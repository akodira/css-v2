using Ccs.Application.Access;
using Ccs.Application.Abstractions;
using Ccs.Application.Common;
using Ccs.Application.Tickets;
using Ccs.Domain;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>
/// Support console figures: the queue counters, the team SLA strip, the red sidebar counts and the dashboard.
/// Everything is counted over the tickets the caller may see (same rule as the ticket list).
/// </summary>
[ApiController]
[Authorize]
[Route("api/console")]
public sealed class ConsoleController(CcsDbContext db, AccessService access, TicketQueries tickets, IClock clock) : ControllerBase
{
    private static readonly string[] Open = [TicketStatus.New, TicketStatus.Open, TicketStatus.InProgress, TicketStatus.PendingCustomer, TicketStatus.PendingInternal, TicketStatus.Reopened];
    private const double YellowBelow = 0.5, RedBelow = 0.2;   // share of the target still left (same as the current clock)

    private async Task<Ccs.Domain.Rules.AccessContext> Internal(CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        return c.Internal ? c : throw new ForbiddenException();
    }

    /// <summary>Counters above the queue and the "My team" SLA strip (admins: all teams; scoped admins: their organizations or branches; leaders: their teams).</summary>
    [HttpGet("counts")]
    public async Task<object> Counts(CancellationToken ct)
    {
        var c = await Internal(ct);
        var q = access.VisibleTickets(db.Tickets.AsNoTracking(), c);
        var mine = await q.CountAsync(t => t.AssignedAgentId == c.UserId && Open.Contains(t.Status), ct);
        var unassigned = await q.CountAsync(t => t.AssignedAgentId == null && Open.Contains(t.Status), ct);
        var breached = await q.CountAsync(t => db.TicketSlaRecords.Any(r => r.TicketId == t.Id && r.State == SlaState.Breached), ct);
        var dueSoon = await q.CountAsync(t => db.TicketSlaRecords.Any(r => r.TicketId == t.Id && r.State == SlaState.DueSoon), ct);
        var closed = await q.CountAsync(t => t.Status == TicketStatus.Closed, ct);
        var escIds = await tickets.EscalatedIdsAsync(c, ct);
        var escalated = escIds.Count == 0 ? 0 : await q.CountAsync(t => escIds.Contains(t.Id) && Open.Contains(t.Status), ct);

        var scoped = !c.Admin && c.ScopeLevel is not null;   // Organization admin / Branch admin: the tickets in their scope (already limited by VisibleTickets)
        var showStrip = c.Admin || scoped || c.LeaderOfTeams.Count > 0;
        var stripKind = c.Admin ? "all" : scoped ? "scope" : "team";
        int green = 0, yellow = 0, red = 0, overdue = 0;
        if (showStrip)
        {
            var lead = c.LeaderOfTeams.ToList();
            var rows = await (from t in q
                              join r in db.TicketSlaRecords on t.Id equals r.TicketId
                              where Open.Contains(t.Status) && (c.Admin || scoped || (t.TeamId != null && lead.Contains(t.TeamId.Value)))
                              select new { t.CreatedAt, SlaResolvedAt = r.ResolvedAt, r.FirstResponseDue, r.ResolutionDue, r.FirstRespondedAt, r.PausedAt, r.PausedTotalSeconds }).ToListAsync(ct);
            var now = clock.UtcNow;
            foreach (var r in rows)
            {
                // The running clock: first response until someone replies, then resolution.
                var firstClock = r.FirstRespondedAt is null && r.FirstResponseDue is not null;
                DateTimeOffset? due = firstClock ? r.FirstResponseDue : r.ResolutionDue;
                // A resolution clock that already has a resolved time is finished (met/late), not running (same as v1).
                if (due is null || r.PausedAt is not null || (!firstClock && r.SlaResolvedAt is not null)) continue;
                var total = Math.Max(1, (due.Value - r.CreatedAt).TotalSeconds - r.PausedTotalSeconds);
                var left = (due.Value - now).TotalSeconds;
                if (left <= 0) overdue++;
                else if (left / total < RedBelow) red++;
                else if (left / total < YellowBelow) yellow++;
                else green++;
            }
        }
        return new { mine, unassigned, breached, dueSoon, closed, escalated, strip = showStrip ? new { green, yellow, red, overdue, kind = stripKind } : null };
    }

