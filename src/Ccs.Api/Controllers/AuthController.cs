using System.ComponentModel.DataAnnotations;
using System.IdentityModel.Tokens.Jwt;
using Ccs.Infrastructure.Identity;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using SignInResult = Ccs.Infrastructure.Identity.SignInResult;

namespace Ccs.Api.Controllers;

public sealed record SignInBody([Required] string Identifier, [Required] string Password, string? CaptchaToken);
public sealed record CodeBody([Required] string Code);
public sealed record OptionalCodeBody(string? Code);
public sealed record EmailBody([Required, EmailAddress] string Email, string? CaptchaToken);
public sealed record EmailCodeBody([Required, EmailAddress] string Email, [Required] string Code);
public sealed record ResetBody([Required, EmailAddress] string Email, [Required] string Code, [Required] string Password);
public sealed record ChangePasswordBody([Required] string CurrentPassword, [Required] string Password);
public sealed record RegisterBody([Required, MaxLength(200)] string FullName, [Required, EmailAddress] string Email, string? Phone,
    [Required] string Password, string Locale, Guid? OrganizationId, Guid? BranchId, string? CaptchaToken);

/// <summary>What the Angular app keeps in memory. The refresh token lives only in an HttpOnly cookie.</summary>
public sealed record SessionResponse(string? AccessToken, DateTimeOffset? ExpiresAt, bool MfaRequired, string? MfaToken,
    IReadOnlyList<string> Roles, string Locale);

[ApiController]
[Route("api/auth")]
[EnableRateLimiting("auth")]
public sealed class AuthController(AuthService auth, CcsDbContext db, CaptchaVerifier captcha) : ControllerBase
{
    private const string RefreshCookie = "ccs_rt";

    [HttpPost("sign-in")]
    public async Task<SessionResponse> SignIn(SignInBody body, CancellationToken ct)
    {
        // v1 has no captcha on password sign-in (only sign-up, forgot password and the sign-in-code request).
        return Session(await auth.SignInAsync(body.Identifier, body.Password, UserAgent, Ip, ct));
    }

    /// <summary>Second step: the Authorization header carries the 5-minute MFA token from sign-in.</summary>
    [HttpPost("mfa")]
    [Authorize(Policy = "MfaStep")]
    public async Task<SessionResponse> Mfa(CodeBody body, CancellationToken ct)
    {
        if (User.FindFirst(CcsClaims.Purpose)?.Value != "mfa") return Session(null);
        var uid = Guid.Parse(User.FindFirst(JwtRegisteredClaimNames.Sub)!.Value);
        return Session(await auth.VerifyMfaAsync(uid, body.Code, UserAgent, Ip, ct));
    }

    [HttpPost("refresh")]
    public async Task<SessionResponse> Refresh(CancellationToken ct)
    {
        if (!Request.Cookies.TryGetValue(RefreshCookie, out var raw)) throw new AuthError("notSignedIn", 401);
        return Session(await auth.RefreshAsync(raw, UserAgent, Ip, ct));
    }

    [HttpPost("sign-out")]
    public async Task<IActionResult> Logout([FromServices] TokenService tokens, CancellationToken ct)
    {
        if (Request.Cookies.TryGetValue(RefreshCookie, out var raw)) await tokens.RevokeAsync(raw, ct);
        Response.Cookies.Delete(RefreshCookie, CookieOptions(DateTimeOffset.UnixEpoch));
        return NoContent();
    }

    [HttpPost("signin-code")]
    public async Task<IActionResult> RequestSigninCode(EmailBody body, CancellationToken ct)
    {
        await captcha.RequireAsync("signin_code", body.CaptchaToken, ct);
        await auth.RequestSigninCodeAsync(body.Email, ct);
        return Accepted();
    }

    [HttpPost("signin-code/verify")]
    public async Task<SessionResponse> VerifySigninCode(EmailCodeBody body, CancellationToken ct) =>
        Session(await auth.VerifySigninCodeAsync(body.Email, body.Code, UserAgent, Ip, ct));

