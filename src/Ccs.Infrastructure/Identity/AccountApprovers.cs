using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Infrastructure.Identity;

/// <summary>
/// Who handles a customer's account request. One rule for the notification, the email, the approvals list,
/// the sidebar badge and approve/reject:
/// the chosen branch's admins; if none, the organization's admins, then each parent organization's;
/// if none anywhere, the system admins. Unplaced sign-ups go to the system admins.
/// An "admin" of a branch or organization is an active staff member whose account type grants approve_customers
/// and who is placed on (or scoped to) exactly that branch, or that organization as a whole.
/// System admins can still see and act on every request; they are only notified when it falls back to them.
/// </summary>
public sealed class AccountApprovers(CcsDbContext db)
{
    public async Task<List<Guid>> ForAsync(Guid? organizationId, Guid? branchId, CancellationToken ct)
    {
        if (branchId is Guid b)
        {
            var branchAdmins = await WithPermission(
                db.AdminScopes.Where(s => s.BranchId == b).Select(s => s.UserId)
                    .Concat(db.StaffPlacements.Where(s => s.BranchId == b).Select(s => s.UserId)), ct);
            if (branchAdmins.Count > 0) return branchAdmins;
        }
        var org = organizationId;
        var guard = 0;
        while (org is Guid o && guard++ < 20)
        {
            var orgAdmins = await WithPermission(
                db.AdminScopes.Where(s => s.OrganizationId == o && s.BranchId == null).Select(s => s.UserId)
                    .Concat(db.StaffPlacements.Where(s => s.OrganizationId == o && s.BranchId == null).Select(s => s.UserId)), ct);
            if (orgAdmins.Count > 0) return orgAdmins;
            org = await db.Organizations.Where(x => x.Id == o).Select(x => x.ParentId).FirstOrDefaultAsync(ct);
        }
        return await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id
                      join pr in db.Profiles on ur.UserId equals pr.Id
                      where r.Code == RoleCode.Admin && pr.AccountStatus == AccountStatus.Active
                      select ur.UserId).Distinct().ToListAsync(ct);
    }

    /// <summary>True when the caller may see, approve or reject this request.</summary>
    public async Task<bool> CanHandleAsync(AccessContext c, Profile p, CancellationToken ct) =>
        c.Admin || (c.Has(Permission.ApproveCustomers) && (await ForAsync(p.OrganizationId, p.BranchId, ct)).Contains(c.UserId));

    /// <summary>Pending requests the caller may see: every one for system admins, otherwise those routed to them.</summary>
    public async Task<HashSet<Guid>> VisibleAsync(AccessContext c, CancellationToken ct)
    {
        if (!c.Admin && !c.Has(Permission.ApproveCustomers)) return [];
        var pending = await PendingAsync(ct);
        if (c.Admin) return pending.Select(x => x.Id).ToHashSet();
        return await RoutedToAsync(c.UserId, pending, ct);
    }

    /// <summary>The badge: pending requests waiting on this person (for system admins, only the ones that fell back to them).</summary>
    public async Task<int> WaitingOnAsync(AccessContext c, CancellationToken ct)
    {
        if (!c.Admin && !c.Has(Permission.ApproveCustomers)) return 0;
        return (await RoutedToAsync(c.UserId, await PendingAsync(ct), ct)).Count;
    }

    private async Task<HashSet<Guid>> RoutedToAsync(Guid userId, List<(Guid Id, Guid? Org, Guid? Branch)> pending, CancellationToken ct)
    {
        var cache = new Dictionary<(Guid?, Guid?), List<Guid>>();
        var mine = new HashSet<Guid>();
        foreach (var p in pending)
        {
            if (!cache.TryGetValue((p.Org, p.Branch), out var who))
                cache[(p.Org, p.Branch)] = who = await ForAsync(p.Org, p.Branch, ct);
            if (who.Contains(userId)) mine.Add(p.Id);
        }
        return mine;
    }

    private async Task<List<(Guid Id, Guid? Org, Guid? Branch)>> PendingAsync(CancellationToken ct)
    {
        var customers = from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id
                        where r.Code == RoleCode.Customer select ur.UserId;
        var rows = await db.Profiles.AsNoTracking()
            .Where(p => p.AccountStatus == AccountStatus.PendingApproval && customers.Contains(p.Id))
            .Select(p => new { p.Id, p.OrganizationId, p.BranchId }).ToListAsync(ct);
        return rows.Select(x => (x.Id, x.OrganizationId, x.BranchId)).ToList();
    }

    private async Task<List<Guid>> WithPermission(IQueryable<Guid> candidates, CancellationToken ct)
    {
        var staff = from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id
                    where r.Code != RoleCode.Customer select ur.UserId;
        return await (from id in candidates
                      join pr in db.Profiles on id equals pr.Id
                      where pr.AccountStatus == AccountStatus.Active && staff.Contains(id)
                            && db.AccountTypePermissions.Any(ap => ap.AccountTypeId == pr.AccountTypeId && ap.Permission == Permission.ApproveCustomers)
                      select id).Distinct().ToListAsync(ct);
    }
}
