using System.Text.Json;
using Ccs.Application.Abstractions;
using Ccs.Domain.Entities;
using Ccs.Infrastructure.Persistence;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MimeKit;

namespace Ccs.Infrastructure.Email;

public sealed class AppUrlOptions
{
    public const string Section = "App";
    /// <summary>Public address of the Angular site, e.g. https://ccs.example.com (links in emails).</summary>
    public string PublicUrl { get; set; } = "https://localhost:4200";
}

/// <summary>SMTP through MailKit, using the settings edited in Admin, Settings, Email (password kept with Data Protection).</summary>
public sealed class SmtpEmailSender(CcsDbContext db, IDataProtectionProvider dp, ILogger<SmtpEmailSender> log) : IEmailSender
{
    public const string ProtectorPurpose = "ccs.smtp.password";

    public async Task SendAsync(OutgoingEmail email, CancellationToken ct = default)
    {
        var s = await db.EmailSettings.AsNoTracking().FirstOrDefaultAsync(ct)
                ?? throw new InvalidOperationException("Email settings are missing.");
        if (!s.UseSmtp || string.IsNullOrWhiteSpace(s.Host)) throw new InvalidOperationException("SMTP is not configured.");

        var msg = new MimeMessage();
        msg.From.Add(new MailboxAddress(s.FromName, s.FromEmail));
        msg.To.Add(MailboxAddress.Parse(email.To));
        if (!string.IsNullOrWhiteSpace(s.ReplyTo)) msg.ReplyTo.Add(MailboxAddress.Parse(s.ReplyTo));
        msg.Subject = email.Subject;
        msg.Body = new BodyBuilder { HtmlBody = email.Html, TextBody = email.Text }.ToMessageBody();   // HTML and plain text together

        using var client = new SmtpClient();
        var security = s.Security switch { "ssl" => SecureSocketOptions.SslOnConnect, "none" => SecureSocketOptions.None, _ => SecureSocketOptions.StartTls };
        await client.ConnectAsync(s.Host, s.Port, security, ct);
        if (!string.IsNullOrEmpty(s.Username) && s.PasswordEnc is not null)
            await client.AuthenticateAsync(s.Username, dp.CreateProtector(ProtectorPurpose).Unprotect(s.PasswordEnc), ct);
        await client.SendAsync(msg, ct);
        await client.DisconnectAsync(true, ct);
        log.LogInformation("Email sent to {To}: {Subject}", email.To, email.Subject);
    }
}

/// <summary>Builds emails from the editable templates (one per event and language) and the shared design.</summary>
public sealed class TemplateMailer(CcsDbContext db, IOptions<AppUrlOptions> urls)
{
    public async Task<RenderedEmail?> BuildAsync(string evt, string locale, Dictionary<string, string> values,
        string? defaultLink, string? code = null, CancellationToken ct = default)
    {
        var tpl = await db.EmailTemplates.AsNoTracking().FirstOrDefaultAsync(t => t.Event == evt && t.Locale == locale, ct)
                  ?? await db.EmailTemplates.AsNoTracking().FirstOrDefaultAsync(t => t.Event == evt && t.Locale == "en", ct);
        var site = await db.SiteSettings.AsNoTracking().FirstOrDefaultAsync(ct) ?? new SiteSettings();
        var settings = await db.EmailSettings.AsNoTracking().FirstOrDefaultAsync(ct) ?? new EmailSettings();
        var siteName = locale == "ar" ? site.SiteNameAr : site.SiteNameEn;
        values.TryAdd("siteName", siteName);

        var subject = tpl?.Subject is { Length: > 0 } sj ? sj : Fallback.Subject(evt);
        var body = tpl?.Body is { Length: > 0 } b ? b : Fallback.Body(evt);
        if (string.IsNullOrWhiteSpace(subject)) return null;

        // A custom button link per ticket event; empty means the automatic link (spec 6). Account emails keep theirs.
        var link = !evt.StartsWith("auth_") && !string.IsNullOrWhiteSpace(tpl?.Link) ? EmailRenderer.Fill(tpl!.Link, values) : defaultLink;
        if (link is not null && link.StartsWith('/')) link = urls.Value.PublicUrl.TrimEnd('/') + link;

        var design = EmailDesign.FromJson(settings.Design);
        return EmailRenderer.Render(subject, body, tpl?.Button is { Length: > 0 } bt ? bt : (link is null ? null : Fallback.Button(locale)),
            link, values, design, siteName, locale, locale == "ar" ? site.FooterTextAr : site.FooterTextEn, code);
    }

