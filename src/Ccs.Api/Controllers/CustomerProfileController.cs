using Ccs.Application.Access;
using Ccs.Application.Common;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Identity;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>
/// Customer profile for staff (v1 /console/customers/[id]): details, ticket history, and for the main Administrator
/// "Promote to staff" (admin_promote_customer) and "Turn back into a customer" (admin_demote_staff).
/// </summary>
[ApiController]
[Authorize]
public sealed class CustomerProfileController(CcsDbContext db, AccessService access, AuditService audit, AuthService auth) : ControllerBase
{
    public sealed record PromoteBody(string Role, Guid? AccountTypeId, Guid? TeamId, bool AutoAssign);
    private static AuthError Err(string code, string? field = null, int status = 400) => new(code, status, field);

    [HttpGet("api/console/customers/{id:guid}")]
    public async Task<object> Get(Guid id, CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        if (!(c.Admin || c.Has(Permission.CustomersView))) throw new ForbiddenException();
        var p = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var isCustomer = await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id
                                where ur.UserId == id && r.Code == RoleCode.Customer select 1).AnyAsync(ct);
        if (!isCustomer) throw new NotFoundException();
        if (!c.Admin && !c.AllScope && !AccessRules.InScope(c, p.OrganizationId, p.BranchId)) throw new NotFoundException();

