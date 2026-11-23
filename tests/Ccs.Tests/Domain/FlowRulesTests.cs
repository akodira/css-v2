using Ccs.Domain;
using Ccs.Domain.Rules;

namespace Ccs.Tests.Domain;

/// <summary>Several ticket flows: which statuses a flow must have, what it may use, and the checks before it is saved.</summary>
public class FlowRulesTests
{
    static Transition S(string f, string t, bool r = false) => new(f, t, "staff", r);
    static Transition C(string f, string t, bool r = false) => new(f, t, "customer", r);

    /// <summary>The flow from the admin's picture: 10 button moves plus the automatic ones.</summary>
    static readonly string[] All = [.. TicketStatus.All];
    static readonly Transition[] Picture =
    [
        S("in_progress", "pending_customer"), S("in_progress", "pending_internal"), S("pending_internal", "in_progress"), S("in_progress", "resolved"),
        S("reopened", "in_progress"), S("new", "closed", true), S("pending_customer", "closed", true),
        C("resolved", "closed"), C("resolved", "reopened", true), C("closed", "reopened", true),
    ];

    [Fact]
    public void Picture_flow_has_no_problems() => Assert.Empty(FlowRules.Problems(All, Picture));

    [Fact]
    public void Required_statuses_must_stay()
    {
        var p = FlowRules.Problems(["new", "in_progress", "resolved"], [S("in_progress", "resolved")]);
        Assert.Contains("missing:closed", p);
    }

    [Fact]
    public void A_status_nothing_leads_to_is_a_problem()
    {
        var p = FlowRules.Problems(All, Picture.Where(m => m.To != "pending_internal").ToArray());
        Assert.Contains("unreachable:pending_internal", p);
    }

    [Fact]
    public void Staff_must_be_able_to_resolve_from_a_working_status()
    {
        var p = FlowRules.Problems(All, Picture.Where(m => !(m.From == "in_progress" && m.To == "resolved")).ToArray());
        Assert.Contains("no_resolve:in_progress", p);
    }

    [Fact]
    public void A_waiting_status_with_no_way_out_is_a_problem()
    {
        var p = FlowRules.Problems(All, Picture.Where(m => m.From != "pending_internal").ToArray());
        Assert.Contains("stuck:pending_internal", p);
    }

    [Fact]
    public void Moves_must_stay_inside_the_flow()
    {
        var p = FlowRules.Problems(["new", "in_progress", "resolved", "closed"], [S("in_progress", "resolved"), S("in_progress", "pending_internal"), C("resolved", "closed")]);
        Assert.Contains("outside:in_progress>pending_internal", p);
    }

    [Fact]
    public void Short_flow_without_open_or_waiting_is_fine()
    {
        // New → In progress happens by itself at the first reply; Open is skipped when the flow does not have it.
        var p = FlowRules.Problems(["new", "in_progress", "resolved", "closed"], [S("in_progress", "resolved"), S("new", "closed", true), C("resolved", "closed")]);
        Assert.Empty(p);
    }

    [Fact]
    public void Automatic_moves_only_to_statuses_the_flow_has()
    {
        Assert.Equal("open", FlowRules.AfterAssign(All));
        Assert.Null(FlowRules.AfterAssign(["new", "in_progress", "resolved", "closed"]));
        Assert.Equal("reopened", FlowRules.AfterResolvedReply(All));
        Assert.Equal("in_progress", FlowRules.AfterResolvedReply(["new", "in_progress", "resolved", "closed"]));
    }

    [Theory]
    [InlineData("new,in_progress,resolved,closed", true)]
    [InlineData("new,open,in_progress,resolved,closed,reopened", true)]
    [InlineData("new,in_progress,resolved,closed,boss", false)]
    [InlineData("", false)]
    public void Status_list_must_be_known(string csv, bool ok) => Assert.Equal(ok, FlowRules.ValidStatuses(FlowRules.Parse(csv)));

    // ---------------------------------------------------------------- the admin's own statuses
    static readonly Dictionary<string, string> Like = new() { ["c_visit"] = "pending_internal", ["c_wait"] = "pending_customer", ["c_check"] = "in_progress" };

    [Fact]
    public void Own_status_is_known_only_when_it_exists()
    {
        Assert.True(FlowRules.ValidStatuses(["new", "in_progress", "resolved", "closed", "c_visit"], Like));
        Assert.False(FlowRules.ValidStatuses(["new", "in_progress", "resolved", "closed", "c_gone"], Like));
    }

    [Fact]
    public void Own_waiting_status_with_a_way_back_is_fine()
    {
        string[] st = [.. All, "c_visit"];
        Assert.Empty(FlowRules.Problems(st, [.. Picture, S("in_progress", "c_visit"), S("c_visit", "in_progress")], Like));
    }

    [Fact]
    public void Own_waiting_status_without_a_way_out_is_stuck()
    {
        string[] st = [.. All, "c_visit"];
        Assert.Contains("stuck:c_visit", FlowRules.Problems(st, [.. Picture, S("in_progress", "c_visit")], Like));
        Assert.Contains("unreachable:c_visit", FlowRules.Problems(st, Picture, Like));
    }

    [Fact]
    public void Own_status_like_pending_customer_gets_the_automatic_moves()
    {
        var auto = FlowRules.Automatic(["new", "in_progress", "resolved", "closed", "c_wait"], Like).ToList();
        Assert.Contains(("c_wait", "in_progress"), auto);
        Assert.Contains(("c_wait", "closed"), auto);
        string[] st = [.. All, "c_wait"];
        Assert.Empty(FlowRules.Problems(st, [.. Picture, S("in_progress", "c_wait")], Like));   // no way out by hand needed
    }

    [Fact]
    public void Own_working_status_must_reach_resolved()
    {
        string[] st = [.. All, "c_check"];
        Assert.Contains("no_resolve:c_check", FlowRules.Problems(st, [.. Picture, S("in_progress", "c_check"), C("c_check", "in_progress")], Like));
        Assert.Empty(FlowRules.Problems(st, [.. Picture, S("in_progress", "c_check"), S("c_check", "resolved")], Like));
    }

    [Fact]
    public void Moving_to_an_own_status_stores_what_it_behaves_like()
    {
        Assert.Equal(("pending_internal", "c_visit"), FlowRules.Target("c_visit", Like));
        Assert.Equal(("resolved", (string?)null), FlowRules.Target("resolved", Like));
        Assert.Equal("new,in_progress,resolved,closed,c_visit", FlowRules.Join(["c_visit", "closed", "new", "resolved", "in_progress"]));
    }

    [Theory]
    [InlineData("c_ab12", true)]
    [InlineData("c_", false)]
    [InlineData("c_AB", false)]
    [InlineData("in_progress", false)]
    public void Own_status_codes(string code, bool ok) => Assert.Equal(ok, CustomStatuses.IsCode(code));

    [Fact]
    public void Customers_see_an_own_status_only_with_its_own_name()
    {
        var own = new HashSet<string> { "c_visit" };
        Assert.Equal("c_visit", CustomStatuses.CustomerView("pending_internal", "c_visit", own));
        Assert.Equal("in_progress", CustomStatuses.CustomerView("pending_internal", "c_other", own));
        Assert.Equal("pending_customer", CustomStatuses.CustomerView("pending_customer", null, own));
    }
}
