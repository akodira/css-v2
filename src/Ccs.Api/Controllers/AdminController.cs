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
    UserManager<AppUser> users, IClock clock) : ControllerBase
{
    // ---------------------------------------------------------------- contracts

    public sealed record UserBody(string FullName, string Email, string? Phone, string? Password, string Role,
        Guid? AccountTypeId, Guid? OrganizationId, Guid? BranchId, string? Status, bool AutoAssign, bool CanCreateForCustomers);
    public sealed record PasswordBody(string Password);
    public sealed record StatusBody(string Status);
    public sealed record ApproveBody(Guid OrganizationId, Guid? BranchId);
    public sealed record RejectBody(string? Reason);
    public sealed record AccessRow(Guid OrganizationId, Guid? BranchId);
    public sealed record TypeBody(string NameEn, string NameAr, bool AllAccess, string? ScopeLevel, string[] Permissions, AccessRow[] Access);
    public sealed record OrgBody(string Name, string? Location, string? Phone, Guid? TeamLeaderId, bool IsActive, bool SharedAccessEnabled);
    public sealed record BranchBody(Guid OrganizationId, string Name, string? Location, string? Phone, Guid? TeamLeaderId, bool IsActive);
    public sealed record TeamBody(string NameEn, string NameAr, bool IsActive);
    public sealed record MemberRow(Guid UserId, bool IsLeader);
    public sealed record MembersBody(MemberRow[] Members);

    private static AuthError Err(string code, string? field = null, int status = 400) => new(code, status, field);

    private async Task<AccessContext> Need(string? permission, CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        if (c.Admin || (permission is not null && c.Has(permission))) return c;
        throw new ForbiddenException();
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
        else if (kind != "staff" && !c.Admin && !c.AllScope)
        {
            var orgIds = c.Scope.Where(s => s.BranchId == null).Select(s => s.OrganizationId).ToList();
            var branchIds = c.Scope.Where(s => s.BranchId != null).Select(s => s.BranchId!.Value).ToList();
            rows = rows.Where(x => x.p.OrganizationId == null && kind == "pending"
                || (x.p.OrganizationId != null && orgIds.Contains(x.p.OrganizationId.Value))
                || (x.p.BranchId != null && branchIds.Contains(x.p.BranchId.Value)));
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
        await CheckPhoneAsync(b.Phone, null, ct);
        await CheckPlacementAsync(b.OrganizationId, b.BranchId, ct);
        if (b.Role != RoleCode.Customer) await CheckTypeAsync(b.AccountTypeId, ct);

        var user = new AppUser { Id = Guid.NewGuid(), UserName = email, Email = email, EmailConfirmed = true };
        var r = await users.CreateAsync(user, b.Password);
        if (!r.Succeeded) throw Err(r.Errors.Any(e => e.Code.StartsWith("password", StringComparison.OrdinalIgnoreCase)) ? "passwordWeak" : "generic", "password");

        var now = clock.UtcNow;
        var p = new Profile
        {
            Id = user.Id, FullName = name, Email = email, Phone = Clean(b.Phone), CreatedAt = now, UpdatedAt = now, PasswordChangedAt = now,
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
        await CheckPhoneAsync(b.Phone, id, ct);
        p.Phone = Clean(b.Phone);
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
        await Need(Permission.ApproveCustomers, ct);
        var p = await PendingAsync(id, ct);
        await CheckPlacementAsync(b.OrganizationId, b.BranchId, ct);
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
        await Need(Permission.ApproveCustomers, ct);
        var p = await PendingAsync(id, ct);
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
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.AccountTypePermissions.Where(x => x.AccountTypeId == id).ExecuteDeleteAsync(ct);
        await db.AccountTypeAccess.Where(x => x.AccountTypeId == id).ExecuteDeleteAsync(ct);
        (await ApplyTypeAsync(t, b, ct))();
        audit.Write("account_type.update", "account_type", id, before, b);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return NoContent();
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
            o.Id, o.Name, o.Location, o.Phone, o.TeamLeaderId, o.IsActive, o.SharedAccessEnabled,
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
        var before = new { o.Name, o.Location, o.Phone, o.TeamLeaderId, o.IsActive, o.SharedAccessEnabled };
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

    [HttpGet("teams")]
    public async Task<object> Teams(CancellationToken ct)
    {
        await Need(null, ct);
        var teams = await db.Teams.AsNoTracking().OrderBy(t => t.NameEn).ToListAsync(ct);
        var members = await (from m in db.TeamMembers.AsNoTracking() join p in db.Profiles on m.UserId equals p.Id
                             select new { m.TeamId, m.UserId, m.IsLeader, p.FullName, p.Email }).ToListAsync(ct);
        var candidates = await (from p in db.Profiles join ur in db.CcsUserRoles on p.Id equals ur.UserId join r in db.CcsRoles on ur.RoleId equals r.Id
                                where p.AccountStatus == AccountStatus.Active && (r.Code == RoleCode.Agent || r.Code == RoleCode.TeamLeader)
                                orderby p.FullName select new { p.Id, p.FullName, p.Email, Role = r.Code }).ToListAsync(ct);
        return new
        {
            teams = teams.Select(t => new
            {
                t.Id, t.NameEn, t.NameAr, t.IsActive,
                Members = members.Where(m => m.TeamId == t.Id).OrderByDescending(m => m.IsLeader).ThenBy(m => m.FullName)
                    .Select(m => new { m.UserId, m.FullName, m.Email, m.IsLeader }),
            }),
            candidates,
        };
    }

    [HttpPost("teams")]
    public async Task<object> CreateTeam(TeamBody b, CancellationToken ct)
    {
        await Need(null, ct);
        var t = new Team { Id = Guid.NewGuid(), CreatedAt = clock.UtcNow };
        await ApplyTeamAsync(t, b, ct);
        db.Teams.Add(t);
        audit.Write("team.create", "team", t.Id, null, b);
        await db.SaveChangesAsync(ct);
        return new { t.Id };
    }

    [HttpPut("teams/{id:guid}")]
    public async Task<IActionResult> UpdateTeam(Guid id, TeamBody b, CancellationToken ct)
    {
        await Need(null, ct);
        var t = await db.Teams.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var before = new { t.NameEn, t.NameAr, t.IsActive };
        await ApplyTeamAsync(t, b, ct);
        audit.Write("team.update", "team", id, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("teams/{id:guid}")]
    public async Task<IActionResult> DeleteTeam(Guid id, CancellationToken ct)
    {
        await Need(null, ct);
        var t = await db.Teams.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (await db.Tickets.AnyAsync(x => x.TeamId == id, ct) || await db.TicketCategories.AnyAsync(x => x.DefaultTeamId == id, ct))
            throw Err("inUse", null, 409);
        db.TeamMembers.RemoveRange(db.TeamMembers.Where(m => m.TeamId == id));
        db.Teams.Remove(t);
        audit.Write("team.delete", "team", id, new { t.NameEn, t.NameAr }, null);
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { throw Err("inUse", null, 409); }
        return NoContent();
    }

    [HttpPut("teams/{id:guid}/members")]
    public async Task<IActionResult> Members(Guid id, MembersBody b, CancellationToken ct)
    {
        await Need(null, ct);
        if (!await db.Teams.AnyAsync(x => x.Id == id, ct)) throw new NotFoundException();
        var wanted = (b.Members ?? []).GroupBy(m => m.UserId).Select(g => g.First()).ToList();
        var ids = wanted.Select(m => m.UserId).ToList();
        var roles = await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id
                           where ids.Contains(ur.UserId) select new { ur.UserId, r.Code }).ToListAsync(ct);
        foreach (var m in wanted)
        {
            var code = roles.FirstOrDefault(r => r.UserId == m.UserId)?.Code;
            if (code is not (RoleCode.Agent or RoleCode.TeamLeader)) throw Err("user_must_be_agent_or_team_leader");
            if (m.IsLeader && code != RoleCode.TeamLeader) throw Err("leaderRole");
        }
        var before = await db.TeamMembers.AsNoTracking().Where(m => m.TeamId == id).Select(m => new { m.UserId, m.IsLeader }).ToListAsync(ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.TeamMembers.Where(m => m.TeamId == id).ExecuteDeleteAsync(ct);
        foreach (var m in wanted) db.TeamMembers.Add(new TeamMember { TeamId = id, UserId = m.UserId, IsLeader = m.IsLeader });
        audit.Write("team.members", "team", id, before, wanted);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return NoContent();
    }

    private async Task ApplyTeamAsync(Team t, TeamBody b, CancellationToken ct)
    {
        var en = Name(b.NameEn, "nameEn");
        var ar = Name(b.NameAr, "nameAr");
        if (await db.Teams.AnyAsync(x => x.Id != t.Id && (x.NameEn == en || x.NameAr == ar), ct)) throw Err("nameTaken", "nameEn", 409);
        t.NameEn = en; t.NameAr = ar; t.IsActive = b.IsActive; t.UpdatedAt = clock.UtcNow;
    }

    // ---------------------------------------------------------------- helpers

    private async Task<(AccessContext, Profile, string?)> TargetAsync(Guid id, CancellationToken ct)
    {
        var p = await db.Profiles.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var role = await RoleOfAsync(id, ct);
        var c = await Need(role == RoleCode.Customer ? Permission.CustomersManage : null, ct);
        return (c, p, role);
    }

    private async Task<Profile> PendingAsync(Guid id, CancellationToken ct)
    {
        var p = await db.Profiles.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
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
        if (await RoleOfAsync(id.Value, ct) != RoleCode.TeamLeader) throw Err("leaderRole", "teamLeaderId");
    }

    private async Task CheckPhoneAsync(string? phone, Guid? self, CancellationToken ct)
    {
        var p = Clean(phone);
        if (p is null) return;
        if (!System.Text.RegularExpressions.Regex.IsMatch(p, @"^\+?[0-9 ()\-]{6,24}$")) throw Err("phoneInvalid", "phone");
        if (await db.Profiles.AnyAsync(x => x.Phone == p && x.Id != self, ct)) throw Err("phoneTaken", "phone", 409);
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