        // Security audit L-06: list only tickets this staff member may open (team and permission rules); counts stay totals.
        var tickets = await access.VisibleTickets(db.Tickets.AsNoTracking(), c).Where(t => t.RequesterId == id).OrderByDescending(t => t.CreatedAt).Take(50)
            .Select(t => new { t.Id, t.Reference, t.Subject, t.Status, t.Priority, t.CreatedAt }).ToListAsync(ct);
        var all = await db.Tickets.AsNoTracking().Where(t => t.RequesterId == id).Select(t => t.Status).ToListAsync(ct);
        return new
        {
            user = new
            {
                p.Id, p.FullName, p.Email, p.Phone, Status = p.AccountStatus, Role = RoleCode.Customer, p.AccountTypeId,
                p.OrganizationId, p.BranchId, p.AutoAssign, p.CanCreateForCustomers, p.CreatedAt, TeamIds = Array.Empty<Guid>(),
                Tickets = all.Count, OpenTickets = all.Count(s => s is not (TicketStatus.Resolved or TicketStatus.Closed)), IsSelf = p.Id == c.UserId,
            },
            organizationName = p.OrganizationId is Guid o ? await db.Organizations.Where(x => x.Id == o).Select(x => x.Name).FirstOrDefaultAsync(ct) : null,
            branchName = p.BranchId is Guid b ? await db.Branches.Where(x => x.Id == b).Select(x => x.Name).FirstOrDefaultAsync(ct) : null,
            tickets,
            canEdit = c.Admin || c.Has(Permission.CustomersManage),
            isAdmin = c.Admin,
        };
    }

    private async Task<AccessContext> AdminAsync(CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        return c.Admin ? c : throw new ForbiddenException();
    }

    private Task<List<string>> RolesOfAsync(Guid id, CancellationToken ct) =>
        (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id where ur.UserId == id select r.Code).ToListAsync(ct);

    /// <summary>Port of admin_promote_customer(): one staff role; the customer placement is cleared (staff use "Works in").</summary>
    [HttpPost("api/admin/users/{id:guid}/promote")]
    public async Task<IActionResult> Promote(Guid id, PromoteBody b, CancellationToken ct)
    {
        var c = await AdminAsync(ct);
        if (id == c.UserId) throw Err("cannotChangeSelf");
        var p = await db.Profiles.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (!(await RolesOfAsync(id, ct)).Contains(RoleCode.Customer)) throw Err("notCustomer");
        if (b.Role is not (RoleCode.Agent or RoleCode.TeamLeader or RoleCode.Admin or RoleCode.ManagementViewer)) throw Err("pickRole", "role");
        if (b.AccountTypeId is Guid tid && !await db.AccountTypes.AnyAsync(t => t.Id == tid, ct)) throw Err("notFound", "accountTypeId");
        if (b.TeamId is Guid team && !await db.Teams.AnyAsync(t => t.Id == team, ct)) throw Err("notFound", "teamId");

        var before = new { roles = new[] { RoleCode.Customer }, p.OrganizationId, p.BranchId };
        db.CcsUserRoles.RemoveRange(db.CcsUserRoles.Where(x => x.UserId == id));
        db.CcsUserRoles.Add(new UserRole { UserId = id, RoleId = await db.CcsRoles.Where(r => r.Code == b.Role).Select(r => r.Id).FirstAsync(ct) });
        p.OrganizationId = null; p.BranchId = null;
        p.AccountTypeId = b.AccountTypeId;
        p.AutoAssign = b.AutoAssign && b.AccountTypeId is not null;
        if (b.TeamId is Guid t2 && b.Role is (RoleCode.Agent or RoleCode.TeamLeader) && !await db.TeamMembers.AnyAsync(m => m.TeamId == t2 && m.UserId == id, ct))
            db.TeamMembers.Add(new TeamMember { TeamId = t2, UserId = id, IsLeader = false });
        audit.Write("user.promoted", "user", id, before, new { roles = new[] { b.Role }, accountTypeId = b.AccountTypeId, teamId = b.TeamId });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>admin_reset_mfa(): switch off someone's two-step verification, e.g. after a lost phone.</summary>
    [HttpPost("api/admin/users/{id:guid}/reset-mfa")]
    public async Task<IActionResult> ResetMfa(Guid id, CancellationToken ct)
    {
        await AdminAsync(ct);
        await auth.ResetMfaAsync(id, ct);
        return NoContent();
    }

    /// <summary>Port of admin_demote_staff(): back to customer; team membership, organization leadership and open assignments are removed.</summary>
    [HttpPost("api/admin/users/{id:guid}/demote")]
    public async Task<IActionResult> Demote(Guid id, CancellationToken ct)
    {
        var c = await AdminAsync(ct);
        if (id == c.UserId) throw Err("cannotChangeSelf");
        var p = await db.Profiles.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var roles = await RolesOfAsync(id, ct);
        if (roles.Contains(RoleCode.Customer) || roles.Count == 0) throw Err("notStaff");
        if (roles.Contains(RoleCode.Admin))
        {
            var others = await (from x in db.Profiles join ur in db.CcsUserRoles on x.Id equals ur.UserId join r in db.CcsRoles on ur.RoleId equals r.Id
                                where r.Code == RoleCode.Admin && x.AccountStatus == AccountStatus.Active && x.Id != id select x.Id).AnyAsync(ct);
            if (!others) throw Err("lastAdmin", null, 409);
        }
        await db.Organizations.Where(o => o.TeamLeaderId == id).ExecuteUpdateAsync(s => s.SetProperty(o => o.TeamLeaderId, (Guid?)null), ct);
        await db.Branches.Where(o => o.TeamLeaderId == id).ExecuteUpdateAsync(s => s.SetProperty(o => o.TeamLeaderId, (Guid?)null), ct);
        await db.TeamMembers.Where(m => m.UserId == id).ExecuteDeleteAsync(ct);
        await db.Tickets.Where(t => t.AssignedAgentId == id && t.Status != TicketStatus.Resolved && t.Status != TicketStatus.Closed)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.AssignedAgentId, (Guid?)null), ct);
        await db.AdminScopes.Where(x => x.UserId == id).ExecuteDeleteAsync(ct);
        await db.StaffPlacements.Where(x => x.UserId == id).ExecuteDeleteAsync(ct);
        db.CcsUserRoles.RemoveRange(db.CcsUserRoles.Where(x => x.UserId == id));
        db.CcsUserRoles.Add(new UserRole { UserId = id, RoleId = await db.CcsRoles.Where(r => r.Code == RoleCode.Customer).Select(r => r.Id).FirstAsync(ct) });
        p.AccountTypeId = null; p.AutoAssign = false; p.CanCreateForCustomers = false;
        audit.Write("user.demoted", "user", id, new { roles }, new { roles = new[] { RoleCode.Customer } });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }
}
