using Ccs.Application.Abstractions;
using Ccs.Application.Access;
using Ccs.Application.Common;
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
/// People screen for scoped administrators (Branch Admin, Organization Admin), port of the scoped_* functions,
/// plus the main Administrator's editors for where a staff member works (placement) and what a scoped admin manages (scope).
/// Rank: Administrator 3, Organization Admin 2, Branch Admin 1. A scoped admin only manages people below their own rank.
/// </summary>
[ApiController]
[Authorize]
public sealed class PeopleController(CcsDbContext db, AccessService access, AuditService audit, UserManager<AppUser> users, IClock clock) : ControllerBase
{
    public sealed record CreateBody(string Kind, string FullName, string Email, string? Phone, string Password, Guid OrganizationId, Guid? BranchId, Guid? AccountTypeId);
    public sealed record UpdateBody(string FullName, string Email, string? Phone);
    public sealed record StatusBody(string Status);
    public sealed record TypeBody(Guid AccountTypeId);
    public sealed record PickBody(Guid[] Orgs, Guid[] Branches);

    private static AuthError Err(string code, string? field = null, int status = 400) => new(code, status, field);
    private static int Rank(string? level) => level switch { "organization" => 2, "branch" => 1, _ => 0 };

    /// <summary>What the caller manages: their rank and the organizations / branches their scope covers.</summary>
    private sealed record Me(AccessContext C, int Rank, HashSet<Guid> Orgs, HashSet<Guid> Branches)
    {
        public bool Covers(Guid? org, Guid? branch) =>
            C.Admin || (Rank > 0 && org is not null && (Orgs.Contains(org.Value) || (branch is not null && Branches.Contains(branch.Value))));
    }

    private async Task<Me> MeAsync(CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        var rank = c.Admin ? 3 : c.Staff || c.Viewer ? Rank(c.ScopeLevel) : 0;
        if (rank == 0) throw new ForbiddenException();
        var scopes = await db.AdminScopes.AsNoTracking().Where(s => s.UserId == c.UserId).ToListAsync(ct);
        var tree = await db.Organizations.AsNoTracking().Select(o => new { o.Id, o.ParentId }).ToListAsync(ct);
        var orgs = new HashSet<Guid>();
        var queue = new Queue<Guid>(scopes.Where(s => s.BranchId is null).Select(s => s.OrganizationId));
        while (queue.Count > 0)
        {
            var id = queue.Dequeue();
            if (!orgs.Add(id)) continue;
            foreach (var child in tree.Where(o => o.ParentId == id)) queue.Enqueue(child.Id);
        }
        return new Me(c, rank, orgs, scopes.Where(s => s.BranchId is not null).Select(s => s.BranchId!.Value).ToHashSet());
    }

    /// <summary>Port of scoped_people(): everyone (not an Administrator, not the caller) placed inside the caller's scope, below the caller's rank.</summary>
    private async Task<List<PersonRow>> PeopleAsync(Me me, CancellationToken ct)
    {
        var rows = await (from p in db.Profiles.AsNoTracking()
                          join t in db.AccountTypes on p.AccountTypeId equals (Guid?)t.Id into tj
                          from t in tj.DefaultIfEmpty()
                          where p.Id != me.C.UserId
                          select new { p.Id, p.FullName, p.Email, p.Phone, p.AccountStatus, p.AccountTypeId, p.OrganizationId, p.BranchId, Scope = t == null ? null : t.ScopeLevel })
                         .ToListAsync(ct);
        var roles = (await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id select new { ur.UserId, r.Id, r.Code }).ToListAsync(ct))
            .GroupBy(x => x.UserId).ToDictionary(g => g.Key, g => g.OrderBy(x => x.Id).Select(x => x.Code).ToArray());
        var places = (await db.StaffPlacements.AsNoTracking().ToListAsync(ct))
            .GroupBy(x => x.UserId).ToDictionary(g => g.Key, g => g.OrderBy(x => x.OrganizationId).ThenBy(x => x.BranchId.HasValue).ToList());