    [HttpPost("register")]
    public async Task<IActionResult> Register(RegisterBody body, CancellationToken ct)
    {
        await captcha.RequireAsync("sign_up", body.CaptchaToken, ct);
        var mode = await RegistrationModeAsync(ct);
        await auth.RegisterAsync(new RegisterRequest(body.FullName, body.Email, body.Phone, body.Password, body.Locale,
            body.OrganizationId, body.BranchId), mode, ct);
        return Accepted();
    }

    [HttpPost("confirm-email")]
    public async Task<IActionResult> ConfirmEmail(EmailCodeBody body, CancellationToken ct)
    {
        await auth.ConfirmEmailAsync(body.Email, body.Code, await RegistrationModeAsync(ct), ct);
        return NoContent();
    }

    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword(EmailBody body, CancellationToken ct)
    {
        await captcha.RequireAsync("forgot_password", body.CaptchaToken, ct);
        await auth.ForgotPasswordAsync(body.Email, ct);
        return Accepted();
    }

    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword(ResetBody body, CancellationToken ct)
    {
        await auth.ResetPasswordAsync(body.Email, body.Code, body.Password, ct);
        return NoContent();
    }

    [HttpPost("change-password")]
    [Authorize]
    public async Task<IActionResult> ChangePassword(ChangePasswordBody body, CancellationToken ct)
    {
        await auth.ChangePasswordAsync(Me, body.CurrentPassword, body.Password, ct);
        Response.Cookies.Delete(RefreshCookie, CookieOptions(DateTimeOffset.UnixEpoch));
        return NoContent();
    }

    [HttpPost("mfa/enroll")]
    [Authorize]
    public async Task<object> BeginMfa(CancellationToken ct)
    {
        var site = await db.SiteSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        var (secret, uri) = await auth.BeginMfaEnrollmentAsync(Me, site?.SiteNameEn ?? "CCS");
        return new { secret, otpauthUri = uri };
    }

    /// <summary>
    /// Turning the second factor off needs a current code from it (security audit M-01). When it is already off
    /// there is nothing to protect, so no code (or no body) is needed; a missing code while it is on is a wrong code.
    /// </summary>
    [HttpPost("mfa/disable")]
    [Authorize]
    public async Task<IActionResult> DisableMfa([FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] OptionalCodeBody? body, CancellationToken ct)
    {
        await auth.DisableOwnMfaAsync(Me, body?.Code, ct);
        return NoContent();
    }

    [HttpPost("mfa/enroll/verify")]
    [Authorize]
    public async Task<IActionResult> CompleteMfa(CodeBody body, CancellationToken ct)
    {
        await auth.CompleteMfaEnrollmentAsync(Me, body.Code, ct);
        return NoContent();
    }

    // ------------------------------------------------------------------

    private Guid Me => Guid.Parse(User.FindFirst(JwtRegisteredClaimNames.Sub)!.Value);
    private string? UserAgent => Request.Headers.UserAgent.ToString();
    private string? Ip => HttpContext.Connection.RemoteIpAddress?.ToString();

    private async Task<string> RegistrationModeAsync(CancellationToken ct) =>
        await db.SiteSettings.AsNoTracking().Select(s => s.RegistrationMode).FirstOrDefaultAsync(ct) ?? "approval";

    private SessionResponse Session(SignInResult? r)
    {
        if (r is null) throw new AuthError("notSignedIn", 401);
        if (r.Tokens is not null)
            Response.Cookies.Append(RefreshCookie, r.Tokens.RefreshToken, CookieOptions(r.Tokens.RefreshExpires));
        return new SessionResponse(r.Tokens?.AccessToken, r.Tokens?.AccessExpires, r.MfaRequired, r.MfaToken, r.Roles, r.Locale);
    }

    private static CookieOptions CookieOptions(DateTimeOffset expires) => new()
    {
        HttpOnly = true, Secure = true, SameSite = SameSiteMode.Strict, Path = "/api/auth", Expires = expires, IsEssential = true,
    };
}
