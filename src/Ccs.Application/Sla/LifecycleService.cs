using Ccs.Application.Abstractions;
using Ccs.Application.Notifications;
using Ccs.Application.Settings;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Application.Sla;

public sealed record LifecycleResult(int AutoClosedResolved, int NoResponseClosed, int Reminders, int PasswordWarnings);

/// <summary>
/// Ticket lifecycle timers (spec 4) and password expiry. Port of ticket_timers_tick(), the auto-close block of
/// sla_tick() and password_expiry_tick(). Each reminder is sent once (dedupe key carries the day number).
/// </summary>
public sealed class LifecycleService(ICcsDbContext db, SettingsService settings, CalendarProvider calendars,
    NotificationService notifications, IClock clock)
{
    public async Task<LifecycleResult> TickAsync(CancellationToken ct = default)
    {
        var now = clock.UtcNow;
        int d1 = await settings.GetIntAsync("pending_reminder_1_day", 2, ct);
        int d2 = await settings.GetIntAsync("pending_reminder_2_day", 4, ct);
        int df = await settings.GetIntAsync("pending_final_day", 7, ct);
        int dc = await settings.GetIntAsync("no_response_close_days", 10, ct);
        int dr = await settings.GetIntAsync("resolved_reminder_day", 3, ct);
        int dar = await settings.GetIntAsync("auto_close_days", 5, ct);
        int autoClosed = 0, noResponse = 0, sent = 0;

        // 1. Resolved tickets close themselves after N days with no customer response (sla_tick).
        if (dar > 0)
        {
            var cutoff = now.AddDays(-dar);
            var due = await db.Tickets.Where(t => t.Status == TicketStatus.Resolved && t.ResolvedAt < cutoff).ToListAsync(ct);
            foreach (var t in due)
            {
                await CloseBySystemAsync(t, TicketStatus.Resolved, ClosureReasonCode.AutoClosed, $"Closed automatically after {dar} days without a response", now, ct);
                autoClosed++;
            }
            await db.SaveChangesAsync(ct);
        }

        // 2. Waiting for customer: reminders on day 2 and 4, final warning on day 7, close on day 10.
        var pending = await db.Tickets.Where(t => t.Status == TicketStatus.PendingCustomer).ToListAsync(ct);
        foreach (var t in pending)
        {
            var since = await db.TicketStatusHistory.Where(h => h.TicketId == t.Id && h.ToStatus == TicketStatus.PendingCustomer)
                .MaxAsync(h => (DateTimeOffset?)h.CreatedAt, ct) ?? t.UpdatedAt;
            var cal = await CalendarForAsync(t.Id, ct);
            if (dc > 0 && now >= WallClock.LifecycleBoundary(cal, since, dc))
            {
                await CloseBySystemAsync(t, TicketStatus.PendingCustomer, ClosureReasonCode.NoResponse,
                    $"Closed automatically: no customer response after {dc} days", now, ct);
                noResponse++;
                continue;
            }
            int? day = df > 0 && now >= WallClock.LifecycleBoundary(cal, since, df) ? df
                     : d2 > 0 && now >= WallClock.LifecycleBoundary(cal, since, d2) ? d2
                     : d1 > 0 && now >= WallClock.LifecycleBoundary(cal, since, d1) ? d1 : null;
            if (day is int n)
            {
                var evt = n == df ? NotificationEvent.CustomerFinalWarning : NotificationEvent.CustomerReminder;
                await notifications.NotifyAsync(t.RequesterId, evt, t.Id, await notifications.TicketPayloadAsync(t.Id, ct: ct),
                    $"pc:{since.ToUnixTimeSeconds()}:{n}", ct);
                sent++;
            }
        }

        // 3. Resolved: one reminder on day 3 (before auto-close).
        var resolved = await db.Tickets.Where(t => t.Status == TicketStatus.Resolved && t.ResolvedAt != null).ToListAsync(ct);
        foreach (var t in resolved)
        {
            var cal = await CalendarForAsync(t.Id, ct);
            if (dr > 0 && now >= WallClock.LifecycleBoundary(cal, t.ResolvedAt!.Value, dr) && (dar <= 0 || now < t.ResolvedAt.Value.AddDays(dar)))
            {
                await notifications.NotifyAsync(t.RequesterId, NotificationEvent.ResolvedReminder, t.Id,
                    await notifications.TicketPayloadAsync(t.Id, ct: ct), $"rs:{t.ResolvedAt.Value.ToUnixTimeSeconds()}:{dr}", ct);
                sent++;
            }
        }
        await db.SaveChangesAsync(ct);

        var pw = await PasswordExpiryTickAsync(ct);
        return new LifecycleResult(autoClosed, noResponse, sent, pw);
    }

    /// <summary>password_expiry_tick(): warnings at 7, 4 and 1 days; each stage once.</summary>
    public async Task<int> PasswordExpiryTickAsync(CancellationToken ct = default)
    {
        var policy = await settings.GetPasswordPolicyAsync(ct);
        if (!policy.ExpiryEnabled) return 0;
        var now = clock.UtcNow;
        var people = await db.Profiles.Where(p => p.AccountStatus == AccountStatus.Active).ToListAsync(ct);
        var count = 0;
        foreach (var p in people)
        {
            var stage = policy.Stage(p.PasswordChangedAt, now);
            if (stage is >= 1 and <= 3 && stage > p.PasswordWarnStage)
            {
                var daysLeft = Math.Max(0, (int)Math.Ceiling((p.PasswordChangedAt.AddDays(policy.ExpiryDays) - now).TotalDays));
                await notifications.NotifyAsync(p.Id, NotificationEvent.PasswordExpiring, null,
                    new Dictionary<string, object?> { ["days"] = daysLeft }, $"pw:{p.PasswordChangedAt.ToUnixTimeSeconds()}:{stage}", ct);
                p.PasswordWarnStage = (short)stage;
                count++;
            }
        }
        await db.SaveChangesAsync(ct);
        return count;
    }

    private async Task<BusinessCalendar?> CalendarForAsync(Guid ticketId, CancellationToken ct)
    {
        var policyCal = await (from r in db.TicketSlaRecords join p in db.SlaPolicies on r.PolicyId equals p.Id
                               where r.TicketId == ticketId select p.BusinessHoursId).FirstOrDefaultAsync(ct);
        return await calendars.ForTicketAsync(ticketId, policyCal, ct);
    }

    /// <summary>Automatic closing writes the history row and the closure reason (spec 4).</summary>
    private async Task CloseBySystemAsync(Ticket t, string from, string closureReason, string reason, DateTimeOffset now, CancellationToken ct)
    {
        t.Status = TicketStatus.Closed;
        t.ClosedAt = now;
        t.ClosureReason = closureReason;
        t.UpdatedAt = now;
        var h = new TicketStatusHistory
        {
            Id = Guid.NewGuid(), TicketId = t.Id, FromStatus = from, ToStatus = TicketStatus.Closed, ChangedBy = null,
            Reason = reason, ClosureReason = closureReason, CreatedAt = now,
        };
        db.TicketStatusHistory.Add(h);
        await notifications.OnStatusAsync(h, t, ct);   // trg_notify_status: the customer is told
    }
}
