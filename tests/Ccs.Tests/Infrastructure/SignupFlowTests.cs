using Ccs.Application.Abstractions;
using Ccs.Application.Notifications;
using Ccs.Application.Settings;
using Ccs.Application.Sla;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Email;
using Ccs.Infrastructure.Identity;
using Ccs.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Ccs.Tests.Infrastructure;

/// <summary>Sign-up: the email carries its code, unconfirmed requests are removed, waiting requests remind the approvers.</summary>
public class SignupFlowTests
{
    sealed class Clock(DateTimeOffset now) : IClock { public DateTimeOffset UtcNow { get; set; } = now; }

    readonly CcsDbContext db = new(new DbContextOptionsBuilder<CcsDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options);

    // Thursday 26 Nov 2026, 15:00 Cairo (13:00 UTC).
    static readonly DateTimeOffset Thursday = new(2026, 11, 26, 13, 0, 0, TimeSpan.Zero);

    TemplateMailer Mailer() => new(db, Options.Create(new AppUrlOptions { PublicUrl = "https://ccs.test" }));

    static Dictionary<string, string> Values() => new() { ["name"] = "Ahmed", ["email"] = "a@x.test", ["minutes"] = "60", ["code"] = "482913" };

    [Fact]
    public async Task Signup_email_shows_the_code_and_a_confirm_button()
    {
        var mail = await Mailer().BuildAsync("auth_signup", "en", Values(), "/register/confirm#email=a%40x.test&code=482913", "482913");
        Assert.NotNull(mail);
        Assert.Contains("482913", mail!.Text);
        Assert.Contains("https://ccs.test/en/register/confirm#email=a%40x.test", mail.Html);
        Assert.Contains("Confirm email", mail.Html);
    }

    [Fact]
    public async Task Admin_reset_email_carries_the_temporary_password_and_a_sign_in_button()
    {
        var values = new Dictionary<string, string> { ["name"] = "Ahmed", ["email"] = "a@x.test", ["minutes"] = "0", ["password"] = "Tq7!mK2#pR9x", ["by"] = "Sara Adel" };
        var en = await Mailer().BuildAsync("auth_password_reset", "en", values, "/login", "Tq7!mK2#pR9x");
        Assert.Contains("Tq7!mK2#pR9x", en!.Text);
        Assert.Contains("Tq7!mK2#pR9x", en.Html);
        Assert.Contains("Sara Adel", en.Text);
        Assert.Contains("https://ccs.test/en/login", en.Html);
        var ar = await Mailer().BuildAsync("auth_password_change_required", "ar", values, "/login", null);
        Assert.Contains("Sara Adel", ar!.Text);
        Assert.DoesNotContain("{", ar.Subject);
    }

    [Fact]
    public async Task Saved_wording_without_the_code_still_gets_it()
    {
        db.EmailTemplates.Add(new EmailTemplate { Event = "auth_signup", Locale = "ar", Subject = "أكّد بريدك", Body = "أهلًا {name}. أكّد بريدك." });
        await db.SaveChangesAsync();
        var mail = await Mailer().BuildAsync("auth_signup", "ar", Values(), null, "482913");
        Assert.Contains("482913", mail!.Text);
    }

    [Fact]
    public void Two_working_days_from_Thursday_is_Monday_at_nine_Cairo()
    {
        var due = BusinessCalendar.WorkingDaysBoundaryDefault(Thursday, 2);
        Assert.Equal(new DateTimeOffset(2026, 11, 30, 7, 0, 0, TimeSpan.Zero), due);   // Monday 09:00 Cairo (UTC+2)
    }

    AccountRequestTimers Timers(Clock clock) => new(db, new AccountApprovers(db), new CalendarProvider(db),
        new NotificationService(db, clock), new SettingsService(db), clock, NullLogger<AccountRequestTimers>.Instance);