    /// <summary>Customers screen (v1 console_customers): customers this person may see, newest first, max 200,
    /// with the number of their tickets the person can open.</summary>
    [HttpGet("customers")]
    public async Task<object> Customers([FromQuery] string? q, CancellationToken ct)
    {
        var c = await Internal(ct);
        var customers = from p in db.Profiles.AsNoTracking()
                        where db.CcsUserRoles.Any(ur => ur.UserId == p.Id && db.CcsRoles.Any(r => r.Id == ur.RoleId && r.Code == RoleCode.Customer))
                        select p;
        customers = access.CustomersInScope(customers, c);
        var term = (q ?? "").Trim();
        if (term.Length > 80) term = term[..80];
        if (term.Length > 0)
            customers = customers.Where(p => p.FullName.Contains(term) || p.Email.Contains(term) || (p.Phone ?? "").Contains(term)
                || db.Organizations.Any(o => o.Id == p.OrganizationId && o.Name.Contains(term))
                || db.Branches.Any(b => b.Id == p.BranchId && b.Name.Contains(term)));
        var visible = access.VisibleTickets(db.Tickets.AsNoTracking(), c);
        return await customers.OrderByDescending(p => p.CreatedAt).Take(200).Select(p => new
        {
            p.Id, p.FullName, p.Email, p.Phone, p.AccountStatus, p.CreatedAt,
            organization = db.Organizations.Where(o => o.Id == p.OrganizationId).Select(o => o.Name).FirstOrDefault(),
            branch = db.Branches.Where(b => b.Id == p.BranchId).Select(b => b.Name).FirstOrDefault(),
            tickets = visible.Count(t => t.RequesterId == p.Id),
            open = visible.Count(t => t.RequesterId == p.Id && Open.Contains(t.Status)),
        }).ToListAsync(ct);
    }

    /// <summary>Teams for the queue filter.</summary>
    [HttpGet("teams")]
    public async Task<object> Teams(CancellationToken ct)
    {
        await Internal(ct);
        return await db.Teams.AsNoTracking().Where(t => t.IsActive).OrderBy(t => t.NameEn).Select(t => new { t.Id, t.NameEn, t.NameAr }).ToListAsync(ct);
    }

    /// <summary>The red numbers in the sidebar: unassigned open tickets, and accounts waiting for approval.</summary>
    [HttpGet("badges")]
    public async Task<object> Badges(CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        if (!c.Internal) return new { tickets = 0, approvals = 0 };
        var q = access.VisibleTickets(db.Tickets.AsNoTracking(), c);
        // v1: active tickets that are mine or still unassigned.
        var uid = c.UserId;
        var unassigned = await q.CountAsync(t => (t.AssignedAgentId == null || t.AssignedAgentId == uid) && Open.Contains(t.Status), ct);
        var approvals = 0;
        if (c.Admin || c.Has(Permission.ApproveCustomers))
            approvals = await db.Profiles.CountAsync(p => p.AccountStatus == AccountStatus.PendingApproval, ct);
        return new { tickets = unassigned, approvals };
    }

    /// <summary>Dashboard: same figures as the current dashboard (last 30 days, Cairo days).</summary>
    [HttpGet("dashboard")]
    public async Task<object> Dashboard(CancellationToken ct)
    {
        var c = await Internal(ct);
        var all = access.VisibleTickets(db.Tickets.AsNoTracking(), c);
        var to = clock.UtcNow;
        // v1 reportSummary(30): from 00:00 Cairo, 29 days before today, so the chart shows 30 Cairo days ending today.
        var cairo = Ccs.Domain.Rules.BusinessCalendar.ResolveTimeZone("Africa/Cairo");
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(to, cairo).DateTime);
        var startLocal = today.AddDays(-29).ToDateTime(TimeOnly.MinValue);
        var from = new DateTimeOffset(startLocal, cairo.GetUtcOffset(startLocal));

