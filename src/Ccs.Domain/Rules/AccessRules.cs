namespace Ccs.Domain.Rules;

/// <summary>One scope entry: a whole organization (BranchId null) or one branch of it.</summary>
public sealed record ScopeEntry(Guid OrganizationId, Guid? BranchId);

/// <summary>
/// Who the caller is, built once per request. Port of ticket_ctx(): same fields, same meaning.
/// </summary>
public sealed record AccessContext
{
    public required Guid UserId { get; init; }
    public bool Active { get; init; }                 // account active (and MFA satisfied)
    public bool Admin { get; init; }
    public bool Staff { get; init; }                  // agent, team_leader or admin
    public bool Viewer { get; init; }                 // management_viewer
    public bool TeamLeader { get; init; }             // has the team_leader role
    public bool Customer { get; init; }
    public bool AllScope { get; init; }               // admin, or all_access type with no placement/admin scope
    public IReadOnlySet<string> Permissions { get; init; } = new HashSet<string>();
    public IReadOnlySet<Guid> Teams { get; init; } = new HashSet<Guid>();
    public IReadOnlySet<Guid> LeaderOfTeams { get; init; } = new HashSet<Guid>();
    public IReadOnlyList<ScopeEntry> Scope { get; init; } = [];
    public string? ScopeLevel { get; init; }          // branch | organization for scoped admins
    public Guid? OrganizationId { get; init; }        // the caller's own placement (customers)
    public Guid? BranchId { get; init; }
    public bool OrgSharedAccess { get; init; }        // global switch AND the caller's organization switch

    public bool Internal => Staff || Viewer;
    /// <summary>Permissions belong to staff and viewers only. A customer never holds one, whatever the set says
    /// (defence in depth: the permission set itself is already empty for customers).</summary>
    public bool Has(string permission) => (Admin || Internal) && Permissions.Contains(permission);

    public static AccessContext Anonymous { get; } = new() { UserId = Guid.Empty };
}

/// <summary>The facts about one ticket that the rules need.</summary>
public sealed record TicketFacts(
    Guid RequesterId,
    Guid? AssignedAgentId,
    Guid? TeamId,
    Guid? RequesterOrganizationId,
    Guid? RequesterBranchId,
    Guid? CreatedBy = null,
    DateTimeOffset? CreatedAt = null);

/// <summary>
/// The single place that decides ticket access (spec 5, "Authorization").
/// Each method is a direct port of a PostgreSQL function; each has unit tests in Ccs.Tests.
/// The SQL-translatable version used for lists is AccessService.VisibleTickets and must stay in step.
/// </summary>
public static class AccessRules
{
    /// <summary>can_access_ticket(), plus organization shared access (spec 2).</summary>
    public static bool CanAccessTicket(AccessContext c, TicketFacts t)
    {
        if (!c.Active) return false;
        if (t.RequesterId == c.UserId || c.Admin) return true;

        // Organization shared access: colleagues of the same organization see each other's tickets.
        if (c.Customer && c.OrgSharedAccess && c.OrganizationId is not null && t.RequesterOrganizationId == c.OrganizationId)
            return true;

        if (!c.Internal) return false;
        if (t.AssignedAgentId == c.UserId) return true;
        if (!InScope(c, t.RequesterOrganizationId, t.RequesterBranchId)) return false;
        if (!(c.Viewer || c.Has(Permission.AllTeams) || (t.TeamId is Guid team && c.Teams.Contains(team)))) return false;
        return t.AssignedAgentId is null ? c.Has(Permission.ViewUnassigned) : c.Has(Permission.ViewOthers);
    }

    public static bool InScope(AccessContext c, Guid? org, Guid? branch) =>
        c.AllScope || c.Scope.Any(s => s.OrganizationId == org && (s.BranchId is null || s.BranchId == branch));

    /// <summary>can_see_internal_notes(): admin, or staff in the ticket's team or assigned to it. Never customers.</summary>
    public static bool CanSeeInternalNotes(AccessContext c, TicketFacts t) =>
        c.Active && (c.Admin || (c.Staff && ((t.TeamId is Guid team && c.Teams.Contains(team)) || t.AssignedAgentId == c.UserId)));

    /// <summary>can_write_ticket(): requester or staff who can see it; or the staff creator within one hour.</summary>
    public static bool CanWriteTicket(AccessContext c, TicketFacts t, DateTimeOffset now) =>
        (CanAccessTicket(c, t) && (t.RequesterId == c.UserId || c.Staff))
        || (t.CreatedBy == c.UserId && t.CreatedAt > now.AddHours(-1) && c.Has(Permission.CreateForCustomer));

    /// <summary>
    /// assign_ticket() rule (spec 2): a team leader or admin can assign anyone;
    /// an agent can only claim an unassigned ticket in their own team.
    /// </summary>
    public static bool CanAssign(AccessContext c, TicketFacts t, Guid targetTeamId, Guid? targetAgentId)
    {
        if (!c.Active || !c.Staff) return false;
        if (c.Admin) return true;
        if (c.Has(Permission.AssignOthers) && ((t.TeamId is Guid team && c.Teams.Contains(team)) || c.Has(Permission.AllTeams)))
            return true;
        return c.Has(Permission.AssignSelf)
            && targetAgentId == c.UserId
            && t.AssignedAgentId is null
            && t.TeamId == targetTeamId
            && c.Teams.Contains(targetTeamId);
    }

    /// <summary>my_permissions(): what a person may do, from role, account type and flags.
    /// Customers (not internal) get nothing: <see cref="Permission.NoTypeDefault"/> is for staff without an account type only.</summary>
    public static IReadOnlySet<string> EffectivePermissions(
        bool active, bool admin, bool internalUser, bool hasAccountType,
        IEnumerable<string> typePermissions, bool canCreateForCustomers)
    {
        if (!active) return new HashSet<string>();
        if (admin) return new HashSet<string>(Permission.AdminAll);
        if (!internalUser) return new HashSet<string>();
        var set = hasAccountType ? new HashSet<string>(typePermissions) : new HashSet<string>(Permission.NoTypeDefault);
        if (internalUser && canCreateForCustomers) set.Add(Permission.CreateForCustomer);
        return set;
    }
}
