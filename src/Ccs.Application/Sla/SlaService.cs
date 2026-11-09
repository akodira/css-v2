using System.Text.Json;
using Ccs.Application.Abstractions;
using Ccs.Application.Common;
using Ccs.Application.Notifications;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Ccs.Application.Sla;

/// <summary>Loads business calendars. Port of ticket_calendar(): branch, then organization, then team, then the policy's.</summary>
public sealed class CalendarProvider(ICcsDbContext db)
{
    private readonly Dictionary<Guid, BusinessCalendar> _cache = [];

    public async Task<BusinessCalendar?> GetAsync(Guid? businessHoursId, CancellationToken ct = default)
    {
        if (businessHoursId is not Guid id) return null;
        if (_cache.TryGetValue(id, out var cal)) return cal;
        var bh = await db.BusinessHours.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id, ct);
        if (bh is null) return null;
        var holidays = await db.Holidays.Where(h => h.BusinessHoursId == id).Select(h => h.HolidayDate).ToListAsync(ct);
        return _cache[id] = BusinessCalendar.FromJson(bh.Timezone, bh.WeeklySchedule, holidays);
    }

    public async Task<Guid?> TicketCalendarIdAsync(Guid ticketId, Guid? fallback, CancellationToken ct = default)
    {
        var row = await (from t in db.Tickets
                         join p in db.Profiles on t.RequesterId equals p.Id
                         where t.Id == ticketId
                         select new
                         {
                             Branch = db.Branches.Where(b => b.Id == p.BranchId).Select(b => b.BusinessHoursId).FirstOrDefault(),
                             Org = db.Organizations.Where(o => o.Id == p.OrganizationId).Select(o => o.BusinessHoursId).FirstOrDefault(),
                             Team = db.Teams.Where(tm => tm.Id == t.TeamId).Select(tm => tm.BusinessHoursId).FirstOrDefault(),
                         }).AsNoTracking().FirstOrDefaultAsync(ct);
        return row?.Branch ?? row?.Org ?? row?.Team ?? fallback;
    }

    public async Task<BusinessCalendar?> ForTicketAsync(Guid ticketId, Guid? policyCalendar, CancellationToken ct = default) =>
        await GetAsync(await TicketCalendarIdAsync(ticketId, policyCalendar, ct), ct);
}

