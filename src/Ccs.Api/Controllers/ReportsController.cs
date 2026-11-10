using System.Globalization;
using System.Text;
using System.Text.Json;
using Ccs.Application.Access;
using Ccs.Application.Abstractions;
using Ccs.Application.Common;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>
/// Insights (batch 4): reports overview and builder with CSV export, SLA report, audit log, and the team leader's "My team".
/// Same figures as report_summary / report_performance / report_builder today, counted over the tickets the caller may see;
/// people with reports_own only see tickets assigned to them.
/// </summary>
[ApiController]
[Authorize]
public sealed class ReportsController(CcsDbContext db, AccessService access, AuditService audit, IClock clock) : ControllerBase
{
    private static readonly TimeZoneInfo Cairo = BusinessCalendar.ResolveTimeZone("Africa/Cairo");
    private static readonly string[] Finished = [TicketStatus.Resolved, TicketStatus.Closed];
    private static readonly string[] NotCounted = ["cancelled", "duplicate", "spam"];

    private sealed record Row(Guid Id, string Status, string Priority, Guid CategoryId, Guid? TeamId, Guid? AgentId, Guid RequesterId,
        Guid? OrgId, Guid? BranchId, DateTimeOffset CreatedAt, DateTimeOffset? ResolvedAt, DateTimeOffset? FirstRespondedAt, bool HasSla,
        bool Breached, int? Rating);

    private async Task<(AccessContext C, bool All)> ReportUser(CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        if (!c.Internal) throw new ForbiddenException();
        var all = c.Admin || c.Has(Permission.ReportsAll);
        if (!all && !c.Has(Permission.ReportsOwn)) throw new ForbiddenException();
        return (c, all);
    }

    private IQueryable<Ticket> Scope(AccessContext c, bool all)
    {
        var q = access.VisibleTickets(db.Tickets.AsNoTracking(), c);
        return all ? q : q.Where(t => t.AssignedAgentId == c.UserId);
    }

    /// <summary>One row per ticket created in the period, with what every report needs.</summary>
    private async Task<List<Row>> RowsAsync(IQueryable<Ticket> q, DateTimeOffset fromAt, DateTimeOffset toAt, CancellationToken ct)
    {
        var rows = await (from t in q.Where(t => t.CreatedAt >= fromAt && t.CreatedAt < toAt)
                          join p in db.Profiles on t.RequesterId equals p.Id
                          join s in db.TicketSlaRecords on t.Id equals s.TicketId into ss
                          from s in ss.DefaultIfEmpty()
                          select new
                          {
                              t.Id, t.Status, t.Priority, t.CategoryId, t.TeamId, t.AssignedAgentId, t.RequesterId, p.OrganizationId, p.BranchId,
                              t.CreatedAt, t.ResolvedAt, FirstRespondedAt = s == null ? null : s.FirstRespondedAt, HasSla = s != null,
                              Breached = s != null && (s.BreachedAt != null || db.TicketSlaCycles.Any(x => x.TicketId == t.Id && x.BreachedAt != null)),
                              Rating = db.CustomerFeedback.Where(f => f.TicketId == t.Id).Select(f => (int?)f.Rating).FirstOrDefault(),
                          }).ToListAsync(ct);
        return rows.Select(r => new Row(r.Id, r.Status, r.Priority, r.CategoryId, r.TeamId, r.AssignedAgentId, r.RequesterId, r.OrganizationId, r.BranchId,
            r.CreatedAt, r.ResolvedAt, r.FirstRespondedAt, r.HasSla, r.Breached, r.Rating)).ToList();
    }

