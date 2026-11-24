using Ccs.Application.Common;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>
/// Teams per place. Kinds of team (Technical support, Billing…) are defined once by the system admin. Every organization
/// and branch has its own teams of those kinds; organization and branch admins manage the teams of their own places, the
/// system admin also central teams (no place = every place). "Only these people": per category and team.
/// </summary>
public sealed partial class PeopleController
{
    public sealed record KindBody(string NameEn, string NameAr, bool CentralFallback, int SortOrder);
    public sealed record PlaceTeamBody(Guid? KindId, Guid? OrganizationId, Guid? BranchId, string? NameEn, string? NameAr, bool IsActive, string? AssignMethod);
    public sealed record MemberRow(Guid UserId, bool IsLeader);
    public sealed record MembersBody(MemberRow[] Members);
    public sealed record CategoryPeopleBody(Guid CategoryId, Guid TeamId, Guid[] UserIds);

    // ------------------------------------------------------------------ kinds of team

    [HttpGet("api/admin/team-kinds")]
    public async Task<object> Kinds(CancellationToken ct)
    {
        await MeAsync(ct);
        return await db.TeamKinds.AsNoTracking().OrderBy(k => k.SortOrder).ThenBy(k => k.NameEn)
            .Select(k => new { k.Id, k.NameEn, k.NameAr, k.CentralFallback, k.SortOrder, Teams = db.Teams.Count(t => t.KindId == k.Id) }).ToListAsync(ct);
    }

    [HttpPost("api/admin/team-kinds")]
    public async Task<object> CreateKind(KindBody b, CancellationToken ct)
    {
        await AdminAsync(ct);
        var k = new TeamKind { Id = Guid.NewGuid(), CreatedAt = clock.UtcNow };
        await ApplyKindAsync(k, b, ct);
        db.TeamKinds.Add(k);
        audit.Write("team_kind.create", "team_kind", k.Id, null, b);
        await db.SaveChangesAsync(ct);
        return new { k.Id };
    }

