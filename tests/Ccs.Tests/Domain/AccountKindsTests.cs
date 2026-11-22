using Ccs.Domain;
using Ccs.Domain.Rules;

namespace Ccs.Tests.Domain;

/// <summary>The kind of an account type (what the Staff and Permissions pages show) and the permissions each kind may hold.</summary>
public class AccountKindsTests
{
    [Theory]
    [InlineData(true, null, new[] { "reply" }, AccountKinds.Administrator)]
    [InlineData(false, "organization", new[] { "reply" }, AccountKinds.OrganizationAdmin)]
    [InlineData(false, "branch", new string[0], AccountKinds.BranchAdmin)]
    [InlineData(false, null, new[] { "reply", "assign_others" }, AccountKinds.TeamLeader)]
    [InlineData(false, null, new[] { "reply", "resolve" }, AccountKinds.Agent)]
    [InlineData(false, null, new[] { "reports_all", "customers_view" }, AccountKinds.Viewer)]
    public void Kind_follows_the_type(bool builtin, string? scope, string[] perms, string kind) =>
        Assert.Equal(kind, AccountKinds.Of(builtin, scope, perms));

    [Fact]
    public void Viewer_holds_only_view_and_report_permissions()
    {
        Assert.Null(AccountKinds.Check(AccountKinds.Viewer, [Permission.ReportsAll, Permission.Export, Permission.CustomersView]));
        Assert.Equal("kindViewerOnly", AccountKinds.Check(AccountKinds.Viewer, [Permission.ReportsAll, Permission.Reply]));
    }

    [Fact]
    public void Agent_replies_and_does_not_assign_others()
    {
        Assert.Null(AccountKinds.Check(AccountKinds.Agent, [Permission.Reply, Permission.AssignSelf]));
        Assert.Equal("kindNeedsReply", AccountKinds.Check(AccountKinds.Agent, [Permission.AssignSelf]));
        Assert.Equal("kindAgentNoAssign", AccountKinds.Check(AccountKinds.Agent, [Permission.Reply, Permission.AssignOthers]));
    }

    [Fact]
    public void Team_leader_replies_and_assigns_others()
    {
        Assert.Null(AccountKinds.Check(AccountKinds.TeamLeader, [Permission.Reply, Permission.AssignOthers]));
        Assert.Equal("kindLeaderAssigns", AccountKinds.Check(AccountKinds.TeamLeader, [Permission.Reply]));
    }

    [Fact]
    public void Scoped_admins_and_unknown_kinds()
    {
        Assert.Null(AccountKinds.Check(AccountKinds.BranchAdmin, [Permission.ApproveCustomers]));
        Assert.Equal("branch", AccountKinds.ScopeLevelOf(AccountKinds.BranchAdmin));
        Assert.Equal("organization", AccountKinds.ScopeLevelOf(AccountKinds.OrganizationAdmin));
        Assert.Null(AccountKinds.ScopeLevelOf(AccountKinds.Agent));
        Assert.Equal("kind", AccountKinds.Check("boss", [Permission.Reply]));
        Assert.Equal("kind", AccountKinds.Check(AccountKinds.Administrator, [Permission.Reply]));
    }

    /// <summary>Whatever a type holds, its kind always passes its own check (so saving never moves a type to another kind).</summary>
    [Theory]
    [InlineData("reply")]
    [InlineData("reply,assign_others,manage_kb")]
    [InlineData("view_others,all_teams")]
    public void Kind_of_a_type_passes_its_check(string csv)
    {
        var perms = csv.Split(',');
        Assert.Null(AccountKinds.Check(AccountKinds.Of(false, null, perms), perms));
    }
}
