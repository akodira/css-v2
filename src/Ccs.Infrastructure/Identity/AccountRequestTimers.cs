using Ccs.Application.Abstractions;
using Ccs.Application.Notifications;
using Ccs.Application.Settings;
using Ccs.Application.Sla;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Ccs.Infrastructure.Identity;

public sealed record AccountRequestResult(int Removed, int Reminders);

/// <summary>
/// Account requests that are left waiting (Settings, Security, Sign-up and registration):
/// sign-ups whose email was never confirmed are removed after N days, so the list stays clean and the person can
/// register again; requests waiting for approval remind their approvers every N working days.
/// </summary>
public sealed class AccountRequestTimers(CcsDbContext db, AccountApprovers approvers, CalendarProvider calendars,
    NotificationService notifications, SettingsService settings, IClock clock, ILogger<AccountRequestTimers> log)
{
    public const int DefaultUnconfirmedDays = 7, DefaultReminderDays = 2;

    public async Task<AccountRequestResult> TickAsync(CancellationToken ct = default) =>
        new(await RemoveUnconfirmedAsync(ct), await RemindApproversAsync(ct));

    /// <summary>Removes sign-ups still waiting for email confirmation N days after they registered (0 = keep them).</summary>
    public async Task<int> RemoveUnconfirmedAsync(CancellationToken ct = default)
    {
        var days = await settings.GetIntAsync("signup_unconfirmed_days", DefaultUnconfirmedDays, ct);
        if (days <= 0) return 0;
        var cutoff = clock.UtcNow.AddDays(-days);
        var stale = await db.Profiles.Where(p => p.AccountStatus == AccountStatus.PendingVerification && p.CreatedAt < cutoff).ToListAsync(ct);
        var removed = 0;
        foreach (var p in stale)
        {
            // Never someone with history (an account an admin moved back to this status, say).
            if (await db.Tickets.AnyAsync(t => t.RequesterId == p.Id || t.AssignedAgentId == p.Id, ct)
                || await db.TicketMessages.AnyAsync(m => m.AuthorId == p.Id, ct)) continue;
            db.CcsUserRoles.RemoveRange(await db.CcsUserRoles.Where(x => x.UserId == p.Id).ToListAsync(ct));
            db.Notifications.RemoveRange(await db.Notifications.Where(x => x.UserId == p.Id).ToListAsync(ct));
            db.AuthCodes.RemoveRange(await db.AuthCodes.Where(x => x.UserId == p.Id).ToListAsync(ct));
            db.Profiles.Remove(p);
            // The sign-in account row; its roles, tokens and other Identity rows follow it (ON DELETE CASCADE).
            if (await db.Users.FirstOrDefaultAsync(u => u.Id == p.Id, ct) is { } user) db.Users.Remove(user);
            removed++;
        }
        if (removed > 0)
        {
            await db.SaveChangesAsync(ct);
            log.LogInformation("Removed {Count} sign-ups not confirmed within {Days} days", removed, days);
        }
        return removed;
    }

    /// <summary>
    /// Every N working days a request waits for approval, its approvers get a reminder (0 = off).
    /// Working days come from the branch's calendar, else the organization's, else the default calendar.
    /// </summary>
    public async Task<int> RemindApproversAsync(CancellationToken ct = default)
    {
        var every = await settings.GetIntAsync("approval_reminder_days", DefaultReminderDays, ct);
        if (every <= 0) return 0;
        var now = clock.UtcNow;
        var waiting = await db.Profiles.AsNoTracking().Where(p => p.AccountStatus == AccountStatus.PendingApproval).ToListAsync(ct);
        var fallbackCal = await db.BusinessHours.AsNoTracking().Where(b => b.IsDefault).Select(b => (Guid?)b.Id).FirstOrDefaultAsync(ct);
        var sent = 0;
        foreach (var p in waiting)
        {
            var since = p.EmailVerifiedAt ?? p.UpdatedAt;
            var calId = await db.Branches.Where(b => b.Id == p.BranchId).Select(b => b.BusinessHoursId).FirstOrDefaultAsync(ct)
                        ?? await db.Organizations.Where(o => o.Id == p.OrganizationId).Select(o => o.BusinessHoursId).FirstOrDefaultAsync(ct)
                        ?? fallbackCal;
            var cal = await calendars.GetAsync(calId, ct);
            var stage = TicketTimers.InternalReminderStage(now, every, d => WallClock.WorkingDaysBoundary(cal, since, d));
            if (stage == 0) continue;
            var payload = AuthService.ApprovalPayload(p, stage * every);
            foreach (var to in await approvers.ForAsync(p.OrganizationId, p.BranchId, ct))
                await notifications.NotifyAsync(to, NotificationEvent.ApprovalReminder, null, payload, $"ar:{p.Id}:{since.ToUnixTimeSeconds()}:{stage}", ct);
            sent++;
        }
        await db.SaveChangesAsync(ct);
        return sent;
    }
}