    [HttpPut("api/admin/team-kinds/{id:guid}")]
    public async Task<IActionResult> UpdateKind(Guid id, KindBody b, CancellationToken ct)
    {
        await AdminAsync(ct);
        var k = await db.TeamKinds.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var before = new { k.NameEn, k.NameAr, k.CentralFallback, k.SortOrder };
        await ApplyKindAsync(k, b, ct);
        audit.Write("team_kind.update", "team_kind", id, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("api/admin/team-kinds/{id:guid}")]
    public async Task<IActionResult> DeleteKind(Guid id, CancellationToken ct)
    {
        await AdminAsync(ct);
        var k = await db.TeamKinds.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (await db.Teams.AnyAsync(t => t.KindId == id, ct) || await db.TicketCategories.AnyAsync(c => c.TeamKindId == id, ct)) throw Err("inUse", null, 409);
        db.TeamKinds.Remove(k);
        audit.Write("team_kind.delete", "team_kind", id, new { k.NameEn, k.NameAr }, null);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task ApplyKindAsync(TeamKind k, KindBody b, CancellationToken ct)
    {
        var en = (b.NameEn ?? "").Trim();
        var ar = (b.NameAr ?? "").Trim();
        if (en.Length is < 2 or > 80) throw Err("name", "nameEn");
        if (ar.Length is < 2 or > 80) throw Err("name", "nameAr");
        if (await db.TeamKinds.AnyAsync(x => x.Id != k.Id && (x.NameEn == en || x.NameAr == ar), ct)) throw Err("nameTaken", "nameEn", 409);
        k.NameEn = en; k.NameAr = ar; k.CentralFallback = b.CentralFallback; k.SortOrder = b.SortOrder;
    }

    // ------------------------------------------------------------------ teams

    /// <summary>A team the caller may manage: the system admin all; others the teams of the places they cover (never central ones).</summary>
    private static bool Manages(Me me, Team t) => me.C.Admin || (t.OrganizationId is not null && me.Covers(t.OrganizationId, t.BranchId));

    [HttpGet("api/admin/teams")]
    public async Task<object> Teams(CancellationToken ct)
    {
        var me = await MeAsync(ct);
        var all = await db.Teams.AsNoTracking().ToListAsync(ct);
        var teams = all.Where(t => Manages(me, t)).ToList();
        var ids = teams.Select(t => t.Id).ToList();
        var members = await (from m in db.TeamMembers.AsNoTracking() join p in db.Profiles on m.UserId equals p.Id
                             where ids.Contains(m.TeamId)
                             select new { m.TeamId, m.UserId, m.IsLeader, p.FullName, p.Email, p.AutoAssign }).ToListAsync(ct);
        // Open = not resolved or closed (the load automatic assignment uses).
        var open = db.Tickets.AsNoTracking().Where(t => t.Status != TicketStatus.Resolved && t.Status != TicketStatus.Closed);
        var memberIds = members.Select(m => m.UserId).Distinct().ToList();
        var openByAgent = await open.Where(t => t.AssignedAgentId != null && memberIds.Contains(t.AssignedAgentId.Value))
            .GroupBy(t => t.AssignedAgentId!.Value).Select(g => new { Id = g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.N, ct);
        var openByTeam = await open.Where(t => t.TeamId != null && ids.Contains(t.TeamId.Value))
            .GroupBy(t => t.TeamId!.Value).Select(g => new { Id = g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.N, ct);
        var orgs = await db.Organizations.AsNoTracking().Where(o => o.IsActive).OrderBy(o => o.Name).Select(o => new { o.Id, o.Name, o.ParentId }).ToListAsync(ct);
        var branches = await db.Branches.AsNoTracking().Where(b => b.IsActive).OrderBy(b => b.Name)
            .Select(b => new { b.Id, b.OrganizationId, b.Name, OrganizationName = db.Organizations.Where(o => o.Id == b.OrganizationId).Select(o => o.Name).FirstOrDefault() }).ToListAsync(ct);
        return new
        {
            teams = teams.OrderBy(t => t.OrganizationId.HasValue).ThenBy(t => t.NameEn).Select(t => new
            {
                t.Id, t.NameEn, t.NameAr, t.IsActive, t.KindId, t.OrganizationId, t.BranchId, t.AssignMethod,
                OpenTickets = openByTeam.GetValueOrDefault(t.Id),
                Members = members.Where(m => m.TeamId == t.Id).OrderByDescending(m => m.IsLeader).ThenBy(m => m.FullName)
                    .Select(m => new { m.UserId, m.FullName, m.Email, m.IsLeader, m.AutoAssign, OpenTickets = openByAgent.GetValueOrDefault(m.UserId) }),
            }),
            kinds = await db.TeamKinds.AsNoTracking().OrderBy(k => k.SortOrder).ThenBy(k => k.NameEn).Select(k => new { k.Id, k.NameEn, k.NameAr, k.CentralFallback }).ToListAsync(ct),
            // Places the caller may put a team in.
            organizations = orgs.Where(o => me.Covers(o.Id, null)),
            branches = branches.Where(b => me.Covers(b.OrganizationId, b.Id)),
            canCentral = me.C.Admin,
            candidates = await CandidatesAsync(me, ct),
            defaultMethod = (await HttpContext.RequestServices.GetRequiredService<Ccs.Application.Settings.SettingsService>().GetRoutingAsync(ct)).Method,
        };
    }

    /// <summary>Active agents and team leaders the caller may put in a team (scoped admins: the people of their places).</summary>
    private async Task<List<Candidate>> CandidatesAsync(Me me, CancellationToken ct)
    {
        var rows = await (from p in db.Profiles join ur in db.CcsUserRoles on p.Id equals ur.UserId join r in db.CcsRoles on ur.RoleId equals r.Id
                          where p.AccountStatus == AccountStatus.Active && (r.Code == RoleCode.Agent || r.Code == RoleCode.TeamLeader)
                          orderby p.FullName select new Candidate(p.Id, p.FullName, p.Email, r.Code)).ToListAsync(ct);
        // One line per person, even with both the Agent and the Team leader role.
        rows = rows.GroupBy(x => x.Id).Select(g => g.OrderByDescending(x => x.Role == RoleCode.TeamLeader).First()).ToList();
        if (me.C.Admin) return rows;
        var mine = (await PeopleAsync(me, ct)).Select(p => p.Id).ToHashSet();
        return rows.Where(x => mine.Contains(x.Id)).ToList();
    }
    public sealed record Candidate(Guid Id, string FullName, string Email, string Role);

    [HttpPost("api/admin/teams")]
    public async Task<object> CreateTeam(PlaceTeamBody b, CancellationToken ct)
    {
        var me = await MeAsync(ct);
        var t = new Team { Id = Guid.NewGuid(), CreatedAt = clock.UtcNow };
        await ApplyTeamAsync(me, t, b, ct);
        db.Teams.Add(t);
        audit.Write("team.create", "team", t.Id, null, b);
        await db.SaveChangesAsync(ct);
        return new { t.Id };
    }

    [HttpPut("api/admin/teams/{id:guid}")]
    public async Task<IActionResult> UpdateTeam(Guid id, PlaceTeamBody b, CancellationToken ct)
    {
        var me = await MeAsync(ct);
        var t = await db.Teams.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (!Manages(me, t)) throw Err("outOfScope", null, 403);
        var before = new { t.NameEn, t.NameAr, t.IsActive, t.KindId, t.OrganizationId, t.BranchId, t.AssignMethod };
        await ApplyTeamAsync(me, t, b, ct);
        audit.Write("team.update", "team", id, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("api/admin/teams/{id:guid}")]
    public async Task<IActionResult> DeleteTeam(Guid id, CancellationToken ct)
    {
        var me = await MeAsync(ct);
        var t = await db.Teams.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (!Manages(me, t)) throw Err("outOfScope", null, 403);
        if (await db.Tickets.AnyAsync(x => x.TeamId == id, ct) || await db.TicketCategories.AnyAsync(x => x.DefaultTeamId == id, ct))
            throw Err("inUse", null, 409);
        db.TeamMembers.RemoveRange(db.TeamMembers.Where(m => m.TeamId == id));
        db.CategoryPeople.RemoveRange(db.CategoryPeople.Where(m => m.TeamId == id));
        db.Teams.Remove(t);
        audit.Write("team.delete", "team", id, new { t.NameEn, t.NameAr }, null);
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { throw Err("inUse", null, 409); }
        return NoContent();
    }

    [HttpPut("api/admin/teams/{id:guid}/members")]
    public async Task<IActionResult> Members(Guid id, MembersBody b, CancellationToken ct)
    {
        var me = await MeAsync(ct);
        var team = await db.Teams.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (!Manages(me, team)) throw Err("outOfScope", null, 403);
        var wanted = (b.Members ?? []).GroupBy(m => m.UserId).Select(g => g.First()).ToList();
        var ids = wanted.Select(m => m.UserId).ToList();
        var roles = await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id
                           where ids.Contains(ur.UserId) select new { ur.UserId, r.Code }).ToListAsync(ct);
        var before = await db.TeamMembers.AsNoTracking().Where(m => m.TeamId == id).Select(m => new { m.UserId, m.IsLeader }).ToListAsync(ct);
        var allowed = me.C.Admin ? null : (await CandidatesAsync(me, ct)).Select(x => x.Id).ToHashSet();
        foreach (var m in wanted)
        {
            var codes = roles.Where(r => r.UserId == m.UserId).Select(r => r.Code).ToList();
            if (!codes.Any(x => x is RoleCode.Agent or RoleCode.TeamLeader)) throw Err("user_must_be_agent_or_team_leader");
            if (m.IsLeader && !codes.Contains(RoleCode.TeamLeader)) throw Err("leaderRole");
            // A scoped admin keeps members they cannot see, but adds only people of their own places.
            if (allowed is not null && !allowed.Contains(m.UserId) && !before.Any(x => x.UserId == m.UserId)) throw Err("outOfScope", null, 403);
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.TeamMembers.Where(m => m.TeamId == id).ExecuteDeleteAsync(ct);
        await db.CategoryPeople.Where(x => x.TeamId == id && !ids.Contains(x.UserId)).ExecuteDeleteAsync(ct);
        foreach (var m in wanted) db.TeamMembers.Add(new TeamMember { TeamId = id, UserId = m.UserId, IsLeader = m.IsLeader });
        audit.Write("team.members", "team", id, before, wanted);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return NoContent();
    }

    private async Task ApplyTeamAsync(Me me, Team t, PlaceTeamBody b, CancellationToken ct)
    {
        // Without a kind: an existing team keeps its kind and place (name and switches only); a new team named by the
        // system admin becomes a central team of a new kind with that name (how teams were made before places).
        if (b.KindId is null && t.KindId is Guid keep)
        {
            var en0 = (b.NameEn ?? "").Trim(); var ar0 = (b.NameAr ?? "").Trim();
            if (en0.Length is < 2 or > 120) throw Err("name", "nameEn");
            if (ar0.Length is < 2 or > 120) throw Err("name", "nameAr");
            t.NameEn = en0; t.NameAr = ar0; t.IsActive = b.IsActive; t.UpdatedAt = clock.UtcNow;
            return;
        }
        TeamKind kind;
        if (b.KindId is Guid kid) kind = await db.TeamKinds.AsNoTracking().FirstOrDefaultAsync(k => k.Id == kid, ct) ?? throw Err("required", "kindId");
        else
        {
            if (!me.C.Admin) throw Err("required", "kindId");
            var en1 = (b.NameEn ?? "").Trim(); var ar1 = (b.NameAr ?? "").Trim();
            if (en1.Length is < 2 or > 80) throw Err("name", "nameEn");
            if (ar1.Length is < 2 or > 80) throw Err("name", "nameAr");
            if (await db.TeamKinds.AnyAsync(k => k.NameEn == en1 || k.NameAr == ar1, ct)) throw Err("nameTaken", "nameEn", 409);
            kind = new TeamKind { Id = Guid.NewGuid(), NameEn = en1, NameAr = ar1, CreatedAt = clock.UtcNow, SortOrder = await db.TeamKinds.CountAsync(ct) + 1 };
            db.TeamKinds.Add(kind);
            await db.SaveChangesAsync(ct);   // the kind row must exist before the team that points at it
        }
        Guid? org = b.OrganizationId, branch = b.BranchId;
        string place = "";
        if (branch is Guid bid)
        {
            var br = await db.Branches.AsNoTracking().FirstOrDefaultAsync(x => x.Id == bid, ct) ?? throw Err("required", "branchId");
            org = br.OrganizationId; place = br.Name;
        }
        else if (org is Guid oid) place = await db.Organizations.Where(o => o.Id == oid).Select(o => o.Name).FirstOrDefaultAsync(ct) ?? throw Err("required", "organizationId");
        // Central teams (no place) are the system admin's; others only in places the caller covers.
        if (org is null ? !me.C.Admin : !me.Covers(org, branch)) throw Err("outOfScope", "organizationId", 403);
        if (b.AssignMethod is not null && !TeamRouting.IsMethod(b.AssignMethod)) throw Err("required", "assignMethod");
        if (await db.Teams.AnyAsync(x => x.Id != t.Id && x.KindId == kind.Id && x.OrganizationId == org && x.BranchId == branch, ct))
            throw Err("teamExists", "kindId", 409);
        var en = (b.NameEn ?? "").Trim();
        var ar = (b.NameAr ?? "").Trim();
        t.NameEn = en.Length > 0 ? en[..Math.Min(en.Length, 120)] : place.Length > 0 ? $"{kind.NameEn} ({place})" : kind.NameEn;
        t.NameAr = ar.Length > 0 ? ar[..Math.Min(ar.Length, 120)] : place.Length > 0 ? $"{kind.NameAr} ({place})" : kind.NameAr;
        t.KindId = kind.Id; t.OrganizationId = org; t.BranchId = branch;
        t.AssignMethod = b.AssignMethod; t.IsActive = b.IsActive; t.UpdatedAt = clock.UtcNow;
    }

    // ------------------------------------------------------------------ who in each team gets a category's tickets

    [HttpGet("api/admin/category-people")]
    public async Task<object> CategoryPeople(CancellationToken ct)
    {
        var me = await MeAsync(ct);
        var teams = (await db.Teams.AsNoTracking().Where(t => t.KindId != null && t.IsActive).ToListAsync(ct)).Where(t => Manages(me, t)).ToList();
        var ids = teams.Select(t => t.Id).ToList();
        var members = await (from m in db.TeamMembers.AsNoTracking() join p in db.Profiles on m.UserId equals p.Id
                             where ids.Contains(m.TeamId) orderby p.FullName select new { m.TeamId, m.UserId, p.FullName }).ToListAsync(ct);
        return new
        {
            teams = teams.OrderBy(t => t.OrganizationId.HasValue).ThenBy(t => t.NameEn)
                .Select(t => new { t.Id, t.NameEn, t.NameAr, t.KindId, Members = members.Where(m => m.TeamId == t.Id).Select(m => new { m.UserId, m.FullName }) }),
            categories = await db.TicketCategories.AsNoTracking().Where(c => c.TeamKindId != null).OrderBy(c => c.SortOrder).ThenBy(c => c.NameEn)
                .Select(c => new { c.Id, c.NameEn, c.NameAr, c.TeamKindId, c.IsActive }).ToListAsync(ct),
            chosen = await db.CategoryPeople.AsNoTracking().Where(x => ids.Contains(x.TeamId)).Select(x => new { x.CategoryId, x.TeamId, x.UserId }).ToListAsync(ct),
        };
    }

    /// <summary>Sets who in a team may get a category's tickets; an empty list = all its staff.</summary>
    [HttpPut("api/admin/category-people")]
    public async Task<IActionResult> SetCategoryPeople(CategoryPeopleBody b, CancellationToken ct)
    {
        var me = await MeAsync(ct);
        var team = await db.Teams.AsNoTracking().FirstOrDefaultAsync(t => t.Id == b.TeamId, ct) ?? throw new NotFoundException();
        if (!Manages(me, team)) throw Err("outOfScope", null, 403);
        var cat = await db.TicketCategories.AsNoTracking().FirstOrDefaultAsync(c => c.Id == b.CategoryId, ct) ?? throw new NotFoundException();
        if (cat.TeamKindId != team.KindId) throw Err("required", "teamId");
        var ids = (b.UserIds ?? []).Distinct().ToList();
        var inTeam = await db.TeamMembers.Where(m => m.TeamId == team.Id && ids.Contains(m.UserId)).CountAsync(ct);
        if (inTeam != ids.Count) throw Err("required", "userIds");
        var before = await db.CategoryPeople.AsNoTracking().Where(x => x.CategoryId == cat.Id && x.TeamId == team.Id).Select(x => x.UserId).ToListAsync(ct);
        await db.CategoryPeople.Where(x => x.CategoryId == cat.Id && x.TeamId == team.Id).ExecuteDeleteAsync(ct);
        foreach (var u in ids) db.CategoryPeople.Add(new CategoryPerson { CategoryId = cat.Id, TeamId = team.Id, UserId = u });
        audit.Write("category.people", "ticket_category", cat.Id, new { team = team.Id, people = before }, new { team = team.Id, people = ids });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }
}