    private static class Fallback
    {
        public static string Subject(string evt) => evt switch
        {
            "auth_signup" => "Confirm your email for {siteName}",
            "auth_recovery" => "Your {siteName} password reset code",
            "auth_signin_code" => "Your {siteName} sign-in code",
            "auth_signin_code_blocked" => "Sign-in code requests paused",
            "auth_email_change" => "Confirm your new email address",
            "auth_invite" => "You are invited to {siteName}",
            "auth_reauth" => "Confirm it is you",
            _ => "{reference}: {subject}",
        };
        public static string Body(string evt) => evt switch
        {
            "auth_signup" => "Hello {name},\n\nUse this code to confirm your email. It expires in {minutes} minutes.",
            "auth_recovery" => "Hello {name},\n\nUse this code to reset your password. It expires in {minutes} minutes.",
            "auth_signin_code" => "Hello {name},\n\nUse this code to sign in. It expires in {minutes} minutes.",
            _ => "Hello {name},\n\nThere is an update on ticket **{reference}**: {subject}.",
        };
        public static string Button(string locale) => locale == "ar" ? "عرض" : "View";
    }
}

/// <summary>
/// Sends queued email notifications (claim_pending_emails / finish_email / dispatch_email_job).
/// Claims a batch with a lease so two workers never send the same row; records attempts and errors; retries.
/// </summary>
public sealed class EmailDispatcher(CcsDbContext db, TemplateMailer mailer, IEmailSender sender, IClock clock,
    ILogger<EmailDispatcher> log)
{
    public const int MaxAttempts = 5;

    public async Task<int> RunAsync(int batch = 50, CancellationToken ct = default)
    {
        var enabled = await db.AppSettings.Where(s => s.Key == "email_enabled").Select(s => s.Value).FirstOrDefaultAsync(ct);
        if (enabled == "false") return 0;
        var useSmtp = await db.EmailSettings.Select(s => s.UseSmtp).FirstOrDefaultAsync(ct);
        if (!useSmtp) return 0;

        var now = clock.UtcNow;
        var lease = now.AddMinutes(5);
        // Claim: READPAST skips rows another worker holds; the lease survives a crash.
        var ids = await db.Database.SqlQuery<Guid>($"""
            WITH claim AS (
                SELECT TOP ({batch}) id, locked_until, attempts
                  FROM ccs.notifications WITH (ROWLOCK, UPDLOCK, READPAST)
                 WHERE channel = N'email' AND status = N'pending' AND attempts < {MaxAttempts}
                   AND (locked_until IS NULL OR locked_until < {now})
                 ORDER BY created_at)
            UPDATE claim SET locked_until = {lease}, attempts = attempts + 1
            OUTPUT inserted.id AS [Value];
            """).ToListAsync(ct);
        if (ids.Count == 0) return 0;

        var rows = await db.Notifications.Where(n => ids.Contains(n.Id)).ToListAsync(ct);
        var sent = 0;
        foreach (var n in rows)
        {
            try
            {
                var p = await db.Profiles.AsNoTracking().FirstAsync(x => x.Id == n.UserId, ct);
                var values = PayloadValues(n.Payload);
                values["name"] = p.FullName;
                var link = n.TicketId is Guid tid ? $"/{p.PreferredLocale}/tickets/{tid}" : $"/{p.PreferredLocale}/notifications";
                var email = await mailer.BuildAsync(n.EventType, p.PreferredLocale, values, link, ct: ct);
                if (email is null) { n.Status = "failed"; n.LastError = "no template"; continue; }
                await sender.SendAsync(new OutgoingEmail(p.Email, email.Subject, email.Html, email.Text), ct);
                n.Status = "sent";
                n.SentAt = clock.UtcNow;
                n.LastError = null;
                sent++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Email notification {Id} failed (attempt {Attempt})", n.Id, n.Attempts);
                n.LastError = ex.Message.Length > 2000 ? ex.Message[..2000] : ex.Message;
                if (n.Attempts >= MaxAttempts) n.Status = "failed";
            }
            n.LockedUntil = null;
        }
        await db.SaveChangesAsync(ct);
        return sent;
    }

    private static Dictionary<string, string> PayloadValues(string json)
    {
        var d = new Dictionary<string, string>();
        try
        {
            using var doc = JsonDocument.Parse(json);
            foreach (var p in doc.RootElement.EnumerateObject())
                d[p.Name] = p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString()! : p.Value.GetRawText();
        }
        catch (JsonException) { }
        return d;
    }
}
