using System.Security.Cryptography;
using Ccs.Api.Controllers;
using Ccs.Infrastructure.Email;
using Ccs.Infrastructure.Persistence;
using Ccs.Infrastructure.Security;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api;

/// <summary>
/// One-time move to the SQL Server key ring: the SMTP password and captcha secret saved by an older release are
/// opened with the old key folder (C:\CcsData\keys) and saved again with the new keys. Runs at start-up, does
/// nothing when every secret already opens. Never blocks the start: a secret that cannot be moved shows the
/// usual "enter it again" warning in Settings.
/// </summary>
public static class KeyRingMigration
{
    private static readonly (string Name, string Purpose)[] Secrets =
        [("smtp password", SmtpEmailSender.ProtectorPurpose), ("captcha secret", CaptchaVerifier.ProtectorPurpose)];

    public static async Task RunAsync(IServiceProvider services, IConfiguration config, ILogger log)
    {
        try
        {
            await using var scope = services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<CcsDbContext>();
            var current = scope.ServiceProvider.GetRequiredService<IDataProtectionProvider>();
            var email = await db.EmailSettings.FirstOrDefaultAsync();
            var captcha = await db.CaptchaSettings.FirstOrDefaultAsync();
            var values = new[] { email?.PasswordEnc, captcha?.SecretEnc };

            var unreadable = Enumerable.Range(0, Secrets.Length).Where(i => values[i] is not null && !Opens(current, Secrets[i].Purpose, values[i]!)).ToList();
            if (unreadable.Count == 0) return;

            var folder = KeyRing.LegacyFolder(config);
            if (folder is null)
            {
                log.LogWarning("Key ring: {Secrets} cannot be opened and no old key folder was found; enter them again in Settings.",
                    string.Join(", ", unreadable.Select(i => Secrets[i].Name)));
                return;
            }

            var legacy = DataProtectionProvider.Create(new DirectoryInfo(folder), b => b.SetApplicationName(KeyRing.ApplicationName));
            var moved = new List<string>();
            foreach (var i in unreadable)
            {
                string plain;
                try { plain = legacy.CreateProtector(Secrets[i].Purpose).Unprotect(values[i]!); }
                catch (CryptographicException) { log.LogWarning("Key ring: the {Secret} cannot be opened with the old keys either; enter it again in Settings.", Secrets[i].Name); continue; }
                var again = current.CreateProtector(Secrets[i].Purpose).Protect(plain);
                if (i == 0 && email is not null) email.PasswordEnc = again;
                if (i == 1 && captcha is not null) captcha.SecretEnc = again;
                moved.Add(Secrets[i].Name);
            }
            if (moved.Count > 0)
            {
                await db.SaveChangesAsync();
                log.LogInformation("Key ring: moved the {Secrets} from {Folder} to the SQL Server key ring. The old folder is no longer needed.",
                    string.Join(" and ", moved), folder);
            }
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Key ring: the one-time move of saved secrets failed; the app runs on, enter the secrets again in Settings if needed.");
        }
    }

    private static bool Opens(IDataProtectionProvider p, string purpose, string value)
    {
        try { p.CreateProtector(purpose).Unprotect(value); return true; }
        catch (CryptographicException) { return false; }
    }
}
