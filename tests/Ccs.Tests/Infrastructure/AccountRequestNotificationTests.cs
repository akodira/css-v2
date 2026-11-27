using Ccs.Application.Abstractions;
using Ccs.Application.Notifications;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Tests.Infrastructure;

/// <summary>An account request's own answers reach the customer by email even though the account is not active.</summary>
public class AccountRequestNotificationTests
{
    sealed class FixedClock : IClock { public DateTimeOffset UtcNow { get; } = DateTimeOffset.UtcNow; }

    readonly CcsDbContext db = new(new DbContextOptionsBuilder<CcsDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    async Task<Guid> Customer(string status)
    {
        var id = Guid.NewGuid();
        db.Profiles.Add(new Profile { Id = id, Email = $"{id}@x.test", AccountStatus = status });
        db.CcsUserRoles.Add(new UserRole { UserId = id, RoleId = 1 });
        await db.SaveChangesAsync();
        return id;
    }

    [Theory]
    [InlineData(NotificationEvent.AccountRejected, AccountStatus.Suspended)]
    [InlineData(NotificationEvent.AccountPending, AccountStatus.PendingVerification)]
    public async Task Request_answers_reach_an_inactive_account_by_email_only(string evt, string status)
    {
        var id = await Customer(status);
        var svc = new NotificationService(db, new FixedClock());
        await svc.NotifyAsync(id, evt, null, new { name = "N", reason = "Because of this." }, "test");
        await db.SaveChangesAsync();
        var rows = await db.Notifications.Where(n => n.UserId == id).ToListAsync();
        Assert.Single(rows);
        Assert.Equal("email", rows[0].Channel);
        Assert.Contains("Because of this.", rows[0].Payload);
    }

    [Fact]
    public async Task Other_events_still_skip_an_inactive_account()
    {
        var id = await Customer(AccountStatus.Suspended);
        var svc = new NotificationService(db, new FixedClock());
        await svc.NotifyAsync(id, NotificationEvent.AccountApproved, null, new { name = "N" }, "test");
        await db.SaveChangesAsync();
        Assert.Empty(await db.Notifications.Where(n => n.UserId == id).ToListAsync());
    }
}
