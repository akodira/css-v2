namespace Ccs.Domain.Rules;

/// <summary>
/// The kind of an account type: what the Staff and Permissions pages call it, and which permissions it may hold.
/// It is not stored; it follows from the type (built in, scope level, permissions), the same way the staff role does.
/// Account type = what a person can do; where they work is set on the person (Works in).
/// </summary>
public static class AccountKinds
{
    public const string Administrator = "administrator";
    public const string OrganizationAdmin = "organization_admin";
    public const string BranchAdmin = "branch_admin";
    public const string TeamLeader = "team_leader";
    public const string Agent = "agent";
    public const string Viewer = "viewer";
    /// <summary>Office staff: works on customers or content (knowledge base, saved replies, settings), never on tickets.</summary>
    public const string Office = "office";

    /// <summary>Kinds an administrator can pick when making or changing a type (Administrator is built in only).</summary>
    public static readonly IReadOnlyList<string> Pickable = [Agent, TeamLeader, Viewer, Office, BranchAdmin, OrganizationAdmin];

    /// <summary>Working on tickets: office staff never hold these.</summary>
    public static readonly IReadOnlySet<string> TicketWork = new HashSet<string>
    {
        Permission.Reply, Permission.Resolve, Permission.Close, Permission.ChangeCategory, Permission.AssignSelf, Permission.AssignOthers,
    };

    /// <summary>What a viewer may hold: looking and reporting, never acting on tickets or people.</summary>
    public static readonly IReadOnlySet<string> ViewerPermissions = new HashSet<string>
    {
        Permission.ViewUnassigned, Permission.ViewOthers, Permission.AllTeams, Permission.ReportsOwn,
        Permission.ReportsAll, Permission.Export, Permission.CustomersView,
    };

    public static string Of(bool builtin, string? scopeLevel, IEnumerable<string> permissions)
    {
        if (builtin) return Administrator;
        if (scopeLevel == "organization") return OrganizationAdmin;
        if (scopeLevel == "branch") return BranchAdmin;
        var set = permissions as IReadOnlyCollection<string> ?? permissions.ToList();
        return set.Contains(Permission.AssignOthers) ? TeamLeader : set.Contains(Permission.Reply) ? Agent
            : set.All(ViewerPermissions.Contains) ? Viewer : Office;
    }

    public static string? ScopeLevelOf(string kind) => kind switch
    {
        OrganizationAdmin => "organization",
        BranchAdmin => "branch",
        _ => null,
    };

    /// <summary>Null when the permissions fit the kind, otherwise the error code to show.</summary>
    public static string? Check(string kind, IReadOnlyCollection<string> permissions) => kind switch
    {
        Viewer => permissions.All(ViewerPermissions.Contains) ? null : "kindViewerOnly",
        Agent => !permissions.Contains(Permission.Reply) ? "kindNeedsReply"
            : permissions.Contains(Permission.AssignOthers) ? "kindAgentNoAssign" : null,
        TeamLeader => !permissions.Contains(Permission.Reply) ? "kindNeedsReply"
            : !permissions.Contains(Permission.AssignOthers) ? "kindLeaderAssigns" : null,
        Office => permissions.Any(TicketWork.Contains) ? "kindOfficeNoTickets"
            : permissions.All(ViewerPermissions.Contains) ? "kindOfficeNeedsOne" : null,
        OrganizationAdmin or BranchAdmin => null,
        _ => "kind",
    };
}