        var kpi = new
        {
            total = await all.CountAsync(ct),
            fresh = await all.CountAsync(t => t.Status == TicketStatus.New, ct),
            working = await all.CountAsync(t => Open.Contains(t.Status) && t.Status != TicketStatus.New, ct),
            done = await all.CountAsync(t => t.Status == TicketStatus.Resolved || t.Status == TicketStatus.Closed, ct),
            overdue = await all.CountAsync(t => db.TicketSlaRecords.Any(r => r.TicketId == t.Id && r.State == SlaState.Breached), ct),
            orgs = await access.VisibleOrganizations(db.Organizations.AsNoTracking(), c).CountAsync(ct),
            branches = await access.VisibleBranches(db.Branches.AsNoTracking(), c).CountAsync(ct),
        };

        // v1 report_tickets(): period figures count everything visible with reports_all, otherwise only my assigned tickets.
        var me = c.UserId;
        var rep = c.Admin || c.Has(Permission.ReportsAll) ? all : all.Where(t => t.AssignedAgentId == me);
        var period = rep.Where(t => t.CreatedAt >= from && t.CreatedAt < to);
        var rows = await (from t in period
                          join p in db.Profiles on t.RequesterId equals p.Id
                          select new { t.Id, t.Status, t.Priority, t.CategoryId, t.AssignedAgentId, t.CreatedAt, t.ResolvedAt, p.OrganizationId, p.BranchId }).ToListAsync(ct);
        var resolvedInPeriod = await rep.Where(t => t.ResolvedAt >= from && t.ResolvedAt < to).Select(t => new { t.CreatedAt, ResolvedAt = t.ResolvedAt!.Value }).ToListAsync(ct);
        var ids = rows.Select(r => r.Id).ToList();
        var sla = await db.TicketSlaRecords.AsNoTracking().Where(r => ids.Contains(r.TicketId))
            .Select(r => new { r.TicketId, r.FirstRespondedAt, r.BreachedAt }).ToListAsync(ct);
        var cycleBreached = await db.TicketSlaCycles.AsNoTracking().Where(x => ids.Contains(x.TicketId) && x.BreachedAt != null).Select(x => x.TicketId).Distinct().ToListAsync(ct);
        var ratings = await db.CustomerFeedback.AsNoTracking().Where(f => ids.Contains(f.TicketId)).Select(f => (int)f.Rating).ToListAsync(ct);

