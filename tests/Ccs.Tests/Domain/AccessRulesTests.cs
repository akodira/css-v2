using Ccs.Domain;
using Ccs.Domain.Rules;

namespace Ccs.Tests.Domain;

/// <summary>One test per access rule in spec section 2. These replace row-level security, so they must never go red.</summary>
public class AccessRulesTests
{
    static readonly Guid Me = Guid.NewGuid(), Other = Guid.NewGuid(), Agent2 = Guid.NewGuid();
    static readonly Guid OrgA = Guid.NewGuid(), OrgB = Guid.NewGuid(), BranchA1 = Guid.NewGuid(), BranchA2 = Guid.NewGuid();
    static readonly Guid TeamX = Guid.NewGuid(), TeamY = Guid.NewGuid();

    static AccessContext Customer(bool shared = false) => new()
    {
        UserId = Me, Active = true, Customer = true, OrganizationId = OrgA, BranchId = BranchA1, OrgSharedAccess = shared,
    };

    static AccessContext Agent(params string[] perms) => new()
    {
        UserId = Me, Active = true, Staff = true, Permissions = perms.ToHashSet(), Teams = new HashSet<Guid> { TeamX },
        Scope = [new ScopeEntry(OrgA, null)],
    };

    static TicketFacts Ticket(Guid requester, Guid? agent = null, Guid? team = null, Guid? org = null, Guid? branch = null) =>
        new(requester, agent, team, org ?? OrgA, branch ?? BranchA1);

    [Fact]
    public void Requester_sees_own_ticket() => Assert.True(AccessRules.CanAccessTicket(Customer(), Ticket(Me)));

    [Fact]
    public void Customer_cannot_see_another_customers_ticket() => Assert.False(AccessRules.CanAccessTicket(Customer(), Ticket(Other)));

    [Fact]
    public void Organization_shared_access_lets_colleagues_see_each_other_when_on()
    {
        Assert.True(AccessRules.CanAccessTicket(Customer(shared: true), Ticket(Other, org: OrgA)));
        Assert.False(AccessRules.CanAccessTicket(Customer(shared: true), Ticket(Other, org: OrgB)));
        Assert.False(AccessRules.CanAccessTicket(Customer(shared: false), Ticket(Other, org: OrgA)));
    }

    [Fact]
    public void Suspended_account_sees_nothing_not_even_own_tickets() =>
        Assert.False(AccessRules.CanAccessTicket(Customer() with { Active = false }, Ticket(Me)));

    [Fact]
    public void Admin_sees_everything() =>
        Assert.True(AccessRules.CanAccessTicket(new AccessContext { UserId = Me, Active = true, Admin = true, Staff = true }, Ticket(Other, org: OrgB, team: TeamY)));

    [Fact]
    public void Assigned_agent_always_sees_the_ticket_even_outside_team_and_scope() =>
        Assert.True(AccessRules.CanAccessTicket(Agent(), Ticket(Other, agent: Me, team: TeamY, org: OrgB)));

    [Fact]
    public void Agent_sees_unassigned_ticket_in_own_team_only_with_view_unassigned()
    {
        Assert.True(AccessRules.CanAccessTicket(Agent(Permission.ViewUnassigned), Ticket(Other, team: TeamX)));
        Assert.False(AccessRules.CanAccessTicket(Agent(), Ticket(Other, team: TeamX)));
    }

    [Fact]
    public void Agent_sees_colleagues_tickets_only_with_view_others()
    {
        Assert.True(AccessRules.CanAccessTicket(Agent(Permission.ViewOthers), Ticket(Other, agent: Agent2, team: TeamX)));
        Assert.False(AccessRules.CanAccessTicket(Agent(Permission.ViewUnassigned), Ticket(Other, agent: Agent2, team: TeamX)));
    }

    [Fact]
    public void Agent_does_not_see_other_teams_without_all_teams()
    {
        Assert.False(AccessRules.CanAccessTicket(Agent(Permission.ViewUnassigned), Ticket(Other, team: TeamY)));
        Assert.True(AccessRules.CanAccessTicket(Agent(Permission.ViewUnassigned, Permission.AllTeams), Ticket(Other, team: TeamY)));
    }

    [Fact]
    public void Scope_limits_staff_to_their_organizations_and_branches()
    {
        var branchScoped = Agent(Permission.ViewUnassigned) with { Scope = [new ScopeEntry(OrgA, BranchA1)] };
        Assert.True(AccessRules.CanAccessTicket(branchScoped, Ticket(Other, team: TeamX, branch: BranchA1)));
        Assert.False(AccessRules.CanAccessTicket(branchScoped, Ticket(Other, team: TeamX, branch: BranchA2)));
        Assert.False(AccessRules.CanAccessTicket(Agent(Permission.ViewUnassigned), Ticket(Other, team: TeamX, org: OrgB)));
    }

