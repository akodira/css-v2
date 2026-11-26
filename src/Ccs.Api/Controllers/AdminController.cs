using Ccs.Application.Access;
using Ccs.Application.Abstractions;
using Ccs.Application.Common;
using Ccs.Application.Notifications;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Identity;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>
/// Admin portal, batch 1: staff, customers, approvals, account types and permissions,
/// organizations and branches, teams. Every change writes an audit row in the same save.
/// Error codes are translation keys (AdminCommon.errors / Directory.errors).
/// </summary>
[ApiController]
[Authorize]
[Route("api/admin")]
public sealed class AdminController(
    CcsDbContext db, AccessService access, AuditService audit, NotificationService notify,
    UserManager<AppUser> users, IClock clock, AccountApprovers approvers) : ControllerBase
{
    // ---------------------------------------------------------------- contracts

    public sealed record UserBody(string FullName, string Email, string? Phone, string? Password, string Role,
        Guid? AccountTypeId, Guid? OrganizationId, Guid? BranchId, string? Status, bool AutoAssign, bool CanCreateForCustomers,
        bool MoveOpenTickets = false);
    public sealed record PasswordBody(string Password);
    public sealed record StatusBody(string Status);
    public sealed record ApproveBody(Guid OrganizationId, Guid? BranchId);
    public sealed record RejectBody(string? Reason);
    public sealed record AccessRow(Guid OrganizationId, Guid? BranchId);
    /// <summary>With <see cref="Kind"/> (the Permissions page): the kind sets the scope level, the permissions must fit it,
    /// and the type has no places of its own (each person's Works in decides where). Without it: the older shape.</summary>
    public sealed record TypeBody(string NameEn, string NameAr, bool AllAccess, string? ScopeLevel, string[] Permissions, AccessRow[] Access, string? Kind = null);
    /// <summary>SetParent = true saves ParentId (null = a top-level organization); false leaves the parent as it is.</summary>
    public sealed record OrgBody(string Name, string? Location, string? Phone, Guid? TeamLeaderId, bool IsActive, bool SharedAccessEnabled,
        Guid? ParentId = null, bool SetParent = false);
    public sealed record BranchBody(Guid OrganizationId, string Name, string? Location, string? Phone, Guid? TeamLeaderId, bool IsActive);
    /// <summary>With <see cref="AccountTypeId"/> (the Staff page): the type gives the role, Everywhere / Orgs / Branches give Works in.
    /// Without it: the older roles / scoped shape.</summary>
    public sealed record StaffCreateBody(string FullName, string Email, string? Phone, string Password, string[]? Roles, string? Scoped, Guid[]? Orgs, Guid[]? Branches,
        Guid? AccountTypeId = null, bool Everywhere = false);
    public sealed record RolesBody(string[] Roles);
    public sealed record DetailsBody(string FullName, string Email, string? Phone);

    private static AuthError Err(string code, string? field = null, int status = 400) => new(code, status, field);

    private async Task<AccessContext> Need(string? permission, CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        if (c.Admin || (permission is not null && c.Has(permission))) return c;
        throw new ForbiddenException();
    }

    /// <summary>
    /// Security audit H-01: a non-admin with customers_manage / approve_customers acts only inside their own
    /// organizations and branches (all-scope staff: everywhere), the same scope the customer screens show.
    /// </summary>
    private static bool Covers(AccessContext c, Guid? org, Guid? branch) => c.Admin || AccessRules.InScope(c, org, branch);

    /// <summary>The placement a non-admin gives a customer must be inside their scope.</summary>
    private static void RequirePlacementInScope(AccessContext c, Guid? org, Guid? branch)
    {
        if (!Covers(c, org, branch)) throw Err("outOfScope", "organizationId", 403);
    }

    // ---------------------------------------------------------------- lookups

    [HttpGet("lookups")]
    public async Task<object> Lookups(CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        if (!(c.Admin || c.Has(Permission.CustomersView) || c.Has(Permission.ApproveCustomers))) throw new ForbiddenException();
        var orgs = await db.Organizations.AsNoTracking().OrderBy(o => o.Name).Select(o => new { o.Id, o.Name, o.IsActive }).ToListAsync(ct);
        var branches = await db.Branches.AsNoTracking().OrderBy(b => b.Name).Select(b => new { b.Id, b.OrganizationId, b.Name, b.IsActive }).ToListAsync(ct);
        var teams = await db.Teams.AsNoTracking().OrderBy(t => t.NameEn).Select(t => new { t.Id, t.NameEn, t.NameAr, t.IsActive }).ToListAsync(ct);
        var types = await db.AccountTypes.AsNoTracking().OrderBy(t => t.NameEn).Select(t => new { t.Id, t.NameEn, t.NameAr, t.IsBuiltin, t.ScopeLevel }).ToListAsync(ct);
        var leaders = await (from p in db.Profiles join ur in db.CcsUserRoles on p.Id equals ur.UserId join r in db.CcsRoles on ur.RoleId equals r.Id
                             where r.Code == RoleCode.TeamLeader && p.AccountStatus == AccountStatus.Active
                             orderby p.FullName select new { p.Id, p.FullName, p.Email }).ToListAsync(ct);
        return new { orgs, branches, teams, types, leaders, permissions = Permission.Assignable, roles = RoleCode.All, me = c.UserId };
    }

    // ---------------------------------------------------------------- people

    /// <summary>kind = staff | customers | pending.</summary>
    [HttpGet("users")]
    public async Task<object> Users([FromQuery] string kind = "staff", [FromQuery] string? q = null, CancellationToken ct = default)
    {
        var c = kind switch
        {
            "customers" => await Need(Permission.CustomersView, ct),
            "pending" => await Need(Permission.ApproveCustomers, ct),
            _ => await Need(null, ct),
        };
        var rows = from p in db.Profiles.AsNoTracking()
                   join ur in db.CcsUserRoles on p.Id equals ur.UserId into urs
                   from ur in urs.DefaultIfEmpty()
                   join r in db.CcsRoles on ur.RoleId equals r.Id into rs
                   from r in rs.DefaultIfEmpty()
                   select new { p, Role = r == null ? null : r.Code };
        rows = kind switch
        {
            "customers" => rows.Where(x => x.Role == RoleCode.Customer && x.p.AccountStatus != AccountStatus.PendingApproval),
            "pending" => rows.Where(x => x.Role == RoleCode.Customer && x.p.AccountStatus == AccountStatus.PendingApproval),
            _ => rows.Where(x => x.Role != null && x.Role != RoleCode.Customer),
        };
        if (kind == "customers" && !c.Admin)
        {
            var scoped = access.CustomersInScope(db.Profiles, c);
            rows = rows.Where(x => scoped.Any(s => s.Id == x.p.Id));
        }
        else if (kind == "pending" && !c.Admin)
        {
            // Only the requests routed to the caller (branch admin, else organization admin up the tree).
            var mine = (await approvers.VisibleAsync(c, ct)).ToList();
            rows = rows.Where(x => mine.Contains(x.p.Id));
        }
        if (!string.IsNullOrWhiteSpace(q))
        {
            var s = q.Trim();
            rows = rows.Where(x => x.p.FullName.Contains(s) || x.p.Email.Contains(s) || (x.p.Phone != null && x.p.Phone.Contains(s)));
        }
        var list = await rows.OrderBy(x => x.p.FullName).Take(1000).Select(x => new
        {
            x.p.Id, x.p.FullName, x.p.Email, x.p.Phone, Status = x.p.AccountStatus, x.Role, x.p.AccountTypeId,
            x.p.OrganizationId, x.p.BranchId, x.p.AutoAssign, x.p.CanCreateForCustomers, x.p.CreatedAt,
        }).ToListAsync(ct);

        var ids = list.Select(x => x.Id).ToList();
        var teams = await db.TeamMembers.AsNoTracking().Where(m => ids.Contains(m.UserId)).ToListAsync(ct);
        var tickets = await db.Tickets.AsNoTracking().Where(t => kind != "staff" && ids.Contains(t.RequesterId))
            .GroupBy(t => t.RequesterId)
            .Select(g => new { Id = g.Key, Total = g.Count(), Open = g.Count(t => t.Status != TicketStatus.Resolved && t.Status != TicketStatus.Closed) })
            .ToListAsync(ct);
        var tk = tickets.ToDictionary(t => t.Id);
        var mfa = (await users.Users.Where(u => u.TwoFactorEnabled && ids.Contains(u.Id)).Select(u => u.Id).ToListAsync(ct)).ToHashSet();
        return list.Select(u => new
        {
            u.Id, u.FullName, u.Email, u.Phone, u.Status, u.Role, u.AccountTypeId, u.OrganizationId, u.BranchId,
            u.AutoAssign, u.CanCreateForCustomers, u.CreatedAt,
            TeamIds = teams.Where(m => m.UserId == u.Id).Select(m => m.TeamId),
            Tickets = tk.TryGetValue(u.Id, out var t) ? t.Total : 0,
            OpenTickets = tk.TryGetValue(u.Id, out var o) ? o.Open : 0,
            IsSelf = u.Id == c.UserId,
            MfaEnabled = mfa.Contains(u.Id),
        });
    }

    [HttpPost("users")]
    public async Task<object> CreateUser(UserBody b, CancellationToken ct)
    {
        var c = await Need(b.Role == RoleCode.Customer ? Permission.CustomersManage : null, ct);
        var role = await RoleIdAsync(b.Role, ct);
        var email = (b.Email ?? "").Trim().ToLowerInvariant();
        if (!email.Contains('@') || email.Length > 254) throw Err("required", "email");
        var name = Name(b.FullName, "fullName");
        if (string.IsNullOrEmpty(b.Password)) throw Err("passwordWeak", "password");
        if (await users.FindByEmailAsync(email) is not null) throw Err("emailTaken", "email", 409);
        var phone = await CheckPhoneAsync(b.Phone, null, ct);
        await CheckPlacementAsync(b.OrganizationId, b.BranchId, ct);
        RequirePlacementInScope(c, b.OrganizationId, b.BranchId);
        if (b.Role != RoleCode.Customer) await CheckTypeAsync(b.AccountTypeId, ct);

        var user = new AppUser { Id = Guid.NewGuid(), UserName = email, Email = email, EmailConfirmed = true };
        var r = await users.CreateAsync(user, b.Password);
        if (!r.Succeeded) throw Err(r.Errors.Any(e => e.Code.StartsWith("password", StringComparison.OrdinalIgnoreCase)) ? "passwordWeak" : "generic", "password");

        var now = clock.UtcNow;
        var p = new Profile
        {
            Id = user.Id, FullName = name, Email = email, Phone = phone, CreatedAt = now, UpdatedAt = now, PasswordChangedAt = now,
            AccountStatus = AccountStatus.Active, OrganizationId = b.OrganizationId, BranchId = b.BranchId,
            AccountTypeId = b.Role == RoleCode.Customer ? null : b.AccountTypeId,
            AutoAssign = b.Role != RoleCode.Customer && b.AutoAssign,
            CanCreateForCustomers = b.Role != RoleCode.Customer && b.CanCreateForCustomers,
        };
        db.Profiles.Add(p);
        db.CcsUserRoles.Add(new UserRole { UserId = user.Id, RoleId = role });
        audit.Write("user.create", "profile", p.Id, null, new { p.FullName, p.Email, b.Role, p.AccountTypeId, p.OrganizationId, p.BranchId });
        try { await db.SaveChangesAsync(ct); }
        catch { await users.DeleteAsync(user); throw; }
        return new { p.Id };
    }

    [HttpPut("users/{id:guid}")]
    public async Task<IActionResult> UpdateUser(Guid id, UserBody b, CancellationToken ct)
    {
        var (c, p, oldRole) = await TargetAsync(id, ct);
        if (oldRole == RoleCode.Customer && b.Role != RoleCode.Customer && !c.Admin) throw new ForbiddenException();
        var role = await RoleIdAsync(b.Role, ct);
        var before = new { p.FullName, p.Email, p.Phone, Role = oldRole, p.AccountTypeId, p.OrganizationId, p.BranchId, p.AccountStatus };

        if (id == c.UserId && (b.Role != oldRole || b.AccountTypeId != p.AccountTypeId)) throw Err("cannotChangeSelf");
        if (oldRole == RoleCode.Admin && b.Role != RoleCode.Admin) await GuardLastAdminAsync(id, ct);

        p.FullName = Name(b.FullName, "fullName");
        p.Phone = await CheckPhoneAsync(b.Phone, id, ct);
        var email = (b.Email ?? "").Trim().ToLowerInvariant();
        if (email != p.Email)
        {
            if (!email.Contains('@')) throw Err("required", "email");
            if (await users.FindByEmailAsync(email) is not null) throw Err("emailTaken", "email", 409);
            var u = await users.FindByIdAsync(id.ToString()) ?? throw new NotFoundException();
            u.Email = email; u.UserName = email; u.NormalizedEmail = null; u.NormalizedUserName = null;
            var r = await users.UpdateAsync(u);
            if (!r.Succeeded) throw Err("emailTaken", "email", 409);
            p.Email = email;
        }
        await CheckPlacementAsync(b.OrganizationId, b.BranchId, ct);
        RequirePlacementInScope(c, b.OrganizationId, b.BranchId);
        var placeChanged = p.OrganizationId != b.OrganizationId || p.BranchId != b.BranchId;
        p.OrganizationId = b.OrganizationId;
        p.BranchId = b.BranchId;
        if (b.Role == RoleCode.Customer)
        {
            p.AccountTypeId = null; p.AutoAssign = false; p.CanCreateForCustomers = false;
            db.TeamMembers.RemoveRange(db.TeamMembers.Where(m => m.UserId == id));
        }
        else
        {
            await CheckTypeAsync(b.AccountTypeId, ct);
            p.AccountTypeId = b.AccountTypeId; p.AutoAssign = b.AutoAssign; p.CanCreateForCustomers = b.CanCreateForCustomers;
            if (b.Role is not (RoleCode.Agent or RoleCode.TeamLeader))
                db.TeamMembers.RemoveRange(db.TeamMembers.Where(m => m.UserId == id));
            else if (b.Role != RoleCode.TeamLeader)
                await db.TeamMembers.Where(m => m.UserId == id && m.IsLeader).ExecuteUpdateAsync(s => s.SetProperty(m => m.IsLeader, false), ct);
        }
        if (b.Role != oldRole)
        {
            db.CcsUserRoles.RemoveRange(db.CcsUserRoles.Where(x => x.UserId == id));
            db.CcsUserRoles.Add(new UserRole { UserId = id, RoleId = role });
        }
        if (!string.IsNullOrEmpty(b.Status) && b.Status != p.AccountStatus) await SetStatusAsync(c, p, oldRole, b.Status, ct);
        p.UpdatedAt = clock.UtcNow;
        audit.Write("user.update", "profile", id, before, new { p.FullName, p.Email, p.Phone, b.Role, p.AccountTypeId, p.OrganizationId, p.BranchId, p.AccountStatus });
        await db.SaveChangesAsync(ct);
        // Tickets keep the place they were created in. On request, the customer's open tickets move with them;
        // resolved and closed tickets always stay where they were.
        if (placeChanged && b.MoveOpenTickets && b.Role == RoleCode.Customer)
        {
            var moved = await db.Tickets.Where(t => t.RequesterId == id && t.Status != TicketStatus.Resolved && t.Status != TicketStatus.Closed)
                .ExecuteUpdateAsync(x => x.SetProperty(t => t.OrganizationId, b.OrganizationId).SetProperty(t => t.BranchId, b.BranchId), ct);
            if (moved > 0)
            {
                audit.Write("user.move_tickets", "profile", id, null, new { moved, p.OrganizationId, p.BranchId });
                await db.SaveChangesAsync(ct);
            }
        }
        return NoContent();
    }

    [HttpPost("users/{id:guid}/status")]
    public async Task<IActionResult> Status(Guid id, StatusBody b, CancellationToken ct)
    {
        var (c, p, role) = await TargetAsync(id, ct);
        var before = p.AccountStatus;
        await SetStatusAsync(c, p, role, b.Status, ct);
        p.UpdatedAt = clock.UtcNow;
        audit.Write("user.status", "profile", id, new { status = before }, new { status = p.AccountStatus });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("users/{id:guid}/password")]
    public async Task<IActionResult> Password(Guid id, PasswordBody b, CancellationToken ct)
    {
        var (_, p, _) = await TargetAsync(id, ct);
        var u = await users.FindByIdAsync(id.ToString()) ?? throw new NotFoundException();
        var token = await users.GeneratePasswordResetTokenAsync(u);
        var r = await users.ResetPasswordAsync(u, token, b.Password ?? "");
        if (!r.Succeeded) throw Err("passwordWeak", "password");
        p.PasswordChangedAt = clock.UtcNow;
        p.PasswordWarnStage = 0;
        await RevokeSessionsAsync(id, ct);
        audit.Write("user.password_reset", "profile", id, null, null);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Deletes a person with no history; otherwise answers inUse so the screen offers Suspend.</summary>
    [HttpDelete("users/{id:guid}")]
    public async Task<IActionResult> DeleteUser(Guid id, CancellationToken ct)
    {
        var (c, p, role) = await TargetAsync(id, ct);
        if (id == c.UserId) throw Err("cannotDeleteSelf");
        if (role == RoleCode.Admin) await GuardLastAdminAsync(id, ct);
        var used = await db.Tickets.AnyAsync(t => t.RequesterId == id || t.AssignedAgentId == id, ct)
                   || await db.TicketMessages.AnyAsync(m => m.AuthorId == id, ct)
                   || await db.Organizations.AnyAsync(o => o.TeamLeaderId == id, ct)
                   || await db.Branches.AnyAsync(b => b.TeamLeaderId == id, ct);
        if (used) throw Err("inUse", null, 409);

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        try
        {
            await db.TeamMembers.Where(m => m.UserId == id).ExecuteDeleteAsync(ct);
            await db.StaffPlacements.Where(m => m.UserId == id).ExecuteDeleteAsync(ct);
            await db.AdminScopes.Where(m => m.UserId == id).ExecuteDeleteAsync(ct);
            await db.CcsUserRoles.Where(m => m.UserId == id).ExecuteDeleteAsync(ct);
            await db.Notifications.Where(m => m.UserId == id).ExecuteDeleteAsync(ct);
            // The sign-in account row; profiles, tokens and codes follow it (ON DELETE CASCADE).
            await db.Users.Where(u => u.Id == id).ExecuteDeleteAsync(ct);
            audit.Write("user.delete", "profile", id, new { p.FullName, p.Email, role }, null);
            db.Entry(p).State = EntityState.Detached;
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (Exception e) when (e is DbUpdateException or Microsoft.Data.SqlClient.SqlException)
        {
            await tx.RollbackAsync(ct);
            throw Err("inUse", null, 409);
        }
        return NoContent();
    }

    // ---------------------------------------------------------------- approvals

    [HttpPost("users/{id:guid}/approve")]
    public async Task<IActionResult> Approve(Guid id, ApproveBody b, CancellationToken ct)
    {
        var c = await Need(Permission.ApproveCustomers, ct);
        var p = await PendingAsync(c, id, ct);
        await CheckPlacementAsync(b.OrganizationId, b.BranchId, ct);
        RequirePlacementInScope(c, b.OrganizationId, b.BranchId);
        p.OrganizationId = b.OrganizationId;
        p.BranchId = b.BranchId;
        p.AccountStatus = AccountStatus.Active;
        p.UpdatedAt = clock.UtcNow;
        audit.Write("user.approve", "profile", id, new { status = AccountStatus.PendingApproval }, new { status = p.AccountStatus, p.OrganizationId, p.BranchId });
        await db.SaveChangesAsync(ct);
        await notify.NotifyAsync(id, "account_approved", null, new { name = p.FullName }, "admin", ct);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("users/{id:guid}/reject")]
    public async Task<IActionResult> Reject(Guid id, RejectBody b, CancellationToken ct)
    {
        var c = await Need(Permission.ApproveCustomers, ct);
        var p = await PendingAsync(c, id, ct);
        p.AccountStatus = AccountStatus.Suspended;
        p.UpdatedAt = clock.UtcNow;
        audit.Write("user.reject", "profile", id, new { status = AccountStatus.PendingApproval }, new { status = p.AccountStatus, reason = b.Reason?.Trim() });
        await RevokeSessionsAsync(id, ct);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ---------------------------------------------------------------- account types

    [HttpGet("account-types")]
    public async Task<object> Types(CancellationToken ct)
    {
        await Need(null, ct);
        var types = await db.AccountTypes.AsNoTracking().OrderByDescending(t => t.IsBuiltin).ThenBy(t => t.NameEn).ToListAsync(ct);
        var perms = await db.AccountTypePermissions.AsNoTracking().ToListAsync(ct);
        var acc = await db.AccountTypeAccess.AsNoTracking().ToListAsync(ct);
        var counts = await db.Profiles.AsNoTracking().Where(p => p.AccountTypeId != null).GroupBy(p => p.AccountTypeId)
            .Select(g => new { Id = g.Key, N = g.Count() }).ToListAsync(ct);
        return types.Select(t => new
        {
            t.Id, t.NameEn, t.NameAr, t.AllAccess, t.IsBuiltin, t.ScopeLevel,
            Kind = AccountKinds.Of(t.IsBuiltin, t.ScopeLevel, perms.Where(x => x.AccountTypeId == t.Id).Select(x => x.Permission).ToList()),
            Permissions = t.IsBuiltin ? Permission.Assignable : perms.Where(x => x.AccountTypeId == t.Id).Select(x => x.Permission).ToList(),
            Access = acc.Where(x => x.AccountTypeId == t.Id).Select(x => new AccessRow(x.OrganizationId, x.BranchId)),
            Staff = counts.FirstOrDefault(x => x.Id == t.Id)?.N ?? 0,
        });
    }

    [HttpPost("account-types")]
    public async Task<object> CreateType(TypeBody b, CancellationToken ct)
    {
        await Need(null, ct);
        var t = new AccountType { Id = Guid.NewGuid(), CreatedAt = clock.UtcNow };
        var rows = await ApplyTypeAsync(t, b, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        db.AccountTypes.Add(t);
        await db.SaveChangesAsync(ct);          // the type first: its rows point at it (no navigations to order them)
        rows();
        audit.Write("account_type.create", "account_type", t.Id, null, b);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { t.Id };
    }

    [HttpPut("account-types/{id:guid}")]
    public async Task<IActionResult> UpdateType(Guid id, TypeBody b, CancellationToken ct)
    {
        await Need(null, ct);
        var t = await db.AccountTypes.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (t.IsBuiltin) throw Err("builtinLocked");
        var before = new { t.NameEn, t.NameAr, t.AllAccess, t.ScopeLevel };
        var oldPerms = await db.AccountTypePermissions.Where(x => x.AccountTypeId == id).Select(x => x.Permission).ToListAsync(ct);
        var oldKind = AccountKinds.Of(false, t.ScopeLevel, oldPerms);
        var holders = await db.Profiles.Where(p => p.AccountTypeId == id).Select(p => p.Id).ToListAsync(ct);
        // Moving a type in use to or from Organization / Branch Admin would change where its people work: not here.
        if (b.Kind is not null && b.Kind != oldKind && holders.Count > 0
            && (AccountKinds.ScopeLevelOf(oldKind) is not null || AccountKinds.ScopeLevelOf(b.Kind) is not null))
            throw Err("kindInUse", "kind", 409);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.AccountTypePermissions.Where(x => x.AccountTypeId == id).ExecuteDeleteAsync(ct);
        await db.AccountTypeAccess.Where(x => x.AccountTypeId == id).ExecuteDeleteAsync(ct);
        (await ApplyTypeAsync(t, b, ct))();
        audit.Write("account_type.update", "account_type", id, before, b);
        await db.SaveChangesAsync(ct);
        await SyncHoldersAsync(t, holders, ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return NoContent();
    }

    /// <summary>After a type changes, its people keep the staff role it implies (Agent / Team leader / Viewer),
    /// and lose team leadership or team places their new role no longer has.</summary>
    private async Task SyncHoldersAsync(AccountType t, List<Guid> holders, CancellationToken ct)
    {
        if (holders.Count == 0 || t.IsBuiltin) return;
        var role = await PeopleController.StaffRoleForTypeAsync(db, t, ct);
        var roleId = await RoleIdAsync(role, ct);
        var customerId = await RoleIdAsync(RoleCode.Customer, ct);
        await db.CcsUserRoles.Where(x => holders.Contains(x.UserId) && x.RoleId != customerId).ExecuteDeleteAsync(ct);
        foreach (var h in holders) db.CcsUserRoles.Add(new UserRole { UserId = h, RoleId = roleId });
        if (role == RoleCode.ManagementViewer)
        {
            await db.TeamMembers.Where(m => holders.Contains(m.UserId)).ExecuteDeleteAsync(ct);
            await db.Profiles.Where(p => holders.Contains(p.Id)).ExecuteUpdateAsync(s => s.SetProperty(p => p.AutoAssign, false), ct);
        }
        else if (role != RoleCode.TeamLeader)
            await db.TeamMembers.Where(m => holders.Contains(m.UserId) && m.IsLeader).ExecuteUpdateAsync(s => s.SetProperty(m => m.IsLeader, false), ct);
    }

    [HttpDelete("account-types/{id:guid}")]
    public async Task<IActionResult> DeleteType(Guid id, CancellationToken ct)
    {
        await Need(null, ct);
        var t = await db.AccountTypes.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (t.IsBuiltin) throw Err("builtinLocked");
        if (await db.Profiles.AnyAsync(p => p.AccountTypeId == id, ct)) throw Err("typeInUse", null, 409);
        db.AccountTypePermissions.RemoveRange(db.AccountTypePermissions.Where(x => x.AccountTypeId == id));
        db.AccountTypeAccess.RemoveRange(db.AccountTypeAccess.Where(x => x.AccountTypeId == id));
        db.AccountTypes.Remove(t);
        audit.Write("account_type.delete", "account_type", id, new { t.NameEn, t.NameAr }, null);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Validates and sets the fields; returns the step that adds the permission and access rows.</summary>
    private async Task<Action> ApplyTypeAsync(AccountType t, TypeBody b, CancellationToken ct)
    {
        var en = Name(b.NameEn, "nameEn");
        var ar = Name(b.NameAr, "nameAr");
        if (await db.AccountTypes.AnyAsync(x => x.Id != t.Id && (x.NameEn == en || x.NameAr == ar), ct)) throw Err("nameTaken", "nameEn", 409);
        if (b.Kind is not null)
        {
            // New shape: the kind decides the scope level, the permissions must fit it, and a type has no places of its own.
            if (!AccountKinds.Pickable.Contains(b.Kind)) throw Err("kind", "kind");
            var picked = (b.Permissions ?? []).Distinct().ToList();
            if (picked.Any(p => !Permission.Assignable.Contains(p))) throw Err("required", "permissions");
            if (AccountKinds.Check(b.Kind, picked) is string bad) throw Err(bad, "permissions");
            b = b with { ScopeLevel = AccountKinds.ScopeLevelOf(b.Kind), AllAccess = AccountKinds.ScopeLevelOf(b.Kind) is null, Access = [] };
        }
        if (b.ScopeLevel is not (null or "" or "branch" or "organization")) throw Err("required", "scopeLevel");
        var acc = (b.Access ?? []).Distinct().ToList();
        // A scoped admin type (Branch / Organization Admin) gets its reach from the per-person scope, not from access rows.
        if (!b.AllAccess && acc.Count == 0 && string.IsNullOrEmpty(b.ScopeLevel)) throw Err("accessRequired", "access");
        if (!b.AllAccess) await CheckAccessRowsAsync(acc, ct);
        t.NameEn = en; t.NameAr = ar; t.AllAccess = b.AllAccess;
        t.ScopeLevel = string.IsNullOrEmpty(b.ScopeLevel) ? null : b.ScopeLevel;
        t.UpdatedAt = clock.UtcNow;
        var perms = (b.Permissions ?? []).Distinct().ToList();
        if (perms.Any(p => !Permission.Assignable.Contains(p))) throw Err("required", "permissions");
        return () =>
        {
            foreach (var perm in perms) db.AccountTypePermissions.Add(new AccountTypePermission { AccountTypeId = t.Id, Permission = perm });
            if (!b.AllAccess)
                foreach (var a in acc)
                    db.AccountTypeAccess.Add(new AccountTypeAccess { Id = Guid.NewGuid(), AccountTypeId = t.Id, OrganizationId = a.OrganizationId, BranchId = a.BranchId });
        };
    }

    // ---------------------------------------------------------------- organizations and branches

    [HttpGet("organizations")]
    public async Task<object> Orgs(CancellationToken ct)
    {
        await Need(null, ct);
        var orgs = await db.Organizations.AsNoTracking().OrderBy(o => o.Name).ToListAsync(ct);
        var branches = await db.Branches.AsNoTracking().OrderBy(b => b.Name).ToListAsync(ct);
        var people = await db.Profiles.AsNoTracking().Where(p => p.OrganizationId != null)
            .GroupBy(p => new { p.OrganizationId, p.BranchId }).Select(g => new { g.Key.OrganizationId, g.Key.BranchId, N = g.Count() }).ToListAsync(ct);
        return orgs.Select(o => new
        {
            o.Id, o.Name, o.Location, o.Phone, o.TeamLeaderId, o.IsActive, o.SharedAccessEnabled, o.ParentId,
            Customers = people.Where(x => x.OrganizationId == o.Id).Sum(x => x.N),
            Branches = branches.Where(b => b.OrganizationId == o.Id).Select(b => new
            {
                b.Id, b.Name, b.Location, b.Phone, b.TeamLeaderId, b.IsActive,
                Customers = people.Where(x => x.BranchId == b.Id).Sum(x => x.N),
            }),
        });
    }

    [HttpPost("organizations")]
    public async Task<object> CreateOrg(OrgBody b, CancellationToken ct)
    {
        await Need(null, ct);
        var o = new Organization { Id = Guid.NewGuid(), CreatedAt = clock.UtcNow };
        await ApplyOrgAsync(o, b, ct);
        db.Organizations.Add(o);
        audit.Write("organization.create", "organization", o.Id, null, b);
        await db.SaveChangesAsync(ct);
        return new { o.Id };
    }

    [HttpPut("organizations/{id:guid}")]
    public async Task<IActionResult> UpdateOrg(Guid id, OrgBody b, CancellationToken ct)
    {
        await Need(null, ct);
        var o = await db.Organizations.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var before = new { o.Name, o.Location, o.Phone, o.TeamLeaderId, o.IsActive, o.SharedAccessEnabled, o.ParentId };
        await ApplyOrgAsync(o, b, ct);
        audit.Write("organization.update", "organization", id, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("organizations/{id:guid}")]
    public async Task<IActionResult> DeleteOrg(Guid id, CancellationToken ct)
    {
        await Need(null, ct);
        var o = await db.Organizations.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (await db.Branches.AnyAsync(x => x.OrganizationId == id, ct) || await db.Profiles.AnyAsync(x => x.OrganizationId == id, ct)
            || await db.Organizations.AnyAsync(x => x.ParentId == id, ct)) throw Err("orgInUse", null, 409);
        db.AccountTypeAccess.RemoveRange(db.AccountTypeAccess.Where(x => x.OrganizationId == id));
        db.AdminScopes.RemoveRange(db.AdminScopes.Where(x => x.OrganizationId == id));
        db.StaffPlacements.RemoveRange(db.StaffPlacements.Where(x => x.OrganizationId == id));
        db.Organizations.Remove(o);
        audit.Write("organization.delete", "organization", id, new { o.Name }, null);
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { throw Err("orgInUse", null, 409); }
        return NoContent();
    }

    [HttpPost("branches")]
    public async Task<object> CreateBranch(BranchBody b, CancellationToken ct)
    {
        await Need(null, ct);
        var x = new Branch { Id = Guid.NewGuid(), CreatedAt = clock.UtcNow };
        await ApplyBranchAsync(x, b, ct);
        db.Branches.Add(x);
        audit.Write("branch.create", "branch", x.Id, null, b);
        await db.SaveChangesAsync(ct);
        return new { x.Id };
    }

    [HttpPut("branches/{id:guid}")]
    public async Task<IActionResult> UpdateBranch(Guid id, BranchBody b, CancellationToken ct)
    {
        await Need(null, ct);
        var x = await db.Branches.FirstOrDefaultAsync(y => y.Id == id, ct) ?? throw new NotFoundException();
        if (b.OrganizationId != x.OrganizationId && await db.Profiles.AnyAsync(p => p.BranchId == id, ct)) throw Err("branchInUse", null, 409);
        var before = new { x.OrganizationId, x.Name, x.Location, x.Phone, x.TeamLeaderId, x.IsActive };
        await ApplyBranchAsync(x, b, ct);
        audit.Write("branch.update", "branch", id, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("branches/{id:guid}")]
    public async Task<IActionResult> DeleteBranch(Guid id, CancellationToken ct)
    {
        await Need(null, ct);
        var x = await db.Branches.FirstOrDefaultAsync(y => y.Id == id, ct) ?? throw new NotFoundException();
        if (await db.Profiles.AnyAsync(p => p.BranchId == id, ct)) throw Err("branchInUse", null, 409);
        db.AccountTypeAccess.RemoveRange(db.AccountTypeAccess.Where(y => y.BranchId == id));
        db.AdminScopes.RemoveRange(db.AdminScopes.Where(y => y.BranchId == id));
        db.StaffPlacements.RemoveRange(db.StaffPlacements.Where(y => y.BranchId == id));
        db.Branches.Remove(x);
        audit.Write("branch.delete", "branch", id, new { x.Name }, null);
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { throw Err("branchInUse", null, 409); }
        return NoContent();
    }

    private async Task ApplyOrgAsync(Organization o, OrgBody b, CancellationToken ct)
    {
        var name = Name(b.Name, "name");
        if (await db.Organizations.AnyAsync(x => x.Id != o.Id && x.Name == name, ct)) throw Err("nameTaken", "name", 409);
        await CheckLeaderAsync(b.TeamLeaderId, ct);
        o.Name = name; o.Location = Short(b.Location, "location"); o.Phone = Clean(b.Phone);
        o.TeamLeaderId = b.TeamLeaderId; o.IsActive = b.IsActive; o.SharedAccessEnabled = b.SharedAccessEnabled; o.UpdatedAt = clock.UtcNow;
        if (b.SetParent)
        {
            if (b.ParentId is Guid pid)
            {
                // The parent must exist, and may not be the organization itself or one under it (no loops).
                var tree = await db.Organizations.AsNoTracking().Select(x => new { x.Id, x.ParentId }).ToDictionaryAsync(x => x.Id, x => x.ParentId, ct);
                if (!tree.ContainsKey(pid)) throw Err("orgNotFound", "parentId");
                for (Guid? cur = pid; cur is Guid c; cur = tree.GetValueOrDefault(c))
                    if (c == o.Id) throw Err("parentLoop", "parentId");
            }
            o.ParentId = b.ParentId;
        }
    }

    private async Task ApplyBranchAsync(Branch x, BranchBody b, CancellationToken ct)
    {
        var name = Name(b.Name, "name");
        if (!await db.Organizations.AnyAsync(o => o.Id == b.OrganizationId, ct)) throw Err("orgNotFound", "organizationId");
        if (await db.Branches.AnyAsync(y => y.Id != x.Id && y.OrganizationId == b.OrganizationId && y.Name == name, ct)) throw Err("nameTaken", "name", 409);
        await CheckLeaderAsync(b.TeamLeaderId, ct);
        x.OrganizationId = b.OrganizationId; x.Name = name; x.Location = Short(b.Location, "location"); x.Phone = Clean(b.Phone);
        x.TeamLeaderId = b.TeamLeaderId; x.IsActive = b.IsActive; x.UpdatedAt = clock.UtcNow;
    }

    // ---------------------------------------------------------------- teams

    // Teams (per place) live in PeopleController.Teams.cs: organization and branch admins manage their own.

    // ---------------------------------------------------------------- staff screen (v1 /admin/users)

    /// <summary>Staff with every role, account type, what they can reach, teams and what they lead (v1 admin_list_users + scopeOf).</summary>
    [HttpGet("staff")]
    public async Task<object> Staff(CancellationToken ct)
    {
        var c = await Need(null, ct);
        var roleRows = await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id select new { ur.UserId, r.Code }).ToListAsync(ct);
        var rolesOf = roleRows.GroupBy(x => x.UserId).ToDictionary(g => g.Key, g => g.Select(x => x.Code).OrderBy(x => RoleCode.All.ToList().IndexOf(x)).ToList());
        var staffIds = rolesOf.Where(kv => !kv.Value.Contains(RoleCode.Customer)).Select(kv => kv.Key).ToList();
        var people = await db.Profiles.AsNoTracking().Where(p => staffIds.Contains(p.Id)).OrderByDescending(p => p.CreatedAt).ToListAsync(ct); // newest first, as v1
        var orgs = await db.Organizations.AsNoTracking().Select(o => new { o.Id, o.Name, o.TeamLeaderId, o.IsActive }).ToListAsync(ct);
        var branches = await db.Branches.AsNoTracking().Select(b => new { b.Id, b.OrganizationId, b.Name, b.TeamLeaderId, b.IsActive }).ToListAsync(ct);
        var types = await db.AccountTypes.AsNoTracking().ToDictionaryAsync(t => t.Id, ct);
        var typeAccess = await db.AccountTypeAccess.AsNoTracking().ToListAsync(ct);
        var scopes = await db.AdminScopes.AsNoTracking().Where(s => staffIds.Contains(s.UserId)).ToListAsync(ct);
        var places = await db.StaffPlacements.AsNoTracking().Where(s => staffIds.Contains(s.UserId)).ToListAsync(ct);
        var teams = await (from m in db.TeamMembers.AsNoTracking() join t in db.Teams on m.TeamId equals t.Id where staffIds.Contains(m.UserId)
                           select new { m.UserId, TeamId = t.Id, t.NameEn, t.NameAr, m.IsLeader }).ToListAsync(ct);
        var mfa = (await users.Users.Where(u => u.TwoFactorEnabled && staffIds.Contains(u.Id)).Select(u => u.Id).ToListAsync(ct)).ToHashSet();
        string OrgName(Guid id) => orgs.FirstOrDefault(o => o.Id == id)?.Name ?? "?";
        string BrName(Guid id) => branches.FirstOrDefault(b => b.Id == id)?.Name ?? "?";
        // A line per place: "Org · Branch", or the organization with an "all branches" marker the screen translates.
        object Line(Guid org, Guid? br) => br is Guid b ? new { org = OrgName(org), branch = (string?)BrName(b) } : new { org = OrgName(org), branch = (string?)null };
        return new
        {
            me = c.UserId,
            orgs = orgs.Where(o => o.IsActive).OrderBy(o => o.Name).Select(o => new { o.Id, o.Name }),
            branches = branches.Where(b => b.IsActive).OrderBy(b => b.Name).Select(b => new { b.Id, b.OrganizationId, b.Name }),
            staff = people.Select(p =>
            {
                var roles = rolesOf[p.Id];
                var ty = p.AccountTypeId is Guid tid && types.TryGetValue(tid, out var tt) ? tt : null;
                var isAdmin = roles.Contains(RoleCode.Admin);
                var picked = scopes.Where(s => s.UserId == p.Id).Select(s => Line(s.OrganizationId, s.BranchId)).ToList();
                var placed = places.Where(s => s.UserId == p.Id).Select(s => Line(s.OrganizationId, s.BranchId)).ToList();
                // Same order of rules as v1 scopeOf(): scoped admin → their scope; placed → placement; admin / all-access / no type → everything; else the type's places.
                string kind; List<object> access;
                if (ty?.ScopeLevel is not null && !isAdmin) { kind = picked.Count == 0 ? "none" : "list"; access = picked; }
                else if (placed.Count > 0 && !isAdmin) { kind = "list"; access = placed; }
                else if (isAdmin || ty is null || ty.AllAccess) { kind = "all"; access = []; }
                else { access = typeAccess.Where(a => a.AccountTypeId == ty.Id).Select(a => Line(a.OrganizationId, a.BranchId)).ToList(); kind = access.Count == 0 ? "none" : "list"; }
                var leads = orgs.Where(o => o.TeamLeaderId == p.Id).Select(o => o.Name)
                    .Concat(branches.Where(b => b.TeamLeaderId == p.Id).Select(b => OrgName(b.OrganizationId) + " · " + b.Name)).Distinct().ToList();
                return new
                {
                    p.Id, p.FullName, p.Email, p.Phone, Status = p.AccountStatus, Roles = roles, p.CreatedAt, IsSelf = p.Id == c.UserId,
                    Mfa = mfa.Contains(p.Id), TypeNameEn = ty?.NameEn, TypeNameAr = ty?.NameAr, ScopeLevel = ty?.ScopeLevel,
                    AccessKind = kind, Access = access, Leads = leads,
                    Teams = teams.Where(t => t.UserId == p.Id).Select(t => new { t.TeamId, t.NameEn, t.NameAr, t.IsLeader }),
                    p.AccountTypeId, p.AutoAssign, p.CanCreateForCustomers,
                    // Raw Works in for the person card: scoped admins edit their scope, everyone else their placement.
                    Places = (ty?.ScopeLevel is not null ? scopes.Where(s => s.UserId == p.Id).Select(s => new { s.OrganizationId, s.BranchId })
                        : places.Where(s => s.UserId == p.Id).Select(s => new { s.OrganizationId, s.BranchId })).ToList(),
                };
            }),
        };
    }

    /// <summary>v1 createUserAction for staff: several roles, or an Organization / Branch Admin with the places they manage.</summary>
    [HttpPost("staff")]
    public async Task<object> CreateStaff(StaffCreateBody b, CancellationToken ct)
    {
        await Need(null, ct);
        if (b.AccountTypeId is Guid typeIdPicked) return await CreateStaffWithTypeAsync(b, typeIdPicked, ct);
        var scoped = b.Scoped is "organization" or "branch" ? b.Scoped : null;
        string[] roles = scoped is not null ? [RoleCode.Agent] : (b.Roles ?? []).Distinct().ToArray();
        CheckRoles(roles, staffOnly: true);
        Guid[] pickOrgs = b.Orgs ?? [], pickBranches = b.Branches ?? [];
        if (scoped is not null && (scoped == "organization" ? pickOrgs.Length : pickBranches.Length) == 0) throw Err("scopeRequired", "scope");
        var email = (b.Email ?? "").Trim().ToLowerInvariant();
        if (!email.Contains('@') || email.Length > 254) throw Err("required", "email");
        var name = Name(b.FullName, "fullName");
        if (string.IsNullOrEmpty(b.Password)) throw Err("passwordWeak", "password");
        if (await users.FindByEmailAsync(email) is not null) throw Err("emailTaken", "email", 409);
        var phone = await CheckPhoneAsync(b.Phone, null, ct);
        Guid? typeId = null;
        if (scoped is not null)
        {
            typeId = await db.AccountTypes.Where(t => t.ScopeLevel == scoped).OrderByDescending(t => t.IsBuiltin).ThenBy(t => t.CreatedAt).Select(t => (Guid?)t.Id).FirstOrDefaultAsync(ct)
                     ?? throw Err("generic");
        }
        var user = new AppUser { Id = Guid.NewGuid(), UserName = email, Email = email, EmailConfirmed = true };
        var r = await users.CreateAsync(user, b.Password);
        if (!r.Succeeded) throw Err(r.Errors.Any(e => e.Code.StartsWith("password", StringComparison.OrdinalIgnoreCase)) ? "passwordWeak" : "generic", "password");
        var now = clock.UtcNow;
        var p = new Profile { Id = user.Id, FullName = name, Email = email, Phone = phone, CreatedAt = now, UpdatedAt = now, PasswordChangedAt = now, AccountStatus = AccountStatus.Active, AccountTypeId = typeId };
        db.Profiles.Add(p);
        foreach (var code in roles) db.CcsUserRoles.Add(new UserRole { UserId = user.Id, RoleId = await RoleIdAsync(code, ct) });
        if (scoped is not null)
        {
            var rows = scoped == "organization"
                ? await db.Organizations.Where(o => pickOrgs.Contains(o.Id)).Select(o => new { OrganizationId = o.Id, BranchId = (Guid?)null }).ToListAsync(ct)
                : await db.Branches.Where(x => pickBranches.Contains(x.Id)).Select(x => new { x.OrganizationId, BranchId = (Guid?)x.Id }).ToListAsync(ct);
            foreach (var x in rows)
            {
                db.AdminScopes.Add(new AdminScope { Id = Guid.NewGuid(), UserId = user.Id, OrganizationId = x.OrganizationId, BranchId = x.BranchId });
                db.StaffPlacements.Add(new StaffPlacement { Id = Guid.NewGuid(), UserId = user.Id, OrganizationId = x.OrganizationId, BranchId = x.BranchId });
            }
        }
        audit.Write("user.create", "profile", p.Id, null, new { p.FullName, p.Email, roles, scoped });
        try { await db.SaveChangesAsync(ct); }
        catch { await users.DeleteAsync(user); throw; }
        return new { p.Id };
    }

    /// <summary>Staff page "+ Add staff": account type (what) and Works in (where); the staff role follows the type.</summary>
    private async Task<object> CreateStaffWithTypeAsync(StaffCreateBody b, Guid typeId, CancellationToken ct)
    {
        var type = await db.AccountTypes.AsNoTracking().FirstOrDefaultAsync(t => t.Id == typeId, ct) ?? throw Err("typeRequired", "accountTypeId");
        var email = (b.Email ?? "").Trim().ToLowerInvariant();
        if (!email.Contains('@') || email.Length > 254) throw Err("required", "email");
        var name = Name(b.FullName, "fullName");
        if (string.IsNullOrEmpty(b.Password)) throw Err("passwordWeak", "password");
        if (await users.FindByEmailAsync(email) is not null) throw Err("emailTaken", "email", 409);
        var phone = await CheckPhoneAsync(b.Phone, null, ct);
        // Works in is checked before the account exists, so a missing place never leaves a half-made user.
        bool scopedType = type.ScopeLevel is not null;
        int picks = type.ScopeLevel == "organization" ? (b.Orgs ?? []).Length : type.ScopeLevel == "branch" ? (b.Branches ?? []).Length : (b.Orgs ?? []).Length + (b.Branches ?? []).Length;
        if (!type.IsBuiltin && (scopedType || !b.Everywhere) && picks == 0)
            throw Err(type.ScopeLevel == "organization" ? "placeOrgRequired" : type.ScopeLevel == "branch" ? "placeBranchRequired" : "placeRequired", "where");

        var user = new AppUser { Id = Guid.NewGuid(), UserName = email, Email = email, EmailConfirmed = true };
        var r = await users.CreateAsync(user, b.Password);
        if (!r.Succeeded) throw Err(r.Errors.Any(e => e.Code.StartsWith("password", StringComparison.OrdinalIgnoreCase)) ? "passwordWeak" : "generic", "password");
        try
        {
            var now = clock.UtcNow;
            var role = await PeopleController.StaffRoleForTypeAsync(db, type, ct);
            db.Profiles.Add(new Profile { Id = user.Id, FullName = name, Email = email, Phone = phone, CreatedAt = now, UpdatedAt = now, PasswordChangedAt = now, AccountStatus = AccountStatus.Active, AccountTypeId = type.Id });
            db.CcsUserRoles.Add(new UserRole { UserId = user.Id, RoleId = await RoleIdAsync(role, ct) });
            await db.SaveChangesAsync(ct);
            var where = await PeopleController.ApplyWhereAsync(db, user.Id, type, b.Everywhere, b.Orgs, b.Branches, ct);
            audit.Write("user.create", "profile", user.Id, null, new { FullName = name, Email = email, accountTypeId = type.Id, role, where.Everywhere, where.Orgs, where.Branches });
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            db.ChangeTracker.Clear();
            await db.Profiles.Where(p => p.Id == user.Id).ExecuteDeleteAsync(CancellationToken.None);
            await users.DeleteAsync(user);
            throw;
        }
        return new { user.Id };
    }

    /// <summary>v1 admin_set_user_roles(): the ticked roles replace the old ones. Customer stays alone; nobody drops their own Administrator role.</summary>
    [HttpPut("users/{id:guid}/roles")]
    public async Task<IActionResult> SetRoles(Guid id, RolesBody b, CancellationToken ct)
    {
        var c = await Need(null, ct);
        var p = await db.Profiles.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var roles = (b.Roles ?? []).Distinct().ToArray();
        CheckRoles(roles, staffOnly: false);
        var old = await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id where ur.UserId == id select r.Code).ToListAsync(ct);
        if (id == c.UserId && old.Contains(RoleCode.Admin) && !roles.Contains(RoleCode.Admin)) throw Err("cannot_remove_own_admin");
        if (old.Contains(RoleCode.Admin) && !roles.Contains(RoleCode.Admin)) await GuardLastAdminAsync(id, ct);
        await db.CcsUserRoles.Where(x => x.UserId == id).ExecuteDeleteAsync(ct);
        foreach (var code in roles) db.CcsUserRoles.Add(new UserRole { UserId = id, RoleId = await RoleIdAsync(code, ct) });
        if (!roles.Any(x => x is RoleCode.Agent or RoleCode.TeamLeader)) await db.TeamMembers.Where(m => m.UserId == id).ExecuteDeleteAsync(ct);
        else if (!roles.Contains(RoleCode.TeamLeader)) await db.TeamMembers.Where(m => m.UserId == id && m.IsLeader).ExecuteUpdateAsync(s => s.SetProperty(m => m.IsLeader, false), ct);
        if (roles.Contains(RoleCode.Customer)) { p.AutoAssign = false; p.CanCreateForCustomers = false; }
        p.UpdatedAt = clock.UtcNow;
        audit.Write("user.roles", "profile", id, new { roles = old }, new { roles });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>v1 UserEditForm: name, email and phone only.</summary>
    [HttpPut("users/{id:guid}/details")]
    public async Task<IActionResult> SetDetails(Guid id, DetailsBody b, CancellationToken ct)
    {
        var (_, p, _) = await TargetAsync(id, ct);
        var before = new { p.FullName, p.Email, p.Phone };
        p.FullName = Name(b.FullName, "fullName");
        p.Phone = await CheckPhoneAsync(b.Phone, id, ct);
        var email = (b.Email ?? "").Trim().ToLowerInvariant();
        if (email != p.Email)
        {
            if (!email.Contains('@') || email.Length > 254) throw Err("required", "email");
            if (await users.FindByEmailAsync(email) is not null) throw Err("emailTaken", "email", 409);
            var u = await users.FindByIdAsync(id.ToString()) ?? throw new NotFoundException();
            u.Email = email; u.UserName = email; u.NormalizedEmail = null; u.NormalizedUserName = null;
            if (!(await users.UpdateAsync(u)).Succeeded) throw Err("emailTaken", "email", 409);
            p.Email = email;
        }
        p.UpdatedAt = clock.UtcNow;
        audit.Write("user.update", "profile", id, before, new { p.FullName, p.Email, p.Phone });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private static void CheckRoles(string[] roles, bool staffOnly)
    {
        if (roles.Length == 0) throw Err("at_least_one_role", "roles");
        if (roles.Any(r => !RoleCode.All.Contains(r))) throw Err("invalid_role", "roles");
        if (roles.Contains(RoleCode.Customer) && (staffOnly || roles.Length > 1)) throw Err("customer_role_is_exclusive", "roles");
    }

    /// <summary>v1 approved_accounts(): active customers, with when and by whom they were approved.</summary>
    [HttpGet("approved")]
    public async Task<object> Approved(CancellationToken ct)
    {
        var c = await Need(Permission.ApproveCustomers, ct);
        var custIds = from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id where r.Code == RoleCode.Customer select ur.UserId;
        var rows = await (from p in db.Profiles.AsNoTracking()
                          where p.AccountStatus == AccountStatus.Active && custIds.Contains(p.Id)
                          join o in db.Organizations on p.OrganizationId equals (Guid?)o.Id into os from o in os.DefaultIfEmpty()
                          join b in db.Branches on p.BranchId equals (Guid?)b.Id into bs from b in bs.DefaultIfEmpty()
                          select new { p.Id, p.FullName, p.Email, p.Phone, Organization = o == null ? null : o.Name, Branch = b == null ? null : b.Name, RegisteredAt = p.CreatedAt, p.OrganizationId, p.BranchId }).ToListAsync(ct);
        // H-01: approvers below admin see only customers placed in their own scope.
        var list = rows.Where(x => Covers(c, x.OrganizationId, x.BranchId)).ToList();
        var ids = list.Select(x => x.Id).ToList();
        var logs = await (from l in db.AuditLogs.AsNoTracking()
                          where (l.Action == "user.approve" || l.Action == "customer.approved") && l.EntityId != null && ids.Contains(l.EntityId.Value)
                          select new { l.EntityId, l.CreatedAt, l.ActorId }).ToListAsync(ct);
        var last = logs.GroupBy(l => l.EntityId!.Value).ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.CreatedAt).First());
        var actorIds = last.Values.Where(x => x.ActorId != null).Select(x => x.ActorId!.Value).Distinct().ToList();
        var actors = await db.Profiles.AsNoTracking().Where(p => actorIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.FullName, ct);
        return list.Select(x =>
        {
            var a = last.GetValueOrDefault(x.Id);
            return new
            {
                x.Id, x.FullName, x.Email, x.Phone, x.Organization, x.Branch, x.RegisteredAt,
                ApprovedAt = a?.CreatedAt, ApprovedBy = a?.ActorId is Guid g && actors.TryGetValue(g, out var n) ? n : null,
            };
        }).OrderByDescending(x => x.ApprovedAt ?? x.RegisteredAt).Take(500);
    }

    /// <summary>Everyone placed in an organization, for the customers list under each organization (v1 organizations page).</summary>
    [HttpGet("organizations/people")]
    public async Task<object> OrgPeople(CancellationToken ct)
    {
        await Need(null, ct);
        var people = await db.Profiles.AsNoTracking().Where(p => p.OrganizationId != null).OrderBy(p => p.FullName)
            .Select(p => new { p.Id, p.FullName, p.Email, p.Phone, Status = p.AccountStatus, p.OrganizationId, p.BranchId }).ToListAsync(ct);
        // Tickets they opened (open = not resolved or closed) and when they last signed in or used the site.
        var tickets = await db.Tickets.AsNoTracking().GroupBy(t => t.RequesterId)
            .Select(g => new { Id = g.Key, Total = g.Count(), Open = g.Count(t => t.Status != TicketStatus.Resolved && t.Status != TicketStatus.Closed) })
            .ToDictionaryAsync(x => x.Id, ct);
        var signIns = await db.AuditLogs.AsNoTracking().Where(a => a.EntityType == "user" && a.Action == "auth.sign_in" && a.EntityId != null)
            .GroupBy(a => a.EntityId!.Value).Select(g => new { Id = g.Key, At = g.Max(a => a.CreatedAt) }).ToDictionaryAsync(x => x.Id, x => x.At, ct);
        var sessions = await db.RefreshTokens.AsNoTracking().GroupBy(r => r.UserId)
            .Select(g => new { Id = g.Key, At = g.Max(r => r.CreatedAt) }).ToDictionaryAsync(x => x.Id, x => x.At, ct);
        return people.Select(p =>
        {
            var t = tickets.GetValueOrDefault(p.Id);
            DateTimeOffset? a = signIns.TryGetValue(p.Id, out var s1) ? s1 : null, b = sessions.TryGetValue(p.Id, out var s2) ? s2 : null;
            return new { p.Id, p.FullName, p.Email, p.Phone, p.Status, p.OrganizationId, p.BranchId,
                         OpenTickets = t?.Open ?? 0, TotalTickets = t?.Total ?? 0, LastActive = a > b || b is null ? a : b };
        });
    }

    /// <summary>
    /// Staff per place for the Organizations page: one row per place a person works in (head office or branch),
    /// with their role, account type, whether they are the admin of that place, and their teams.
    /// </summary>
    [HttpGet("organizations/staff")]
    public async Task<object> OrgStaff(CancellationToken ct)
    {
        await Need(null, ct);
        var rows = await (from s in db.StaffPlacements.AsNoTracking()
                          join p in db.Profiles on s.UserId equals p.Id
                          join t in db.AccountTypes on p.AccountTypeId equals (Guid?)t.Id into tj from t in tj.DefaultIfEmpty()
                          select new { s.UserId, s.OrganizationId, s.BranchId, p.FullName, p.Email, Status = p.AccountStatus,
                                       TypeEn = t == null ? null : t.NameEn, TypeAr = t == null ? null : t.NameAr, Scope = t == null ? null : t.ScopeLevel }).ToListAsync(ct);
        var ids = rows.Select(r => r.UserId).Distinct().ToList();
        var roles = await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id
                           where ids.Contains(ur.UserId) && r.Code != RoleCode.Customer select new { ur.UserId, r.Code }).ToListAsync(ct);
        var scopes = await db.AdminScopes.AsNoTracking().Where(a => ids.Contains(a.UserId)).Select(a => new { a.UserId, a.OrganizationId, a.BranchId }).ToListAsync(ct);
        var teams = await (from m in db.TeamMembers join t in db.Teams on m.TeamId equals t.Id
                           where ids.Contains(m.UserId) select new { m.UserId, t.NameEn, t.NameAr, m.IsLeader }).ToListAsync(ct);
        return rows.Where(r => roles.Any(x => x.UserId == r.UserId)).OrderBy(r => r.FullName).Select(r => new
        {
            Id = r.UserId, r.FullName, r.Email, r.Status, r.OrganizationId, r.BranchId, r.TypeEn, r.TypeAr,
            Role = roles.Where(x => x.UserId == r.UserId).Select(x => x.Code).OrderByDescending(c => c == RoleCode.Admin).First(),
            AdminHere = r.Scope is not null && scopes.Any(a => a.UserId == r.UserId && a.OrganizationId == r.OrganizationId && a.BranchId == r.BranchId),
            Teams = teams.Where(t => t.UserId == r.UserId).Select(t => new { t.NameEn, t.NameAr, t.IsLeader }),
        });
    }

    // ---------------------------------------------------------------- helpers

    private async Task<(AccessContext, Profile, string?)> TargetAsync(Guid id, CancellationToken ct)
    {
        var p = await db.Profiles.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var role = await RoleOfAsync(id, ct);
        var c = await Need(role == RoleCode.Customer ? Permission.CustomersManage : null, ct);
        // H-01: a customer outside the caller's scope does not exist for them (same 404 as the profile screen).
        if (!Covers(c, p.OrganizationId, p.BranchId)) throw new NotFoundException();
        return (c, p, role);
    }

    private async Task<Profile> PendingAsync(AccessContext c, Guid id, CancellationToken ct)
    {
        var p = await db.Profiles.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        // Same rule as the pending list: only the request's own approvers (system admins: all).
        if (!await approvers.CanHandleAsync(c, p, ct)) throw new NotFoundException();
        if (p.AccountStatus != AccountStatus.PendingApproval) throw Err("not_pending_approval");
        return p;
    }

    private Task<string?> RoleOfAsync(Guid id, CancellationToken ct) =>
        (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id where ur.UserId == id
         orderby r.Id descending select r.Code).FirstOrDefaultAsync(ct);

    private async Task<short> RoleIdAsync(string code, CancellationToken ct)
    {
        if (!RoleCode.All.Contains(code)) throw Err("pickRole", "role");
        return await db.CcsRoles.Where(r => r.Code == code).Select(r => r.Id).FirstAsync(ct);
    }

    private async Task SetStatusAsync(AccessContext c, Profile p, string? role, string status, CancellationToken ct)
    {
        if (status is not (AccountStatus.Active or AccountStatus.Suspended)) throw Err("status", "status");
        if (p.Id == c.UserId) throw Err("cannot_change_own_status");
        if (status == AccountStatus.Suspended && role == RoleCode.Admin) await GuardLastAdminAsync(p.Id, ct);
        p.AccountStatus = status;
        if (status == AccountStatus.Suspended) await RevokeSessionsAsync(p.Id, ct);
    }

    private async Task GuardLastAdminAsync(Guid leaving, CancellationToken ct)
    {
        var others = await (from p in db.Profiles join ur in db.CcsUserRoles on p.Id equals ur.UserId join r in db.CcsRoles on ur.RoleId equals r.Id
                            where r.Code == RoleCode.Admin && p.AccountStatus == AccountStatus.Active && p.Id != leaving select p.Id).AnyAsync(ct);
        if (!others) throw Err("lastAdmin", null, 409);
    }

    private Task RevokeSessionsAsync(Guid id, CancellationToken ct) =>
        db.RefreshTokens.Where(t => t.UserId == id && t.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, clock.UtcNow), ct);

    private async Task CheckPlacementAsync(Guid? org, Guid? branch, CancellationToken ct)
    {
        if (branch is not null && org is null) throw Err("branchOrg", "branchId");
        if (org is not null && !await db.Organizations.AnyAsync(o => o.Id == org, ct)) throw Err("orgNotFound", "organizationId");
        if (branch is not null && !await db.Branches.AnyAsync(b => b.Id == branch && b.OrganizationId == org, ct)) throw Err("branchOrg", "branchId");
    }

    private async Task CheckTypeAsync(Guid? typeId, CancellationToken ct)
    {
        if (typeId is not null && !await db.AccountTypes.AnyAsync(t => t.Id == typeId, ct)) throw Err("notFound", "accountTypeId");
    }

    private async Task CheckAccessRowsAsync(List<AccessRow> rows, CancellationToken ct)
    {
        foreach (var a in rows) await CheckPlacementAsync(a.OrganizationId, a.BranchId, ct);
    }

    private async Task CheckLeaderAsync(Guid? id, CancellationToken ct)
    {
        if (id is null) return;
        if (!await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id where ur.UserId == id.Value && r.Code == RoleCode.TeamLeader select ur).AnyAsync(ct))
            throw Err("leaderRole", "teamLeaderId");
    }

    /// <summary>A person's phone: optional; when given, an Egyptian mobile (11 digits starting 01), stored as +201xxxxxxxxx like at registration.</summary>
    private async Task<string?> CheckPhoneAsync(string? phone, Guid? self, CancellationToken ct)
    {
        if (Clean(phone) is null) return null;
        var p = (await HttpContext.RequestServices.GetRequiredService<Ccs.Application.Settings.SettingsService>().GetPhoneFormatAsync(ct)).Normalize(phone) ?? throw Err("phoneInvalid", "phone");
        if (await db.Profiles.AnyAsync(x => x.Phone == p && x.Id != self, ct)) throw Err("phoneTaken", "phone", 409);
        return p;
    }

    private static string Name(string? v, string field)
    {
        var s = (v ?? "").Trim();
        if (s.Length is < 2 or > 120) throw Err("name", field);
        return s;
    }

    private static string? Short(string? v, string field)
    {
        var s = Clean(v);
        if (s is { Length: > 300 }) throw Err("locationLong", field);
        return s;
    }

    private static string? Clean(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();
}
