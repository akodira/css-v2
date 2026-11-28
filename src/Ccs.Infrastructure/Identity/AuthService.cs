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
public sealed class AuthError(string code, int status = 400, string? field = null, IReadOnlyDictionary<string, object?>? extra = null) : AppException(code, status, code)
{
    public string? Field { get; } = field;
    /// <summary>Extra values for the message, e.g. attempts left or "locked until" (never anything secret).</summary>
    public IReadOnlyDictionary<string, object?>? Extra { get; } = extra;

    /// <summary>Wrong email/phone or password, with the attempts left when 2 or fewer remain.</summary>
    public static AuthError Invalid(LockState s, string code = "invalidCredentials", int status = 401) =>
        new(code, status, null, s.Remaining is int r ? new Dictionary<string, object?> { ["remaining"] = r, ["autoUnlock"] = s.AutoUnlock } : null);

    /// <summary>Temporarily locked (until a time) or locked until an admin unlocks it.</summary>
    public static AuthError Locked(LockState s) =>
        new("accountLocked", 423, null, new Dictionary<string, object?> { ["until"] = s.Until, ["autoUnlock"] = s.Until is not null });
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
    Ccs.Application.Settings.SettingsService settings, AccountApprovers approvers, LockoutService lockout, AccountSecurity security)
{
    private const int ResetCodeLength = 6, ResetCodeMinutes = 60, ResetCodeAttempts = 5;
    /// <summary>Security audit M-02: at most this many recovery codes per account per 24 hours, and password reset
    /// stops for 24 hours after this many wrong codes, so a 6-digit code cannot be guessed over days.</summary>
    public const int RecoveryCodesPerDay = 5, RecoveryFailuresPerDay = 10;

    // ------------------------------------------------------------------ password sign-in

    /// <param name="identifier">Email, or an Egyptian mobile number (+2 optional), looked up to the account email.</param>
    public async Task<SignInResult> SignInAsync(string identifier, string password, string? userAgent, string? ip, CancellationToken ct = default)
    {
        var user = await FindByIdentifierAsync(identifier, ct);
        if (user is null)
        {
            // No such account: counted in memory with the same rule, so the answers are the same as for a real one.
            // Recorded for the security report without the full address (and never the password).
            audit.Write("auth.login_failed", "user", null, null, new { method = "password", unknown = MaskIdentifier(identifier) }, null);
            await db.SaveChangesAsync(ct);
            var ghost = await lockout.GhostStateAsync(identifier, ct);
            if (ghost.Locked) throw AuthError.Locked(ghost);
            var g = await lockout.GhostFailAsync(identifier, ct);
            throw g.Locked ? AuthError.Locked(g) : AuthError.Invalid(g);
        }
        // A locked account is refused before the password is checked, so a locked account cannot be used to test passwords.
        var state = await lockout.StateAsync(user.Id, ct);
        if (state.Locked) throw AuthError.Locked(state);
        if (!await users.CheckPasswordAsync(user, password))   // re-hashes migrated bcrypt passwords on success
        {
            var s = await lockout.FailAsync(user.Id, "password", ip, ct);
            throw s.Locked ? AuthError.Locked(s) : AuthError.Invalid(s);
        }
        await lockout.ResetAsync(user.Id, ct);
        if (!user.EmailConfirmed) throw new AuthError("emailNotConfirmed", 403);
        if (await PasswordExpiredAsync(user.Id, ct))
        {
            // Same as v1: an expired password cannot sign in; a one-time code is emailed and the renewal step opens.
            var lastMinute = clock.UtcNow.AddSeconds(-60);
            if (!await db.AuthCodes.AnyAsync(c => c.UserId == user.Id && c.Purpose == "recovery" && c.CreatedAt > lastMinute, ct)
                && await RecoveryCodesTodayAsync(user.Id, ct) < RecoveryCodesPerDay)
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
        var pair = await tokens.IssueAsync(user.Id, user.Email!, roles, 1, userAgent, ip, ct, maxSession: await security.MaxSessionAsync(roles, ct));
        audit.Write("auth.sign_in", "user", user.Id, null, new { method = "password" }, user.Id);
        await db.SaveChangesAsync(ct);
        await security.AfterSignInAsync(user.Id, roles, userAgent, ip, pair.SessionId, ct);
        return new SignInResult(pair, false, null, roles, profile.PreferredLocale);
    }

    /// <summary>TOTP second step. Once enrolled it is enforced on every request (aal claim checked by middleware).</summary>
    public async Task<SignInResult> VerifyMfaAsync(Guid userId, string code, string? userAgent, string? ip, CancellationToken ct = default)
    {
        var user = await users.FindByIdAsync(userId.ToString()) ?? throw new AuthError("notSignedIn", 401);
        // L-02: the lockout that wrong passwords trigger also stops code guessing at this step.
        var state = await lockout.StateAsync(user.Id, ct);
        if (state.Locked) throw AuthError.Locked(state);
        var ok = await users.VerifyTwoFactorTokenAsync(user, TokenOptions.DefaultAuthenticatorProvider, Clean(code));
        if (!ok)
        {
            var s = await lockout.FailAsync(user.Id, "two_step", null, ct);
            throw s.Locked ? AuthError.Locked(s) : AuthError.Invalid(s, "mfaWrong", 400);
        }
        await lockout.ResetAsync(user.Id, ct);
        var profile = await db.Profiles.AsNoTracking().FirstAsync(p => p.Id == user.Id, ct);
        EnsureActive(profile);
        var roles = await RolesAsync(user.Id, ct);
        var pair = await tokens.IssueAsync(user.Id, user.Email!, roles, 2, userAgent, ip, ct, maxSession: await security.MaxSessionAsync(roles, ct));
        audit.Write("auth.sign_in", "user", user.Id, null, new { method = "password+totp" }, user.Id);
        await db.SaveChangesAsync(ct);
        await security.AfterSignInAsync(user.Id, roles, userAgent, ip, pair.SessionId, ct);
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
        // Same sign-in continues (same session); it cannot outlive the longest sign-in time.
        var pair = await tokens.IssueAsync(user.Id, user.Email!, roles, level, userAgent, ip, ct, used.Old, await security.MaxSessionAsync(roles, ct));
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
        // No code for a locked account; the answer on screen stays the same (the sign-in page explains the lock).
        if ((await lockout.StateAsync(user.Id, ct)).Locked) return;
        var profile = await db.Profiles.AsNoTracking().FirstAsync(p => p.Id == user.Id, ct);
        var roles = await RolesAsync(user.Id, ct);
        var group = roles.Contains(RoleCode.Admin) ? "admins" : roles.Any(r => r != RoleCode.Customer) ? "staff" : "customers";

        // Instead of a code, an account that may not use one gets an email saying why (Settings → Sign-in codes).
        // The reply on screen stays the same, so the form still cannot be used to discover accounts.
        var refusal = (group switch { "admins" => s.ForAdmins, "staff" => s.ForStaff, _ => s.ForCustomers }) ? null
            : "auth_signin_code_not_allowed";
        var needs2fa = group switch { "admins" => s.AdminsNeedTwoFactor, "staff" => s.StaffNeedTwoFactor, _ => s.CustomersNeedTwoFactor };
        if (refusal is null && needs2fa && !user.TwoFactorEnabled) refusal = "auth_signin_code_blocked";
        if (recent.Count >= s.DailyLimit) refusal = "auth_signin_code_limit";

        if (refusal is not null)
        {
            // Recorded like a code so the wait and the daily limit also apply to these emails; one limit email a day.
            db.SigninCodes.Add(new SigninCode { Id = Guid.NewGuid(), Email = email, CodeHash = "blocked", ExpiresAt = now, ConsumedAt = now, CreatedAt = now });
            await db.SaveChangesAsync(ct);
            if (refusal != "auth_signin_code_limit" || recent.Count == s.DailyLimit)
                await SendAccountEmailAsync(refusal, profile, null, s.ValidMinutes, ct);
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
        // A locked account cannot get in with a code either (Settings → Security → Account lockout).
        var state = await lockout.StateAsync(user.Id, ct);
        if (state.Locked) throw AuthError.Locked(state);
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
            phone = (await settings.GetPhoneFormatAsync(ct)).Normalize(r.Phone) ?? throw new AuthError("phoneInvalid", 400, "phone");
        if (await users.FindByEmailAsync(email) is { } existing)
        {
            // Registered before and never confirmed: point to a new code. The first request is kept as it is
            // (replacing its password would let someone else set the password of an address they do not own).
            var waiting = await db.Profiles.AnyAsync(p => p.Id == existing.Id && p.AccountStatus == AccountStatus.PendingVerification, ct);
            throw new AuthError(waiting ? "emailPending" : "emailTaken", 400, "email");
        }
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
    /// (branch admin, else organization admin up the tree, else system admins); pick_auto activates immediately.
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
        profile.EmailVerifiedAt = profile.UpdatedAt;
        if (profile.AccountStatus == AccountStatus.PendingApproval)
        {
            await notifications.NotifyAsync(profile.Id, NotificationEvent.AccountPending, null, new { name = profile.FullName }, profile.Id.ToString(), ct);
            foreach (var approver in await ApproversAsync(profile, ct))
                await notifications.NotifyAsync(approver, NotificationEvent.ApprovalRequested, null,
                    ApprovalPayload(profile), profile.Id.ToString(), ct);
        }
        await db.SaveChangesAsync(ct);
    }

    /// <summary>What the approvers' emails show: who is waiting, and the Account requests page as the button.</summary>
    public static Dictionary<string, object?> ApprovalPayload(Profile p, int? days = null)
    {
        var d = new Dictionary<string, object?> { ["customer"] = p.FullName, ["customerEmail"] = p.Email, ["path"] = "/admin/approvals" };
        if (days is int n) d["days"] = n;
        return d;
    }

    /// <summary>
    /// A new sign-up code for an account still waiting for email confirmation. Same answer for any other email,
    /// once a minute and a few times a day at most.
    /// </summary>
    public async Task ResendSignupCodeAsync(string email, CancellationToken ct = default)
    {
        var user = await users.FindByEmailAsync(email.Trim().ToLowerInvariant());
        if (user is null) return;
        if (!await db.Profiles.AnyAsync(p => p.Id == user.Id && p.AccountStatus == AccountStatus.PendingVerification, ct)) return;
        var now = clock.UtcNow;
        var lastMinute = now.AddSeconds(-60);
        if (await db.AuthCodes.AnyAsync(c => c.UserId == user.Id && c.Purpose == "signup" && c.CreatedAt > lastMinute, ct))
            throw new AuthError("rateLimited", 429);
        var dayAgo = now.AddDays(-1);
        if (await db.AuthCodes.CountAsync(c => c.UserId == user.Id && c.Purpose == "signup" && c.CreatedAt > dayAgo, ct) >= RecoveryCodesPerDay)
            throw new AuthError("rateLimited", 429);
        await SendCodeAsync(user, "signup", "auth_signup", ct);
    }

    /// <summary>account_approvers(): see <see cref="AccountApprovers"/>.</summary>
    public Task<List<Guid>> ApproversAsync(Profile p, CancellationToken ct) => approvers.ForAsync(p.OrganizationId, p.BranchId, ct);

    /// <summary>my_password_status().expired: an admin asked for a new password, or expiry is on and the password is older than the allowed days.</summary>
    private async Task<bool> PasswordExpiredAsync(Guid userId, CancellationToken ct)
    {
        var row = await db.Profiles.Where(p => p.Id == userId).Select(p => new { p.PasswordChangedAt, p.MustChangePassword }).FirstOrDefaultAsync(ct);
        if (row is null) return false;
        if (row.MustChangePassword) return true;
        var policy = await settings.GetPasswordPolicyAsync(ct);
        return policy.ExpiryEnabled && clock.UtcNow >= row.PasswordChangedAt.AddDays(policy.ExpiryDays);
    }

    // ------------------------------------------------------------------ password reset by code

    public async Task ForgotPasswordAsync(string email, CancellationToken ct = default)
    {
        var user = await users.FindByEmailAsync(email.Trim().ToLowerInvariant());
        if (user is null) return;   // same answer either way
        var lastMinute = clock.UtcNow.AddSeconds(-60);
        if (await db.AuthCodes.AnyAsync(c => c.UserId == user.Id && c.Purpose == "recovery" && c.CreatedAt > lastMinute, ct))
            throw new AuthError("rateLimited", 429);
        if (await RecoveryCodesTodayAsync(user.Id, ct) >= RecoveryCodesPerDay) throw new AuthError("rateLimited", 429);
        await SendCodeAsync(user, "recovery", "auth_recovery", ct);
    }

    /// <returns>The lock state after the reset: a new password does not end an active lock (it is reported, not bypassed).</returns>
    public async Task<LockState> ResetPasswordAsync(string email, string code, string newPassword, CancellationToken ct = default)
    {
        var user = await users.FindByEmailAsync(email.Trim().ToLowerInvariant()) ?? throw new AuthError("codeWrong");
        if (await RecoveryFailuresTodayAsync(user.Id, ct) >= RecoveryFailuresPerDay) throw new AuthError("rateLimited", 429);
        await ConsumeCodeAsync(user.Id, "recovery", code, ct);
        if (await users.CheckPasswordAsync(user, newPassword)) throw new AuthError("passwordSame", 400, "password");
        await security.CheckReuseAsync(user, newPassword, users.PasswordHasher, ct);
        var replaced = user.PasswordHash;
        var token = await users.GeneratePasswordResetTokenAsync(user);
        var res = await users.ResetPasswordAsync(user, token, newPassword);
        if (!res.Succeeded) throw new AuthError("passwordWeak", 400, "password");
        await security.RememberAsync(user.Id, replaced, ct);
        if (!user.EmailConfirmed) { user.EmailConfirmed = true; await users.UpdateAsync(user); }   // the code proved the mailbox
        await PasswordChangedAsync(user.Id, ct);
        return await lockout.StateAsync(user.Id, ct);
    }

    public async Task ChangePasswordAsync(Guid userId, string current, string next, CancellationToken ct = default)
    {
        var user = await users.FindByIdAsync(userId.ToString()) ?? throw new AuthError("notSignedIn", 401);
        if (!await users.CheckPasswordAsync(user, current)) throw new AuthError("currentWrong", 400, "currentPassword");
        if (current == next) throw new AuthError("passwordSame", 400, "password");
        await security.CheckReuseAsync(user, next, users.PasswordHasher, ct);
        var replaced = user.PasswordHash;
        var res = await users.ChangePasswordAsync(user, current, next);
        if (!res.Succeeded) throw new AuthError("passwordWeak", 400, "password");
        await security.RememberAsync(user.Id, replaced, ct);
        await PasswordChangedAsync(user.Id, ct);
    }

    /// <summary>trg_password_changed: restart the expiry clock and end other sessions.</summary>
    private async Task PasswordChangedAsync(Guid userId, CancellationToken ct)
    {
        var p = await db.Profiles.FirstAsync(x => x.Id == userId, ct);
        p.PasswordChangedAt = clock.UtcNow;
        p.PasswordWarnStage = 0;
        p.MustChangePassword = false;
        p.UpdatedAt = clock.UtcNow;
        audit.Write("auth.password_changed", "user", userId, null, null, userId);
        await db.SaveChangesAsync(ct);
        await tokens.RevokeAllAsync(userId, ct);
    }

    // ------------------------------------------------------------------ authenticator (TOTP)

    public async Task<(string Secret, string OtpAuthUri)> BeginMfaEnrollmentAsync(Guid userId, string issuer)
    {
        var user = await users.FindByIdAsync(userId.ToString()) ?? throw new AuthError("notSignedIn", 401);
        // M-01: never replace a working authenticator silently. Turn it off first (that needs a code).
        if (user.TwoFactorEnabled) throw new AuthError("mfaAlreadyOn", 409);
        await users.ResetAuthenticatorKeyAsync(user);
        var key = await users.GetAuthenticatorKeyAsync(user) ?? throw new AuthError("generic");
        var uri = $"otpauth://totp/{Uri.EscapeDataString(issuer)}:{Uri.EscapeDataString(user.Email!)}?secret={key}&issuer={Uri.EscapeDataString(issuer)}&digits=6";
        return (key, uri);
    }

    public async Task CompleteMfaEnrollmentAsync(Guid userId, string code, CancellationToken ct = default)
    {
        var user = await users.FindByIdAsync(userId.ToString()) ?? throw new AuthError("notSignedIn", 401);
        if (user.TwoFactorEnabled) throw new AuthError("mfaAlreadyOn", 409);
        if (!await users.VerifyTwoFactorTokenAsync(user, TokenOptions.DefaultAuthenticatorProvider, Clean(code))) throw new AuthError("mfaWrong");
        await users.SetTwoFactorEnabledAsync(user, true);
        audit.Write("auth.mfa_enrolled", "user", userId, null, null, userId);
        await db.SaveChangesAsync(ct);
        await tokens.RevokeAllAsync(userId, ct);   // existing aal1 sessions must step up
    }

    /// <summary>
    /// The person turns their own second factor off (v1 disableMfaAction). Security audit M-01: it needs a current
    /// code from the authenticator, and the account lockout applies, so a stolen session alone cannot remove it.
    /// </summary>
    public async Task DisableOwnMfaAsync(Guid userId, string? code, CancellationToken ct = default)
    {
        var user = await users.FindByIdAsync(userId.ToString()) ?? throw new AuthError("notSignedIn", 401);
        if (!user.TwoFactorEnabled) return;
        var state = await lockout.StateAsync(user.Id, ct);
        if (state.Locked) throw AuthError.Locked(state);
        if (!await users.VerifyTwoFactorTokenAsync(user, TokenOptions.DefaultAuthenticatorProvider, Clean(code ?? "")))
        {
            var s = await lockout.FailAsync(user.Id, "two_step", null, ct);
            if (s.Locked) throw AuthError.Locked(s);
            throw new AuthError("mfaWrong", 400, "code");
        }
        await lockout.ResetAsync(user.Id, ct);
        await ResetMfaAsync(userId, ct, self: true);
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
        if ((await settings.GetPhoneFormatAsync(ct)).Normalize(identifier) is string phone)
        {
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
        // Called only once the person proved the account is theirs (password or code), so the reason may be shown.
        if (p.AccountStatus == AccountStatus.Suspended && p.RejectedAt is not null)
            throw new AuthError("rejected", 403, null, new Dictionary<string, object?> { ["reason"] = p.RejectionReason ?? "" });
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
        // Sign-up: the button opens the confirm screen with the code filled in (after #, so it never reaches the server logs).
        var link = purpose == "signup" ? $"/register/confirm#email={Uri.EscapeDataString(profile.Email)}&code={code}" : null;
        await SendAccountEmailAsync(template, profile, code, ResetCodeMinutes, ct, link);
    }

    private Task<int> RecoveryCodesTodayAsync(Guid userId, CancellationToken ct)
    {
        var dayAgo = clock.UtcNow.AddHours(-24);
        return db.AuthCodes.CountAsync(c => c.UserId == userId && c.Purpose == "recovery" && c.CreatedAt > dayAgo, ct);
    }

    /// <summary>Wrong recovery codes in the last 24 hours, across all codes (every try counts; a used code had one right try).</summary>
    private async Task<int> RecoveryFailuresTodayAsync(Guid userId, CancellationToken ct)
    {
        var dayAgo = clock.UtcNow.AddHours(-24);
        var rows = await db.AuthCodes.Where(c => c.UserId == userId && c.Purpose == "recovery" && c.CreatedAt > dayAgo)
            .Select(c => new { c.Attempts, Used = c.ConsumedAt != null }).ToListAsync(ct);
        return rows.Sum(r => r.Attempts - (r.Used ? 1 : 0));
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
    private async Task SendAccountEmailAsync(string template, Profile p, string? code, int minutes, CancellationToken ct, string? link = null)
    {
        var values = new Dictionary<string, string> { ["name"] = p.FullName, ["email"] = p.Email, ["minutes"] = minutes.ToString() };
        if (code is not null) values["code"] = code;
        var email = await mailer.BuildAsync(template, p.PreferredLocale, values, link, code, ct);
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

    /// <summary>"inf…@example.com" / "+2010…89": enough to group repeated tries in the report, not the whole address.</summary>
    public static string MaskIdentifier(string identifier)
    {
        var v = identifier.Trim().ToLowerInvariant();
        if (v.Length > 120) v = v[..120];
        var at = v.IndexOf('@');
        if (at > 0) return v[..Math.Min(3, at)] + "…" + v[at..];
        return v.Length <= 6 ? "…" : v[..5] + "…" + v[^2..];
    }

    private static string Clean(string code) => new(code.Where(char.IsDigit).ToArray());
}
