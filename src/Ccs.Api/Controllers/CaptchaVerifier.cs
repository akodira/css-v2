using System.Text.Json;
using Ccs.Infrastructure.Identity;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>
/// Bot check on sign-up, forgot password and sign-in code forms (spec 5). Cloudflare Turnstile today;
/// keys are entered by an admin in Settings. Open decision #3: a self-hosted check can replace it
/// by adding a provider here, nothing else changes.
/// </summary>
public sealed class CaptchaVerifier(CcsDbContext db, IHttpClientFactory http, IDataProtectionProvider dp, IHttpContextAccessor ctx,
    ILogger<CaptchaVerifier> log)
{
    public const string ProtectorPurpose = "ccs.captcha.secret";

    public async Task RequireAsync(string action, string? token, CancellationToken ct)
    {
        var s = await db.CaptchaSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        if (s is null || !s.Enabled || s.SecretEnc is null) return;
        if (string.IsNullOrWhiteSpace(token)) throw new AuthError("captchaFailed");

        if (s.Provider == "turnstile")
        {
            var secret = dp.CreateProtector(ProtectorPurpose).Unprotect(s.SecretEnc);
            var form = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["secret"] = secret, ["response"] = token,
                ["remoteip"] = ctx.HttpContext?.Connection.RemoteIpAddress?.ToString() ?? "",
            });
            try
            {
                var res = await http.CreateClient("captcha").PostAsync("https://challenges.cloudflare.com/turnstile/v0/siteverify", form, ct);
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
                if (doc.RootElement.TryGetProperty("success", out var ok) && ok.GetBoolean()) return;
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
            {
                log.LogWarning(ex, "Captcha check failed to run for {Action}", action);
            }
        }
        throw new AuthError("captchaFailed");
    }
}
