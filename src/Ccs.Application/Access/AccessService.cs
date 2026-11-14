using Ccs.Application.Abstractions;
using Ccs.Application.Common;
using Ccs.Application.Settings;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Application.Access;

/// <summary>
/// The one place that decides what a person may see (spec 5, "Authorization").
/// Replaces row-level security: every ticket query in the API goes through <see cref="VisibleTickets"/>,
/// every single-ticket action through <see cref="RequireTicketAsync"/>.
/// Port of ticket_ctx, can_access_ticket, can_see_internal_notes, has_perm, my_permissions, my_scope_level.
/// </summary>
public sealed class AccessService(ICcsDbContext db, ICurrentUser current, IMfaStatus mfa, SettingsService settings)
{
    private AccessContext? _ctx;

    /// <summary>The caller's context, built once per request.</summary>
    public async Task<AccessContext> GetContextAsync(CancellationToken ct = default)
    {
        if (_ctx is not null) return _ctx;
        if (current.UserId is not Guid uid) return _ctx = AccessContext.Anonymous;
        return _ctx = await BuildContextAsync(uid, current.MfaLevel, ct);
    }

    /// <summary>Builds the context for any user. Background jobs use it with mfaLevel 2.</summary>
    public async Task<AccessContext> BuildContextAsync(Guid uid, int mfaLevel, CancellationToken ct = default)
    {
        var me = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(p => p.Id == uid, ct);
        if (me is null) return AccessContext.Anonymous with { UserId = uid };

        // mfa_ok(): if a factor is enrolled, the session must be aal2.
        var mfaOk = mfaLevel >= 2 || !await mfa.HasVerifiedFactorAsync(uid, ct);
        var active = mfaOk && me.AccountStatus == AccountStatus.Active;

        var roles = await (from ur in db.UserRoles join r in db.Roles on ur.RoleId equals r.Id
                           where ur.UserId == uid select r.Code).ToListAsync(ct);
        bool admin = roles.Contains(RoleCode.Admin);
        bool staff = admin || roles.Contains(RoleCode.Agent) || roles.Contains(RoleCode.TeamLeader);
        bool viewer = roles.Contains(RoleCode.ManagementViewer);
        bool customer = roles.Contains(RoleCode.Customer);

        AccountType? type = me.AccountTypeId is Guid tid
            ? await db.AccountTypes.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tid, ct) : null;
        List<string> typePerms = type is null ? [] :
            await db.AccountTypePermissions.Where(p => p.AccountTypeId == type.Id).Select(p => p.Permission).ToListAsync(ct);

        // admin and is_active_user() both require an active account; a suspended admin has nothing.
        admin &= active;
        var perms = AccessRules.EffectivePermissions(active, admin, staff || viewer, type is not null, typePerms, me.CanCreateForCustomers);

        var teams = await db.TeamMembers.Where(m => m.UserId == uid).Select(m => new { m.TeamId, m.IsLeader }).ToListAsync(ct);
        var placements = await db.StaffPlacements.Where(p => p.UserId == uid).ToListAsync(ct);
        var scopes = await db.AdminScopes.Where(s => s.UserId == uid).ToListAsync(ct);
        bool placed = placements.Count > 0, scoped = scopes.Count > 0;

        var scope = new List<ScopeEntry>();
        if (!placed && !scoped && type is not null)
        {
            scope.AddRange(await db.AccountTypeAccess.Where(a => a.AccountTypeId == type.Id)
                .Select(a => new ScopeEntry(a.OrganizationId, a.BranchId)).ToListAsync(ct));
        }
        if (placed || scoped)
        {
            var tree = await OrgTreeAsync(ct);
            foreach (var p in placements)
                foreach (var org in WithChildren(tree, p.OrganizationId))
                    scope.Add(new ScopeEntry(org, org == p.OrganizationId ? p.BranchId : null));
            foreach (var s in scopes.Where(s => s.BranchId is null))
                foreach (var org in WithChildren(tree, s.OrganizationId))
                    scope.Add(new ScopeEntry(org, null));
            scope.AddRange(scopes.Where(s => s.BranchId is not null).Select(s => new ScopeEntry(s.OrganizationId, s.BranchId)));
        }

