using Ccs.Domain.Rules;

namespace Ccs.Tests.Domain;

public class TeamRoutingTests
{
    private static readonly Guid Org = Guid.NewGuid(), Parent = Guid.NewGuid(), Branch = Guid.NewGuid(), Other = Guid.NewGuid();
    private static readonly TeamRouting.TeamAt AtBranch = new(Guid.NewGuid(), Org, Branch), AtOrg = new(Guid.NewGuid(), Org, null),
        AtParent = new(Guid.NewGuid(), Parent, null), Central = new(Guid.NewGuid(), null, null), Elsewhere = new(Guid.NewGuid(), Other, Guid.NewGuid());

    private static (Guid, string)? Pick(TeamRouting.TeamAt[] teams, Guid? branch = null, RoutingSettings? s = null, bool kindCentral = true) =>
        TeamRouting.Pick(teams, [Org, Parent], branch ?? Branch, s ?? RoutingSettings.Default, kindCentral);

    [Fact]
    public void The_customers_branch_team_comes_first() =>
        Assert.Equal((AtBranch.Id, TeamRouting.AtBranch), Pick([Central, AtOrg, AtBranch, Elsewhere]));

    [Fact]
    public void Then_the_organization_then_the_one_above_it()
    {
        Assert.Equal((AtOrg.Id, TeamRouting.AtOrganization), Pick([Central, AtOrg, AtParent, Elsewhere]));
        Assert.Equal((AtParent.Id, TeamRouting.AtOrganization), Pick([Central, AtParent, Elsewhere]));
    }

    [Fact]
    public void Then_the_central_team()
    {
        Assert.Equal((Central.Id, TeamRouting.AtCentral), Pick([Central, Elsewhere]));
        Assert.Null(Pick([Central, Elsewhere], kindCentral: false));
        Assert.Null(Pick([Central], s: RoutingSettings.Default with { UseCentral = false }));
    }

    [Fact]
    public void Another_places_team_never_gets_it() => Assert.Null(Pick([Elsewhere]));

    [Fact]
    public void Organization_step_can_be_switched_off_for_branch_customers()
    {
        var off = RoutingSettings.Default with { UseOrganization = false };
        Assert.Equal((Central.Id, TeamRouting.AtCentral), Pick([AtOrg, Central], s: off));
        // A customer with no branch still gets their own organization's team.
        Assert.Equal((AtOrg.Id, TeamRouting.AtOrganization), TeamRouting.Pick([AtOrg, Central], [Org, Parent], null, off, true));
    }

    [Fact]
    public void Take_turns_goes_round_the_team()
    {
        Guid a = Guid.NewGuid(), b = Guid.NewGuid(), c = Guid.NewGuid();
        Assert.Equal(a, TeamRouting.NextInLine([a, b, c], null));
        Assert.Equal(c, TeamRouting.NextInLine([a, b, c], b));
        Assert.Equal(a, TeamRouting.NextInLine([a, b, c], c));
        Assert.Equal(a, TeamRouting.NextInLine([a, b, c], Guid.NewGuid()));   // the last one left the team
    }

    [Fact]
    public void Fewest_open_tickets_wins()
    {
        Guid a = Guid.NewGuid(), b = Guid.NewGuid();
        Assert.Equal(b, TeamRouting.PickFewest([(a, 3), (b, 1)], _ => 0));
    }
}
