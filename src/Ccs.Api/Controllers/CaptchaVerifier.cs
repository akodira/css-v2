using System.Security.Cryptography;
using System.Text.Json;
using Ccs.Infrastructure.Identity;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>What the sign-up, forgot-password and sign-in-code pages need, and what the admin sees.</summary>
/// <param name="Active">The widget is shown and the server checks the answer.</param>
/// <param name="SiteKey">Public Turnstile site key (null when not active).</param>
/// <param name="Fault">Configuration fault while switched on: "noSiteKey", "noSecret" or "secretUnreadable"; null when fine.</param>
public sealed record CaptchaState(bool Active, string? SiteKey, string? Fault);

/// <summary>
/// Cloudflare Turnstile bot check (v1 lib/auth/captcha.ts). Used on sign-up, forgot password and the sign-in-code
/// request, exactly where v1 shows the widget; password sign-in has none in v1.
/// Safety rule (difference list 6.7): a configuration fault (no site key, no or unreadable secret) never locks people
/// out: the widget is hidden, the check is skipped and the fault is logged and shown to the admin in Settings.
/// A missing or wrong answer, or Cloudflare being unreachable, still blocks (v1: any failure means "not verified").
/// </summary>
public sealed class CaptchaVerifier(CcsDbContext db, IHttpClientFactory http, IDataProtectionProvider dp, IHttpContextAccessor ctx,
    ILogger<CaptchaVerifier> log)
{
    public const string ProtectorPurpose = "ccs.captcha.secret";
    public const string SiteVerifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

    /// <summary>Reads the settings and tries to open the secret. The secret itself never leaves this class.</summary>
    private async Task<(CaptchaState State, string? Secret)> LoadAsync(CancellationToken ct)
    {
        var s = await db.CaptchaSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        if (s is null || !s.Enabled) return (new CaptchaState(false, null, null), null);
        if (string.IsNullOrWhiteSpace(s.SiteKey)) return (new CaptchaState(false, null, "noSiteKey"), null);
        if (string.IsNullOrWhiteSpace(s.SecretEnc)) return (new CaptchaState(false, null, "noSecret"), null);
        try
        {
            var secret = dp.CreateProtector(ProtectorPurpose).Unprotect(s.SecretEnc);
            if (string.IsNullOrWhiteSpace(secret)) return (new CaptchaState(false, null, "noSecret"), null);
            return (new CaptchaState(true, s.SiteKey.Trim(), null), secret);
        }
        catch (CryptographicException)
        {
            // Usually the Data Protection key ring changed (new server, keys folder lost). Re-enter the secret in Settings.
            return (new CaptchaState(false, null, "secretUnreadable"), null);
        }
    }

    public async Task<CaptchaState> StateAsync(CancellationToken ct) => (await LoadAsync(ct)).State;

    /// <summary>True when a secret is saved and this server can open it (whether or not the captcha is on).</summary>
    public async Task<bool> SecretReadableAsync(CancellationToken ct)
    {
        var enc = await db.CaptchaSettings.AsNoTracking().Select(x => x.SecretEnc).FirstOrDefaultAsync(ct);
        if (string.IsNullOrWhiteSpace(enc)) return false;
        try { return !string.IsNullOrEmpty(dp.CreateProtector(ProtectorPurpose).Unprotect(enc)); }
        catch (CryptographicException) { return false; }
    }

    public async Task RequireAsync(string action, string? token, CancellationToken ct)
    {
        var (state, secret) = await LoadAsync(ct);
        if (state.Fault is not null)
        {
            log.LogWarning("Captcha is switched on but not usable ({Fault}); check skipped for {Action}. Fix it in Settings, System rules.", state.Fault, action);
            return;
        }
        if (!state.Active || secret is null) return;
        if (string.IsNullOrWhiteSpace(token) || token.Length > 4096)
        {
            log.LogInformation("Captcha answer missing for {Action}", action);
            throw new AuthError("captchaFailed");
        }

        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["secret"] = secret, ["response"] = token,
            ["remoteip"] = ctx.HttpContext?.Connection.RemoteIpAddress?.ToString() ?? "",
        });
        try
        {
            using var res = await http.CreateClient("captcha").PostAsync(SiteVerifyUrl, form, ct);
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
            var root = doc.RootElement;
            if (root.TryGetProperty("success", out var ok) && ok.ValueKind == JsonValueKind.True) return;
            var codes = root.TryGetProperty("error-codes", out var e) && e.ValueKind == JsonValueKind.Array
                ? string.Join(",", e.EnumerateArray().Select(x => x.GetString())) : "none";
            var host = root.TryGetProperty("hostname", out var h) ? h.GetString() : null;
            // invalid-input-secret / missing-input-secret = wrong secret key; check the hostname list of the Turnstile widget too.
            log.LogWarning("Captcha rejected for {Action}: HTTP {Status}, error codes {Codes}, hostname {Host}", action, (int)res.StatusCode, codes, host);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            log.LogWarning("Captcha check could not reach Cloudflare for {Action}: {Error}", action, ex.Message);
        }
        throw new AuthError("captchaFailed");
    }
}
