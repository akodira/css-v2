using Ccs.Application.Common;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Infrastructure.Identity;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>
/// Staff page, one card per person with one Save: account type (what they can do), Works in (where),
/// teams and the two ticket switches. Plus the counts behind the setup guide on Staff and Permissions.
/// </summary>
public sealed partial class PeopleController
{
    public sealed record TeamPick(Guid TeamId, bool IsLeader);
    public sealed record SetupBody(Guid AccountTypeId, bool Everywhere, Guid[]? Orgs, Guid[]? Branches, TeamPick[]? Teams, bool AutoAssign, bool CanCreateForCustomers);

    [HttpPut("api/admin/users/{id:guid}/setup")]
    public async Task<IActionResult> Setup(Guid id, SetupBody b, CancellationToken ct)
    {
        var c = await AdminAsync(ct);
        var roles = await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id where ur.UserId == id select r.Code).ToListAsync(ct);
        if (roles.Count == 0 || roles.Contains(RoleCode.Customer)) throw Err("notStaff");
        var p = await db.Profiles.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var type = await db.AccountTypes.AsNoTracking().FirstOrDefaultAsync(x => x.Id == b.AccountTypeId, ct) ?? throw Err("typeRequired", "accountTypeId");
        var self = id == c.UserId;
        var typeChanged = p.AccountTypeId != type.Id;
        if (self && typeChanged) throw Err("cannotChangeSelf", "accountTypeId", 403);
        if (typeChanged && !type.IsBuiltin && (roles.Contains(RoleCode.Admin) || (p.AccountTypeId is Guid o && await db.AccountTypes.AnyAsync(x => x.Id == o && x.IsBuiltin, ct))))
        {
            var others = await (from pr in db.Profiles join ur in db.CcsUserRoles on pr.Id equals ur.UserId join r in db.CcsRoles on ur.RoleId equals r.Id
                                where r.Code == RoleCode.Admin && pr.Id != id && pr.AccountStatus == AccountStatus.Active select pr.Id).AnyAsync(ct);
            if (!others) throw Err("lastAdmin", null, 409);
        }

        var teamPicks = (b.Teams ?? []).GroupBy(t => t.TeamId).Select(g => g.First()).ToList();
        var teamIds = teamPicks.Select(t => t.TeamId).ToList();
        if (await db.Teams.CountAsync(t => teamIds.Contains(t.Id), ct) != teamIds.Count) throw Err("notFound", "teams");

        var before = new { p.AccountTypeId, p.AutoAssign, p.CanCreateForCustomers };
        var role = self ? null : await StaffRoleForTypeAsync(db, type, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var where = await ApplyWhereAsync(db, id, type, b.Everywhere, b.Orgs, b.Branches, ct);
        if (role is not null) await SetStaffRoleAsync(id, role, ct);
        var effective = role ?? roles.First();
        var worksTickets = effective is RoleCode.Agent or RoleCode.TeamLeader;
        await db.TeamMembers.Where(m => m.UserId == id).ExecuteDeleteAsync(ct);
        if (worksTickets)
            foreach (var t in teamPicks)
                db.TeamMembers.Add(new TeamMember { TeamId = t.TeamId, UserId = id, IsLeader = t.IsLeader && effective == RoleCode.TeamLeader });
        p.AccountTypeId = type.Id;
        p.AutoAssign = !type.IsBuiltin && worksTickets && teamPicks.Count > 0 && b.AutoAssign;
        p.CanCreateForCustomers = !type.IsBuiltin && b.CanCreateForCustomers;
        p.UpdatedAt = clock.UtcNow;
        audit.Write("user.setup", "profile", id, before, new
        {
            accountTypeId = type.Id, p.AutoAssign, p.CanCreateForCustomers, where.Everywhere, where.Orgs, where.Branches,
            teams = worksTickets ? teamPicks : [],
        });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return NoContent();
    }

    public sealed record WhereResult(bool Everywhere, List<Guid> Orgs, List<Guid> Branches);