        bool orgShared = false;
        if (customer && me.OrganizationId is Guid myOrg && await settings.GetBoolAsync("org_shared_access_enabled", false, ct))
            orgShared = await db.Organizations.AnyAsync(o => o.Id == myOrg && o.SharedAccessEnabled, ct);

        return new AccessContext
        {
            UserId = uid,
            Active = active,
            Admin = admin,
            Staff = staff && active,
            Viewer = viewer && active,
            TeamLeader = roles.Contains(RoleCode.TeamLeader) && active,
            Customer = customer,
            // All-scope is a staff notion: a customer (no account type) must never count as "sees every organisation".
            AllScope = admin || ((staff || viewer) && active && !placed && !scoped && (type is null || type.AllAccess)),
            Permissions = perms,
            Teams = teams.Select(t => t.TeamId).ToHashSet(),
            LeaderOfTeams = teams.Where(t => t.IsLeader).Select(t => t.TeamId).ToHashSet(),
            Scope = scope.Distinct().ToList(),
            ScopeLevel = active ? type?.ScopeLevel : null,
            OrganizationId = me.OrganizationId,
            BranchId = me.BranchId,
            OrgSharedAccess = orgShared,
        };
    }

    /// <summary>
    /// The ticket filter every list query uses. SQL-translatable twin of AccessRules.CanAccessTicket;
    /// AccessParityTests checks that both give the same answer.
    /// </summary>
    public IQueryable<Ticket> VisibleTickets(IQueryable<Ticket> source, AccessContext c)
    {
        if (!c.Active) return source.Where(_ => false);
        if (c.Admin) return source;

        var uid = c.UserId;
        bool isInternal = c.Internal, allScope = c.AllScope, viewer = c.Viewer;
        bool allTeams = c.Has(Permission.AllTeams), viewUnassigned = c.Has(Permission.ViewUnassigned), viewOthers = c.Has(Permission.ViewOthers);
        bool shared = c.Customer && c.OrgSharedAccess && c.OrganizationId is not null;
        var myOrg = c.OrganizationId ?? Guid.Empty;
        var teams = c.Teams.ToList();
        var wholeOrgs = c.Scope.Where(s => s.BranchId is null).Select(s => s.OrganizationId).Distinct().ToList();
        var branches = c.Scope.Where(s => s.BranchId is not null).Select(s => s.BranchId!.Value).Distinct().ToList();
        var profiles = db.Profiles;

        return source.Where(t =>
            t.RequesterId == uid
            || (shared && profiles.Any(p => p.Id == t.RequesterId && p.OrganizationId == myOrg))
            || (isInternal && (
                t.AssignedAgentId == uid
                || ((allScope || profiles.Any(p => p.Id == t.RequesterId &&
                        ((p.OrganizationId != null && wholeOrgs.Contains(p.OrganizationId.Value))
                         || (p.BranchId != null && branches.Contains(p.BranchId.Value)))))
                    && (viewer || allTeams || (t.TeamId != null && teams.Contains(t.TeamId.Value)))
                    && ((t.AssignedAgentId == null && viewUnassigned) || (t.AssignedAgentId != null && viewOthers))))));
    }

    /// <summary>
    /// customer_in_scope(p, strict): the customers a person may list on the Customers screen (v1 console_customers).
    /// Admins and viewers: everyone. Staff: customers of organizations/branches they lead, plus
    /// (all-scope staff, not team leaders) customers whose tickets are assigned to them, or (placed staff) customers in their scope.
    /// </summary>
    public IQueryable<Profile> CustomersInScope(IQueryable<Profile> source, AccessContext c)
    {
        if (!c.Active) return source.Where(_ => false);
        if (c.Admin || c.Viewer) return source;
        if (!c.Staff) return source.Where(_ => false);
        var uid = c.UserId;
        bool allScope = c.AllScope, teamLeader = c.TeamLeader;
        var wholeOrgs = c.Scope.Where(s => s.BranchId is null).Select(s => s.OrganizationId).Distinct().ToList();
        var branchIds = c.Scope.Where(s => s.BranchId is not null).Select(s => s.BranchId!.Value).Distinct().ToList();
        var orgs = db.Organizations; var branches = db.Branches; var tickets = db.Tickets;
        return source.Where(p =>
            orgs.Any(o => o.Id == p.OrganizationId && o.TeamLeaderId == uid)
            || branches.Any(b => b.Id == p.BranchId && b.TeamLeaderId == uid)
            || (allScope
                ? !teamLeader && tickets.Any(t => t.RequesterId == p.Id && t.AssignedAgentId == uid)
                : (p.OrganizationId != null && wholeOrgs.Contains(p.OrganizationId.Value)) || (p.BranchId != null && branchIds.Contains(p.BranchId.Value))));
    }

    /// <summary>customer_in_scope(p, loose): leads their organization/branch, or can open one of their tickets.</summary>
    private IQueryable<Profile> CustomersLoose(AccessContext c)
    {
        var uid = c.UserId;
        var visible = VisibleTickets(db.Tickets, c);
        var orgs = db.Organizations; var branches = db.Branches;
        return db.Profiles.Where(p =>
            orgs.Any(o => o.Id == p.OrganizationId && o.TeamLeaderId == uid)
            || branches.Any(b => b.Id == p.BranchId && b.TeamLeaderId == uid)
            || visible.Any(t => t.RequesterId == p.Id));
    }

    /// <summary>org_visible(): organizations a person may see (dashboard counts, reports).</summary>
    public IQueryable<Organization> VisibleOrganizations(IQueryable<Organization> source, AccessContext c)
    {
        if (!c.Active) return source.Where(_ => false);
        if (c.Admin || c.Viewer) return source;
        var uid = c.UserId; var myOrg = c.OrganizationId ?? Guid.Empty;
        var scopedOrgs = c.ScopeLevel is null ? [] : c.Scope.Where(s => s.BranchId is null).Select(s => s.OrganizationId).Distinct().ToList();
        bool staff = c.Staff;
        var branches = db.Branches; var loose = staff ? CustomersLoose(c) : db.Profiles.Where(_ => false);
        return source.Where(o => o.Id == myOrg || scopedOrgs.Contains(o.Id)
            || (staff && (o.TeamLeaderId == uid || branches.Any(b => b.OrganizationId == o.Id && b.TeamLeaderId == uid)
                          || loose.Any(p => p.OrganizationId == o.Id))));
    }

    /// <summary>branch_visible(): branches a person may see.</summary>
    public IQueryable<Branch> VisibleBranches(IQueryable<Branch> source, AccessContext c)
    {
        if (!c.Active) return source.Where(_ => false);
        if (c.Admin || c.Viewer) return source;
        var uid = c.UserId; var myBranch = c.BranchId ?? Guid.Empty;
        var scopedOrgs = c.ScopeLevel is null ? [] : c.Scope.Where(s => s.BranchId is null).Select(s => s.OrganizationId).Distinct().ToList();
        var scopedBranches = c.ScopeLevel is null ? [] : c.Scope.Where(s => s.BranchId is not null).Select(s => s.BranchId!.Value).Distinct().ToList();
        bool staff = c.Staff;
        var orgs = db.Organizations; var loose = staff ? CustomersLoose(c) : db.Profiles.Where(_ => false);
        return source.Where(b => b.Id == myBranch || scopedOrgs.Contains(b.OrganizationId) || scopedBranches.Contains(b.Id)
            || (staff && (b.TeamLeaderId == uid || orgs.Any(o => o.Id == b.OrganizationId && o.TeamLeaderId == uid)
                          || loose.Any(p => p.BranchId == b.Id))));
    }

    public async Task<TicketFacts?> GetFactsAsync(Guid ticketId, CancellationToken ct = default) =>
        await (from t in db.Tickets
               join r in db.Profiles on t.RequesterId equals r.Id
               where t.Id == ticketId
               select new TicketFacts(t.RequesterId, t.AssignedAgentId, t.TeamId, r.OrganizationId, r.BranchId, t.CreatedBy, t.CreatedAt))
              .AsNoTracking().FirstOrDefaultAsync(ct);

    /// <summary>Loads the ticket facts and throws 404 when the caller may not see it (same message as today).</summary>
    public async Task<(AccessContext Ctx, TicketFacts Facts)> RequireTicketAsync(Guid ticketId, CancellationToken ct = default)
    {
        var c = await GetContextAsync(ct);
        if (c.UserId == Guid.Empty) throw new NotAuthenticatedException();
        var facts = await GetFactsAsync(ticketId, ct);
        if (facts is null || !AccessRules.CanAccessTicket(c, facts)) throw new NotFoundException("ticket not found");
        return (c, facts);
    }

    public async Task<AccessContext> RequireSignedInAsync(CancellationToken ct = default)
    {
        var c = await GetContextAsync(ct);
        if (c.UserId == Guid.Empty) throw new NotAuthenticatedException();
        if (!c.Active) throw new ForbiddenException("account is not active");
        return c;
    }

    public async Task<AccessContext> RequirePermissionAsync(string permission, CancellationToken ct = default)
    {
        var c = await RequireSignedInAsync(ct);
        if (!c.Has(permission)) throw new ForbiddenException();
        return c;
    }

    public async Task<AccessContext> RequireAdminAsync(CancellationToken ct = default)
    {
        var c = await RequireSignedInAsync(ct);
        if (!c.Admin) throw new ForbiddenException();
        return c;
    }

    /// <summary>user_in_scope(): may this staff member handle tickets of that requester (used by auto-assign).</summary>
    public async Task<bool> UserInScopeAsync(Guid userId, Guid requesterId, CancellationToken ct = default)
    {
        var isAdmin = await (from ur in db.UserRoles join r in db.Roles on ur.RoleId equals r.Id
                             where ur.UserId == userId && r.Code == RoleCode.Admin select 1).AnyAsync(ct);
        if (isAdmin) return true;
        var me = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(p => p.Id == userId, ct);
        if (me is null) return false;
        if (me.AccountTypeId is null) return true;
        var type = await db.AccountTypes.AsNoTracking().FirstOrDefaultAsync(t => t.Id == me.AccountTypeId, ct);
        if (type?.AllAccess == true) return true;
        var req = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(p => p.Id == requesterId, ct);
        if (req is null) return false;
        return await db.AccountTypeAccess.AnyAsync(a => a.AccountTypeId == me.AccountTypeId
            && a.OrganizationId == req.OrganizationId && (a.BranchId == null || a.BranchId == req.BranchId), ct);
    }

    private async Task<Dictionary<Guid, Guid?>> OrgTreeAsync(CancellationToken ct) =>
        await db.Organizations.AsNoTracking().ToDictionaryAsync(o => o.Id, o => o.ParentId, ct);

    /// <summary>org_and_children(): the organization and every descendant (cycle-safe).</summary>
    public static IEnumerable<Guid> WithChildren(IReadOnlyDictionary<Guid, Guid?> parentOf, Guid root)
    {
        var seen = new HashSet<Guid> { root };
        var queue = new Queue<Guid>([root]);
        while (queue.Count > 0)
        {
            var cur = queue.Dequeue();
            yield return cur;
            foreach (var (child, parent) in parentOf)
                if (parent == cur && seen.Add(child)) queue.Enqueue(child);
        }
    }
}
