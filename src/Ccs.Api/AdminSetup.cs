using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Infrastructure;
using Ccs.Infrastructure.Identity;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api;

/// <summary>
/// Server command used by the installer: creates the first administrator, or resets an existing account
/// to an active administrator with a new password.
///   dotnet Ccs.Api.dll create-admin &lt;email&gt; &lt;password&gt; [full name]
/// Reads ConnectionStrings__Ccs from the environment, like the API itself.
/// </summary>
public static class AdminSetup
{
    public static async Task<int> RunAsync(string[] args)
    {
        if (args.Length < 3)
        {
            Console.Error.WriteLine("Usage: dotnet Ccs.Api.dll create-admin <email> <password> [full name]");
            return 2;
        }
        var email = args[1].Trim().ToLowerInvariant();
        var password = args[2];
        var name = args.Length > 3 ? string.Join(' ', args[3..]).Trim() : "Administrator";

        var builder = Host.CreateApplicationBuilder();
        builder.Services.AddCcsInfrastructure(builder.Configuration, runJobs: false);
        using var host = builder.Build();
        using var scope = host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CcsDbContext>();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var now = DateTimeOffset.UtcNow;

        var user = await users.FindByEmailAsync(email);
        if (user is null)
        {
            user = new AppUser { Id = Guid.NewGuid(), UserName = email, Email = email, EmailConfirmed = true };
            var r = await users.CreateAsync(user, password);
            if (!r.Succeeded) return Fail(r);
        }
        else
        {
            var token = await users.GeneratePasswordResetTokenAsync(user);
            var r = await users.ResetPasswordAsync(user, token, password);
            if (!r.Succeeded) return Fail(r);
            user.EmailConfirmed = true;
            await users.UpdateAsync(user);
        }

        var adminType = await db.AccountTypes.Where(t => t.NameEn == "Administrator").Select(t => (Guid?)t.Id).FirstOrDefaultAsync();
        var profile = await db.Profiles.FirstOrDefaultAsync(p => p.Id == user.Id);
        if (profile is null)
        {
            profile = new Profile { Id = user.Id, FullName = name, Email = email, CreatedAt = now };
            db.Profiles.Add(profile);
        }
        profile.AccountStatus = AccountStatus.Active;
        profile.AccountTypeId = adminType;
        profile.PasswordChangedAt = now;
        profile.UpdatedAt = now;

        // One role per person: the administrator role replaces any other.
        db.CcsUserRoles.RemoveRange(db.CcsUserRoles.Where(x => x.UserId == user.Id));
        db.CcsUserRoles.Add(new UserRole { UserId = user.Id, RoleId = 4 });   // 4 = admin
        await db.SaveChangesAsync();

        Console.WriteLine($"Administrator ready: {email}");
        return 0;
    }

    private static int Fail(IdentityResult r)
    {
        Console.Error.WriteLine("Could not set the account: " + string.Join("; ", r.Errors.Select(e => e.Description)));
        return 1;
    }
}