    [Fact]
    public void All_scope_ignores_organization() =>
        Assert.True(AccessRules.CanAccessTicket(Agent(Permission.ViewUnassigned) with { AllScope = true }, Ticket(Other, team: TeamX, org: OrgB)));

    [Fact]
    public void Management_viewer_sees_all_teams_in_scope_but_respects_assignment_permissions()
    {
        var viewer = new AccessContext { UserId = Me, Active = true, Viewer = true, AllScope = true, Permissions = new HashSet<string> { Permission.ViewOthers } };
        Assert.True(AccessRules.CanAccessTicket(viewer, Ticket(Other, agent: Agent2, team: TeamY)));
        Assert.False(AccessRules.CanAccessTicket(viewer, Ticket(Other, team: TeamY)));
    }

    [Fact]
    public void Internal_notes_are_never_visible_to_customers()
    {
        Assert.False(AccessRules.CanSeeInternalNotes(Customer(), Ticket(Me)));
        Assert.True(AccessRules.CanSeeInternalNotes(Agent(), Ticket(Other, team: TeamX)));
        Assert.True(AccessRules.CanSeeInternalNotes(Agent(), Ticket(Other, agent: Me, team: TeamY)));
        Assert.False(AccessRules.CanSeeInternalNotes(Agent(), Ticket(Other, team: TeamY)));
    }

    [Fact]
    public void Viewer_cannot_see_internal_notes() =>
        Assert.False(AccessRules.CanSeeInternalNotes(new AccessContext { UserId = Me, Active = true, Viewer = true, AllScope = true, Teams = new HashSet<Guid> { TeamX } }, Ticket(Other, team: TeamX)));

    [Fact]
    public void Team_leader_or_admin_can_assign_anyone()
    {
        var leader = Agent(Permission.AssignOthers);
        Assert.True(AccessRules.CanAssign(leader, Ticket(Other, team: TeamX), TeamX, Agent2));
        Assert.True(AccessRules.CanAssign(new AccessContext { UserId = Me, Active = true, Admin = true, Staff = true }, Ticket(Other, team: TeamY), TeamY, Agent2));
    }

    [Fact]
    public void Agent_can_only_claim_an_unassigned_ticket_in_own_team()
    {
        var agent = Agent(Permission.AssignSelf);
        Assert.True(AccessRules.CanAssign(agent, Ticket(Other, team: TeamX), TeamX, Me));
        Assert.False(AccessRules.CanAssign(agent, Ticket(Other, team: TeamX), TeamX, Agent2));            // not someone else
        Assert.False(AccessRules.CanAssign(agent, Ticket(Other, agent: Agent2, team: TeamX), TeamX, Me));  // already assigned
        Assert.False(AccessRules.CanAssign(agent, Ticket(Other, team: TeamY), TeamY, Me));                // not my team
    }

    [Fact]
    public void Customer_cannot_assign() => Assert.False(AccessRules.CanAssign(Customer(), Ticket(Me), TeamX, Me));

    [Fact]
    public void Staff_creator_can_write_for_one_hour_with_create_for_customer()
    {
        var now = DateTimeOffset.UtcNow;
        var creator = new AccessContext { UserId = Me, Active = true, Staff = true, Permissions = new HashSet<string> { Permission.CreateForCustomer }, Scope = [] };
        var fresh = new TicketFacts(Other, null, TeamY, OrgB, null, Me, now.AddMinutes(-30));
        var old = fresh with { CreatedAt = now.AddHours(-2) };
        Assert.True(AccessRules.CanWriteTicket(creator, fresh, now));
        Assert.False(AccessRules.CanWriteTicket(creator, old, now));
    }

    [Fact]
    public void Admin_has_every_permission_and_suspended_has_none()
    {
        var admin = AccessRules.EffectivePermissions(true, true, true, false, [], false);
        Assert.Contains(Permission.ManageUsers, admin);
        Assert.Contains(Permission.CreateForCustomer, admin);
        Assert.Empty(AccessRules.EffectivePermissions(false, true, true, false, [], true));
    }

    [Fact]
    public void Account_type_permissions_are_exact_and_create_for_customers_is_a_flag()
    {
        var p = AccessRules.EffectivePermissions(true, false, true, true, [Permission.Reply], canCreateForCustomers: true);
        Assert.Equal(new[] { Permission.CreateForCustomer, Permission.Reply }.OrderBy(x => x), p.OrderBy(x => x));
        var customer = AccessRules.EffectivePermissions(true, false, false, true, [], canCreateForCustomers: true);
        Assert.Empty(customer);
    }
}
