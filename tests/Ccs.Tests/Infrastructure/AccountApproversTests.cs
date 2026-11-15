using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Identity;
using Ccs.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Ccs.Tests.Infrastructure;

/// <summary>A customer's account request goes only to the admin of the branch or organization they picked.</summary>
public class AccountApproversTests
{
    readonly CcsDbContext db = new(new DbContextOptionsBuilder<CcsDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options);

    readonly Guid parent = Guid.NewGuid(), orgA = Guid.NewGuid(), orgB = Guid.NewGuid(), branchA1 = Guid.NewGuid(), branchA2 = Guid.NewGuid();
    readonly Guid approverType = Guid.NewGuid(), plainType = Guid.NewGuid();
    Guid sysAdmin, adminA1, adminOrgA, adminParent, agentA2NoPerm, adminOrgB;

    Guid Person(string role, Guid? type, Guid? org = null, Guid? branch = null, bool scope = false, string status = AccountStatus.Active)
    {
        var id = Guid.NewGuid();
        db.Profiles.Add(new Profile { Id = id, Email = $"{id}@x.test", AccountStatus = status, AccountTypeId = type,
            OrganizationId = role == RoleCode.Customer ? org : null, BranchId = role == RoleCode.Customer ? branch : null });
        db.CcsUserRoles.Add(new UserRole { UserId = id, RoleId = role switch { RoleCode.Customer => 1, RoleCode.Agent => 2, _ => 4 } });
        if (role != RoleCode.Customer && org is Guid o)
        {
            db.StaffPlacements.Add(new StaffPlacement { Id = Guid.NewGuid(), UserId = id, OrganizationId = o, BranchId = branch });
            if (scope) db.AdminScopes.Add(new AdminScope { Id = Guid.NewGuid(), UserId = id, OrganizationId = o, BranchId = branch });
        }
        return id;
    }

    async Task<AccountApprovers> Setup()
    {
        db.CcsRoles.AddRange(new Role { Id = 1, Code = RoleCode.Customer }, new Role { Id = 2, Code = RoleCode.Agent }, new Role { Id = 4, Code = RoleCode.Admin });
        db.Organizations.AddRange(new Organization { Id = parent, Name = "P" }, new Organization { Id = orgA, Name = "A", ParentId = parent },
            new Organization { Id = orgB, Name = "B", ParentId = parent });
        db.Branches.AddRange(new Branch { Id = branchA1, OrganizationId = orgA, Name = "A1" }, new Branch { Id = branchA2, OrganizationId = orgA, Name = "A2" });
        db.AccountTypePermissions.Add(new AccountTypePermission { AccountTypeId = approverType, Permission = Permission.ApproveCustomers });
        sysAdmin = Person(RoleCode.Admin, null);
        adminA1 = Person(RoleCode.Agent, approverType, orgA, branchA1, scope: true);       // branch admin (admin scope)
        adminOrgA = Person(RoleCode.Agent, approverType, orgA);                           // org admin (placement only)
        agentA2NoPerm = Person(RoleCode.Agent, plainType, orgA, branchA2, scope: true);   // no approve permission
        adminParent = Person(RoleCode.Agent, approverType, parent);
        adminOrgB = Person(RoleCode.Agent, approverType, orgB);
        Person(RoleCode.Agent, approverType, orgB, status: AccountStatus.Suspended);     // suspended: never an approver
        await db.SaveChangesAsync();
        return new AccountApprovers(db);
    }

    static AccessContext Ctx(Guid id, bool admin = false) => new()
    {
        UserId = id, Active = true, Admin = admin, Staff = true,
        Permissions = new HashSet<string> { Permission.ApproveCustomers },
    };

    [Fact]
    public async Task Branch_request_goes_to_branch_admin_only()
    {
        var a = await Setup();
        Assert.Equal([adminA1], await a.ForAsync(orgA, branchA1, default));
    }

    [Fact]
    public async Task Branch_without_admin_falls_back_to_org_admin()
    {
        var a = await Setup();
        Assert.Equal([adminOrgA], await a.ForAsync(orgA, branchA2, default));
        Assert.Equal([adminOrgA], await a.ForAsync(orgA, null, default));
    }

    [Fact]
    public async Task Org_without_admin_goes_up_the_tree_then_to_system_admins()
    {
        var a = await Setup();
        var orgC = Guid.NewGuid();
        db.Organizations.Add(new Organization { Id = orgC, Name = "C", ParentId = parent });
        var lone = Guid.NewGuid();
        db.Organizations.Add(new Organization { Id = lone, Name = "Lone" });
        await db.SaveChangesAsync();
        Assert.Equal([adminParent], await a.ForAsync(orgC, null, default));
        Assert.Equal([sysAdmin], await a.ForAsync(lone, null, default));
        Assert.Equal([sysAdmin], await a.ForAsync(null, null, default));
    }

    [Fact]
    public async Task List_badge_and_approve_follow_the_same_rule()
    {
        var a = await Setup();
        var toA1 = Person(RoleCode.Customer, null, orgA, branchA1, status: AccountStatus.PendingApproval);
        var toA2 = Person(RoleCode.Customer, null, orgA, branchA2, status: AccountStatus.PendingApproval);
        var toB = Person(RoleCode.Customer, null, orgB, null, status: AccountStatus.PendingApproval);
        var unplaced = Person(RoleCode.Customer, null, null, null, status: AccountStatus.PendingApproval);
        await db.SaveChangesAsync();

        Assert.Equal([toA1], await a.VisibleAsync(Ctx(adminA1), default));
        Assert.Equal([toA2], await a.VisibleAsync(Ctx(adminOrgA), default));     // not the A1 request: A1 has its own admin
        Assert.Equal([toB], await a.VisibleAsync(Ctx(adminOrgB), default));
        Assert.Empty(await a.VisibleAsync(Ctx(adminParent), default));
        Assert.Empty(await a.VisibleAsync(Ctx(agentA2NoPerm) with { Permissions = new HashSet<string>() }, default));

        var sys = Ctx(sysAdmin, admin: true);
        Assert.Equal(4, (await a.VisibleAsync(sys, default)).Count);           // system admins still see every request
        Assert.Equal(1, await a.WaitingOnAsync(sys, default));                  // but only the unplaced one waits on them
        Assert.Equal(1, await a.WaitingOnAsync(Ctx(adminOrgA), default));

        var pA1 = await db.Profiles.FirstAsync(p => p.Id == toA1);
        Assert.True(await a.CanHandleAsync(Ctx(adminA1), pA1, default));
        Assert.False(await a.CanHandleAsync(Ctx(adminOrgA), pA1, default));
        Assert.False(await a.CanHandleAsync(Ctx(adminOrgB), pA1, default));
        Assert.True(await a.CanHandleAsync(sys, pA1, default));
        _ = unplaced;
    }
}