        var list = new List<PersonRow>();
        foreach (var p in rows)
        {
            var codes = roles.GetValueOrDefault(p.Id) ?? [];
            if (codes.Contains(RoleCode.Admin)) continue;
            if (me.Rank != 3 && Rank(p.Scope) >= me.Rank) continue;
            var pl = places.GetValueOrDefault(p.Id);
            var inScope = pl is { Count: > 0 } ? pl.Any(x => me.Covers(x.OrganizationId, x.BranchId)) : me.Covers(p.OrganizationId, p.BranchId);
            if (!inScope) continue;
            var first = pl?.FirstOrDefault();
            list.Add(new PersonRow(p.Id, p.FullName, p.Email, p.Phone, p.AccountStatus, codes, p.AccountTypeId,
                first?.OrganizationId ?? p.OrganizationId, first is null ? p.BranchId : first.BranchId));
        }
        return list.OrderBy(x => x.FullName).Take(1000).ToList();
    }

    public sealed record PersonRow(Guid Id, string FullName, string Email, string? Phone, string Status, string[] Roles, Guid? AccountTypeId, Guid? OrganizationId, Guid? BranchId);

    private async Task<PersonRow> TargetAsync(Me me, Guid id, CancellationToken ct) =>
        (await PeopleAsync(me, ct)).FirstOrDefault(x => x.Id == id) ?? throw Err("outOfScope", null, 403);

    /// <summary>Account types the caller may hand out: not built in, below the caller's rank.</summary>
    private async Task<AccountType> TypeAsync(Me me, Guid id, CancellationToken ct)
    {
        var t = await db.AccountTypes.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw Err("notFound", "accountTypeId");
        if (t.IsBuiltin || Rank(t.ScopeLevel) >= me.Rank) throw Err("outOfScope", "accountTypeId", 403);
        return t;
    }

    /// <summary>Port of account_type_role(): the staff role an account type implies.</summary>
    private async Task<string> RoleForTypeAsync(AccountType t, CancellationToken ct)
    {
        if (t.IsBuiltin) return RoleCode.Admin;
        var perms = await db.AccountTypePermissions.Where(p => p.AccountTypeId == t.Id).Select(p => p.Permission).ToListAsync(ct);
        return perms.Contains(Permission.AssignOthers) ? RoleCode.TeamLeader : perms.Contains(Permission.Reply) ? RoleCode.Agent : RoleCode.ManagementViewer;
    }

    private async Task SetStaffRoleAsync(Guid user, string role, CancellationToken ct)
    {
        var roleId = await db.CcsRoles.Where(r => r.Code == role).Select(r => r.Id).FirstAsync(ct);
        var customerId = await db.CcsRoles.Where(r => r.Code == RoleCode.Customer).Select(r => r.Id).FirstAsync(ct);
        db.CcsUserRoles.RemoveRange(db.CcsUserRoles.Where(x => x.UserId == user && x.RoleId != customerId));
        db.CcsUserRoles.Add(new UserRole { UserId = user, RoleId = roleId });
    }

    public sealed record AdminTypeBody(Guid AccountTypeId, bool AutoAssign);

    /// <summary>Port of admin_set_account_type(): the main Administrator picks a staff member's account type (Permissions → Staff).
    /// The staff role follows the type (sync_user_role); a person cannot change their own, and the last Administrator cannot be moved off.</summary>
    [HttpPut("api/admin/users/{id:guid}/account-type")]
    public async Task<IActionResult> AdminSetType(Guid id, AdminTypeBody b, CancellationToken ct)
    {
        var c = await AdminAsync(ct);
        if (id == c.UserId) throw Err("cannot_change_self", null, 403);
        var roles = await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id where ur.UserId == id select r.Code).ToListAsync(ct);
        if (roles.Contains(RoleCode.Customer)) throw Err("notStaff");
        var p = await db.Profiles.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var type = await db.AccountTypes.AsNoTracking().FirstOrDefaultAsync(x => x.Id == b.AccountTypeId, ct) ?? throw Err("notFound", "accountTypeId");
        var oldBuiltin = p.AccountTypeId is Guid o && await db.AccountTypes.AnyAsync(x => x.Id == o && x.IsBuiltin, ct);
        if ((oldBuiltin || roles.Contains(RoleCode.Admin)) && !type.IsBuiltin)
        {
            var others = await (from pr in db.Profiles join ur in db.CcsUserRoles on pr.Id equals ur.UserId join r in db.CcsRoles on ur.RoleId equals r.Id
                                where r.Code == RoleCode.Admin && pr.Id != id && pr.AccountStatus == AccountStatus.Active select pr.Id).AnyAsync(ct);
            if (!others) throw Err("lastAdmin", null, 409);
        }
        var old = p.AccountTypeId;
        p.AccountTypeId = type.Id; p.AutoAssign = !type.IsBuiltin && b.AutoAssign; p.UpdatedAt = clock.UtcNow;
        await SetStaffRoleAsync(id, await RoleForTypeAsync(type, ct), ct);
        audit.Write("user.account_type_changed", "profile", id, new { accountTypeId = old }, new { accountTypeId = type.Id, autoAssign = p.AutoAssign });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ---------------------------------------------------------------- scoped admin: People

    [HttpGet("api/console/people")]
    public async Task<object> List(CancellationToken ct)
    {
        var me = await MeAsync(ct);
        var branches = await db.Branches.AsNoTracking().Where(b => b.IsActive).OrderBy(b => b.Name)
            .Select(b => new { b.Id, b.OrganizationId, b.Name }).ToListAsync(ct);
        branches = branches.Where(b => me.Covers(b.OrganizationId, b.Id)).ToList();
        var orgs = (await db.Organizations.AsNoTracking().Where(o => o.IsActive).OrderBy(o => o.Name).Select(o => new { o.Id, o.Name }).ToListAsync(ct))
            .Where(o => me.Covers(o.Id, null) || branches.Any(b => b.OrganizationId == o.Id)).ToList();
        var types = (await db.AccountTypes.AsNoTracking().Where(t => !t.IsBuiltin).OrderBy(t => t.NameEn)
            .Select(t => new { t.Id, t.NameEn, t.NameAr, t.ScopeLevel }).ToListAsync(ct)).Where(t => Rank(t.ScopeLevel) < me.Rank).ToList();
        return new { level = me.C.Admin ? "admin" : me.C.ScopeLevel, orgs, branches, types, people = await PeopleAsync(me, ct) };
    }

    [HttpPost("api/console/people")]
    public async Task<object> Create(CreateBody b, CancellationToken ct)
    {
        var me = await MeAsync(ct);
        if (b.Kind is not ("customer" or "staff")) throw Err("pickRole", "kind");
        if (!me.Covers(b.OrganizationId, b.BranchId) || (me.Rank == 1 && b.BranchId is null)) throw Err("outOfScope", "organizationId", 403);
        if (b.BranchId is not null && !await db.Branches.AnyAsync(x => x.Id == b.BranchId && x.OrganizationId == b.OrganizationId, ct)) throw Err("branchOrg", "branchId");
        AccountType? type = null;
        if (b.Kind == "staff")
        {
            if (b.AccountTypeId is null) throw Err("typeRequired", "accountTypeId");
            type = await TypeAsync(me, b.AccountTypeId.Value, ct);
            if (type.ScopeLevel == "branch" && b.BranchId is null) throw Err("outOfScope", "branchId", 403);
        }
        var name = (b.FullName ?? "").Trim();
        if (name.Length is < 2 or > 120) throw Err("name", "fullName");
        var email = (b.Email ?? "").Trim().ToLowerInvariant();
        if (!email.Contains('@') || email.Length > 254) throw Err("invalidEmail", "email");
        if (await users.FindByEmailAsync(email) is not null) throw Err("emailTaken", "email", 409);
        var phone = await PhoneAsync(b.Phone, null, ct);
        if (string.IsNullOrEmpty(b.Password)) throw Err("passwordWeak", "password");

        var user = new AppUser { Id = Guid.NewGuid(), UserName = email, Email = email, EmailConfirmed = true };
        var r = await users.CreateAsync(user, b.Password);
        if (!r.Succeeded) throw Err(r.Errors.Any(e => e.Code.StartsWith("password", StringComparison.OrdinalIgnoreCase)) ? "passwordWeak" : "generic", "password");

        var now = clock.UtcNow;
        var staff = type is not null;
        db.Profiles.Add(new Profile
        {
            Id = user.Id, FullName = name, Email = email, Phone = phone, CreatedAt = now, UpdatedAt = now, PasswordChangedAt = now,
            AccountStatus = AccountStatus.Active, AccountTypeId = type?.Id,
            OrganizationId = staff ? null : b.OrganizationId, BranchId = staff ? null : b.BranchId,
        });
        var role = staff ? await RoleForTypeAsync(type!, ct) : RoleCode.Customer;
        db.CcsUserRoles.Add(new UserRole { UserId = user.Id, RoleId = await db.CcsRoles.Where(x => x.Code == role).Select(x => x.Id).FirstAsync(ct) });
        if (staff)
        {
            db.StaffPlacements.Add(new StaffPlacement { Id = Guid.NewGuid(), UserId = user.Id, OrganizationId = b.OrganizationId, BranchId = b.BranchId });
            if (type!.ScopeLevel == "branch")
                db.AdminScopes.Add(new AdminScope { Id = Guid.NewGuid(), UserId = user.Id, OrganizationId = b.OrganizationId, BranchId = b.BranchId });
        }
        audit.Write("user.created_scoped", "profile", user.Id, null, new { kind = b.Kind, organizationId = b.OrganizationId, branchId = b.BranchId, accountTypeId = type?.Id });
        try { await db.SaveChangesAsync(ct); }
        catch { await users.DeleteAsync(user); throw; }
        return new { id = user.Id };
    }

    [HttpPut("api/console/people/{id:guid}")]
    public async Task<IActionResult> Update(Guid id, UpdateBody b, CancellationToken ct)
    {
        var me = await MeAsync(ct);
        await TargetAsync(me, id, ct);
        var p = await db.Profiles.FirstAsync(x => x.Id == id, ct);
        var before = new { p.FullName, p.Email, p.Phone };
        var name = (b.FullName ?? "").Trim();
        if (name.Length is < 2 or > 120) throw Err("name", "fullName");
        p.FullName = name;
        p.Phone = await PhoneAsync(b.Phone, id, ct);
        var email = (b.Email ?? "").Trim().ToLowerInvariant();
        if (email != p.Email)
        {
            if (!email.Contains('@') || email.Length > 254) throw Err("invalidEmail", "email");
            if (await users.FindByEmailAsync(email) is not null) throw Err("emailTaken", "email", 409);
            var u = await users.FindByIdAsync(id.ToString()) ?? throw new NotFoundException();
            u.Email = email; u.UserName = email; u.NormalizedEmail = null; u.NormalizedUserName = null;
            if (!(await users.UpdateAsync(u)).Succeeded) throw Err("emailTaken", "email", 409);
            p.Email = email;
        }
        p.UpdatedAt = clock.UtcNow;
        audit.Write("user.updated", "profile", id, before, new { p.FullName, p.Email, p.Phone });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("api/console/people/{id:guid}/status")]
    public async Task<IActionResult> Status(Guid id, StatusBody b, CancellationToken ct)
    {
        var me = await MeAsync(ct);
        if (b.Status is not (AccountStatus.Active or AccountStatus.Suspended)) throw Err("status", "status");
        await TargetAsync(me, id, ct);
        var p = await db.Profiles.FirstAsync(x => x.Id == id, ct);
        var before = p.AccountStatus;
        if (before is not (AccountStatus.Active or AccountStatus.Suspended)) throw Err("status", "status");
        p.AccountStatus = b.Status;
        p.UpdatedAt = clock.UtcNow;
        if (b.Status == AccountStatus.Suspended)
            await db.RefreshTokens.Where(t => t.UserId == id && t.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, clock.UtcNow), ct);
        audit.Write("user.status_changed", "user", id, new { status = before }, new { status = b.Status });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("api/console/people/{id:guid}/type")]
    public async Task<IActionResult> SetType(Guid id, TypeBody b, CancellationToken ct)
    {
        var me = await MeAsync(ct);
        var target = await TargetAsync(me, id, ct);
        if (target.Roles.Contains(RoleCode.Customer)) throw Err("notStaff");
        var type = await TypeAsync(me, b.AccountTypeId, ct);
        var p = await db.Profiles.FirstAsync(x => x.Id == id, ct);
        var old = p.AccountTypeId;
        p.AccountTypeId = type.Id; p.AutoAssign = false; p.UpdatedAt = clock.UtcNow;
        await SetStaffRoleAsync(id, await RoleForTypeAsync(type, ct), ct);
        db.AdminScopes.RemoveRange(db.AdminScopes.Where(s => s.UserId == id));
        if (type.ScopeLevel == "branch")
            foreach (var pl in await db.StaffPlacements.Where(x => x.UserId == id && x.BranchId != null).ToListAsync(ct))
                db.AdminScopes.Add(new AdminScope { Id = Guid.NewGuid(), UserId = id, OrganizationId = pl.OrganizationId, BranchId = pl.BranchId });
        audit.Write("user.account_type_changed", "profile", id, new { accountTypeId = old }, new { accountTypeId = type.Id });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ---------------------------------------------------------------- main Administrator: placement and scope

    private async Task<AccessContext> AdminAsync(CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        return c.Admin ? c : throw new ForbiddenException();
    }

    [HttpGet("api/admin/users/{id:guid}/where")]
    public async Task<object> Where(Guid id, CancellationToken ct)
    {
        await AdminAsync(ct);
        var level = await (from p in db.Profiles join t in db.AccountTypes on p.AccountTypeId equals (Guid?)t.Id where p.Id == id select t.ScopeLevel).FirstOrDefaultAsync(ct);
        return new
        {
            scopeLevel = level,
            placements = await db.StaffPlacements.Where(x => x.UserId == id).Select(x => new { x.OrganizationId, x.BranchId }).ToListAsync(ct),
            scopes = await db.AdminScopes.Where(x => x.UserId == id).Select(x => new { x.OrganizationId, x.BranchId }).ToListAsync(ct),
        };
    }

    /// <summary>Port of admin_set_staff_placements(): one row per ticked organization, or one per ticked branch inside it.</summary>
    [HttpPut("api/admin/users/{id:guid}/placements")]
    public async Task<IActionResult> Placements(Guid id, PickBody b, CancellationToken ct)
    {
        await AdminAsync(ct);
        if (!await db.Profiles.AnyAsync(p => p.Id == id, ct)) throw new NotFoundException();
        Guid[] pickOrgs = b.Orgs ?? [], pickBranches = b.Branches ?? [];
        var orgs = await db.Organizations.Where(o => pickOrgs.Contains(o.Id)).Select(o => o.Id).ToListAsync(ct);
        var branches = await db.Branches.Where(x => pickBranches.Contains(x.Id)).Select(x => new { x.Id, x.OrganizationId }).ToListAsync(ct);
        await db.StaffPlacements.Where(x => x.UserId == id).ExecuteDeleteAsync(ct);
        foreach (var o in orgs)
        {
            var mine = branches.Where(x => x.OrganizationId == o).ToList();
            if (mine.Count == 0) db.StaffPlacements.Add(new StaffPlacement { Id = Guid.NewGuid(), UserId = id, OrganizationId = o });
            else foreach (var x in mine) db.StaffPlacements.Add(new StaffPlacement { Id = Guid.NewGuid(), UserId = id, OrganizationId = o, BranchId = x.Id });
        }
        audit.Write("staff.placement", "profile", id, null, new { organizations = orgs, branches = branches.Select(x => x.Id) });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Port of admin_set_admin_scope(): what a scoped admin manages; their placement mirrors it.</summary>
    [HttpPut("api/admin/users/{id:guid}/scope")]
    public async Task<IActionResult> Scope(Guid id, PickBody b, CancellationToken ct)
    {
        await AdminAsync(ct);
        var level = await (from p in db.Profiles join t in db.AccountTypes on p.AccountTypeId equals (Guid?)t.Id where p.Id == id select t.ScopeLevel).FirstOrDefaultAsync(ct);
        if (level is null) throw Err("notScopedAdmin");
        Guid[] pickOrgs = b.Orgs ?? [], pickBranches = b.Branches ?? [];
        var rows = level == "organization"
            ? await db.Organizations.Where(o => pickOrgs.Contains(o.Id)).Select(o => new { OrganizationId = o.Id, BranchId = (Guid?)null }).ToListAsync(ct)
            : await db.Branches.Where(x => pickBranches.Contains(x.Id)).Select(x => new { x.OrganizationId, BranchId = (Guid?)x.Id }).ToListAsync(ct);
        await db.AdminScopes.Where(x => x.UserId == id).ExecuteDeleteAsync(ct);
        await db.StaffPlacements.Where(x => x.UserId == id).ExecuteDeleteAsync(ct);
        foreach (var r in rows)
        {
            db.AdminScopes.Add(new AdminScope { Id = Guid.NewGuid(), UserId = id, OrganizationId = r.OrganizationId, BranchId = r.BranchId });
            db.StaffPlacements.Add(new StaffPlacement { Id = Guid.NewGuid(), UserId = id, OrganizationId = r.OrganizationId, BranchId = r.BranchId });
        }
        audit.Write("user.scope_changed", "user", id, null, new { organizations = pickOrgs, branches = pickBranches });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task<string?> PhoneAsync(string? phone, Guid? self, CancellationToken ct)
    {
        var p = string.IsNullOrWhiteSpace(phone) ? null : phone.Trim();
        if (p is null) return null;
        if (!System.Text.RegularExpressions.Regex.IsMatch(p, @"^\+?[0-9 ()\-]{6,24}$")) throw Err("phoneInvalid", "phone");
        if (await db.Profiles.AnyAsync(x => x.Phone == p && x.Id != self, ct)) throw Err("phoneTaken", "phone", 409);
        return p;
    }
}