    Guid Person(string status, string role, DateTimeOffset created, DateTimeOffset? verified = null)
    {
        var id = Guid.NewGuid();
        db.Users.Add(new AppUser { Id = id, UserName = $"{id}@x.test", Email = $"{id}@x.test" });
        db.Profiles.Add(new Profile { Id = id, FullName = "P " + status, Email = $"{id}@x.test", AccountStatus = status,
            CreatedAt = created, UpdatedAt = created, EmailVerifiedAt = verified });
        db.CcsUserRoles.Add(new UserRole { UserId = id, RoleId = (short)(role == RoleCode.Admin ? 4 : 1) });
        return id;
    }

    [Fact]
    public async Task Unconfirmed_signups_are_removed_after_seven_days_only()
    {
        var clock = new Clock(Thursday);
        var old = Person(AccountStatus.PendingVerification, RoleCode.Customer, Thursday.AddDays(-8));
        var recent = Person(AccountStatus.PendingVerification, RoleCode.Customer, Thursday.AddDays(-3));
        var waiting = Person(AccountStatus.PendingApproval, RoleCode.Customer, Thursday.AddDays(-30), Thursday.AddDays(-1));
        db.AuthCodes.Add(new AuthCode { Id = Guid.NewGuid(), UserId = old, Purpose = "signup", CodeHash = "x", CreatedAt = Thursday.AddDays(-8), ExpiresAt = Thursday.AddDays(-8) });
        await db.SaveChangesAsync();

        Assert.Equal(1, await Timers(clock).RemoveUnconfirmedAsync());
        Assert.False(await db.Profiles.AnyAsync(p => p.Id == old));
        Assert.False(await db.Users.AnyAsync(u => u.Id == old));
        Assert.False(await db.AuthCodes.AnyAsync(c => c.UserId == old));
        Assert.True(await db.Profiles.AnyAsync(p => p.Id == recent));
        Assert.True(await db.Profiles.AnyAsync(p => p.Id == waiting));
    }

    [Fact]
    public async Task Zero_days_keeps_unconfirmed_signups()
    {
        db.AppSettings.Add(new AppSetting { Key = "signup_unconfirmed_days", Value = "0" });
        Person(AccountStatus.PendingVerification, RoleCode.Customer, Thursday.AddDays(-60));
        await db.SaveChangesAsync();
        Assert.Equal(0, await Timers(new Clock(Thursday)).RemoveUnconfirmedAsync());
    }

    [Fact]
    public async Task Approvers_are_reminded_after_two_working_days_once()
    {
        db.CcsRoles.AddRange(new Role { Id = 1, Code = RoleCode.Customer }, new Role { Id = 4, Code = RoleCode.Admin });
        var admin = Person(AccountStatus.Active, RoleCode.Admin, Thursday.AddDays(-100));
        Person(AccountStatus.PendingApproval, RoleCode.Customer, Thursday, Thursday);   // confirmed Thursday 15:00
        await db.SaveChangesAsync();

        var clock = new Clock(new DateTimeOffset(2026, 11, 29, 12, 0, 0, TimeSpan.Zero));   // Sunday: one working day only
        Assert.Equal(0, await Timers(clock).RemindApproversAsync());

        clock.UtcNow = new DateTimeOffset(2026, 11, 30, 8, 0, 0, TimeSpan.Zero);             // Monday 10:00 Cairo
        Assert.Equal(1, await Timers(clock).RemindApproversAsync());
        Assert.Equal(1, await Timers(clock).RemindApproversAsync());                          // same stage: no second email
        var rows = await db.Notifications.Where(n => n.UserId == admin && n.EventType == NotificationEvent.ApprovalReminder).ToListAsync();
        Assert.Equal(2, rows.Count);                                                           // in-app and email, once each
        Assert.Contains(rows, r => r.Channel == "email");
        Assert.Contains("\"days\":2", rows[0].Payload);
        Assert.Contains("/admin/approvals", rows[0].Payload);
    }
}
