namespace Ccs.Domain;

/// <summary>Ticket statuses. Stored as these exact strings (same as the PostgreSQL enum).</summary>
public static class TicketStatus
{
    public const string New = "new";
    public const string Open = "open";
    public const string InProgress = "in_progress";
    public const string PendingCustomer = "pending_customer";
    public const string PendingInternal = "pending_internal";
    public const string Resolved = "resolved";
    public const string Closed = "closed";
    public const string Reopened = "reopened";

    public static readonly IReadOnlyList<string> All =
        [New, Open, InProgress, PendingCustomer, PendingInternal, Resolved, Closed, Reopened];

    public static bool IsValid(string? s) => s is not null && All.Contains(s);
    public static bool IsFinished(string s) => s is Resolved or Closed;
    public static bool IsPending(string s) => s is PendingCustomer or PendingInternal;
}

public static class RoleCode
{
    public const string Customer = "customer";
    public const string Agent = "agent";
    public const string TeamLeader = "team_leader";
    public const string Admin = "admin";
    public const string ManagementViewer = "management_viewer";

    public static readonly IReadOnlyList<string> All = [Customer, Agent, TeamLeader, Admin, ManagementViewer];
    public static readonly IReadOnlyList<string> Staff = [Agent, TeamLeader, Admin];
}

public static class AccountStatus
{
    public const string Active = "active";
    public const string Suspended = "suspended";
    public const string PendingVerification = "pending_verification";
    public const string PendingApproval = "pending_approval";
}

public static class MessageKind
{
    public const string PublicReply = "public_reply";
    public const string InternalNote = "internal_note";
    public const string System = "system";
}

/// <summary>The 16 account-type permissions (spec 2) plus the 3 management ones stored by the live database.</summary>
public static class Permission
{
    public const string Reply = "reply";
    public const string Resolve = "resolve";
    public const string Close = "close";
    public const string ChangeCategory = "change_category";
    public const string AssignSelf = "assign_self";
    public const string AssignOthers = "assign_others";
    public const string ViewUnassigned = "view_unassigned";
    public const string ViewOthers = "view_others";
    public const string AllTeams = "all_teams";
    public const string ReportsOwn = "reports_own";
    public const string ReportsAll = "reports_all";
    public const string Export = "export";
    public const string ManageCanned = "manage_canned";
    public const string CustomersView = "customers_view";
    public const string CustomersManage = "customers_manage";
    public const string ApproveCustomers = "approve_customers";
    public const string ManageKb = "manage_kb";
    public const string ManageCatalog = "manage_catalog";
    public const string ManageSettings = "manage_settings";
    // Granted by flags, never stored on an account type:
    public const string CreateForCustomer = "create_for_customer";
    public const string ManageUsers = "manage_users";

    /// <summary>Everything a type may hold (the CHECK constraint list).</summary>
    public static readonly IReadOnlyList<string> Assignable =
    [
        Reply, Resolve, Close, ChangeCategory, AssignSelf, AssignOthers, ViewUnassigned, ViewOthers, AllTeams,
        ReportsOwn, ReportsAll, Export, CustomersView, CustomersManage, ManageKb, ManageCatalog, ManageSettings,
        ManageCanned, ApproveCustomers,
    ];

    /// <summary>my_permissions() for a staff member with no account type (legacy "full staff").</summary>
    public static readonly IReadOnlyList<string> NoTypeDefault =
    [
        Reply, Resolve, Close, ChangeCategory, AssignSelf, AssignOthers, ViewUnassigned, ViewOthers, AllTeams,
        ReportsOwn, ReportsAll, Export, CustomersView, CustomersManage, ManageKb, ManageCatalog, ManageSettings,
        ManageCanned,
    ];

    /// <summary>my_permissions() for an administrator.</summary>
    public static readonly IReadOnlyList<string> AdminAll = [.. NoTypeDefault, CreateForCustomer, ManageUsers, ApproveCustomers];
}

public static class ClosureReasonCode
{
    public const string ResolvedConfirmed = "resolved_confirmed";
    public const string AutoClosed = "auto_closed";
    public const string NoResponse = "no_response";
    public const string Duplicate = "duplicate";
    public const string Spam = "spam";
    public const string Cancelled = "cancelled";

    /// <summary>Reasons the system sets itself; staff cannot pick them when closing by hand.</summary>
    public static readonly IReadOnlyList<string> SystemOnly = [ResolvedConfirmed, AutoClosed, Cancelled];
}

public static class SlaState
{
    public const string OnTrack = "on_track";
    public const string DueSoon = "due_soon";
    public const string Breached = "breached";
    public const string Paused = "paused";
    public const string Completed = "completed";
}

public static class NotificationEvent
{
    public const string TicketCreated = "ticket_created";
    public const string TicketAssigned = "ticket_assigned";
    public const string AgentReply = "agent_reply";
    public const string CustomerReply = "customer_reply";
    public const string StatusChanged = "status_changed";
    public const string PriorityChanged = "priority_changed";
    public const string SlaWarning = "sla_warning";
    public const string SlaBreach = "sla_breach";
    public const string TicketResolved = "ticket_resolved";
    public const string TicketClosed = "ticket_closed";
    public const string TicketReopened = "ticket_reopened";
    public const string TicketEscalated = "ticket_escalated";
    public const string AccountPending = "account_pending";
    public const string AccountApproved = "account_approved";
    public const string AccountRejected = "account_rejected";
    public const string ApprovalRequested = "approval_requested";
    public const string AccountPromoted = "account_promoted";
    public const string CustomerReminder = "customer_reminder";
    public const string CustomerFinalWarning = "customer_final_warning";
    public const string ResolvedReminder = "resolved_reminder";
    public const string CancellationRequested = "cancellation_requested";
    public const string CancellationRejected = "cancellation_rejected";
    public const string PasswordExpiring = "password_expiring";
}