        // Trend: one point per Cairo day.
        var tz = Ccs.Domain.Rules.BusinessCalendar.ResolveTimeZone("Africa/Cairo");
        DateOnly Day(DateTimeOffset d) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(d, tz).DateTime);
        var firstDay = Day(from); var lastDay = Day(to.AddSeconds(-1));
        var created = rows.GroupBy(r => Day(r.CreatedAt)).ToDictionary(g => g.Key, g => g.Count());
        var resolved = resolvedInPeriod.GroupBy(r => Day(r.ResolvedAt)).ToDictionary(g => g.Key, g => g.Count());
        var daily = new List<object>();
        for (var d = firstDay; d <= lastDay; d = d.AddDays(1))
            daily.Add(new { day = d, created = created.GetValueOrDefault(d), resolved = resolved.GetValueOrDefault(d) });

        var slaMet = sla.Count(s => s.BreachedAt is null && !cycleBreached.Contains(s.TicketId));
        var firsts = rows.Join(sla.Where(s => s.FirstRespondedAt != null), r => r.Id, s => s.TicketId, (r, s) => (s.FirstRespondedAt!.Value - r.CreatedAt).TotalMinutes).ToList();
        var resolutions = resolvedInPeriod.Select(r => (r.ResolvedAt - r.CreatedAt).TotalMinutes).ToList();

        var orgs = await access.VisibleOrganizations(db.Organizations.AsNoTracking(), c).Select(o => new { o.Id, o.Name }).ToListAsync(ct);
        var branches = await access.VisibleBranches(db.Branches.AsNoTracking(), c).Join(db.Organizations, b => b.OrganizationId, o => o.Id, (b, o) => new { b.Id, b.Name, Org = o.Name }).ToListAsync(ct);
        static bool Fin(DateTimeOffset? r) => r is not null;
        var byOrg = orgs.Select(o => new { name = o.Name, total = rows.Count(r => r.OrganizationId == o.Id), resolved = rows.Count(r => r.OrganizationId == o.Id && Fin(r.ResolvedAt)) })
            .OrderByDescending(x => x.total).ThenBy(x => x.name).ToList();
        var byBranch = branches.Select(b => new { name = b.Name, org = b.Org, total = rows.Count(r => r.BranchId == b.Id), resolved = rows.Count(r => r.BranchId == b.Id && Fin(r.ResolvedAt)) })
            .OrderByDescending(x => x.total).ThenBy(x => x.name).ToList();

        var cats = await db.TicketCategories.AsNoTracking().Select(x => new { x.Id, x.NameEn, x.NameAr }).ToListAsync(ct);
        var prios = await db.Priorities.AsNoTracking().OrderBy(p => p.SortOrder).Select(p => new { p.Code, p.NameEn, p.NameAr, p.Color, p.Icon }).ToListAsync(ct);
        var agentIds = await all.Where(t => t.AssignedAgentId != null && Open.Contains(t.Status)).GroupBy(t => t.AssignedAgentId!.Value)
            .Select(g => new { Id = g.Key, N = g.Count() }).OrderByDescending(x => x.N).Take(6).ToListAsync(ct);
        var agentNames = await db.Profiles.AsNoTracking().Where(p => agentIds.Select(a => a.Id).Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.FullName, ct);

        var recent = await (from t in all
                            join p in db.Profiles on t.RequesterId equals p.Id
                            orderby t.UpdatedAt descending
                            select new { t.Id, t.Reference, t.Subject, t.Priority, t.Status, t.UpdatedAt, Customer = p.FullName }).Take(5).ToListAsync(ct);

        return new
        {
            kpi,
            created = rows.Count,
            resolved = resolvedInPeriod.Count,
            daily,
            slaMet, slaTotal = sla.Count,
            avgFirstResponseMinutes = firsts.Count == 0 ? (double?)null : Math.Round(firsts.Average(), 1),
            avgResolutionMinutes = resolutions.Count == 0 ? (double?)null : Math.Round(resolutions.Average(), 1),
            byStatus = rows.GroupBy(r => r.Status).ToDictionary(g => g.Key, g => g.Count()),
            byPriority = prios.Select(p => new { p.Code, p.NameEn, p.NameAr, p.Color, p.Icon, n = rows.Count(r => r.Priority == p.Code) }).Where(x => x.n > 0),
            byCategory = cats.Select(x => new { x.NameEn, x.NameAr, n = rows.Count(r => r.CategoryId == x.Id) }).Where(x => x.n > 0).OrderByDescending(x => x.n),
            byOrg, byBranch,
            workload = agentIds.Select(a => new { name = agentNames.GetValueOrDefault(a.Id, ""), n = a.N }),
            satisfaction = new
            {
                count = ratings.Count,
                average = ratings.Count == 0 ? (double?)null : Math.Round(ratings.Average(), 2),
                dist = Enumerable.Range(1, 5).Select(s => ratings.Count(r => r == s)),
                resolvedTotal = rows.Count(r => r.Status is TicketStatus.Resolved or TicketStatus.Closed),
            },
            recent,
            queue = await Counts(ct),
        };
    }
}
