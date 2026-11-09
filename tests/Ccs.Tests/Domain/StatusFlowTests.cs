using System.Text.Json;
using Ccs.Domain;
using Ccs.Domain.Rules;

namespace Ccs.Tests.Domain;

/// <summary>The status table in spec 3, checked against the seeded flow (database/status-flow-defaults.json).</summary>
public class StatusFlowTests
{
    static readonly List<Transition> Flow = LoadDefaults();
    static readonly string[] Reasons = ["resolved_confirmed", "auto_closed", "no_response", "duplicate", "spam", "cancelled", "other"];
    static readonly DateTimeOffset Now = new(2026, 11, 9, 10, 0, 0, TimeSpan.Zero);

    static List<Transition> LoadDefaults()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "status-flow-defaults.json");
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        return doc.RootElement.EnumerateArray().Select(e => new Transition(
            e.GetProperty("from").GetString()!, e.GetProperty("to").GetString()!, e.GetProperty("actor").GetString()!,
            e.GetProperty("requires_reason").GetBoolean())).ToList();
    }

    static StatusChangeDecision Try(string from, string to, StatusActor actor, string? reason = "because", string? resolution = "fixed it",
        string? closure = "other", bool resolve = true, bool close = true, DateTimeOffset? closedAt = null, bool? mayReopen = true) =>
        StatusFlow.Evaluate(new StatusChangeRequest(from, to, actor, reason, resolution, closure, resolve, close,
            closedAt ?? Now.AddDays(-1), mayReopen, 30, Now, Reasons), Flow);

    [Theory]
    [InlineData("new", "open,in_progress,pending_internal,closed")]
    [InlineData("open", "in_progress,pending_customer,pending_internal,resolved")]
    [InlineData("in_progress", "open,pending_customer,pending_internal,resolved")]
    [InlineData("pending_customer", "in_progress,resolved,closed")]
    [InlineData("pending_internal", "in_progress,resolved")]
    [InlineData("resolved", "")]
    [InlineData("closed", "reopened")]
    [InlineData("reopened", "in_progress,pending_customer,pending_internal,resolved")]
    public void Staff_moves_match_the_spec_table(string from, string expected)
    {
        var allowed = Flow.Where(t => t.From == from && t.Actor == "staff").Select(t => t.To).OrderBy(x => x);
        Assert.Equal(expected.Split(',', StringSplitOptions.RemoveEmptyEntries).OrderBy(x => x), allowed);
    }

    [Theory]
    [InlineData("resolved", "closed,reopened")]
    [InlineData("closed", "reopened")]
    [InlineData("new", "")]
    [InlineData("open", "")]
    [InlineData("pending_customer", "")]
    public void Customer_moves_match_the_spec_table(string from, string expected)
    {
        var allowed = Flow.Where(t => t.From == from && t.Actor == "customer").Select(t => t.To).OrderBy(x => x);
        Assert.Equal(expected.Split(',', StringSplitOptions.RemoveEmptyEntries).OrderBy(x => x), allowed);
    }

    [Fact]
    public void Move_not_in_table_is_refused() =>
        Assert.Equal("transition new to resolved is not allowed", Try("new", "resolved", StatusActor.Staff).Error);

    [Fact]
    public void Move_requiring_a_reason_needs_one() =>
        Assert.Equal("a reason is required", Try("new", "closed", StatusActor.Staff, reason: "  ").Error);

    [Fact]
    public void Resolving_needs_permission_and_resolution_details()
    {
        Assert.Equal("not allowed to resolve tickets", Try("open", "resolved", StatusActor.Staff, resolve: false).Error);
        Assert.Equal("resolution details are required", Try("open", "resolved", StatusActor.Staff, resolution: "ok").Error);
        Assert.True(Try("open", "resolved", StatusActor.Staff).Allowed);
    }

    [Fact]
    public void Staff_close_needs_a_manual_closure_reason()
    {
        Assert.Equal("a closure reason is required", Try("pending_customer", "closed", StatusActor.Staff, closure: null).Error);
        Assert.Equal("a closure reason is required", Try("pending_customer", "closed", StatusActor.Staff, closure: "auto_closed").Error);
        Assert.Equal("duplicate", Try("pending_customer", "closed", StatusActor.Staff, closure: "duplicate").ClosureReasonToStore);
    }

    [Fact]
    public void Customer_closing_a_resolved_ticket_confirms_it() =>
        Assert.Equal(ClosureReasonCode.ResolvedConfirmed, Try("resolved", "closed", StatusActor.Customer, closure: null).ClosureReasonToStore);

    [Fact]
    public void Customer_reopen_respects_window_and_closure_reason()
    {
        Assert.True(Try("closed", "reopened", StatusActor.Customer, closedAt: Now.AddDays(-29)).Allowed);
        Assert.Equal("the reopen window has passed", Try("closed", "reopened", StatusActor.Customer, closedAt: Now.AddDays(-31)).Error);
        Assert.Equal("this ticket cannot be reopened by the customer", Try("closed", "reopened", StatusActor.Customer, mayReopen: false).Error);
    }

    [Fact]
    public void Default_flow_has_no_problems() => Assert.Empty(StatusFlow.Problems(Flow));
}
