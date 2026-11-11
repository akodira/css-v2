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

/// <summary>Text typed in the template editor but not saved yet (preview and "send me a test").</summary>
public sealed record TemplateDraft(string Subject, string Body, string? Button, string? Link, string? Greeting, string? Footer);

/// <summary>v1 built-in wording for every email (embedded copy of v1 Notifications.events, footers and account emails).</summary>
public static class EmailDefaults
{
    public const string Layout = "_layout";
    /** Stored as the shared footer when an administrator clears it on purpose: send no footer at all (v1 NO_FOOTER). */
    public const string NoFooter = "[[none]]";
    private static readonly System.Text.Json.JsonElement Root = Load();
    private static System.Text.Json.JsonElement Load()
    {
        using var s = typeof(EmailDefaults).Assembly.GetManifestResourceStream("Ccs.EmailDefaults.json")!;
        return System.Text.Json.JsonDocument.Parse(s).RootElement.Clone();
    }
    private static string Str(System.Text.Json.JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString()! : "";
    private static System.Text.Json.JsonElement Loc(string locale) => Root.GetProperty(locale == "ar" ? "ar" : "en");

    public static bool IsAuth(string evt) => Root.GetProperty("auth").TryGetProperty(evt, out _);
    public static bool IsAccount(string evt) => Root.GetProperty("accountEvents").EnumerateArray().Any(x => x.GetString() == evt);
    public static IEnumerable<string> TicketEvents => Root.GetProperty("en").GetProperty("events").EnumerateObject().Select(x => x.Name);
    public static IEnumerable<string> AuthEvents => Root.GetProperty("auth").EnumerateObject().Select(x => x.Name);
    public static string Greeting(string locale) => Str(Root.GetProperty("greeting"), locale == "ar" ? "ar" : "en");
    public static string OpenLabel(string locale) => Str(Loc(locale), "emailOpen");

    /// <summary>Built-in subject, body and button for one event (or the shared layout) and language (v1 defaultFor).</summary>
    public static (string Subject, string Body, string Button) For(string evt, string locale)
    {
        var l = locale == "ar" ? "ar" : "en";
        if (Root.GetProperty("auth").TryGetProperty(evt, out var a)) { var x = a.GetProperty(l); return (Str(x, "subject"), Str(x, "body"), Str(x, "button")); }
        var m = Loc(locale);
        if (evt == Layout) return (Greeting(locale), Str(m, "emailFooter"), Str(m, "emailOpen"));
        if (m.GetProperty("events").TryGetProperty(evt, out var e)) return (Str(e, "title"), Str(e, "body"), Str(e, "button"));
        return ("", "", "");
    }

    /// <summary>Built-in footer: none for account-request emails, the account footer for account emails, else the ticket footer.</summary>
    public static string Footer(string evt, string locale) =>
        IsAuth(evt) ? "" : Str(Loc(locale), IsAccount(evt) ? "emailFooterAccount" : "emailFooter");

    public static object Snapshot() => new
    {
        ticketEvents = TicketEvents, authEvents = AuthEvents,
        en = Defaults("en"), ar = Defaults("ar"),
    };
    private static Dictionary<string, object> Defaults(string loc) =>
        TicketEvents.Concat(AuthEvents).Append(Layout).ToDictionary(e => e, e => { var d = For(e, loc); return (object)new { subject = d.Subject, body = d.Body, button = d.Button, footer = e == Layout ? "" : Footer(e, loc) }; });
}

/// <summary>Builds emails the way v1 renderEmail / renderAuthEmail do: greeting, body, button, footer, from saved overrides or the built-in wording.</summary>
public sealed class TemplateMailer(CcsDbContext db, IOptions<AppUrlOptions> urls)
{
    public async Task<RenderedEmail?> BuildAsync(string evt, string locale, Dictionary<string, string> values,
        string? defaultLink, string? code = null, CancellationToken ct = default, TemplateDraft? draft = null)
    {
        locale = locale == "ar" ? "ar" : "en";
        var mine = await db.EmailTemplates.AsNoTracking().FirstOrDefaultAsync(t => t.Event == evt && t.Locale == locale, ct);
        var layout = await db.EmailTemplates.AsNoTracking().FirstOrDefaultAsync(t => t.Event == EmailDefaults.Layout && t.Locale == locale, ct);
        var site = await db.SiteSettings.AsNoTracking().FirstOrDefaultAsync(ct) ?? new SiteSettings();
        var settings = await db.EmailSettings.AsNoTracking().FirstOrDefaultAsync(ct) ?? new EmailSettings();
        var siteName = locale == "ar" ? site.SiteNameAr : site.SiteNameEn;
        var siteUrl = urls.Value.PublicUrl.TrimEnd('/');
        values.TryAdd("siteName", siteName);
        values.TryAdd("supportEmail", site.ContactEmail ?? "");
        values.TryAdd("supportPhone", site.ContactPhone ?? "");
        values.TryAdd("supportHours", locale == "ar" ? site.ContactHoursAr : site.ContactHoursEn);
        values.TryAdd("siteUrl", siteUrl);

        var def = EmailDefaults.For(evt, locale);
        string? Pick(string? draftValue, string? saved) => draft is not null ? draftValue : saved;
        var subject = Pick(draft?.Subject, mine?.Subject) is { Length: > 0 } sj ? sj : def.Subject;
        var body = Pick(draft?.Body, mine?.Body) is { Length: > 0 } b ? b : def.Body;
        if (string.IsNullOrWhiteSpace(subject)) return null;
        var greeting = (draft?.Greeting ?? layout?.Subject) is { Length: > 0 } g ? g : EmailDefaults.Greeting(locale);
        var storedFooter = draft?.Footer is not null ? (draft.Footer.Length == 0 ? EmailDefaults.NoFooter : draft.Footer) : layout?.Body;
        var footer = storedFooter == EmailDefaults.NoFooter ? "" : storedFooter is { Length: > 0 } f ? f : EmailDefaults.Footer(evt, locale);
        var label = Pick(draft?.Button, mine?.Button) is { Length: > 0 } bt ? bt : def.Button is { Length: > 0 } db2 ? db2 : layout?.Button is { Length: > 0 } lb ? lb : EmailDefaults.OpenLabel(locale);

        // A custom button link per ticket event; empty means the automatic link. Account-request emails keep theirs.
        var customLink = EmailDefaults.IsAuth(evt) ? null : Pick(draft?.Link, mine?.Link);
        var link = !string.IsNullOrWhiteSpace(customLink) ? EmailRenderer.Fill(customLink!, values) : defaultLink;
        if (link is not null && link.StartsWith('/')) link = siteUrl + (link.StartsWith("/" + locale + "/") || link == "/" + locale ? link : "/" + locale + link);

        var greet = System.Text.RegularExpressions.Regex.Replace(EmailRenderer.Fill(greeting, values), @"\s+([,،])", "$1");
        var design = EmailDesign.FromJson(settings.Design);
        if (design.LogoUrl is { } lu && lu.StartsWith('/')) design = design with { LogoUrl = siteUrl + lu };
        // Account emails: the code shows in the large box when the design asks for it and the text contains it (v1).
        var showBox = code is not null && design.LargeCodeBox && EmailRenderer.Fill(body, values).Contains(code);
        if (showBox) body = System.Text.RegularExpressions.Regex.Replace(EmailRenderer.Fill(body, values).Replace(code!, ""), @"[:：]\s*(\n|$)", "$1");
        return EmailRenderer.Render(subject, greet + "\n\n" + body, link is null ? null : label, link, values, design, siteName, locale,
            footer.Length == 0 ? null : EmailRenderer.Fill(footer, values), showBox ? code : null);
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
                // v1 ticketPath(): customers open their ticket page, staff the console workspace.
                var staff = await db.CcsUserRoles.AnyAsync(ur => ur.UserId == p.Id && db.CcsRoles.Any(r => r.Id == ur.RoleId && r.Code != Ccs.Domain.RoleCode.Customer), ct);
                var path = values.TryGetValue("path", out var pth) && pth.StartsWith('/') ? pth : null;
                var link = n.TicketId is Guid tid ? (staff ? $"/{p.PreferredLocale}/console/tickets/{tid}" : $"/{p.PreferredLocale}/tickets/{tid}") : path is null ? null : $"/{p.PreferredLocale}{path}";
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
