using Ccs.Domain.Rules;

namespace Ccs.Tests.Domain;

public class ReassignRulesTests
{
    const string On = """{"on":true,"to":["agents","leader"],"reason":"req","once":false}""";
    const string Queue = """{"on":true,"to":["queue"],"reason":"opt","once":true}""";
    const string Off = """{"on":false,"to":[],"reason":"req","once":false}""";

    [Fact]
    public void Nothing_set_anywhere_means_off()
    {
        var r = ReassignRule.Resolve(null, [null, null], null);
        Assert.False(r.On);
    }

    [Fact]
    public void Branch_rule_wins_over_organization_and_default()
    {
        var r = ReassignRule.Resolve(Queue, [Off], On);
        Assert.True(r.On);
        Assert.Equal(["queue"], r.To);
        Assert.False(r.ReasonRequired);
        Assert.True(r.Once);
    }

    [Fact]
    public void Branch_without_rule_uses_nearest_organization_then_default()
    {
        Assert.False(ReassignRule.Resolve(null, [null, Off], On).On);   // parent organization says off
        Assert.Equal(["agents", "leader"], ReassignRule.Resolve(null, [null, null], On).To);
    }

    [Fact]
    public void Unknown_targets_are_dropped_and_bad_json_is_ignored()
    {
        var r = ReassignRule.Parse("""{"on":true,"to":["agents","boss","agents"],"reason":"req","once":false}""")!;
        Assert.Equal(["agents"], r.To);
        Assert.Null(ReassignRule.Parse("not json"));
        Assert.Equal(["queue"], ReassignRule.Resolve("not json", [Queue], null).To);
    }

    [Fact]
    public void Saving_needs_known_targets_and_one_when_on()
    {
        Assert.Null(ReassignRule.Problem(true, ["agents", "auto"]));
        Assert.Equal("to", ReassignRule.Problem(true, []));
        Assert.Equal("to", ReassignRule.Problem(true, ["everyone"]));
        Assert.Null(ReassignRule.Problem(false, []));
    }

    [Fact]
    public void Round_trip_keeps_the_rule()
    {
        var r = new ReassignRule(true, ["leader", "auto"], false, true);
        var back = ReassignRule.Parse(r.ToJson())!;
        Assert.Equal(r.To, back.To);
        Assert.Equal(r.ReasonRequired, back.ReasonRequired);
        Assert.Equal(r.Once, back.Once);
    }
}