/// <summary>The two SLA clocks on every ticket (spec 4). Port of the sla_* functions.</summary>
public sealed class SlaService(ICcsDbContext db, CalendarProvider calendars, NotificationService notifications,
    AuditService audit, IClock clock, ILogger<SlaService> log)
{
    public async Task<SlaPolicy?> PolicyForAsync(string priority, CancellationToken ct = default) =>
        await db.SlaPolicies.AsNoTracking().FirstOrDefaultAsync(p => p.Priority == priority && p.IsActive, ct)
        ?? await db.SlaPolicies.AsNoTracking().FirstOrDefaultAsync(p => p.Priority == "normal" && p.IsActive, ct);

    /// <summary>create_ticket() + sla_set_due trigger: due dates counted in business time from creation.</summary>
    public async Task StartAsync(Ticket t, CancellationToken ct = default)
    {
        var pol = await PolicyForAsync(t.Priority, ct);
        if (pol is null) return;
        var cal = await calendars.ForTicketAsync(t.Id, pol.BusinessHoursId, ct);
        db.TicketSlaRecords.Add(new TicketSlaRecord
        {
            TicketId = t.Id,
            PolicyId = pol.Id,
            FirstResponseDue = WallClock.AddMinutes(cal, t.CreatedAt, pol.FirstResponseMinutes),
            ResolutionDue = WallClock.AddMinutes(cal, t.CreatedAt, pol.ResolutionMinutes),
            State = SlaState.OnTrack,
            CycleNo = 1,
            CycleStartedAt = t.CreatedAt,
            UpdatedAt = clock.UtcNow,
        });
    }

    public async Task PauseAsync(Guid ticketId, CancellationToken ct = default)
    {
        var r = await db.TicketSlaRecords.FirstOrDefaultAsync(x => x.TicketId == ticketId, ct);
        if (r is null || r.PausedAt is not null || r.ResolvedAt is not null) return;
        r.PausedAt = clock.UtcNow;
        r.State = SlaState.Paused;
        r.UpdatedAt = clock.UtcNow;
    }

    /// <summary>sla_resume(): the business time left when paused is carried forward from now.</summary>
    public async Task ResumeAsync(Guid ticketId, CancellationToken ct = default)
    {
        var r = await db.TicketSlaRecords.FirstOrDefaultAsync(x => x.TicketId == ticketId && x.PausedAt != null, ct);
        if (r is null) return;
        var pol = r.PolicyId is Guid pid ? await db.SlaPolicies.AsNoTracking().FirstOrDefaultAsync(p => p.Id == pid, ct) : null;
        var cal = await calendars.ForTicketAsync(ticketId, pol?.BusinessHoursId, ct);
        var now = clock.UtcNow;
        var pausedAt = r.PausedAt!.Value;

        r.PausedTotalSeconds += Math.Max(0, (int)(now - pausedAt).TotalSeconds);
        if (r.ResolutionDue is DateTimeOffset rd && rd > pausedAt)
            r.ResolutionDue = WallClock.AddMinutes(cal, now, WallClock.MinutesBetween(cal, pausedAt, rd));
        if (r.FirstRespondedAt is null && r.FirstResponseDue is DateTimeOffset fd && fd > pausedAt)
            r.FirstResponseDue = WallClock.AddMinutes(cal, now, WallClock.MinutesBetween(cal, pausedAt, fd));
        r.PausedAt = null;
        r.State = SlaState.OnTrack;
        r.UpdatedAt = now;
    }

    public async Task MarkFirstResponseAsync(Guid ticketId, CancellationToken ct = default)
    {
        var r = await db.TicketSlaRecords.FirstOrDefaultAsync(x => x.TicketId == ticketId, ct);
        if (r is null) return;
        r.FirstRespondedAt ??= clock.UtcNow;
        r.UpdatedAt = clock.UtcNow;
    }

    public async Task CompleteAsync(Guid ticketId, CancellationToken ct = default)
    {
        var r = await db.TicketSlaRecords.FirstOrDefaultAsync(x => x.TicketId == ticketId, ct);
        if (r is null) return;
        var now = clock.UtcNow;
        r.ResolvedAt = now;
        r.State = SlaState.Completed;
        if (r.BreachedAt is null && r.ResolutionDue < now) r.BreachedAt = now;
        r.UpdatedAt = now;
    }

    /// <summary>sla_start_reopen_cycle(): archive the cycle and start a fresh one (spec 3, reopening).</summary>
    public async Task StartReopenCycleAsync(Guid ticketId, CancellationToken ct = default)
    {
        var r = await db.TicketSlaRecords.FirstOrDefaultAsync(x => x.TicketId == ticketId, ct);
        if (r is null) return;
        var now = clock.UtcNow;
        if (!await db.TicketSlaCycles.AnyAsync(c => c.TicketId == ticketId && c.CycleNo == r.CycleNo, ct))
        {
            db.TicketSlaCycles.Add(new TicketSlaCycle
            {
                TicketId = ticketId, CycleNo = r.CycleNo, Kind = r.CycleNo == 1 ? "initial" : "reopen",
                StartedAt = r.CycleStartedAt, EndedAt = now, PolicyId = r.PolicyId,
                FirstResponseDue = r.FirstResponseDue, ResolutionDue = r.ResolutionDue,
                FirstRespondedAt = r.FirstRespondedAt, ResolvedAt = r.ResolvedAt, BreachedAt = r.BreachedAt,
                State = r.State, PausedTotalSeconds = r.PausedTotalSeconds,
            });
        }
        var pol = r.PolicyId is Guid pid ? await db.SlaPolicies.AsNoTracking().FirstOrDefaultAsync(p => p.Id == pid, ct) : null;
        r.CycleNo += 1;
        r.CycleStartedAt = now;
        r.ResolvedAt = null;
        r.UpdatedAt = now;
        if (pol is null) return;

        var cal = await calendars.ForTicketAsync(ticketId, pol.BusinessHoursId, ct);
        r.FirstResponseDue = WallClock.AddMinutes(cal, now, pol.FirstResponseMinutes);
        r.ResolutionDue = WallClock.AddMinutes(cal, now, pol.ResolutionMinutes);
        r.FirstRespondedAt = null;
        r.PausedAt = null;
        r.PausedTotalSeconds = 0;
        r.State = SlaState.OnTrack;
        r.BreachedAt = null;
        r.WarningSentAt = null;
        r.BreachNotifiedAt = null;
        audit.Write("ticket.sla_cycle_started", "ticket", ticketId, null, new { cycle = r.CycleNo });
    }

    /// <summary>Priority change: new policy, deadlines re-counted in business time (fixes the known wall-clock issue).</summary>
    public async Task ApplyPriorityAsync(Guid ticketId, string priority, CancellationToken ct = default)
    {
        var r = await db.TicketSlaRecords.FirstOrDefaultAsync(x => x.TicketId == ticketId, ct);
        var pol = await PolicyForAsync(priority, ct);
        if (r is null || pol is null || r.ResolvedAt is not null) return;
        var cal = await calendars.ForTicketAsync(ticketId, pol.BusinessHoursId, ct);
        var (fr, rs) = SlaClock.RecalculateForPriority(r.CycleStartedAt, r.PausedTotalSeconds, pol.FirstResponseMinutes, pol.ResolutionMinutes, cal);
        r.PolicyId = pol.Id;
        if (r.FirstRespondedAt is null) r.FirstResponseDue = fr;
        r.ResolutionDue = rs;
        r.UpdatedAt = clock.UtcNow;
    }

    /// <summary>
    /// sla_tick(): re-check every running clock. Runs every minute from the background job.
    /// Warning, breach and escalation fire once per ticket, cycle and clock (unique index on ticket_sla_events).
    /// </summary>
    public async Task<int> TickAsync(CancellationToken ct = default)
    {
        var now = clock.UtcNow;
        var rows = await (from s in db.TicketSlaRecords
                          join p in db.SlaPolicies on s.PolicyId equals p.Id
                          join t in db.Tickets on s.TicketId equals t.Id
                          where s.ResolvedAt == null && s.PausedAt == null
                                && t.Status != TicketStatus.Resolved && t.Status != TicketStatus.Closed
                          select new { Record = s, Policy = p }).ToListAsync(ct);
        var changes = 0;
        foreach (var row in rows)
        {
            try
            {
                var s = row.Record;
                var cal = await calendars.ForTicketAsync(s.TicketId, row.Policy.BusinessHoursId, ct);
                var ev = SlaClock.Evaluate(new SlaSnapshot(s.FirstRespondedAt, s.FirstResponseDue, s.ResolutionDue,
                    row.Policy.FirstResponseMinutes, row.Policy.ResolutionMinutes, row.Policy.WarningThresholdPct), now, cal);

                if (ev.State != s.State)
                {
                    s.State = ev.State;
                    s.UpdatedAt = now;
                    if (ev.State == SlaState.Breached) s.BreachedAt ??= now;
                    if (ev.State == SlaState.DueSoon) s.WarningSentAt ??= now;
                    changes++;
                }
                if (ev.State is SlaState.DueSoon or SlaState.Breached)
                    await FireAsync(s, ev.Clock, "warning", row.Policy.EscalationRules, ct);
                if (ev.State == SlaState.Breached)
                {
                    await FireAsync(s, ev.Clock, "breach", row.Policy.EscalationRules, ct);
                    s.BreachNotifiedAt ??= now;
                }
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex)
            {
                // Another worker fired the same event first: the unique index did its job. Move on.
                log.LogWarning(ex, "SLA tick skipped ticket {TicketId}", row.Record.TicketId);
                foreach (var e in ((DbContext)db).ChangeTracker.Entries().Where(e => e.State != EntityState.Unchanged).ToList())
                    e.State = EntityState.Detached;
            }
        }
        return changes;
    }

    /// <summary>sla_fire(): one event row (deduplicated), then notify the roles listed in the policy rules.</summary>
    private async Task FireAsync(TicketSlaRecord s, string clockName, string evt, string rulesJson, CancellationToken ct)
    {
        if (await db.TicketSlaEvents.AnyAsync(e => e.TicketId == s.TicketId && e.CycleNo == s.CycleNo && e.Clock == clockName && e.Event == evt, ct))
            return;
        var row = new TicketSlaEvent { Id = Guid.NewGuid(), TicketId = s.TicketId, Clock = clockName, Event = evt, CycleNo = s.CycleNo, CreatedAt = clock.UtcNow };
        db.TicketSlaEvents.Add(row);

        var notifyEvent = evt == "warning" ? NotificationEvent.SlaWarning : NotificationEvent.SlaBreach;
        var payload = await notifications.TicketPayloadAsync(s.TicketId, new Dictionary<string, object?> { ["clock"] = clockName }, ct);
        foreach (var roles in RulesFor(rulesJson, evt))
            foreach (var u in await notifications.SlaRecipientsAsync(s.TicketId, roles, ct))
                await notifications.NotifyAsync(u, notifyEvent, s.TicketId, payload, row.Id.ToString(), ct);

        audit.Write("ticket.sla_" + evt, "ticket", s.TicketId, null, new { clock = clockName }, actorOverride: null);
    }

    private static IEnumerable<List<string>> RulesFor(string json, string evt)
    {
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
        foreach (var rule in doc.RootElement.EnumerateArray())
        {
            if (!rule.TryGetProperty("event", out var e) || e.GetString() != evt) continue;
            var roles = new List<string>();
            if (rule.TryGetProperty("notify", out var n) && n.ValueKind == JsonValueKind.Array)
                roles.AddRange(n.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x != ""));
            yield return roles;
        }
    }
}
