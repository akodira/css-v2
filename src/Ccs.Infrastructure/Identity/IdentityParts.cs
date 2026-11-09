using Ccs.Application.Abstractions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Ccs.Infrastructure.Identity;

/// <summary>ASP.NET Core Identity user. Id = ccs.profiles.id = the old Supabase auth.users.id.</summary>
public sealed class AppUser : IdentityUser<Guid>;

/// <summary>
/// Accepts the bcrypt hashes migrated from Supabase ("$2a$/$2b$...") and asks Identity to re-hash them
/// with its own algorithm on the first successful sign-in (spec 9, step 4). Nobody has to reset a password.
/// </summary>
public sealed class BcryptCompatiblePasswordHasher(IOptions<PasswordHasherOptions>? options = null)
    : PasswordHasher<AppUser>(options)
{
    public override PasswordVerificationResult VerifyHashedPassword(AppUser user, string hashedPassword, string providedPassword)
    {
        if (hashedPassword.StartsWith("$2a$", StringComparison.Ordinal) || hashedPassword.StartsWith("$2b$", StringComparison.Ordinal)
            || hashedPassword.StartsWith("$2y$", StringComparison.Ordinal))
        {
            bool ok;
            try { ok = BCrypt.Net.BCrypt.Verify(providedPassword, hashedPassword); }
            catch (BCrypt.Net.SaltParseException) { ok = false; }
            return ok ? PasswordVerificationResult.SuccessRehashNeeded : PasswordVerificationResult.Failed;
        }
        return base.VerifyHashedPassword(user, hashedPassword, providedPassword);
    }
}

/// <summary>Password rules driven by the editable settings (spec 5), checked on every set/reset.</summary>
public sealed class SettingsPasswordValidator(Application.Settings.SettingsService settings) : IPasswordValidator<AppUser>
{
    public async Task<IdentityResult> ValidateAsync(UserManager<AppUser> manager, AppUser user, string? password)
    {
        var policy = await settings.GetPasswordPolicyAsync();
        var errors = policy.Check(password ?? "");
        return errors.Count == 0
            ? IdentityResult.Success
            : IdentityResult.Failed(errors.Select(e => new IdentityError { Code = "password_" + e, Description = e }).ToArray());
    }
}

public sealed class MfaStatus(Persistence.CcsDbContext db) : IMfaStatus
{
    public Task<bool> HasVerifiedFactorAsync(Guid userId, CancellationToken ct = default) =>
        db.Users.AnyAsync(u => u.Id == userId && u.TwoFactorEnabled, ct);
}