    /// <summary>
    /// Writes Works in for one staff member. Administrator: everywhere, nothing stored. Organization / Branch Admin: the
    /// organizations / branches they manage (scope and placement), never everywhere. Anyone else: everywhere, or
    /// one row per whole organization and one per picked branch. Call inside a transaction; the caller saves.
    /// </summary>
    internal static async Task<WhereResult> ApplyWhereAsync(CcsDbContext db, Guid user, AccountType type, bool everywhere, Guid[]? pickOrgs, Guid[]? pickBranches, CancellationToken ct)
    {
        Guid[] po = (pickOrgs ?? []).Distinct().ToArray(), pb = (pickBranches ?? []).Distinct().ToArray();
        var orgs = await db.Organizations.Where(o => po.Contains(o.Id)).Select(o => o.Id).ToListAsync(ct);
        var branches = await db.Branches.Where(x => pb.Contains(x.Id)).Select(x => new { x.Id, x.OrganizationId }).ToListAsync(ct);
        if (orgs.Count != po.Length || branches.Count != pb.Length) throw new AuthError("notFound", 400, "where");

        await db.StaffPlacements.Where(x => x.UserId == user).ExecuteDeleteAsync(ct);
        await db.AdminScopes.Where(x => x.UserId == user).ExecuteDeleteAsync(ct);
        if (type.IsBuiltin) return new(true, [], []);

        if (type.ScopeLevel is "organization" or "branch")
        {
            var rows = type.ScopeLevel == "organization"
                ? orgs.Select(o => (Org: o, Branch: (Guid?)null)).ToList()
                : branches.Select(x => (Org: x.OrganizationId, Branch: (Guid?)x.Id)).ToList();
            if (rows.Count == 0) throw new AuthError(type.ScopeLevel == "organization" ? "placeOrgRequired" : "placeBranchRequired", 400, "where");
            foreach (var r in rows)
            {
                db.AdminScopes.Add(new AdminScope { Id = Guid.NewGuid(), UserId = user, OrganizationId = r.Org, BranchId = r.Branch });
                db.StaffPlacements.Add(new StaffPlacement { Id = Guid.NewGuid(), UserId = user, OrganizationId = r.Org, BranchId = r.Branch });
            }
            return new(false, rows.Where(r => r.Branch is null).Select(r => r.Org).ToList(), rows.Where(r => r.Branch is not null).Select(r => r.Branch!.Value).ToList());
        }

        if (everywhere) return new(true, [], []);
        // A picked branch narrows its organization to the picked branches; an organization alone means all its branches.
        var whole = orgs.Where(o => !branches.Any(x => x.OrganizationId == o)).ToList();
        if (whole.Count == 0 && branches.Count == 0) throw new AuthError("placeRequired", 400, "where");
        // Settings → System → Ticket routing: "Staff can work in more than one place" off = one place each.
        if (whole.Count + branches.Count > 1 && await db.AppSettings.AnyAsync(s => s.Key == "staff_multi_place" && s.Value == "false", ct))
            throw new AuthError("onePlace", 400, "where");
        foreach (var o in whole) db.StaffPlacements.Add(new StaffPlacement { Id = Guid.NewGuid(), UserId = user, OrganizationId = o });
        foreach (var x in branches) db.StaffPlacements.Add(new StaffPlacement { Id = Guid.NewGuid(), UserId = user, OrganizationId = x.OrganizationId, BranchId = x.Id });
        return new(false, whole, branches.Select(x => x.Id).ToList());
    }

    /// <summary>Port of account_type_role(): the staff role an account type implies.</summary>
    internal static async Task<string> StaffRoleForTypeAsync(CcsDbContext db, AccountType t, CancellationToken ct)
    {
        if (t.IsBuiltin) return RoleCode.Admin;
        var perms = await db.AccountTypePermissions.Where(p => p.AccountTypeId == t.Id).Select(p => p.Permission).ToListAsync(ct);
        return perms.Contains(Permission.AssignOthers) ? RoleCode.TeamLeader : perms.Contains(Permission.Reply) ? RoleCode.Agent : RoleCode.ManagementViewer;
    }

    /// <summary>What the setup guide on Staff and Permissions ticks off: places, teams, account types, and staff who still need something.</summary>
    [HttpGet("api/admin/setup-status")]
    public async Task<object> SetupStatus(CancellationToken ct)
    {
        await AdminAsync(ct);
        var staff = await (from p in db.Profiles.AsNoTracking()
                           where db.CcsUserRoles.Any(ur => ur.UserId == p.Id && db.CcsRoles.Any(r => r.Id == ur.RoleId && r.Code != RoleCode.Customer))
                              && !db.CcsUserRoles.Any(ur => ur.UserId == p.Id && db.CcsRoles.Any(r => r.Id == ur.RoleId && r.Code == RoleCode.Customer))
                           join t in db.AccountTypes on p.AccountTypeId equals (Guid?)t.Id into tj
                           from t in tj.DefaultIfEmpty()
                           select new
                           {
                               p.Id, p.AccountStatus, HasType = t != null, Scoped = t != null && t.ScopeLevel != null,
                               HasScope = db.AdminScopes.Any(s => s.UserId == p.Id),
                               Admin = db.CcsUserRoles.Any(ur => ur.UserId == p.Id && db.CcsRoles.Any(r => r.Id == ur.RoleId && r.Code == RoleCode.Admin)),
                           }).ToListAsync(ct);
        return new
        {
            orgs = await db.Organizations.CountAsync(o => o.IsActive, ct),
            branches = await db.Branches.CountAsync(x => x.IsActive, ct),
            teams = await db.Teams.CountAsync(t => t.IsActive, ct),
            types = await db.AccountTypes.CountAsync(ct),
            staff = staff.Count,
            noType = staff.Where(s => !s.HasType && !s.Admin).Select(s => s.Id),
            noPlace = staff.Where(s => s.Scoped && !s.HasScope).Select(s => s.Id),
        };
    }
}
