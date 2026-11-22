using Ccs.Application.Abstractions;
using Ccs.Application.Common;
using Ccs.Application.Notifications;
using Ccs.Application.Settings;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Ccs.Infrastructure.Identity;

/// <summary>Required two-step for one person: is it required, by when, and has that time passed (they are stopped).</summary>
public sealed record MfaDue(bool Required, DateTimeOffset? Deadline, bool Blocked);

/// <summary>
/// Settings → Security extras: password history, longest sign-in, required two-step and new sign-in alerts.
/// Built on the existing tables (refresh tokens, audit log, notifications) plus the small password history table.
/// </summary>
public sealed class AccountSecurity(CcsDbContext db, SettingsService settings, IClock clock, AuditService audit,
    NotificationService notifications, ILogger<AccountSecurity> log)
{
    /// <summary>Hashes kept per person; the policy can remember up to 24.</summary>
    public const int HistoryKept = 24;

    public Task<SecurityExtras> PolicyAsync(CancellationToken ct = default) => settings.GetSecurityExtrasAsync(ct);

    public async Task<List<string>> RolesAsync(Guid userId, CancellationToken ct) =>
        await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id where ur.UserId == userId select r.Code).ToListAsync(ct);

    // ------------------------------------------------------------------ password history

    /// <summary>
    /// Refuses a new password that matches one of the person's last N: the current one, then the earlier ones kept in
    /// the history (newest first).
    /// </summary>
    public async Task CheckReuseAsync(AppUser user, string newPassword, IPasswordHasher<AppUser> hasher, CancellationToken ct)
    {
        var p = await PolicyAsync(ct);
        if (!p.HistoryEnabled) return;
        var hashes = await db.PasswordHistory.AsNoTracking().Where(h => h.UserId == user.Id)
            .OrderByDescending(h => h.CreatedAt).ThenByDescending(h => h.Id).Select(h => h.PasswordHash).Take(p.HistoryCount).ToListAsync(ct);
        if (user.PasswordHash is { Length: > 0 } current) hashes.Insert(0, current);
        foreach (var h in hashes.Take(p.HistoryCount))
            if (hasher.VerifyHashedPassword(user, h, newPassword) != PasswordVerificationResult.Failed)
                throw new AuthError("passwordReused", 400, "password", new Dictionary<string, object?> { ["count"] = p.HistoryCount });
    }

    /// <summary>Keeps the password a person just replaced (its one-way hash); only the newest 24 stay.</summary>
    public async Task RememberAsync(Guid userId, string? replacedHash, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(replacedHash)) return;
        db.PasswordHistory.Add(new PasswordHistory { UserId = userId, PasswordHash = replacedHash, CreatedAt = clock.UtcNow });
        await db.SaveChangesAsync(ct);
        var old = await db.PasswordHistory.Where(h => h.UserId == userId).OrderByDescending(h => h.CreatedAt).ThenByDescending(h => h.Id)
            .Skip(HistoryKept).Select(h => h.Id).ToListAsync(ct);
        if (old.Count > 0) await db.PasswordHistory.Where(h => old.Contains(h.Id)).ExecuteDeleteAsync(ct);
    }

    // ------------------------------------------------------------------ longest sign-in, required two-step

    public async Task<TimeSpan> MaxSessionAsync(IReadOnlyCollection<string> roles, CancellationToken ct) =>
        (await PolicyAsync(ct)).MaxSession(SecurityGroups.Of(roles));

    public async Task<MfaDue> MfaDueAsync(Guid userId, bool mfaOn, CancellationToken ct)
    {
        if (mfaOn) return new MfaDue(false, null, false);
        var p = await PolicyAsync(ct);
        if (!p.MfaAdmins && !p.MfaStaff && !p.MfaCustomers) return new MfaDue(false, null, false);
        var group = SecurityGroups.Of(await RolesAsync(userId, ct));
        var created = await db.Profiles.AsNoTracking().Where(x => x.Id == userId).Select(x => x.CreatedAt).FirstOrDefaultAsync(ct);
        var deadline = p.MfaDeadline(group, created);
        return deadline is null ? new MfaDue(false, null, false) : new MfaDue(true, deadline, clock.UtcNow >= deadline);
    }

    // ------------------------------------------------------------------ new sign-in alerts

    /// <summary>
    /// After a full sign-in: a device (browser and system, not version) not used on this account within the "known"
    /// days is recorded in the Audit log and, when switched on, the person (and for admin accounts the other admins) is told.
    /// The very first sign-in of an account is not "new". Never fails the sign-in.
    /// </summary>
    public async Task AfterSignInAsync(Guid userId, IReadOnlyCollection<string> roles, string? userAgent, string? ip, Guid sessionId, CancellationToken ct)
    {
        try
        {
            var p = await PolicyAsync(ct);
            var now = clock.UtcNow;
            var device = DeviceInfo.Label(userAgent);
            var since = now.AddDays(-p.KnownDays);
            var earlier = await db.RefreshTokens.AsNoTracking()
                .Where(r => r.UserId == userId && (r.SessionId ?? r.Id) != sessionId)
                .Select(r => new { r.UserAgent, r.CreatedAt }).ToListAsync(ct);
            if (earlier.Count == 0) return;   // first sign-in of this account
            if (earlier.Any(e => e.CreatedAt > since && DeviceInfo.Label(e.UserAgent) == device)) return;

            audit.Write("auth.new_device", "user", userId, null, new { device, ip = DeviceInfo.MaskIp(ip) }, userId);
            await db.SaveChangesAsync(ct);
            if (!p.AlertsEnabled) return;

            var person = await db.Profiles.AsNoTracking().Where(x => x.Id == userId).Select(x => new { x.FullName, x.Email }).FirstAsync(ct);
            var cairo = TimeZoneInfo.FindSystemTimeZoneById(OperatingSystem.IsWindows() ? "Egypt Standard Time" : "Africa/Cairo");
            var at = TimeZoneInfo.ConvertTime(now, cairo).ToString("yyyy-MM-dd HH:mm");
            var source = $"{sessionId:N}";
            await notifications.NotifyAsync(userId, NotificationEvent.NewSignin, null,
                new { device, at, ip = DeviceInfo.MaskIp(ip), path = "/account" }, source, ct);
            if (p.AlertAdmins && roles.Contains(RoleCode.Admin))
            {
                var admins = await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id
                                    where r.Code == RoleCode.Admin && ur.UserId != userId select ur.UserId).Distinct().ToListAsync(ct);
                foreach (var a in admins)
                    await notifications.NotifyAsync(a, NotificationEvent.NewSigninAdmin, null,
                        new { person = person.FullName, email = person.Email, device, at, ip = DeviceInfo.MaskIp(ip), path = "/admin/general/settings/security?p=sessions" }, source, ct);
            }
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "New sign-in check failed for {UserId}", userId);
        }
    }
}
