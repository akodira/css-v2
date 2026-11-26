using Ccs.Application.Abstractions;
using Ccs.Application.Access;
using Ccs.Application.Settings;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Ccs.Tests.Application;

/// <summary>
/// The list filter (SQL) and the single-ticket rule (C#) must always agree, or a list could show a ticket
/// that the detail page refuses, or worse, the other way round. Randomised over many contexts and tickets.
/// </summary>
public class AccessParityTests
{
    sealed class NoUser : ICurrentUser { public Guid? UserId => null; public int MfaLevel => 1; public string? IpAddress => null; }
    sealed class NoMfa : IMfaStatus { public Task<bool> HasVerifiedFactorAsync(Guid userId, CancellationToken ct = default) => Task.FromResult(false); }

    static CcsDbContext NewDb() => new(new DbContextOptionsBuilder<CcsDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
        .Options);

    [Fact]
    public async Task List_filter_matches_single_ticket_rule()
    {
        var rnd = new Random(20261109);
        await using var db = NewDb();
        var orgs = Enumerable.Range(0, 3).Select(_ => Guid.NewGuid()).ToList();
        var branches = orgs.SelectMany(o => Enumerable.Range(0, 2).Select(_ => (Org: o, Id: Guid.NewGuid()))).ToList();
        var teams = Enumerable.Range(0, 3).Select(_ => Guid.NewGuid()).ToList();
        var people = new List<Profile>();
        for (var i = 0; i < 12; i++)
        {
            var b = branches[rnd.Next(branches.Count)];
            people.Add(new Profile { Id = Guid.NewGuid(), Email = $"p{i}@x.test", OrganizationId = b.Org, BranchId = rnd.Next(4) == 0 ? null : b.Id, AccountStatus = AccountStatus.Active });
        }
        db.Profiles.AddRange(people);
        var tickets = new List<Ticket>();
        for (var i = 0; i < 80; i++)
        {
            // The ticket keeps the place it was created in; one in four customers has moved since.
            var requester = people[rnd.Next(people.Count)];
            var moved = rnd.Next(4) == 0 ? branches[rnd.Next(branches.Count)] : default;
            tickets.Add(new Ticket
            {
                Id = Guid.NewGuid(), Reference = $"T{i}", RequesterId = requester.Id,
                OrganizationId = moved == default ? requester.OrganizationId : moved.Org,
                BranchId = moved == default ? requester.BranchId : (rnd.Next(2) == 0 ? null : moved.Id),
                AssignedAgentId = rnd.Next(3) == 0 ? null : people[rnd.Next(people.Count)].Id,
                TeamId = rnd.Next(5) == 0 ? null : teams[rnd.Next(teams.Count)], Subject = "s", Description = "d",
            });
        }
        db.Tickets.AddRange(tickets);
        await db.SaveChangesAsync();

        var access = new AccessService(db, new NoUser(), new NoMfa(), new SettingsService(db));
        string[] perms = [Permission.ViewOthers, Permission.ViewUnassigned, Permission.AllTeams];

        for (var round = 0; round < 200; round++)
        {
            var me = people[rnd.Next(people.Count)];
            var scope = new List<ScopeEntry>();
            for (var s = rnd.Next(3); s > 0; s--)
            {
                var b = branches[rnd.Next(branches.Count)];
                scope.Add(new ScopeEntry(b.Org, rnd.Next(2) == 0 ? null : b.Id));
            }
            var staff = rnd.Next(3) > 0;
            var c = new AccessContext
            {
                UserId = me.Id, Active = rnd.Next(10) > 0, Staff = staff, Viewer = !staff && rnd.Next(2) == 0,
                Customer = !staff, Admin = rnd.Next(15) == 0, AllScope = rnd.Next(4) == 0,
                Permissions = perms.Where(_ => rnd.Next(2) == 0).ToHashSet(),
                Teams = teams.Where(_ => rnd.Next(2) == 0).ToHashSet(), Scope = scope,
                OrganizationId = me.OrganizationId, BranchId = me.BranchId, OrgSharedAccess = !staff && rnd.Next(3) == 0,
            };

            var listed = (await access.VisibleTickets(db.Tickets, c).Select(t => t.Id).ToListAsync()).ToHashSet();
            foreach (var t in tickets)
            {
                var facts = new TicketFacts(t.RequesterId, t.AssignedAgentId, t.TeamId, t.OrganizationId, t.BranchId);
                Assert.True(AccessRules.CanAccessTicket(c, facts) == listed.Contains(t.Id),
                    $"Mismatch in round {round} for ticket {t.Reference}: rule={AccessRules.CanAccessTicket(c, facts)} list={listed.Contains(t.Id)}");
            }
        }
    }

    [Fact]
    public async Task A_moved_customers_old_ticket_stays_with_the_old_branch()
    {
        await using var db = NewDb();
        Guid org = Guid.NewGuid(), oldBranch = Guid.NewGuid(), newBranch = Guid.NewGuid(), team = Guid.NewGuid();
        var customer = new Profile { Id = Guid.NewGuid(), Email = "c@x.test", OrganizationId = org, BranchId = newBranch, AccountStatus = AccountStatus.Active };
        db.Profiles.Add(customer);
        var ticket = new Ticket { Id = Guid.NewGuid(), Reference = "OLD", RequesterId = customer.Id, OrganizationId = org, BranchId = oldBranch, TeamId = team, Subject = "s", Description = "d" };
        db.Tickets.Add(ticket);
        await db.SaveChangesAsync();
        var access = new AccessService(db, new NoUser(), new NoMfa(), new SettingsService(db));
        AccessContext Staff(Guid branch) => new()
        {
            UserId = Guid.NewGuid(), Active = true, Staff = true, Teams = new HashSet<Guid> { team }, Scope = [new ScopeEntry(org, branch)],
            Permissions = new HashSet<string> { Permission.ViewOthers, Permission.ViewUnassigned },
        };
        Assert.True(await access.VisibleTickets(db.Tickets, Staff(oldBranch)).AnyAsync(t => t.Id == ticket.Id));
        Assert.False(await access.VisibleTickets(db.Tickets, Staff(newBranch)).AnyAsync(t => t.Id == ticket.Id));
        var mine = new AccessContext { UserId = customer.Id, Active = true, Customer = true, OrganizationId = org, BranchId = newBranch };
        Assert.True(await access.VisibleTickets(db.Tickets, mine).AnyAsync(t => t.Id == ticket.Id));   // the customer always sees their own
    }

    [Fact]
    public void Organization_tree_includes_children_and_survives_cycles()
    {
        Guid a = Guid.NewGuid(), b = Guid.NewGuid(), c = Guid.NewGuid(), d = Guid.NewGuid();
        var tree = new Dictionary<Guid, Guid?> { [a] = null, [b] = a, [c] = b, [d] = null };
        Assert.Equal(new[] { a, b, c }.OrderBy(x => x), AccessService.WithChildren(tree, a).OrderBy(x => x));
        var cyclic = new Dictionary<Guid, Guid?> { [a] = b, [b] = a };
        Assert.Equal(2, AccessService.WithChildren(cyclic, a).Count());
    }
}
