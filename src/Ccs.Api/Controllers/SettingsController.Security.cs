using Ccs.Infrastructure.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>Settings → Security → Locked accounts: who is locked, who has failed attempts, recent unlocks; manual unlock.</summary>
public sealed partial class SettingsController
{
    private static readonly string[] UnlockActions = ["auth.unlocked_manual", "auth.unlocked_auto", "auth.attempts_cleared"];

    [HttpGet("security/locked")]
    public async Task<object> LockedAccounts([FromServices] LockoutService lockout, CancellationToken ct)
    {
        await Need(ct);
        var now = clock.UtcNow;
        var since = now.AddDays(-7);
        var policy = await lockout.PolicyAsync(ct);
        var resetCut = now.AddMinutes(-policy.ResetMinutes);
        var windowCut = now.AddMinutes(-policy.WindowMinutes);

        var rows = await (from u in db.Users
                          join p in db.Profiles on u.Id equals p.Id
                          where u.LockoutEnd > now || u.LockedAt != null || (u.AccessFailedCount > 0 && u.LastFailedAt > resetCut && u.FailedWindowStart > windowCut)
                          select new { p.Id, p.FullName, p.Email, p.Phone, u.AccessFailedCount, u.LockedAt, u.LockoutEnd, u.LastFailedAt }).ToListAsync(ct);

        var unlocks = await db.AuditLogs.AsNoTracking()
            .Where(a => UnlockActions.Contains(a.Action) && a.CreatedAt > since && a.EntityId != null)
            .OrderByDescending(a => a.CreatedAt)
            .Select(a => new { a.EntityId, a.Action, a.CreatedAt, a.ActorId, a.After }).ToListAsync(ct);
        var people = unlocks.Select(x => x.EntityId!.Value).Concat(unlocks.Where(x => x.ActorId != null).Select(x => x.ActorId!.Value)).Distinct().ToList();
        var names = await db.Profiles.AsNoTracking().Where(p => people.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => new { p.FullName, p.Email, p.Phone }, ct);
        var locks7 = await db.AuditLogs.CountAsync(a => a.Action == "auth.locked" && a.CreatedAt > since, ct);

        static string? Reason(string? after)
        {
            try { return after is null ? null : System.Text.Json.JsonDocument.Parse(after).RootElement.TryGetProperty("reason", out var r) ? r.GetString() : null; }
            catch (System.Text.Json.JsonException) { return null; }
        }

        var list = rows.Select(r =>
        {
            var locked = r.LockoutEnd > now;
            // A lock whose time is over but not yet cleared (nobody tried since) counts as unlocked automatically.
            var status = locked ? "locked" : r.LockedAt is not null ? "unlocked" : "active";
            return new
            {
                id = r.Id, name = r.FullName, email = (string?)r.Email, phone = (string?)r.Phone, failed = locked || status == "active" ? r.AccessFailedCount : 0,
                lockedAt = r.LockedAt, until = locked && r.LockoutEnd < DateTimeOffset.MaxValue.AddYears(-1) ? r.LockoutEnd : null,
                adminOnly = locked && r.LockoutEnd >= DateTimeOffset.MaxValue.AddYears(-1),
                lastFailed = r.LastFailedAt, status,
                unlock = status == "unlocked" ? new { action = "auth.unlocked_auto", at = r.LockoutEnd, by = (string?)null, reason = (string?)null } : null,
            };
        }).ToList();
        var shown = list.Select(x => x.id).ToHashSet();
        foreach (var u in unlocks.Where(u => !shown.Contains(u.EntityId!.Value)).GroupBy(u => u.EntityId!.Value).Select(g => g.First()))
        {
            var n = names.GetValueOrDefault(u.EntityId!.Value);
            if (n is null) continue;
            list.Add(new
            {
                id = u.EntityId.Value, name = n.FullName, email = (string?)n.Email, phone = (string?)n.Phone, failed = 0, lockedAt = (DateTimeOffset?)null, until = (DateTimeOffset?)null,
                adminOnly = false, lastFailed = (DateTimeOffset?)null, status = "unlocked",
                unlock = u.Action is null ? null : new { action = u.Action, at = (DateTimeOffset?)u.CreatedAt, by = u.ActorId is Guid a && names.TryGetValue(a, out var an) ? an.FullName : null, reason = Reason(u.After) },
            });
            shown.Add(u.EntityId.Value);
        }
        var order = new Dictionary<string, int> { ["locked"] = 0, ["active"] = 1, ["unlocked"] = 2 };
        return new
        {
            counts = new { locked = list.Count(x => x.status == "locked"), failing = list.Count(x => x.status == "active"), unlocked = list.Count(x => x.status == "unlocked"), locks7 },
            accounts = list.OrderBy(x => order[x.status]).ThenByDescending(x => x.lockedAt ?? x.lastFailed ?? x.unlock?.at).ToList(),
        };
    }

    public sealed record UnlockBody(string? Reason);

    /// <summary>Ends a lock (or clears failed attempts) for one account; the reason and the admin are kept in the Audit log.</summary>
    [HttpPost("security/unlock/{userId:guid}")]
    public async Task<IActionResult> Unlock(Guid userId, UnlockBody b, [FromServices] LockoutService lockout, CancellationToken ct)
    {
        var c = await Need(ct);
        var reason = (b.Reason ?? "").Trim();
        if (reason.Length is < 5 or > 300) throw Err("unlockReason", "reason");
        if (!await lockout.UnlockAsync(userId, c.UserId, reason, ct)) return NotFound();
        return NoContent();
    }
}
