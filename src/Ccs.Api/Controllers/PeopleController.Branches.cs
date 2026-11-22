using Ccs.Application.Common;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>
/// People â†’ Branches for Organization and Branch Admins. An organization admin adds, edits, deactivates and deletes the
/// branches of their organizations; a branch admin edits everything about their own branch but cannot add or delete one.
/// The branch's team leader is chosen from the team leaders inside the same scope. System admins keep Admin â†’ Organizations.
/// </summary>
public sealed partial class PeopleController
{
    public sealed record ScopedBranchBody(Guid OrganizationId, string? Name, string? Location, string? Phone, Guid? TeamLeaderId, bool IsActive);
    public sealed record LeaderBody(Guid? TeamLeaderId);

    /// <summary>Organization admins (and system admins) may add and delete branches in these organizations.</summary>
    private static bool CanManageOrg(Me me, Guid org) => me.C.Admin || (me.Rank >= 2 && me.Orgs.Contains(org));

    [HttpGet("api/console/branches")]
    public async Task<object> Branches(CancellationToken ct)
    {
        var me = await MeAsync(ct);
        var all = await db.Branches.AsNoTracking().OrderBy(b => b.Name).ToListAsync(ct);
        var mine = all.Where(b => me.Covers(b.OrganizationId, b.Id)).ToList();
        var ids = mine.Select(b => b.Id).ToList();
        var orgs = (await db.Organizations.AsNoTracking().OrderBy(o => o.Name).Select(o => new { o.Id, o.Name, o.IsActive }).ToListAsync(ct))
            .Where(o => CanManageOrg(me, o.Id) || mine.Any(b => b.OrganizationId == o.Id)).ToList();
        var customers = await CustomersOf(ids)
            .GroupBy(p => p.BranchId!.Value).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
        // Any account at all (also staff or customers waiting for approval) keeps the branch from being deleted.
        var inUse = (await db.Profiles.AsNoTracking().Where(p => p.BranchId != null && ids.Contains(p.BranchId.Value)).Select(p => p.BranchId!.Value).Distinct().ToListAsync(ct)).ToHashSet();
        var staff = await db.StaffPlacements.AsNoTracking().Where(s => s.BranchId != null && ids.Contains(s.BranchId.Value))
            .GroupBy(s => s.BranchId!.Value).Select(g => new { g.Key, N = g.Select(x => x.UserId).Distinct().Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
        // Team leaders this admin can pick: people in their scope with the Team leader role (and the current leaders).
        var people = await PeopleAsync(me, ct);
        var leaderIds = mine.Where(b => b.TeamLeaderId != null).Select(b => b.TeamLeaderId!.Value).ToList();
        var leaders = people.Where(p => p.Roles.Contains(RoleCode.TeamLeader) && p.Status == AccountStatus.Active).Select(p => new { p.Id, p.FullName }).ToList();
        var extra = await db.Profiles.AsNoTracking().Where(p => leaderIds.Contains(p.Id)).Select(p => new { p.Id, p.FullName }).ToListAsync(ct);
        foreach (var e in extra) if (!leaders.Any(l => l.Id == e.Id)) leaders.Add(e);
        return new
        {
            level = me.C.Admin ? "admin" : me.C.ScopeLevel,
            canAdd = orgs.Any(o => CanManageOrg(me, o.Id)),
            orgs = orgs.Select(o => new { o.Id, o.Name, canAdd = CanManageOrg(me, o.Id) }),
            leaders = leaders.OrderBy(l => l.FullName),
            branches = mine.Select(b => new
            {
                b.Id, b.OrganizationId, b.Name, b.Location, b.Phone, b.IsActive, b.TeamLeaderId,
                teamLeader = extra.FirstOrDefault(x => x.Id == b.TeamLeaderId)?.FullName,
                customers = customers.GetValueOrDefault(b.Id), staff = staff.GetValueOrDefault(b.Id),
                canDelete = CanManageOrg(me, b.OrganizationId) && !inUse.Contains(b.Id),
            }),
        };
    }

    /// <summary>Customer accounts placed in these branches (same rule as the Customers list: customer role, not waiting for approval).</summary>
    private IQueryable<Profile> CustomersOf(List<Guid> branchIds) =>
        from p in db.Profiles.AsNoTracking()
        where p.BranchId != null && branchIds.Contains(p.BranchId.Value) && p.AccountStatus != AccountStatus.PendingApproval
              && db.CcsUserRoles.Any(ur => ur.UserId == p.Id && db.CcsRoles.Any(r => r.Id == ur.RoleId && r.Code == RoleCode.Customer))
        select p;

    /// <summary>The first customers of one branch, for the list that opens under the branch row (total shows how many there are).</summary>
    [HttpGet("api/console/branches/{id:guid}/customers")]
    public async Task<object> BranchCustomers(Guid id, CancellationToken ct)
    {
        var me = await MeAsync(ct);
        var x = await db.Branches.AsNoTracking().FirstOrDefaultAsync(y => y.Id == id, ct) ?? throw new NotFoundException();
        if (!me.Covers(x.OrganizationId, x.Id)) throw Err("outOfScope", null, 403);
        var q = CustomersOf([id]);
        var total = await q.CountAsync(ct);
        var rows = await q.OrderBy(p => p.FullName).Take(10).Select(p => new { p.Id, p.FullName, p.Email, p.Phone, Status = p.AccountStatus }).ToListAsync(ct);
        var rowIds = rows.Select(r => r.Id).ToList();
        var open = await db.Tickets.AsNoTracking().Where(t => rowIds.Contains(t.RequesterId) && t.Status != TicketStatus.Resolved && t.Status != TicketStatus.Closed)
            .GroupBy(t => t.RequesterId).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.N, ct);
        return new { total, customers = rows.Select(r => new { r.Id, r.FullName, r.Email, r.Phone, r.Status, openTickets = open.GetValueOrDefault(r.Id) }) };
    }

    [HttpPost("api/console/branches")]
    public async Task<object> AddBranch(ScopedBranchBody b, CancellationToken ct)
    {
        var me = await MeAsync(ct);
        if (!CanManageOrg(me, b.OrganizationId)) throw Err("outOfScope", "organizationId", 403);
        var x = new Branch { Id = Guid.NewGuid(), CreatedAt = clock.UtcNow };
        await ApplyScopedBranchAsync(me, x, b, ct);
        db.Branches.Add(x);
        audit.Write("branch.create", "branch", x.Id, null, b);
        await db.SaveChangesAsync(ct);
        return new { x.Id };
    }

    [HttpPut("api/console/branches/{id:guid}")]
    public async Task<IActionResult> EditBranch(Guid id, ScopedBranchBody b, CancellationToken ct)
    {
        var me = await MeAsync(ct);
        var x = await db.Branches.FirstOrDefaultAsync(y => y.Id == id, ct) ?? throw new NotFoundException();
        if (!me.Covers(x.OrganizationId, x.Id)) throw Err("outOfScope", null, 403);
        // Moving a branch to another organization is for organization admins of both, and only while it is empty.
        if (b.OrganizationId != x.OrganizationId)
        {
            if (!CanManageOrg(me, x.OrganizationId) || !CanManageOrg(me, b.OrganizationId)) throw Err("outOfScope", "organizationId", 403);
            if (await db.Profiles.AnyAsync(p => p.BranchId == id, ct)) throw Err("branchInUse", "organizationId", 409);
        }
        var before = new { x.OrganizationId, x.Name, x.Location, x.Phone, x.TeamLeaderId, x.IsActive };
        await ApplyScopedBranchAsync(me, x, b, ct);
        audit.Write("branch.update", "branch", id, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Only the team leader (from the Staff page): the same rule as editing the branch.</summary>
    [HttpPut("api/console/branches/{id:guid}/leader")]
    public async Task<IActionResult> SetBranchLeader(Guid id, LeaderBody b, CancellationToken ct)
    {
        var me = await MeAsync(ct);
        var x = await db.Branches.FirstOrDefaultAsync(y => y.Id == id, ct) ?? throw new NotFoundException();
        if (!me.Covers(x.OrganizationId, x.Id)) throw Err("outOfScope", null, 403);
        await CheckScopedLeaderAsync(me, b.TeamLeaderId, x.TeamLeaderId, ct);
        var before = new { x.TeamLeaderId };
        x.TeamLeaderId = b.TeamLeaderId; x.UpdatedAt = clock.UtcNow;
        audit.Write("branch.update", "branch", id, before, new { b.TeamLeaderId });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("api/console/branches/{id:guid}")]
    public async Task<IActionResult> DeleteBranch(Guid id, CancellationToken ct)
    {
        var me = await MeAsync(ct);
        var x = await db.Branches.FirstOrDefaultAsync(y => y.Id == id, ct) ?? throw new NotFoundException();
        if (!CanManageOrg(me, x.OrganizationId)) throw Err("outOfScope", null, 403);
        // A branch with people or tickets keeps its history: make it inactive instead.
        if (await db.Profiles.AnyAsync(p => p.BranchId == id, ct) || await db.StaffPlacements.AnyAsync(s => s.BranchId == id, ct))
            throw Err("branchInUse", null, 409);
        db.AccountTypeAccess.RemoveRange(db.AccountTypeAccess.Where(y => y.BranchId == id));
        db.AdminScopes.RemoveRange(db.AdminScopes.Where(y => y.BranchId == id));
        db.Branches.Remove(x);
        audit.Write("branch.delete", "branch", id, new { x.Name }, null);
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { throw Err("branchInUse", null, 409); }
        return NoContent();
    }

    private async Task ApplyScopedBranchAsync(Me me, Branch x, ScopedBranchBody b, CancellationToken ct)
    {
        var name = (b.Name ?? "").Trim();
        if (name.Length is < 2 or > 120) throw Err("name", "name");
        if (await db.Branches.AnyAsync(y => y.Id != x.Id && y.OrganizationId == b.OrganizationId && y.Name == name, ct)) throw Err("nameTaken", "name", 409);
        var location = string.IsNullOrWhiteSpace(b.Location) ? null : b.Location.Trim();
        if (location is { Length: > 300 }) throw Err("locationLong", "location");
        // Stored as +digits (the database accepts 8 to 15 digits after the +); spaces, dashes and brackets are dropped, 00 becomes +.
        string? phone = null;
        if (!string.IsNullOrWhiteSpace(b.Phone))
        {
            phone = System.Text.RegularExpressions.Regex.Replace(b.Phone, @"[\s().-]", "");
            if (phone.StartsWith("00")) phone = "+" + phone[2..];
            if (!System.Text.RegularExpressions.Regex.IsMatch(phone, @"^\+[0-9]{8,15}$")) throw Err("phoneInvalid", "phone");
        }
        await CheckScopedLeaderAsync(me, b.TeamLeaderId, x.TeamLeaderId, ct);
        x.OrganizationId = b.OrganizationId; x.Name = name; x.Location = location; x.Phone = phone;
        x.TeamLeaderId = b.TeamLeaderId; x.IsActive = b.IsActive; x.UpdatedAt = clock.UtcNow;
    }

    /// <summary>A new leader must be an active team leader inside the caller's scope (keeping the current one is always allowed).</summary>
    private async Task CheckScopedLeaderAsync(Me me, Guid? leader, Guid? current, CancellationToken ct)
    {
        if (leader is null || leader == current) return;
        var p = (await PeopleAsync(me, ct)).FirstOrDefault(x => x.Id == leader.Value);
        if (p is null || !p.Roles.Contains(RoleCode.TeamLeader) || p.Status != AccountStatus.Active) throw Err("leaderRole", "teamLeaderId");
    }
}
