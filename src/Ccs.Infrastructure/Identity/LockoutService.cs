using System.Data;
using System.Data.Common;
using Ccs.Application.Abstractions;
using Ccs.Application.Common;
using Ccs.Application.Notifications;
using Ccs.Application.Settings;
using Ccs.Domain;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace Ccs.Infrastructure.Identity;

/// <summary>Lock state for one sign-in answer. <c>Until</c> is null for a lock that only an admin can end.</summary>
public sealed record LockState(bool Locked, DateTimeOffset? Until, int Failed, int? Remaining, bool AutoUnlock);

/// <summary>
/// Account lockout (Settings → Security → Account lockout policy), used by every way in: password, two-step code and
/// the emailed one-time code. Real accounts keep their count in Identity's AccessFailedCount / LockoutEnd plus three
/// dates; each change is one SQL UPDATE, so failures sent at the same moment are all counted and only one of them locks.
/// Email addresses and phone numbers without an account are counted in memory with the same rule, so the answers never
/// reveal whether an account exists. Passwords never reach this class.
/// </summary>
public sealed class LockoutService(CcsDbContext db, SettingsService settings, IClock clock, IMemoryCache cache,
    AuditService audit, NotificationService notifications, ILogger<LockoutService> log)
{
    private static readonly DateTimeOffset Forever = DateTimeOffset.MaxValue;

    public Task<LockoutPolicy> PolicyAsync(CancellationToken ct) => settings.GetLockoutPolicyAsync(ct);

    // ------------------------------------------------------------------ real accounts

    /// <summary>Current state; ends an expired lock (automatic unlock, recorded once).</summary>
    public async Task<LockState> StateAsync(Guid userId, CancellationToken ct)
    {
        var p = await PolicyAsync(ct);
        var now = clock.UtcNow;
        var u = await db.Users.AsNoTracking().Where(x => x.Id == userId)
            .Select(x => new { x.AccessFailedCount, x.LockoutEnd, x.LockedAt, x.FailedWindowStart, x.LastFailedAt }).FirstOrDefaultAsync(ct);
        if (u is null) return new(false, null, 0, null, p.AutoUnlock);
        if (u.LockoutEnd is DateTimeOffset end && end > now)
            return p.Enabled ? new(true, end >= Forever.AddYears(-1) ? null : end, u.AccessFailedCount, 0, p.AutoUnlock) : new(false, null, 0, null, p.AutoUnlock);
        if (u.LockedAt is DateTimeOffset lockedAt)
        {
            // The lock time is over: clear it once (two requests at the same moment cannot both record the unlock).
            var n = await ExecAsync("UPDATE dbo.AspNetUsers SET LockedAt = NULL, LockoutEnd = NULL, AccessFailedCount = 0, FailedWindowStart = NULL, LastFailedAt = NULL " +
                                    "WHERE Id = @id AND LockedAt = @at AND (LockoutEnd IS NULL OR LockoutEnd <= @now)", ct, ("@id", userId), ("@at", lockedAt), ("@now", now));
            if (n == 1)
            {
                audit.Write("auth.unlocked_auto", "user", userId, new { lockedAt }, new { at = now });
                await db.SaveChangesAsync(ct);
            }
            return new(false, null, 0, null, p.AutoUnlock);
        }
        // A count whose window or reset period has passed no longer counts.
        var c = new LockoutRules.Counter(u.AccessFailedCount, u.FailedWindowStart, u.LastFailedAt);
        var failed = LockoutRules.StartsOver(c, p, now) ? 0 : c.Failed;
        return new(false, null, failed, p.ShownRemaining(failed), p.AutoUnlock);
    }

    /// <summary>One failed attempt (method: password, two_step). Locks when the maximum is reached within the time window.</summary>
    public async Task<LockState> FailAsync(Guid userId, string method, string? ip, CancellationToken ct)
    {
        var p = await PolicyAsync(ct);
        var now = clock.UtcNow;
        // Same rule as LockoutRules.AddFailure, applied by SQL Server in one statement (the right side reads the old values).
        var failed = await ScalarAsync(
            "UPDATE dbo.AspNetUsers SET " +
            "  AccessFailedCount = CASE WHEN LastFailedAt IS NULL OR FailedWindowStart IS NULL OR LastFailedAt < @resetCut OR FailedWindowStart < @windowCut THEN 1 ELSE AccessFailedCount + 1 END, " +
            "  FailedWindowStart = CASE WHEN LastFailedAt IS NULL OR FailedWindowStart IS NULL OR LastFailedAt < @resetCut OR FailedWindowStart < @windowCut THEN @now ELSE FailedWindowStart END, " +
            "  LastFailedAt = @now " +
            "OUTPUT inserted.AccessFailedCount WHERE Id = @id", ct,
            ("@id", userId), ("@now", now), ("@resetCut", now.AddMinutes(-p.ResetMinutes)), ("@windowCut", now.AddMinutes(-p.WindowMinutes)));
        log.LogWarning("auth.login_failed {UserId} {Method} {Count}", userId, method, failed);
        audit.Write("auth.login_failed", "user", userId, null, new { method, failed });

        if (LockoutRules.ShouldLock(new(failed, now, now), p))
        {
            var until = p.LockUntil(now);
            // Only the request that actually starts the lock records it and sends the notifications.
            // A new ConcurrencyStamp: a save that loaded the account before the lock cannot quietly undo it.
            var n = await ExecAsync("UPDATE dbo.AspNetUsers SET LockoutEnd = @until, LockedAt = @now, ConcurrencyStamp = CONVERT(nvarchar(36), NEWID()) WHERE Id = @id AND (LockoutEnd IS NULL OR LockoutEnd <= @now)",
                ct, ("@id", userId), ("@until", until), ("@now", now));
            if (n == 1)
            {
                audit.Write("auth.locked", "user", userId, null, new { failed, method, until = p.AutoUnlock ? until : (DateTimeOffset?)null, ip });
                await NotifyLockedAsync(userId, now, p, ct);
            }
            await db.SaveChangesAsync(ct);
            return new(true, p.AutoUnlock ? until : null, failed, 0, p.AutoUnlock);
        }
        await db.SaveChangesAsync(ct);
        return new(false, null, failed, p.ShownRemaining(failed), p.AutoUnlock);
    }

    /// <summary>After a successful sign-in: the count starts again.</summary>
    public Task ResetAsync(Guid userId, CancellationToken ct) =>
        ExecAsync("UPDATE dbo.AspNetUsers SET AccessFailedCount = 0, FailedWindowStart = NULL, LastFailedAt = NULL WHERE Id = @id AND (AccessFailedCount <> 0 OR LastFailedAt IS NOT NULL)", ct, ("@id", userId));

    /// <summary>Admin action: ends the lock and clears the count; recorded with the admin and the reason.</summary>
    public async Task<bool> UnlockAsync(Guid userId, Guid adminId, string reason, CancellationToken ct)
    {
        var before = await db.Users.AsNoTracking().Where(x => x.Id == userId).Select(x => new { x.AccessFailedCount, x.LockoutEnd, x.LockedAt }).FirstOrDefaultAsync(ct);
        if (before is null) return false;
        await ExecAsync("UPDATE dbo.AspNetUsers SET LockedAt = NULL, LockoutEnd = NULL, AccessFailedCount = 0, FailedWindowStart = NULL, LastFailedAt = NULL WHERE Id = @id", ct, ("@id", userId));
        var wasLocked = before.LockoutEnd > clock.UtcNow;
        audit.Write(wasLocked ? "auth.unlocked_manual" : "auth.attempts_cleared", "user", userId,
            new { failed = before.AccessFailedCount, before.LockedAt, before.LockoutEnd }, new { reason }, adminId);
        await db.SaveChangesAsync(ct);
        return true;
    }

    private async Task NotifyLockedAsync(Guid userId, DateTimeOffset now, LockoutPolicy p, CancellationToken ct)
    {
        var cairo = TimeZoneInfo.FindSystemTimeZoneById(OperatingSystem.IsWindows() ? "Egypt Standard Time" : "Africa/Cairo");
        string Local(DateTimeOffset t) => TimeZoneInfo.ConvertTime(t, cairo).ToString("yyyy-MM-dd HH:mm");
        // "{until}" in the reader's language: a time (Cairo), or that only an admin can end the lock.
        string Until(string locale) => p.AutoUnlock ? Local(p.LockUntil(now)) : locale == "ar" ? "أن يفتحه أحد المسؤولين" : "an administrator unlocks it";
        var source = $"{userId:N}:{now.UtcTicks}";
        var person = await db.Profiles.AsNoTracking().Where(x => x.Id == userId).Select(x => new { x.FullName, x.Email, x.PreferredLocale }).FirstOrDefaultAsync(ct);
        if (person is null) return;
        if (p.NotifyUser)
            await notifications.NotifyAsync(userId, NotificationEvent.AccountLocked, null,
                new { until = Until(person.PreferredLocale), path = "/forgot-password" }, source, ct);
        if (p.NotifyAdmins)
        {
            var admins = await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id
                                join pr in db.Profiles on ur.UserId equals pr.Id
                                where r.Code == RoleCode.Admin && ur.UserId != userId select new { pr.Id, pr.PreferredLocale }).Distinct().ToListAsync(ct);
            foreach (var a in admins)
                await notifications.NotifyAsync(a.Id, NotificationEvent.AccountLockedAdmin, null,
                    new { person = person.FullName, email = person.Email, at = Local(now), until = Until(a.PreferredLocale), path = "/admin/general/settings/security?p=locked" }, source, ct);
        }
    }

    // ------------------------------------------------------------------ addresses without an account

    private sealed class Ghost { public LockoutRules.Counter C; public DateTimeOffset? Until; }

    private Ghost GhostFor(string identifier) =>
        cache.GetOrCreate("lockout:" + identifier.Trim().ToLowerInvariant(), e => { e.SlidingExpiration = TimeSpan.FromDays(1); return new Ghost(); })!;

    /// <summary>Same answers as a real account for an address that has none (nothing is stored in the database).</summary>
    public async Task<LockState> GhostStateAsync(string identifier, CancellationToken ct)
    {
        var p = await PolicyAsync(ct);
        var g = GhostFor(identifier);
        lock (g)
        {
            if (p.Enabled && g.Until is DateTimeOffset u && u > clock.UtcNow) return new(true, u >= Forever.AddYears(-1) ? null : u, g.C.Failed, 0, p.AutoUnlock);
            if (g.Until is not null) { g.Until = null; g.C = default; }
            return new(false, null, g.C.Failed, p.ShownRemaining(g.C.Failed), p.AutoUnlock);
        }
    }

    public async Task<LockState> GhostFailAsync(string identifier, CancellationToken ct)
    {
        var p = await PolicyAsync(ct);
        var now = clock.UtcNow;
        var g = GhostFor(identifier);
        lock (g)
        {
            g.C = LockoutRules.AddFailure(g.C, p, now);
            if (LockoutRules.ShouldLock(g.C, p)) { g.Until = p.LockUntil(now); return new(true, p.AutoUnlock ? g.Until : null, g.C.Failed, 0, p.AutoUnlock); }
            return new(false, null, g.C.Failed, p.ShownRemaining(g.C.Failed), p.AutoUnlock);
        }
    }

    // ------------------------------------------------------------------ SQL helpers (one statement each, on EF's connection)

    private async Task<int> ExecAsync(string sql, CancellationToken ct, params (string Name, object Value)[] args)
    {
        await using var cmd = await CommandAsync(sql, args, ct);
        return await cmd.ExecuteNonQueryAsync(ct);
    }

    private async Task<int> ScalarAsync(string sql, CancellationToken ct, params (string Name, object Value)[] args)
    {
        await using var cmd = await CommandAsync(sql, args, ct);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct) ?? 0);
    }

    private async Task<DbCommand> CommandAsync(string sql, (string Name, object Value)[] args, CancellationToken ct)
    {
        var conn = db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open) await db.Database.OpenConnectionAsync(ct);
        var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.Transaction = db.Database.CurrentTransaction?.GetDbTransaction();
        foreach (var (name, value) in args)
        {
            var prm = cmd.CreateParameter(); prm.ParameterName = name; prm.Value = value; cmd.Parameters.Add(prm);
        }
        return cmd;
    }
}
