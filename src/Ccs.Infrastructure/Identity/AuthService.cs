using System.Security.Cryptography;
using System.Text;
using Ccs.Application.Abstractions;
using Ccs.Application.Common;
using Ccs.Application.Notifications;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Email;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Ccs.Infrastructure.Identity;

/// <summary>Error codes are the same strings the current app uses, so the Angular messages map 1:1.</summary>
public sealed class AuthError(string code, int status = 400, string? field = null) : AppException(code, status, code)
{
    public string? Field { get; } = field;
}

public sealed record SignInResult(TokenPair? Tokens, bool MfaRequired, string? MfaToken, IReadOnlyList<string> Roles, string Locale);

public sealed record RegisterRequest(string FullName, string Email, string? Phone, string Password, string Locale,
    Guid? OrganizationId, Guid? BranchId);

/// <summary>
/// Sign-in and account flows on ASP.NET Core Identity (spec 5). Replaces Supabase Auth.
/// Every flow keeps the behaviour listed in the spec: phone sign-in, email codes, TOTP, approval, suspension.
/// </summary>
public sealed class AuthService(
    UserManager<AppUser> users, CcsDbContext db, TokenService tokens, TemplateMailer mailer, IEmailSender sender,
    NotificationService notifications, AuditService audit, IClock clock, ILogger<AuthService> log,
    Ccs.Application.Settings.SettingsService settings)
{
    private const int ResetCodeLength = 6, ResetCodeMinutes = 60, ResetCodeAttempts = 5;

    // ------------------------------------------------------------------ password sign-in

    /// <param name="identifier">Email, or an Egyptian mobile number (+2 optional), looked up to the account email.</param>
    public async Task<SignInResult> SignInAsync(string identifier, string password, string? userAgent, string? ip, CancellationToken ct = default)
    {
        var user = await FindByIdentifierAsync(identifier, ct) ?? throw new AuthError("invalidCredentials", 401);
        if (await users.IsLockedOutAsync(user)) throw new AuthError("rateLimited", 429);
        if (!await users.CheckPasswordAsync(user, password))   // re-hashes migrated bcrypt passwords on success
        {
            await users.AccessFailedAsync(user);
            log.LogWarning("auth.login_failed {UserId}", user.Id);
            throw new AuthError("invalidCredentials", 401);
        }
        await users.ResetAccessFailedCountAsync(user);
        if (!user.EmailConfirmed) throw new AuthError("emailNotConfirmed", 403);
        if (await PasswordExpiredAsync(user.Id, ct))
        {
            // Same as v1: an expired password cannot sign in; a one-time code is emailed and the renewal step opens.
            var lastMinute = clock.UtcNow.AddSeconds(-60);
            if (!await db.AuthCodes.AnyAsync(c => c.UserId == user.Id && c.Purpose == "recovery" && c.CreatedAt > lastMinute, ct))
                await SendCodeAsync(user, "recovery", "auth_recovery", ct);
            throw new AuthError("passwordExpired", 403);
        }
        return await CompleteFirstFactorAsync(user, userAgent, ip, ct);
    }

    private async Task<SignInResult> CompleteFirstFactorAsync(AppUser user, string? userAgent, string? ip, CancellationToken ct)
    {
        var profile = await db.Profiles.AsNoTracking().FirstAsync(p => p.Id == user.Id, ct);
        var roles = await RolesAsync(user.Id, ct);
        if (user.TwoFactorEnabled)
        {
            // Second step required: a 5-minute token that only the /mfa endpoint accepts.
            var mfaToken = tokens.CreateAccessToken(user.Id, user.Email!, [], 1, out _, purpose: "mfa", minutes: 5);
            return new SignInResult(null, true, mfaToken, roles, profile.PreferredLocale);
        }
        EnsureActive(profile);
        var pair = await tokens.IssueAsync(user.Id, user.Email!, roles, 1, userAgent, ip, ct);
        audit.Write("auth.sign_in", "user", user.Id, null, new { method = "password" }, user.Id);
        await db.SaveChangesAsync(ct);
        return new SignInResult(pair, false, null, roles, profile.PreferredLocale);
    }

    /// <summary>TOTP second step. Once enrolled it is enforced on every request (aal claim checked by middleware).</summary>
    public async Task<SignInResult> VerifyMfaAsync(Guid userId, string code, string? userAgent, string? ip, CancellationToken ct = default)
    {
        var user = await users.FindByIdAsync(userId.ToString()) ?? throw new AuthError("notSignedIn", 401);
        var ok = await users.VerifyTwoFactorTokenAsync(user, TokenOptions.DefaultAuthenticatorProvider, Clean(code));
        if (!ok) { await users.AccessFailedAsync(user); throw new AuthError("mfaWrong"); }
        var profile = await db.Profiles.AsNoTracking().FirstAsync(p => p.Id == user.Id, ct);
        EnsureActive(profile);
        var roles = await RolesAsync(user.Id, ct);
        var pair = await tokens.IssueAsync(user.Id, user.Email!, roles, 2, userAgent, ip, ct);
        audit.Write("auth.sign_in", "user", user.Id, null, new { method = "password+totp" }, user.Id);
        await db.SaveChangesAsync(ct);
        return new SignInResult(pair, false, null, roles, profile.PreferredLocale);
    }

    public async Task<SignInResult> RefreshAsync(string refreshToken, string? userAgent, string? ip, CancellationToken ct = default)
    {
        var used = await tokens.ConsumeAsync(refreshToken, ct) ?? throw new AuthError("notSignedIn", 401);
        var user = await users.FindByIdAsync(used.UserId.ToString()) ?? throw new AuthError("notSignedIn", 401);
        var profile = await db.Profiles.AsNoTracking().FirstAsync(p => p.Id == user.Id, ct);
        EnsureActive(profile);
        var level = used.Old.MfaLevel;
        if (user.TwoFactorEnabled && level < 2) throw new AuthError("notSignedIn", 401);   // factor added since: sign in again
        var roles = await RolesAsync(user.Id, ct);
        var pair = await tokens.IssueAsync(user.Id, user.Email!, roles, level, userAgent, ip, ct);
        return new SignInResult(pair, false, null, roles, profile.PreferredLocale);
    }

    // ------------------------------------------------------------------ email sign-in code

    /// <summary>
    /// One-time 6-digit code, valid 10 minutes, 5 attempts, 60 s between codes, 10 per day (signin_code_settings).
    /// Always answers the same way so the endpoint cannot be used to discover accounts.
    /// </summary>
    public async Task RequestSigninCodeAsync(string email, CancellationToken ct = default)
    {
        var s = await db.SigninCodeSettings.AsNoTracking().FirstOrDefaultAsync(ct) ?? new SigninCodeSettings();
        if (!s.Enabled) throw new AuthError("signinCodesOff", 403);
        email = email.Trim().ToLowerInvariant();
        var now = clock.UtcNow;
        var recent = await db.SigninCodes.Where(c => c.Email == email && c.CreatedAt > now.AddDays(-1)).OrderByDescending(c => c.CreatedAt).ToListAsync(ct);
        if (recent.Count > 0 && recent[0].CreatedAt > now.AddSeconds(-s.CooldownSeconds)) throw new AuthError("rateLimited", 429);

        var user = await users.FindByEmailAsync(email);
        if (user is null || !user.EmailConfirmed) return;
        var profile = await db.Profiles.AsNoTracking().FirstAsync(p => p.Id == user.Id, ct);
        var isStaff = (await RolesAsync(user.Id, ct)).Any(r => r != RoleCode.Customer);
        // Staff may use codes only when two-step verification is on (spec 5).
        if (isStaff && (s.Audience != "all" || !user.TwoFactorEnabled)) return;

        if (recent.Count >= s.DailyLimit)
        {
            if (recent.Count == s.DailyLimit) await SendAccountEmailAsync("auth_signin_code_blocked", profile, null, s.ValidMinutes, ct);
            db.SigninCodes.Add(new SigninCode { Id = Guid.NewGuid(), Email = email, CodeHash = "blocked", ExpiresAt = now, ConsumedAt = now, CreatedAt = now });
            await db.SaveChangesAsync(ct);
            return;
        }
        var code = NewCode(s.CodeLength);
        db.SigninCodes.Add(new SigninCode { Id = Guid.NewGuid(), Email = email, CodeHash = HashCode(email, code), ExpiresAt = now.AddMinutes(s.ValidMinutes), CreatedAt = now });
        await db.SaveChangesAsync(ct);
        await SendAccountEmailAsync("auth_signin_code", profile, code, s.ValidMinutes, ct);
    }

    public async Task<SignInResult> VerifySigninCodeAsync(string email, string code, string? userAgent, string? ip, CancellationToken ct = default)
    {
        var s = await db.SigninCodeSettings.AsNoTracking().FirstOrDefaultAsync(ct) ?? new SigninCodeSettings();
        email = email.Trim().ToLowerInvariant();
        var now = clock.UtcNow;
        var row = await db.SigninCodes.Where(c => c.Email == email && c.ConsumedAt == null && c.ExpiresAt > now)
            .OrderByDescending(c => c.CreatedAt).FirstOrDefaultAsync(ct) ?? throw new AuthError("codeWrong");
        if (row.Attempts >= s.MaxAttempts) throw new AuthError("codeWrong");
        row.Attempts++;
        if (!FixedEquals(row.CodeHash, HashCode(email, Clean(code)))) { await db.SaveChangesAsync(ct); throw new AuthError("codeWrong"); }
        row.ConsumedAt = now;
        await db.SaveChangesAsync(ct);

        var user = await users.FindByEmailAsync(email) ?? throw new AuthError("codeWrong");
        // A code is a first factor: staff with an authenticator still pass the TOTP step.
        return await CompleteFirstFactorAsync(user, userAgent, ip, ct);
    }

    // ------------------------------------------------------------------ registration

    public async Task RegisterAsync(RegisterRequest r, string registrationMode, CancellationToken ct = default)
    {
        if (registrationMode == "closed") throw new AuthError("generic", 403);
        var email = r.Email.Trim().ToLowerInvariant();
        string? phone = null;
        if (!string.IsNullOrWhiteSpace(r.Phone))
            phone = EgyptPhone.Normalize(r.Phone) ?? throw new AuthError("phoneInvalid", 400, "phone");
        if (await users.FindByEmailAsync(email) is not null) throw new AuthError("emailTaken", 400, "email");
        if (phone is not null && await db.Profiles.AnyAsync(p => p.Phone == phone, ct)) throw new AuthError("phoneTaken", 400, "phone");

        bool picks = registrationMode is "pick_approval" or "pick_auto";
        if (picks)
        {
            if (r.OrganizationId is null || !await db.Organizations.AnyAsync(o => o.Id == r.OrganizationId && o.IsActive, ct))
                throw new AuthError("required", 400, "organizationId");
            if (r.BranchId is Guid b && !await db.Branches.AnyAsync(x => x.Id == b && x.OrganizationId == r.OrganizationId && x.IsActive, ct))
                throw new AuthError("required", 400, "branchId");
        }

        var user = new AppUser { Id = Guid.NewGuid(), UserName = email, Email = email, PhoneNumber = phone };
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var created = await users.CreateAsync(user, r.Password);
        if (!created.Succeeded)
            throw new AuthError(created.Errors.First().Code.StartsWith("password_") ? "passwordWeak" : "generic", 400, "password");

        var now = clock.UtcNow;
        db.Profiles.Add(new Profile
        {
            Id = user.Id, FullName = r.FullName.Trim(), Email = email, Phone = phone,
            PreferredLocale = r.Locale == "ar" ? "ar" : "en",
            OrganizationId = picks ? r.OrganizationId : null, BranchId = picks ? r.BranchId : null,
            AccountStatus = AccountStatus.PendingVerification, PasswordChangedAt = now, CreatedAt = now, UpdatedAt = now,
        });
        db.CcsUserRoles.Add(new UserRole { UserId = user.Id, RoleId = 1 });   // customer
        await db.SaveChangesAsync(ct);
        await users.AddToRoleAsync(user, RoleCode.Customer);
        await tx.CommitAsync(ct);

        await SendCodeAsync(user, "signup", "auth_signup", ct);
    }

    /// <summary>
    /// Email confirmation by code. Then: approval modes wait in pending_approval and notify the approvers
    /// (branch admin, then organization admin, then system admins); pick_auto activates immediately.
    /// </summary>
    public async Task ConfirmEmailAsync(string email, string code, string registrationMode, CancellationToken ct = default)
    {
        var user = await users.FindByEmailAsync(email.Trim().ToLowerInvariant()) ?? throw new AuthError("codeWrong");
        await ConsumeCodeAsync(user.Id, "signup", code, ct);
        user.EmailConfirmed = true;
        await users.UpdateAsync(user);

        var profile = await db.Profiles.FirstAsync(p => p.Id == user.Id, ct);
        if (profile.AccountStatus != AccountStatus.PendingVerification) return;
        profile.AccountStatus = registrationMode == "pick_auto" ? AccountStatus.Active : AccountStatus.PendingApproval;
        profile.UpdatedAt = clock.UtcNow;
        if (profile.AccountStatus == AccountStatus.PendingApproval)
        {
            await notifications.NotifyAsync(profile.Id, NotificationEvent.AccountPending, null, new { name = profile.FullName }, profile.Id.ToString(), ct);
            foreach (var approver in await ApproversAsync(profile, ct))
                await notifications.NotifyAsync(approver, NotificationEvent.ApprovalRequested, null,
                    new { name = profile.FullName, email = profile.Email }, profile.Id.ToString(), ct);
        }
        await db.SaveChangesAsync(ct);
    }

    /// <summary>account_approvers(): branch admins, else organization admins (up the tree), else system admins.</summary>
    public async Task<List<Guid>> ApproversAsync(Profile p, CancellationToken ct)
    {
        async Task<List<Guid>> WithPermission(IQueryable<Guid> candidates) =>
            await (from id in candidates
                   join pr in db.Profiles on id equals pr.Id
                   where pr.AccountStatus == AccountStatus.Active
                         && db.AccountTypePermissions.Any(ap => ap.AccountTypeId == pr.AccountTypeId && ap.Permission == Permission.ApproveCustomers)
                   select id).Distinct().ToListAsync(ct);

        if (p.BranchId is Guid b)
        {
            var branchAdmins = await WithPermission(db.AdminScopes.Where(s => s.BranchId == b).Select(s => s.UserId));
            if (branchAdmins.Count > 0) return branchAdmins;
        }
        var org = p.OrganizationId;
        var guard = 0;
        while (org is Guid o && guard++ < 20)
        {
            var orgAdmins = await WithPermission(db.AdminScopes.Where(s => s.OrganizationId == o && s.BranchId == null).Select(s => s.UserId));
            if (orgAdmins.Count > 0) return orgAdmins;
            org = await db.Organizations.Where(x => x.Id == o).Select(x => x.ParentId).FirstOrDefaultAsync(ct);
        }
        return await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id
                      join pr in db.Profiles on ur.UserId equals pr.Id
                      where r.Code == RoleCode.Admin && pr.AccountStatus == AccountStatus.Active select ur.UserId).ToListAsync(ct);
    }

    /// <summary>my_password_status().expired: expiry switched on and the password is older than the allowed days.</summary>
    private async Task<bool> PasswordExpiredAsync(Guid userId, CancellationToken ct)
    {
        var policy = await settings.GetPasswordPolicyAsync(ct);
        if (!policy.ExpiryEnabled) return false;
        var changed = await db.Profiles.Where(p => p.Id == userId).Select(p => (DateTimeOffset?)p.PasswordChangedAt).FirstOrDefaultAsync(ct);
        return changed is DateTimeOffset at && clock.UtcNow >= at.AddDays(policy.ExpiryDays);
    }

    // ------------------------------------------------------------------ password reset by code

    public async Task ForgotPasswordAsync(string email, CancellationToken ct = default)
    {
        var user = await users.FindByEmailAsync(email.Trim().ToLowerInvariant());
        if (user is null) return;   // same answer either way
        var lastMinute = clock.UtcNow.AddSeconds(-60);
        if (await db.AuthCodes.AnyAsync(c => c.UserId == user.Id && c.Purpose == "recovery" && c.CreatedAt > lastMinute, ct))
            throw new AuthError("rateLimited", 429);
        await SendCodeAsync(user, "recovery", "auth_recovery", ct);
    }

    public async Task ResetPasswordAsync(string email, string code, string newPassword, CancellationToken ct = default)
    {
        var user = await users.FindByEmailAsync(email.Trim().ToLowerInvariant()) ?? throw new AuthError("codeWrong");
        await ConsumeCodeAsync(user.Id, "recovery", code, ct);
        if (await users.CheckPasswordAsync(user, newPassword)) throw new AuthError("passwordSame", 400, "password");
        var token = await users.GeneratePasswordResetTokenAsync(user);
        var res = await users.ResetPasswordAsync(user, token, newPassword);
        if (!res.Succeeded) throw new AuthError("passwordWeak", 400, "password");
        if (!user.EmailConfirmed) { user.EmailConfirmed = true; await users.UpdateAsync(user); }   // the code proved the mailbox
        await PasswordChangedAsync(user.Id, ct);
    }

    public async Task ChangePasswordAsync(Guid userId, string current, string next, CancellationToken ct = default)
    {
        var user = await users.FindByIdAsync(userId.ToString()) ?? throw new AuthError("notSignedIn", 401);
        if (!await users.CheckPasswordAsync(user, current)) throw new AuthError("currentWrong", 400, "currentPassword");
        if (current == next) throw new AuthError("passwordSame", 400, "password");
        var res = await users.ChangePasswordAsync(user, current, next);
        if (!res.Succeeded) throw new AuthError("passwordWeak", 400, "password");
        await PasswordChangedAsync(user.Id, ct);
    }

    /// <summary>trg_password_changed: restart the expiry clock and end other sessions.</summary>
    private async Task PasswordChangedAsync(Guid userId, CancellationToken ct)
    {
        var p = await db.Profiles.FirstAsync(x => x.Id == userId, ct);
        p.PasswordChangedAt = clock.UtcNow;
        p.PasswordWarnStage = 0;
        p.UpdatedAt = clock.UtcNow;
        audit.Write("auth.password_changed", "user", userId, null, null, userId);
        await db.SaveChangesAsync(ct);
        await tokens.RevokeAllAsync(userId, ct);
    }

    // ------------------------------------------------------------------ authenticator (TOTP)

    public async Task<(string Secret, string OtpAuthUri)> BeginMfaEnrollmentAsync(Guid userId, string issuer)
    {
        var user = await users.FindByIdAsync(userId.ToString()) ?? throw new AuthError("notSignedIn", 401);
        await users.ResetAuthenticatorKeyAsync(user);
        var key = await users.GetAuthenticatorKeyAsync(user) ?? throw new AuthError("generic");
        var uri = $"otpauth://totp/{Uri.EscapeDataString(issuer)}:{Uri.EscapeDataString(user.Email!)}?secret={key}&issuer={Uri.EscapeDataString(issuer)}&digits=6";
        return (key, uri);
    }

    public async Task CompleteMfaEnrollmentAsync(Guid userId, string code, CancellationToken ct = default)
    {
        var user = await users.FindByIdAsync(userId.ToString()) ?? throw new AuthError("notSignedIn", 401);
        if (!await users.VerifyTwoFactorTokenAsync(user, TokenOptions.DefaultAuthenticatorProvider, Clean(code))) throw new AuthError("mfaWrong");
        await users.SetTwoFactorEnabledAsync(user, true);
        audit.Write("auth.mfa_enrolled", "user", userId, null, null, userId);
        await db.SaveChangesAsync(ct);
        await tokens.RevokeAllAsync(userId, ct);   // existing aal1 sessions must step up
    }

    /// <summary>admin_reset_mfa(): an administrator removes a person's factor.</summary>
    /// <param name="self">The person turning it off themselves (v1 disableMfaAction) stays signed in; an administrator's reset signs them out everywhere.</param>
    public async Task ResetMfaAsync(Guid userId, CancellationToken ct = default, bool self = false)
    {
        var user = await users.FindByIdAsync(userId.ToString()) ?? throw new NotFoundException();
        await users.SetTwoFactorEnabledAsync(user, false);
        await users.ResetAuthenticatorKeyAsync(user);
        audit.Write(self ? "auth.mfa_disabled" : "user.mfa_reset", "user", userId, null, null);
        await db.SaveChangesAsync(ct);
        if (!self) await tokens.RevokeAllAsync(userId, ct);
    }

    // ------------------------------------------------------------------ helpers

    public async Task<AppUser?> FindByIdentifierAsync(string identifier, CancellationToken ct)
    {
        identifier = identifier.Trim();
        if (EgyptPhone.LooksLikePhone(identifier))
        {
            var phone = EgyptPhone.Normalize(identifier);
            var email = await db.Profiles.Where(p => p.Phone == phone).Select(p => p.Email).FirstOrDefaultAsync(ct);
            return email is null ? null : await users.FindByEmailAsync(email);
        }
        return await users.FindByEmailAsync(identifier.ToLowerInvariant());
    }

    public async Task<List<string>> RolesAsync(Guid userId, CancellationToken ct) =>
        await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id where ur.UserId == userId select r.Code).ToListAsync(ct);

    private static void EnsureActive(Profile p)
    {
        if (p.AccountStatus == AccountStatus.Active) return;
        throw p.AccountStatus switch
        {
            AccountStatus.PendingApproval => new AuthError("pendingApproval", 403),
            AccountStatus.PendingVerification => new AuthError("emailNotConfirmed", 403),
            _ => new AuthError("suspended", 403),
        };
    }

    private async Task SendCodeAsync(AppUser user, string purpose, string template, CancellationToken ct)
    {
        var code = NewCode(ResetCodeLength);
        db.AuthCodes.Add(new AuthCode
        {
            Id = Guid.NewGuid(), UserId = user.Id, Purpose = purpose, CodeHash = HashCode(user.Id.ToString(), code),
            ExpiresAt = clock.UtcNow.AddMinutes(ResetCodeMinutes), CreatedAt = clock.UtcNow,
        });
        await db.SaveChangesAsync(ct);
        var profile = await db.Profiles.AsNoTracking().FirstAsync(p => p.Id == user.Id, ct);
        await SendAccountEmailAsync(template, profile, code, ResetCodeMinutes, ct);
    }

    private async Task ConsumeCodeAsync(Guid userId, string purpose, string code, CancellationToken ct)
    {
        var now = clock.UtcNow;
        var row = await db.AuthCodes.Where(c => c.UserId == userId && c.Purpose == purpose && c.ConsumedAt == null && c.ExpiresAt > now)
            .OrderByDescending(c => c.CreatedAt).FirstOrDefaultAsync(ct) ?? throw new AuthError("codeWrong");
        if (row.Attempts >= ResetCodeAttempts) throw new AuthError("codeWrong");
        row.Attempts++;
        if (!FixedEquals(row.CodeHash, HashCode(userId.ToString(), Clean(code)))) { await db.SaveChangesAsync(ct); throw new AuthError("codeWrong"); }
        row.ConsumedAt = now;
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Account emails (auth_*) are sent by the API directly, not queued (spec 6).</summary>
    private async Task SendAccountEmailAsync(string template, Profile p, string? code, int minutes, CancellationToken ct)
    {
        var values = new Dictionary<string, string> { ["name"] = p.FullName, ["email"] = p.Email, ["minutes"] = minutes.ToString() };
        if (code is not null) values["code"] = code;
        var email = await mailer.BuildAsync(template, p.PreferredLocale, values, null, code, ct);
        if (email is null) return;
        try { await sender.SendAsync(new OutgoingEmail(p.Email, email.Subject, email.Html, email.Text), ct); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Account email {Template} to {UserId} failed", template, p.Id);
            throw new AuthError("emailFailed", 503);
        }
    }

    private static string NewCode(int length)
    {
        var sb = new StringBuilder(length);
        for (var i = 0; i < length; i++) sb.Append(RandomNumberGenerator.GetInt32(0, 10));
        return sb.ToString();
    }

    private static string HashCode(string salt, string code) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{salt}:{code}")));

    private static bool FixedEquals(string a, string b) =>
        CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(a), Encoding.ASCII.GetBytes(b));

    private static string Clean(string code) => new(code.Where(char.IsDigit).ToArray());
}
