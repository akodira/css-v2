using Ccs.Application.Sla;
using Ccs.Domain;
using Ccs.Domain.Rules;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>Business calendars, v1 admin_assign_calendar and admin_recalculate_sla.</summary>
public sealed partial class CatalogAdminController
{
    public sealed record AssignBody(string Kind, Guid Id, Guid? CalendarId);

    /// <summary>Which calendar each organization, branch and team uses (null = follows the default).</summary>
    [HttpGet("calendar-assignments")]
    public async Task<object> CalendarAssignments(CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        return new
        {
            organizations = await db.Organizations.AsNoTracking().OrderBy(o => o.Name).Select(o => new { o.Id, o.Name, o.BusinessHoursId }).ToListAsync(ct),
            branches = await db.Branches.AsNoTracking().OrderBy(b => b.Name).Select(b => new { b.Id, b.OrganizationId, b.Name, b.BusinessHoursId }).ToListAsync(ct),
            teams = await db.Teams.AsNoTracking().OrderBy(t => t.NameEn).Select(t => new { t.Id, t.NameEn, t.NameAr, t.BusinessHoursId }).ToListAsync(ct),
        };
    }

    [HttpPut("calendar-assignments")]
    public async Task<IActionResult> AssignCalendar(AssignBody b, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        if (b.CalendarId is Guid cal && !await db.BusinessHours.AnyAsync(h => h.Id == cal, ct)) throw Err("notFound", "calendarId");
        var n = b.Kind switch
        {
            "organization" => await db.Organizations.Where(o => o.Id == b.Id).ExecuteUpdateAsync(s => s.SetProperty(o => o.BusinessHoursId, b.CalendarId), ct),
            "branch" => await db.Branches.Where(o => o.Id == b.Id).ExecuteUpdateAsync(s => s.SetProperty(o => o.BusinessHoursId, b.CalendarId), ct),
            "team" => await db.Teams.Where(o => o.Id == b.Id).ExecuteUpdateAsync(s => s.SetProperty(o => o.BusinessHoursId, b.CalendarId), ct),
            _ => throw Err("required", "kind"),
        };
        if (n == 0) throw Err("notFound", "id");
        audit.Write("calendar.assigned", "system", b.Id, null, new { kind = b.Kind, calendar = b.CalendarId });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Open, running tickets whose calendar is this one get their deadlines counted again in business time.</summary>
    [HttpPost("business-hours/{id:guid}/recalculate")]
    public async Task<object> Recalculate(Guid id, [FromServices] CalendarProvider calendars, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        var cal = await calendars.GetAsync(id, ct) ?? throw Err("notFound", "id");
        var rows = await (from r in db.TicketSlaRecords
                          join t in db.Tickets on r.TicketId equals t.Id
                          join p in db.SlaPolicies on r.PolicyId equals (Guid?)p.Id
                          where r.ResolvedAt == null && r.PausedAt == null && t.Status != TicketStatus.Resolved && t.Status != TicketStatus.Closed
                          select new { r, p }).ToListAsync(ct);
        var n = 0;
        foreach (var x in rows)
        {
            if (await calendars.TicketCalendarIdAsync(x.r.TicketId, x.p.BusinessHoursId, ct) != id) continue;
            var (fr, rs) = SlaClock.RecalculateForPriority(x.r.CycleStartedAt, x.r.PausedTotalSeconds, x.p.FirstResponseMinutes, x.p.ResolutionMinutes, cal);
            if (x.r.FirstRespondedAt is null) x.r.FirstResponseDue = fr;
            x.r.ResolutionDue = rs;
            x.r.UpdatedAt = clock.UtcNow;
            n++;
        }
        audit.Write("sla.recalculated", "system", id, null, new { calendar = id, tickets = n });
        await db.SaveChangesAsync(ct);
        return new { count = n };
    }
}
