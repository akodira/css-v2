namespace Ccs.Domain.Rules;

/// <summary>
/// The default account types every system has. They are made at start-up when missing, cannot be deleted or renamed,
/// and keep their kind. Their permissions can be changed and set back to <see cref="Def.Permissions"/> ("Reset to default").
/// </summary>
public static class DefaultAccountTypes
{
    public const string Administrator = "administrator";
    public const string OrganizationAdmin = "organization_admin";
    public const string BranchAdmin = "branch_admin";
    public const string TeamLeader = "team_leader";
    public const string Agent = "agent";
    public const string Viewer = "viewer";
    public const string KbEditor = "kb_editor";
    public const string RegistrationOfficer = "registration_officer";

    public sealed record Def(string Key, string Kind, string NameEn, string NameAr, IReadOnlyList<string> Permissions);

    /// <summary>In the order the Permissions page shows them.</summary>
    public static readonly IReadOnlyList<Def> All =
    [
        new(Administrator, AccountKinds.Administrator, "Administrator", "مسؤول النظام", Permission.Assignable),
        new(OrganizationAdmin, AccountKinds.OrganizationAdmin, "Organization admin", "مشرف مؤسسة",
        [
            Permission.Reply, Permission.Resolve, Permission.Close, Permission.ChangeCategory, Permission.AssignSelf, Permission.AssignOthers,
            Permission.ViewUnassigned, Permission.ViewOthers, Permission.AllTeams, Permission.ReportsOwn, Permission.ReportsAll, Permission.Export,
            Permission.CustomersView, Permission.CustomersManage, Permission.ApproveCustomers, Permission.ManageCanned, Permission.ResetStaffPasswords,
        ]),
        new(BranchAdmin, AccountKinds.BranchAdmin, "Branch admin", "مشرف فرع",
        [
            Permission.Reply, Permission.Resolve, Permission.Close, Permission.ChangeCategory, Permission.AssignSelf, Permission.AssignOthers,
            Permission.ViewUnassigned, Permission.ViewOthers, Permission.ReportsOwn, Permission.ReportsAll, Permission.Export,
            Permission.CustomersView, Permission.CustomersManage, Permission.ApproveCustomers, Permission.ResetStaffPasswords,
        ]),
        new(TeamLeader, AccountKinds.TeamLeader, "Team leader", "قائد فريق",
        [
            Permission.Reply, Permission.Resolve, Permission.Close, Permission.ChangeCategory, Permission.AssignSelf, Permission.AssignOthers,
            Permission.ViewUnassigned, Permission.ViewOthers, Permission.ReportsOwn, Permission.ReportsAll, Permission.CustomersView,
            Permission.ManageCanned,
        ]),
        new(Agent, AccountKinds.Agent, "Agent", "وكيل",
        [
            Permission.Reply, Permission.Resolve, Permission.Close, Permission.AssignSelf, Permission.ViewUnassigned, Permission.ReportsOwn,
            Permission.CustomersView,
        ]),
        new(Viewer, AccountKinds.Viewer, "Management viewer", "مُطّلع إداري",
        [
            Permission.ViewUnassigned, Permission.ViewOthers, Permission.AllTeams, Permission.ReportsOwn, Permission.ReportsAll, Permission.Export,
            Permission.CustomersView,
        ]),
        new(KbEditor, AccountKinds.Office, "Knowledge base editor", "محرر قاعدة المعرفة",
            [Permission.ManageKb, Permission.ManageCanned, Permission.CustomersView]),
        new(RegistrationOfficer, AccountKinds.Office, "Customer registration officer", "مسؤول تسجيل العملاء",
            [Permission.CustomersView, Permission.CustomersManage, Permission.ApproveCustomers]),
    ];

    public static Def? Get(string? key) => key is null ? null : All.FirstOrDefault(d => d.Key == key);

    public static int Order(string? key)
    {
        for (var i = 0; i < All.Count; i++) if (All[i].Key == key) return i;
        return All.Count;
    }
}