    private static DateOnly Day(DateTimeOffset d) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(d, Cairo).DateTime);
    private static DateTimeOffset CairoMidnight(DateOnly d)
    {
        var local = d.ToDateTime(TimeOnly.MinValue);
        return new DateTimeOffset(local, Cairo.GetUtcOffset(local));
    }
    private static double? Avg(IEnumerable<double> v) { var l = v.ToList(); return l.Count == 0 ? null : Math.Round(l.Average(), 1); }

    /// <summary>The figures of one group of tickets (a builder row, an agent, a team).</summary>
    private static object Metrics(IReadOnlyCollection<Row> g) => new
    {
        total = g.Count,
        resolved = g.Count(r => Finished.Contains(r.Status)),
        open = g.Count(r => !Finished.Contains(r.Status)),
        avgFirst = Avg(g.Where(r => r.FirstRespondedAt != null).Select(r => (r.FirstRespondedAt!.Value - r.CreatedAt).TotalMinutes)),
        avgRes = Avg(g.Where(r => r.ResolvedAt != null).Select(r => (r.ResolvedAt!.Value - r.CreatedAt).TotalMinutes)),
        slaMet = g.Count(r => r.HasSla && !r.Breached),
        slaTotal = g.Count(r => r.HasSla),
        avgRating = g.Any(r => r.Rating != null) ? Math.Round(g.Where(r => r.Rating != null).Average(r => r.Rating!.Value), 2) : (double?)null,
        ratings = g.Count(r => r.Rating != null),
    };

    // ================================================================ overview

    [HttpGet("api/reports/summary")]
    public async Task<object> Summary([FromQuery] int days = 30, CancellationToken ct = default)
    {
        var (c, all) = await ReportUser(ct);
        if (days is not (7 or 30 or 90)) days = 30;
        var to = clock.UtcNow; var from = to.AddDays(-days);
        var q = Scope(c, all);
        var rows = await RowsAsync(q, from, to, ct);
        var resolvedIn = await q.Where(t => t.ResolvedAt >= from && t.ResolvedAt < to).Select(t => new { t.CreatedAt, ResolvedAt = t.ResolvedAt!.Value }).ToListAsync(ct);
        var created = rows.GroupBy(r => Day(r.CreatedAt)).ToDictionary(g => g.Key, g => g.Count());
        var resolved = resolvedIn.GroupBy(r => Day(r.ResolvedAt)).ToDictionary(g => g.Key, g => g.Count());
        var daily = new List<object>();
        for (var d = Day(from); d <= Day(to.AddSeconds(-1)); d = d.AddDays(1)) daily.Add(new { day = d, created = created.GetValueOrDefault(d), resolved = resolved.GetValueOrDefault(d) });

        var cats = await db.TicketCategories.AsNoTracking().ToDictionaryAsync(x => x.Id, x => new { x.NameEn, x.NameAr }, ct);
        var teams = await db.Teams.AsNoTracking().ToDictionaryAsync(x => x.Id, x => new { x.NameEn, x.NameAr }, ct);
        var agentIds = rows.Where(r => r.AgentId != null).Select(r => r.AgentId!.Value).Distinct().ToList();
        var agents = await db.Profiles.AsNoTracking().Where(p => agentIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.FullName, ct);
        return new
        {
            days, all,
            created = rows.Count, resolved = resolvedIn.Count,
            avgFirstResponseMinutes = Avg(rows.Where(r => r.FirstRespondedAt != null).Select(r => (r.FirstRespondedAt!.Value - r.CreatedAt).TotalMinutes)),
            avgResolutionMinutes = Avg(resolvedIn.Select(r => (r.ResolvedAt - r.CreatedAt).TotalMinutes)),
            slaMet = rows.Count(r => r.HasSla && !r.Breached), slaTotal = rows.Count(r => r.HasSla),
            daily,
            byStatus = rows.GroupBy(r => r.Status).ToDictionary(g => g.Key, g => g.Count()),
            byPriority = rows.GroupBy(r => r.Priority).ToDictionary(g => g.Key, g => g.Count()),
            byCategory = rows.GroupBy(r => r.CategoryId).Select(g => new { nameEn = cats.GetValueOrDefault(g.Key)?.NameEn, nameAr = cats.GetValueOrDefault(g.Key)?.NameAr, n = g.Count() }).OrderByDescending(x => x.n),
            byTeam = rows.GroupBy(r => r.TeamId).Select(g => new { nameEn = g.Key is Guid t ? teams.GetValueOrDefault(t)?.NameEn : null, nameAr = g.Key is Guid t2 ? teams.GetValueOrDefault(t2)?.NameAr : null, n = g.Count() }).OrderByDescending(x => x.n),
            agentPerf = rows.Where(r => r.AgentId != null).GroupBy(r => r.AgentId!.Value).OrderByDescending(g => g.Count()).Select(g => new { name = agents.GetValueOrDefault(g.Key, ""), m = Metrics(g.ToList()) }),
            teamPerf = rows.Where(r => r.TeamId != null).GroupBy(r => r.TeamId!.Value).OrderByDescending(g => g.Count()).Select(g => new { nameEn = teams.GetValueOrDefault(g.Key)?.NameEn, nameAr = teams.GetValueOrDefault(g.Key)?.NameAr, m = Metrics(g.ToList()) }),
            satisfaction = new
            {
                count = rows.Count(r => r.Rating != null),
                average = rows.Any(r => r.Rating != null) ? Math.Round(rows.Where(r => r.Rating != null).Average(r => r.Rating!.Value), 2) : (double?)null,
                dist = Enumerable.Range(1, 5).Select(s => rows.Count(r => r.Rating == s)),
                resolvedTotal = rows.Count(r => Finished.Contains(r.Status)),
            },
        };
    }

    /// <summary>Filter choices for the builder.</summary>
    [HttpGet("api/reports/options")]
    public async Task<object> Options(CancellationToken ct)
    {
        await ReportUser(ct);
        return new
        {
            orgs = await db.Organizations.AsNoTracking().OrderBy(o => o.Name).Select(o => new { o.Id, o.Name }).ToListAsync(ct),
            branches = await db.Branches.AsNoTracking().OrderBy(b => b.Name).Select(b => new { b.Id, b.OrganizationId, b.Name }).ToListAsync(ct),
            teams = await db.Teams.AsNoTracking().OrderBy(t => t.NameEn).Select(t => new { t.Id, t.NameEn, t.NameAr }).ToListAsync(ct),
        };
    }

    // ================================================================ report builder

    private static readonly string[] Kinds = ["day", "month", "user", "category", "organization", "branch", "customer", "team", "priority", "status", "sla", "satisfaction"];

    [HttpGet("api/reports/builder")]
    public async Task<object> Builder([FromQuery] string kind, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] Guid? org, [FromQuery] Guid? branch,
        [FromQuery] Guid? team, [FromQuery] string? priority, [FromQuery] string? status, CancellationToken ct)
    {
        var (c, all) = await ReportUser(ct);
        return new { rows = await BuildAsync(c, all, kind, from, to, org, branch, team, priority, status, ct) };
    }

    private async Task<List<Dictionary<string, object?>>> BuildAsync(AccessContext c, bool all, string kind, DateOnly? from, DateOnly? to, Guid? org, Guid? branch,
        Guid? team, string? priority, string? status, CancellationToken ct)
    {
        if (!Kinds.Contains(kind)) throw new AuthError("required", 400, "kind");
        var today = Day(clock.UtcNow);
        var t1 = to ?? today; var t0 = from ?? t1.AddDays(-29);
        if (t0 > t1) (t0, t1) = (t1, t0);
        if (t1.DayNumber - t0.DayNumber > 400) t0 = t1.AddDays(-400);
        var q = Scope(c, all);
        if (team is Guid tm) q = q.Where(t => t.TeamId == tm);
        if (!string.IsNullOrEmpty(priority)) q = q.Where(t => t.Priority == priority);
        if (!string.IsNullOrEmpty(status)) q = q.Where(t => t.Status == status);
        if (org is Guid o) q = q.Where(t => db.Profiles.Any(p => p.Id == t.RequesterId && p.OrganizationId == o));
        if (branch is Guid b) q = q.Where(t => db.Profiles.Any(p => p.Id == t.RequesterId && p.BranchId == b));
        var rows = await RowsAsync(q, CairoMidnight(t0), CairoMidnight(t1.AddDays(1)), ct);

        var orgs = await db.Organizations.AsNoTracking().ToDictionaryAsync(x => x.Id, x => x.Name, ct);
        var branches = await db.Branches.AsNoTracking().ToDictionaryAsync(x => x.Id, x => new { x.Name, x.OrganizationId }, ct);
        var cats = await db.TicketCategories.AsNoTracking().ToDictionaryAsync(x => x.Id, x => (x.NameEn, x.NameAr), ct);
        var teams = await db.Teams.AsNoTracking().ToDictionaryAsync(x => x.Id, x => (x.NameEn, x.NameAr), ct);
        var prios = await db.Priorities.AsNoTracking().ToDictionaryAsync(x => x.Code, x => (x.NameEn, x.NameAr), ct);
        var ids = rows.Select(r => r.RequesterId).Concat(rows.Where(r => r.AgentId != null).Select(r => r.AgentId!.Value)).Distinct().ToList();
        var people = await db.Profiles.AsNoTracking().Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => (p.FullName, p.Email), ct);

        (string Key, string? En, string? Ar, string? Sub) Label(Row r) => kind switch
        {
            "day" => (Day(r.CreatedAt).ToString("yyyy-MM-dd"), Day(r.CreatedAt).ToString("yyyy-MM-dd"), null, null),
            "month" => (Day(r.CreatedAt).ToString("yyyy-MM"), Day(r.CreatedAt).ToString("yyyy-MM"), null, null),
            "user" => r.AgentId is Guid a ? (a.ToString(), people.GetValueOrDefault(a).FullName, null, people.GetValueOrDefault(a).Email) : ("", null, null, null),
            "category" => (r.CategoryId.ToString(), cats.GetValueOrDefault(r.CategoryId).NameEn, cats.GetValueOrDefault(r.CategoryId).NameAr, null),
            "organization" => r.OrgId is Guid og ? (og.ToString(), orgs.GetValueOrDefault(og), null, null) : ("", null, null, null),
            "branch" => r.BranchId is Guid br && branches.TryGetValue(br, out var bx) ? (br.ToString(), bx.Name, null, orgs.GetValueOrDefault(bx.OrganizationId)) : ("", null, null, null),
            "customer" => (r.RequesterId.ToString(), people.GetValueOrDefault(r.RequesterId).FullName, null, people.GetValueOrDefault(r.RequesterId).Email),
            "team" => r.TeamId is Guid tt ? (tt.ToString(), teams.GetValueOrDefault(tt).NameEn, teams.GetValueOrDefault(tt).NameAr, null) : ("", null, null, null),
            "priority" => (r.Priority, prios.GetValueOrDefault(r.Priority).NameEn ?? r.Priority, prios.GetValueOrDefault(r.Priority).NameAr, null),
            "status" => (r.Status, r.Status, null, null),
            "sla" => !r.HasSla ? ("none", "none", null, null) : r.Breached ? ("breached", "breached", null, null) : ("met", "met", null, null),
            _ => r.Rating is int s ? (s.ToString(), s.ToString(CultureInfo.InvariantCulture), null, null) : ("none", "none", null, null),
        };
        var groups = rows.GroupBy(Label).Select(g =>
        {
            var m = JsonSerializer.SerializeToElement(Metrics(g.ToList()));
            var d = new Dictionary<string, object?> { ["key"] = g.Key.Key, ["labelEn"] = g.Key.En, ["labelAr"] = g.Key.Ar, ["sub"] = g.Key.Sub };
            foreach (var p in m.EnumerateObject()) d[p.Name] = p.Value.ValueKind == JsonValueKind.Null ? null : p.Value.ValueKind == JsonValueKind.Number ? p.Value.GetDouble() : p.Value.ToString();
            return d;
        });
        return kind is "day" or "month" ? groups.OrderBy(d => (string?)d["key"]).ToList() : groups.OrderByDescending(d => (double)d["total"]!).ToList();
    }

    // ================================================================ CSV export (Excel opens it in both languages)

    [HttpGet("api/reports/export")]
    public async Task<IActionResult> Export([FromQuery] string kind, [FromQuery] int days = 30, [FromQuery] string? report = null, [FromQuery] DateOnly? from = null, [FromQuery] DateOnly? to = null,
        [FromQuery] Guid? org = null, [FromQuery] Guid? branch = null, [FromQuery] Guid? team = null, [FromQuery] string? priority = null, [FromQuery] string? status = null,
        [FromQuery] string locale = "en", CancellationToken ct = default)
    {
        var (c, all) = await ReportUser(ct);
        if (!c.Admin && !c.Has(Permission.Export)) throw new ForbiddenException();
        var sb = new StringBuilder();
        static string Q(object? v) { var s = Convert.ToString(v, CultureInfo.InvariantCulture) ?? ""; return s.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? $"\"{s.Replace("\"", "\"\"")}\"" : s; }
        void Line(params object?[] v) => sb.AppendLine(string.Join(',', v.Select(Q)));
        var head = new[] { "label", "sub", "total", "resolved", "open", "avg_first_minutes", "avg_resolution_minutes", "sla_met", "sla_total", "avg_rating", "ratings" };
        if (kind == "builder")
        {
            Line(head);
            foreach (var r in await BuildAsync(c, all, report ?? "organization", from, to, org, branch, team, priority, status, ct))
                Line((locale == "ar" ? r["labelAr"] ?? r["labelEn"] : r["labelEn"]), r["sub"], r["total"], r["resolved"], r["open"], r["avgFirst"], r["avgRes"], r["slaMet"], r["slaTotal"], r["avgRating"], r["ratings"]);
        }
        else
        {
            var s = JsonSerializer.SerializeToElement(await Summary(days, ct));
            if (kind is "agents" or "teams")
            {
                Line(head);
                foreach (var x in s.GetProperty(kind == "agents" ? "agentPerf" : "teamPerf").EnumerateArray())
                {
                    var m = x.GetProperty("m");
                    var label = kind == "agents" ? x.GetProperty("name").ToString() : (locale == "ar" ? x.GetProperty("nameAr").ToString() : x.GetProperty("nameEn").ToString());
                    Line(label, "", m.GetProperty("total"), m.GetProperty("resolved"), m.GetProperty("open"), m.GetProperty("avgFirst"), m.GetProperty("avgRes"),
                        m.GetProperty("slaMet"), m.GetProperty("slaTotal"), m.GetProperty("avgRating"), m.GetProperty("ratings"));
                }
            }
            else if (kind == "satisfaction")
            {
                Line("stars", "count");
                var dist = s.GetProperty("satisfaction").GetProperty("dist").EnumerateArray().ToList();
                for (var i = 0; i < dist.Count; i++) Line(i + 1, dist[i]);
            }
            else
            {
                Line("metric", "value");
                foreach (var k in new[] { "days", "created", "resolved", "avgFirstResponseMinutes", "avgResolutionMinutes", "slaMet", "slaTotal" }) Line(k, s.GetProperty(k));
                foreach (var d in s.GetProperty("daily").EnumerateArray()) Line("day " + d.GetProperty("day"), $"{d.GetProperty("created")} created / {d.GetProperty("resolved")} resolved");
            }
        }
        audit.Write("report.export", "report", null, null, new { kind, report, days, from, to });
        await db.SaveChangesAsync(ct);
        var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
        return File(bytes, "text/csv; charset=utf-8", $"ccs-{kind}-{Day(clock.UtcNow):yyyy-MM-dd}.csv");
    }

    // ================================================================ SLA report (last 30 days)

    [HttpGet("api/reports/sla")]
    public async Task<object> Sla(CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        if (!c.Internal) throw new ForbiddenException();
        var all = c.Admin || c.Has(Permission.ReportsAll);
        var now = clock.UtcNow; var since = now.AddDays(-30);
        var q = access.VisibleTickets(db.Tickets.AsNoTracking(), c).Where(t => t.CreatedAt >= since && (t.ClosureReason == null || !NotCounted.Contains(t.ClosureReason)));
        if (!all) q = q.Where(t => t.AssignedAgentId == c.UserId);
        var current = await (from t in q join s in db.TicketSlaRecords on t.Id equals s.TicketId
                             select new { t.Id, t.Reference, t.Subject, s.State, s.CycleNo, s.FirstResponseDue, s.ResolutionDue, s.FirstRespondedAt, ResolvedAt = s.ResolvedAt }).ToListAsync(ct);
        var past = await (from t in q join s in db.TicketSlaCycles on t.Id equals s.TicketId
                          select new { s.CycleNo, s.FirstResponseDue, s.ResolutionDue, s.FirstRespondedAt, s.ResolvedAt }).ToListAsync(ct);
        var entries = current.Select(r => (r.CycleNo, r.FirstResponseDue, r.ResolutionDue, r.FirstRespondedAt, r.ResolvedAt))
            .Concat(past.Select(r => (r.CycleNo, r.FirstResponseDue, r.ResolutionDue, r.FirstRespondedAt, r.ResolvedAt))).ToList();
        object Tally(IEnumerable<(DateTimeOffset? Due, DateTimeOffset? Done)> list)
        {
            int met = 0, total = 0;
            foreach (var (due, done) in list)
            {
                if (due is null) continue;
                if (done is not null) { total++; if (done <= due) met++; }
                else if (due < now) total++;
            }
            return new { met, total, pct = total == 0 ? (int?)null : (int)Math.Round(met * 100.0 / total) };
        }
        object Cycle(IEnumerable<(int CycleNo, DateTimeOffset? FirstResponseDue, DateTimeOffset? ResolutionDue, DateTimeOffset? FirstRespondedAt, DateTimeOffset? ResolvedAt)> list)
        {
            var l = list.ToList();
            return new { n = l.Count, fr = Tally(l.Select(x => (x.FirstResponseDue, x.FirstRespondedAt))), rs = Tally(l.Select(x => (x.ResolutionDue, x.ResolvedAt))) };
        }
        return new
        {
            firstResponse = Tally(current.Select(r => (r.FirstResponseDue, r.FirstRespondedAt))),
            resolution = Tally(current.Select(r => (r.ResolutionDue, r.ResolvedAt))),
            original = Cycle(entries.Where(e => e.CycleNo == 1)),
            afterReopen = Cycle(entries.Where(e => e.CycleNo > 1)),
            now = new[] { SlaState.Breached, SlaState.DueSoon, SlaState.Paused, SlaState.OnTrack }.ToDictionary(s => s, s => current.Count(r => r.State == s)),
            atRisk = current.Where(r => r.State is SlaState.Breached or SlaState.DueSoon)
                .Select(r => new { r.Id, r.Reference, r.Subject, r.State, due = r.FirstRespondedAt is null ? r.FirstResponseDue : r.ResolutionDue }),
        };
    }

    // ================================================================ audit log

    [HttpGet("api/admin/audit")]
    public async Task<object> Audit([FromQuery] string? entity, [FromQuery] int page = 1, CancellationToken ct = default)
    {
        var c = await access.RequireSignedInAsync(ct);
        if (!c.Admin && !c.Viewer) throw new ForbiddenException();
        page = Math.Clamp(page, 1, 1000);
        var types = await db.AuditLogs.AsNoTracking().Select(a => a.EntityType).Distinct().OrderBy(x => x).ToListAsync(ct);
        var q = db.AuditLogs.AsNoTracking();
        if (!string.IsNullOrEmpty(entity) && types.Contains(entity)) q = q.Where(a => a.EntityType == entity);
        var total = await q.CountAsync(ct);
        var rows = await (from a in q
                          join p in db.Profiles on a.ActorId equals p.Id into pp
                          from p in pp.DefaultIfEmpty()
                          orderby a.CreatedAt descending, a.Id descending
                          select new { a.Id, a.Action, a.EntityType, a.EntityId, a.Before, a.After, a.CreatedAt, Actor = p == null ? null : p.FullName })
            .Skip((page - 1) * 25).Take(25).ToListAsync(ct);
        return new { types, total, page, pageSize = 25, rows };
    }

    // ================================================================ My team (team leaders and admins)

    public sealed record MemberSwitch(bool? AutoAssign, bool? CanCreateForCustomers);

    [HttpGet("api/console/my-team")]
    public async Task<object> MyTeam(CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        if (!c.Admin && c.LeaderOfTeams.Count == 0) throw new ForbiddenException();
        var lead = c.LeaderOfTeams.ToList();
        var teams = await db.Teams.AsNoTracking().Where(t => c.Admin || lead.Contains(t.Id)).OrderBy(t => t.NameEn).ToListAsync(ct);
        var teamIds = teams.Select(t => t.Id).ToList();
        var members = await (from m in db.TeamMembers.AsNoTracking()
                             join p in db.Profiles on m.UserId equals p.Id
                             where teamIds.Contains(m.TeamId) && p.AccountStatus == AccountStatus.Active
                             orderby p.FullName
                             select new { m.TeamId, m.UserId, m.IsLeader, p.FullName, p.Email, p.AutoAssign, p.CanCreateForCustomers }).ToListAsync(ct);
        return teams.Select(t => new { t.Id, t.NameEn, t.NameAr, members = members.Where(m => m.TeamId == t.Id) });
    }

    [HttpPut("api/console/my-team/{userId:guid}")]
    public async Task<IActionResult> SetMember(Guid userId, MemberSwitch b, CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        var lead = c.LeaderOfTeams.ToList();
        var inMyTeam = c.Admin || await db.TeamMembers.AnyAsync(m => m.UserId == userId && lead.Contains(m.TeamId), ct);
        if (!inMyTeam) throw new ForbiddenException();
        var p = await db.Profiles.FirstOrDefaultAsync(x => x.Id == userId, ct) ?? throw new NotFoundException();
        var before = new { p.AutoAssign, p.CanCreateForCustomers };
        if (b.AutoAssign is bool a) p.AutoAssign = a;
        if (b.CanCreateForCustomers is bool cc) p.CanCreateForCustomers = cc;
        p.UpdatedAt = clock.UtcNow;
        audit.Write("team.member_switch", "profile", userId, before, new { p.AutoAssign, p.CanCreateForCustomers });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }
}
