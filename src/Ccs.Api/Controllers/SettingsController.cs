using System.Text.Json;
using System.Text.RegularExpressions;
using Ccs.Application.Access;
using Ccs.Application.Abstractions;
using Ccs.Application.Common;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Email;
using Ccs.Infrastructure.Identity;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>
/// Administration → Settings (batch 4): branding, home page, menus, email (SMTP, design, templates), system messages,
/// uploads, system rules (timers, registration, captcha, password policy), sign-in codes and handover.
/// manage_settings for everything except handover (administrators only). Every change is audited.
/// </summary>
[ApiController]
[Authorize]
[Route("api/admin/settings")]
public sealed partial class SettingsController(
    CcsDbContext db, AccessService access, AuditService audit, IClock clock, IDataProtectionProvider dp,
    IFileStore files, IEmailSender mail, TemplateMailer templates) : ControllerBase
{
    private static AuthError Err(string code, string? field = null, int status = 400) => new(code, status, field);
    private const string SmtpPurpose = SmtpEmailSender.ProtectorPurpose;
    private const string CaptchaPurpose = "ccs.captcha.secret";

    private async Task<AccessContext> Need(CancellationToken ct, bool adminOnly = false)
    {
        var c = await access.RequireSignedInAsync(ct);
        if (c.Admin || (!adminOnly && c.Has(Permission.ManageSettings))) return c;
        throw new ForbiddenException();
    }

    private async Task<SiteSettings> SiteAsync(CancellationToken ct) =>
        await db.SiteSettings.FirstOrDefaultAsync(ct) ?? db.SiteSettings.Add(new SiteSettings { Id = 1 }).Entity;

    // ================================================================ branding and home page

    public sealed record BrandingBody(string SiteNameEn, string SiteNameAr, string HeaderNameEn, string HeaderNameAr, string HeaderSubEn, string HeaderSubAr,
        string FooterTextEn, string FooterTextAr, string? ContactEmail, string? ContactPhone, string ContactHoursEn, string ContactHoursAr, string? BrandColor,
        string HomeTitleEn, string HomeTitleAr, string HomeIntroEn, string HomeIntroAr, string LoginNoticeEn, string LoginNoticeAr);

    [HttpGet("branding")]
    public async Task<object> Branding(CancellationToken ct)
    {
        await Need(ct);
        return await SiteAsync(ct);
    }

    [HttpPut("branding")]
    public async Task<IActionResult> SaveBranding(BrandingBody b, CancellationToken ct)
    {
        var c = await Need(ct);
        var s = await SiteAsync(ct);
        var before = JsonSerializer.Serialize(s);
        string T(string? v, int max, string field, bool required = false)
        {
            var x = (v ?? "").Trim();
            if (required && x.Length == 0) throw Err("required", field);
            if (x.Length > max) throw Err("locationLong", field);
            return x;
        }
        s.SiteNameEn = T(b.SiteNameEn, 80, "siteNameEn", true); s.SiteNameAr = T(b.SiteNameAr, 80, "siteNameAr", true);
        s.HeaderNameEn = T(b.HeaderNameEn, 60, "headerNameEn"); s.HeaderNameAr = T(b.HeaderNameAr, 60, "headerNameAr");
        s.HeaderSubEn = T(b.HeaderSubEn, 80, "headerSubEn"); s.HeaderSubAr = T(b.HeaderSubAr, 80, "headerSubAr");
        s.FooterTextEn = T(b.FooterTextEn, 300, "footerTextEn"); s.FooterTextAr = T(b.FooterTextAr, 300, "footerTextAr");
        var email = T(b.ContactEmail, 254, "contactEmail");
        if (email.Length > 0 && !email.Contains('@')) throw Err("required", "contactEmail");
        s.ContactEmail = email.Length == 0 ? null : email;
        var phone = T(b.ContactPhone, 30, "contactPhone");
        s.ContactPhone = phone.Length == 0 ? null : phone;
        s.ContactHoursEn = T(b.ContactHoursEn, 120, "contactHoursEn"); s.ContactHoursAr = T(b.ContactHoursAr, 120, "contactHoursAr");
        var color = T(b.BrandColor, 7, "brandColor");
        if (color.Length > 0 && !ColorRx().IsMatch(color)) throw Err("color", "brandColor");
        s.BrandColor = color.Length == 0 ? null : color.ToLowerInvariant();
        s.HomeTitleEn = T(b.HomeTitleEn, 120, "homeTitleEn"); s.HomeTitleAr = T(b.HomeTitleAr, 120, "homeTitleAr");
        s.HomeIntroEn = T(b.HomeIntroEn, 300, "homeIntroEn"); s.HomeIntroAr = T(b.HomeIntroAr, 300, "homeIntroAr");
        s.LoginNoticeEn = T(b.LoginNoticeEn, 300, "loginNoticeEn"); s.LoginNoticeAr = T(b.LoginNoticeAr, 300, "loginNoticeAr");
        s.UpdatedAt = clock.UtcNow; s.UpdatedBy = c.UserId;
        audit.Write("settings.branding", "site_settings", null, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Logo or browser icon: PNG, JPG, WebP, SVG or ICO up to 1 MB. Served by GET /api/site/branding/{file}.</summary>
    [HttpPost("branding/{kind}")]
    [RequestSizeLimit(1_200_000)]
    public async Task<object> UploadImage(string kind, IFormFile file, CancellationToken ct)
    {
        var c = await Need(ct);
        if (kind is not ("logo" or "favicon")) throw new NotFoundException();
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext is not (".png" or ".jpg" or ".jpeg" or ".webp" or ".svg" or ".ico")) throw Err("imageType", "file");
        if (file.Length is 0 or > 1024 * 1024) throw Err("imageSize", "file");
        var name = $"{kind}-{Guid.NewGuid():N}{ext}";
        await using (var stream = file.OpenReadStream()) await files.SaveAsync("branding/" + name, stream, ct);
        var s = await SiteAsync(ct);
        var old = kind == "logo" ? s.LogoPath : s.FaviconPath;
        if (kind == "logo") s.LogoPath = name; else s.FaviconPath = name;
        s.UpdatedAt = clock.UtcNow; s.UpdatedBy = c.UserId;
        audit.Write("settings.branding_image", "site_settings", null, new { kind, path = old }, new { kind, path = name });
        await db.SaveChangesAsync(ct);
        if (old is not null) await files.DeleteAsync("branding/" + old, ct);
        return new { path = name };
    }

    [HttpDelete("branding/{kind}")]
    public async Task<IActionResult> RemoveImage(string kind, CancellationToken ct)
    {
        var c = await Need(ct);
        var s = await SiteAsync(ct);
        var old = kind == "logo" ? s.LogoPath : kind == "favicon" ? s.FaviconPath : throw new NotFoundException();
        if (kind == "logo") s.LogoPath = null; else s.FaviconPath = null;
        s.UpdatedAt = clock.UtcNow; s.UpdatedBy = c.UserId;
        audit.Write("settings.branding_image", "site_settings", null, new { kind, path = old }, new { kind, path = (string?)null });
        await db.SaveChangesAsync(ct);
        if (old is not null) await files.DeleteAsync("branding/" + old, ct);
        return NoContent();
    }

    public sealed record HomeBody(bool ShowPopular, string? PopularTitleEn, string? PopularTitleAr);

    [HttpPut("home")]
    public async Task<IActionResult> SaveHome(HomeBody b, CancellationToken ct)
    {
        var c = await Need(ct);
        var s = await SiteAsync(ct);
        var before = s.HomeContent;
        var texts = new Dictionary<string, string>();
        if (!string.IsNullOrWhiteSpace(b.PopularTitleEn)) texts["popularTitleEn"] = b.PopularTitleEn.Trim()[..Math.Min(120, b.PopularTitleEn.Trim().Length)];
        if (!string.IsNullOrWhiteSpace(b.PopularTitleAr)) texts["popularTitleAr"] = b.PopularTitleAr.Trim()[..Math.Min(120, b.PopularTitleAr.Trim().Length)];
        s.HomeContent = JsonSerializer.Serialize(new { show = new { popular = b.ShowPopular }, texts });
        s.UpdatedAt = clock.UtcNow; s.UpdatedBy = c.UserId;
        audit.Write("settings.home", "site_settings", null, before, s.HomeContent);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ================================================================ menus

    public sealed record MenuBody(string Area, Guid? ParentId, string Kind, string LabelEn, string LabelAr, string? Href, string Audience, bool NewTab, bool IsVisible, int SortOrder);
    private static readonly string[] Areas = ["header", "footer", "console", "admin", "general"];
    private static readonly string[] Audiences = ["all", "guest", "signed_in", "customer", "staff"];

    [HttpGet("menus")]
    public async Task<object> Menus(CancellationToken ct)
    {
        await Need(ct);
        return await db.MenuItems.AsNoTracking().OrderBy(m => m.Area).ThenBy(m => m.SortOrder).ToListAsync(ct);
    }

    [HttpPost("menus")]
    public async Task<object> CreateMenu(MenuBody b, CancellationToken ct)
    {
        await Need(ct);
        var m = new MenuItem { Id = Guid.NewGuid(), CreatedAt = clock.UtcNow };
        await ApplyMenuAsync(m, b, ct);
        db.MenuItems.Add(m);
        audit.Write("menu.create", "menu_item", m.Id, null, b);
        await db.SaveChangesAsync(ct);
        return new { m.Id };
    }

    [HttpPut("menus/{id:guid}")]
    public async Task<IActionResult> UpdateMenu(Guid id, MenuBody b, CancellationToken ct)
    {
        await Need(ct);
        var m = await db.MenuItems.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var before = new { m.Area, m.ParentId, m.Kind, m.LabelEn, m.LabelAr, m.Href, m.Audience, m.NewTab, m.IsVisible, m.SortOrder };
        // Built-in entries keep their address and area; only their names, order and visibility change.
        if (m.SystemKey is not null) b = b with { Area = m.Area, Href = m.Href, Kind = m.Kind };
        await ApplyMenuAsync(m, b, ct);
        audit.Write("menu.update", "menu_item", id, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("menus/{id:guid}")]
    public async Task<IActionResult> DeleteMenu(Guid id, CancellationToken ct)
    {
        await Need(ct);
        var m = await db.MenuItems.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (m.SystemKey is not null) throw Err("builtinLocked");
        await db.MenuItems.Where(x => x.ParentId == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.ParentId, (Guid?)null), ct);
        db.MenuItems.Remove(m);
        audit.Write("menu.delete", "menu_item", id, new { m.LabelEn, m.Href }, null);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task ApplyMenuAsync(MenuItem m, MenuBody b, CancellationToken ct)
    {
        if (!Areas.Contains(b.Area)) throw Err("required", "area");
        if (b.Kind is not ("link" or "group")) throw Err("type", "kind");
        if (!Audiences.Contains(b.Audience)) throw Err("required", "audience");
        var en = (b.LabelEn ?? "").Trim(); var ar = (b.LabelAr ?? "").Trim();
        if (en.Length is < 1 or > 60 || ar.Length is < 1 or > 60) throw Err("name", "labelEn");
        var href = (b.Href ?? "").Trim();
        if (b.Kind == "link" && (href.Length > 300 || !(href.StartsWith('/') || href.StartsWith("https://") || href.StartsWith("http://") || href.StartsWith("mailto:") || href.StartsWith("tel:")))) throw Err("required", "href");
        if (b.ParentId is Guid p && (p == m.Id || !await db.MenuItems.AnyAsync(x => x.Id == p && x.Kind == "group" && x.Area == b.Area, ct))) throw Err("notFound", "parentId");
        m.Area = b.Area; m.ParentId = b.ParentId; m.Kind = b.Kind; m.LabelEn = en; m.LabelAr = ar; m.Href = b.Kind == "link" ? href : null;
        m.Audience = b.Audience; m.NewTab = b.NewTab; m.IsVisible = b.IsVisible; m.SortOrder = Math.Clamp(b.SortOrder, 0, 10000);
    }

    // ================================================================ email: SMTP, test, design, templates

    public sealed record SmtpBody(bool UseSmtp, string Host, int Port, string Security, string Username, string? Password, bool ClearPassword,
        string FromName, string FromEmail, string ReplyTo);
    public sealed record TestBody(string? To);
    public sealed record DesignBody(string HeaderColor, string AccentColor, string PageBackground, bool UseLogo, bool ShowSiteName, bool Rounded, bool LargeCodeBox);

    private async Task<EmailSettings> EmailAsync(CancellationToken ct) =>
        await db.EmailSettings.FirstOrDefaultAsync(ct) ?? db.EmailSettings.Add(new EmailSettings { Id = 1 }).Entity;

    [HttpGet("email")]
    public async Task<object> Email(CancellationToken ct)
    {
        await Need(ct);
        var e = await EmailAsync(ct);
        return new
        {
            e.UseSmtp, e.Host, e.Port, e.Security, e.Username, HasPassword = e.PasswordEnc is not null, e.FromName, e.FromEmail, e.ReplyTo,
            Design = EmailDesign.FromJson(e.Design), e.LastTestAt, e.LastTestOk, e.LastTestError,
        };
    }

    [HttpPut("email")]
    public async Task<IActionResult> SaveEmail(SmtpBody b, CancellationToken ct)
    {
        var c = await Need(ct);
        var e = await EmailAsync(ct);
        if (b.Security is not ("starttls" or "ssl" or "none")) throw Err("required", "security");
        if (b.Port is < 1 or > 65535) throw Err("number", "port");
        var from = (b.FromEmail ?? "").Trim();
        if (b.UseSmtp && (string.IsNullOrWhiteSpace(b.Host) || !from.Contains('@'))) throw Err("testIncomplete", "host");
        var before = new { e.UseSmtp, e.Host, e.Port, e.Security, e.Username, e.FromName, e.FromEmail, e.ReplyTo };
        e.UseSmtp = b.UseSmtp; e.Host = (b.Host ?? "").Trim(); e.Port = b.Port; e.Security = b.Security; e.Username = (b.Username ?? "").Trim();
        e.FromName = (b.FromName ?? "").Trim(); e.FromEmail = from; e.ReplyTo = (b.ReplyTo ?? "").Trim();
        if (b.ClearPassword) e.PasswordEnc = null;
        else if (!string.IsNullOrEmpty(b.Password)) e.PasswordEnc = dp.CreateProtector(SmtpPurpose).Protect(b.Password);
        e.HasPassword = e.PasswordEnc is not null;
        e.UpdatedAt = clock.UtcNow; e.UpdatedBy = c.UserId;
        audit.Write("settings.email", "email_settings", null, before, new { b.UseSmtp, b.Host, b.Port, b.Security, b.Username, b.FromName, b.FromEmail, b.ReplyTo, passwordChanged = !string.IsNullOrEmpty(b.Password) || b.ClearPassword });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Sends a test email with the saved settings and records the result.</summary>
    [HttpPost("email/test")]
    public async Task<object> TestEmail(TestBody b, CancellationToken ct)
    {
        var c = await Need(ct);
        var to = string.IsNullOrWhiteSpace(b.To) ? await db.Profiles.Where(p => p.Id == c.UserId).Select(p => p.Email).FirstAsync(ct) : b.To.Trim();
        var e = await EmailAsync(ct);
        string? error = null;
        try
        {
            var r = await templates.BuildAsync("_test", "en", new() { ["name"] = "Test" }, null, null, ct)
                    ?? new RenderedEmail("CCS test email", "<p>This is a test email from the Customer Care System.</p>", "This is a test email from the Customer Care System.");
            await mail.SendAsync(new OutgoingEmail(to, string.IsNullOrWhiteSpace(r.Subject) ? "CCS test email" : r.Subject, r.Html, r.Text), ct);
        }
        catch (Exception ex) { error = ex.Message; }
        e.LastTestAt = clock.UtcNow; e.LastTestOk = error is null; e.LastTestError = error is null ? null : error[..Math.Min(500, error.Length)];
        await db.SaveChangesAsync(ct);
        return new { ok = error is null, error, to };
    }

    public sealed record DesignPreviewBody(DesignBody Design, bool Rtl);

    /// <summary>Sample sign-in-code email with the design as it is set now (v1 design preview). Nothing is saved.</summary>
    [HttpPost("email/design/preview")]
    public async Task<object> PreviewDesign(DesignPreviewBody b, CancellationToken ct)
    {
        await Need(ct);
        var site = await SiteAsync(ct);
        var d = b.Design;
        var logo = d.UseLogo && site.LogoPath is not null ? $"/api/site/branding/{site.LogoPath}" : null;
        string Pick(string? c, string fallback) => c is not null && ColorRx().IsMatch(c) ? c : fallback;
        var design = new EmailDesign(Pick(d.HeaderColor, "#0d1b3e"), Pick(d.AccentColor, "#1f64e6"),
            Pick(d.PageBackground, "#f1f5fb"), logo, d.ShowSiteName, d.Rounded, d.LargeCodeBox);
        var ar = b.Rtl;
        var r = EmailRenderer.Render(ar ? "رمز الدخول" : "Your sign-in code",
            (ar ? "مرحبًا كمال،" : "Hello Kamal,") + "\n\n" + (ar ? "استخدم هذا الرمز لتسجيل الدخول. يعمل لمدة 10 دقائق." : "Use this code to sign in. It works for 10 minutes."),
            ar ? "فتح التذكرة" : "Open the ticket", "https://example.com/", new Dictionary<string, string>(), design,
            ar ? site.SiteNameAr : site.SiteNameEn, ar ? "ar" : "en", ar ? "إذا لم تطلب هذا الرمز، تجاهل الرسالة." : "If you did not ask for this, ignore this email.",
            d.LargeCodeBox ? "482913" : null);
        return new { html = r.Html };
    }

    [HttpPut("email/design")]
    public async Task<IActionResult> SaveDesign(DesignBody b, CancellationToken ct)
    {
        var c = await Need(ct);
        foreach (var (v, f) in new[] { (b.HeaderColor, "headerColor"), (b.AccentColor, "accentColor"), (b.PageBackground, "pageBackground") })
            if (!ColorRx().IsMatch(v ?? "")) throw Err("color", f);
        var e = await EmailAsync(ct);
        var site = await SiteAsync(ct);
        var logo = b.UseLogo && site.LogoPath is not null ? $"/api/site/branding/{site.LogoPath}" : null;
        var before = e.Design;
        e.Design = JsonSerializer.Serialize(new EmailDesign(b.HeaderColor, b.AccentColor, b.PageBackground, logo, b.ShowSiteName, b.Rounded, b.LargeCodeBox),
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        e.UpdatedAt = clock.UtcNow; e.UpdatedBy = c.UserId;
        audit.Write("settings.email_design", "email_settings", null, before, e.Design);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    public sealed record TemplateBody(string Event, string Locale, string Subject, string Body, string? Button, string? Link, string? Greeting = null, string? Footer = null);
    public sealed record DraftBody(string Subject, string Body, string? Button, string? Link, string? Greeting, string? Footer);

    /// <summary>Events and their built-in wording, so the editor shows the real default text (v1 defaultFor / footerDefault).</summary>
    [HttpGet("templates/defaults")]
    public async Task<object> TemplateDefaults(CancellationToken ct) { await Need(ct); return EmailDefaults.Snapshot(); }

    /// <summary>The email exactly as it would be sent, from what is typed now and sample values. Nothing is saved.</summary>
    [HttpPost("templates/{evt}/{locale}/preview")]
    public async Task<object> PreviewTemplate(string evt, string locale, DraftBody d, CancellationToken ct)
    {
        await Need(ct);
        var r = await templates.BuildAsync(evt == EmailDefaults.Layout ? "ticket_created" : evt, locale, SampleValues(locale), "/tickets/sample",
            EmailDefaults.IsAuth(evt) ? "482913" : null, ct, ToDraft(evt, d));
        return new { subject = r?.Subject ?? "", html = r?.Html ?? "" };
    }

    private static TemplateDraft ToDraft(string evt, DraftBody d) => evt == EmailDefaults.Layout
        ? new TemplateDraft("", "", null, null, d.Subject, d.Body)            // the layout row: subject = greeting, body = footer
        : new TemplateDraft(d.Subject ?? "", d.Body ?? "", d.Button, d.Link, d.Greeting, d.Footer);

    /// <summary>v1 SAMPLE values for previews and tests.</summary>
    private static Dictionary<string, string> SampleValues(string locale) => locale == "ar"
        ? new() { ["name"] = "كمال", ["reference"] = "CTS-2026-000123", ["subject"] = "مشكلة في تسجيل الدخول", ["reason"] = "لا يوجد رد منذ 24 ساعة", ["code"] = "482913", ["minutes"] = "10", ["days"] = "3", ["customer"] = "نور حسن", ["customerEmail"] = "nour@example.com" }
        : new() { ["name"] = "Kamal", ["reference"] = "CTS-2026-000123", ["subject"] = "Login issue on the portal", ["reason"] = "No reply for 24 hours", ["code"] = "482913", ["minutes"] = "10", ["days"] = "3", ["customer"] = "Nour Hassan", ["customerEmail"] = "nour@example.com" };

    [HttpGet("templates")]
    public async Task<object> Templates(CancellationToken ct)
    {
        await Need(ct);
        return await db.EmailTemplates.AsNoTracking().OrderBy(t => t.Event).ThenBy(t => t.Locale).ToListAsync(ct);
    }

    [HttpPut("templates")]
    public async Task<IActionResult> SaveTemplate(TemplateBody b, CancellationToken ct)
    {
        var c = await Need(ct);
        if (b.Locale is not ("en" or "ar")) throw Err("required", "locale");
        if (!EventRx().IsMatch(b.Event ?? "")) throw Err("required", "event");
        var subject = (b.Subject ?? "").Trim(); var body = (b.Body ?? "").Trim();
        if (subject.Length > 200) throw Err("title", "subject");
        if (body.Length > 2000) throw Err("body", "body");
        var link = (b.Link ?? "").Trim();
        if (link.Length > 300 || link.Length > 0 && !(link.StartsWith('/') || link.StartsWith("https://"))) throw Err("required", "link");
        var row = await db.EmailTemplates.FirstOrDefaultAsync(t => t.Event == b.Event && t.Locale == b.Locale, ct);
        var before = row is null ? null : new { row.Subject, row.Body, row.Button, row.Link };
        if (row is null) db.EmailTemplates.Add(row = new EmailTemplate { Event = b.Event!, Locale = b.Locale });
        row.Subject = subject; row.Body = body; row.Button = (b.Button ?? "").Trim(); row.Link = link;
        row.UpdatedAt = clock.UtcNow; row.UpdatedBy = c.UserId;
        if (b.Event != EmailDefaults.Layout && (b.Greeting is not null || b.Footer is not null))
        {
            // Greeting and footer are shared by every email of this language (v1: the "_layout" row).
            var greet = (b.Greeting ?? "").Trim(); var foot = (b.Footer ?? "").Trim();
            if (greet.Length > 200) throw Err("title", "greeting");
            if (foot.Length > 2000) throw Err("body", "footer");
            var lay = await db.EmailTemplates.FirstOrDefaultAsync(t => t.Event == EmailDefaults.Layout && t.Locale == b.Locale, ct);
            if (lay is null) db.EmailTemplates.Add(lay = new EmailTemplate { Event = EmailDefaults.Layout, Locale = b.Locale, Button = "", Link = "" });
            lay.Subject = greet == EmailDefaults.Greeting(b.Locale) ? "" : greet;
            lay.Body = foot.Length == 0 ? EmailDefaults.NoFooter : foot == EmailDefaults.Footer(b.Event!, b.Locale) ? "" : foot;
            lay.UpdatedAt = clock.UtcNow; lay.UpdatedBy = c.UserId;
        }
        else if (b.Event == EmailDefaults.Layout && body.Length == 0) row.Body = EmailDefaults.NoFooter;
        audit.Write("settings.email_template", "email_templates", null, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("templates/{evt}/{locale}")]
    public async Task<IActionResult> ResetTemplate(string evt, string locale, CancellationToken ct)
    {
        await Need(ct);
        var row = await db.EmailTemplates.FirstOrDefaultAsync(t => t.Event == evt && t.Locale == locale, ct);
        if (row is not null)
        {
            db.EmailTemplates.Remove(row);
            audit.Write("settings.email_template_reset", "email_templates", null, new { evt, locale, row.Subject }, null);
            await db.SaveChangesAsync(ct);
        }
        return NoContent();
    }

    /// <summary>Sends one template to the caller with sample values.</summary>
    [HttpPost("templates/{evt}/{locale}/test")]
    public async Task<object> TestTemplate(string evt, string locale, [FromBody] DraftBody? d, CancellationToken ct)
    {
        var c = await Need(ct);
        var me = await db.Profiles.AsNoTracking().FirstAsync(p => p.Id == c.UserId, ct);
        var loc = locale is "ar" ? "ar" : "en";
        var values = SampleValues(loc);
        values["name"] = me.FullName;
        try
        {
            var r = await templates.BuildAsync(evt == EmailDefaults.Layout ? "ticket_created" : evt, loc, values, "/tickets/sample",
                EmailDefaults.IsAuth(evt) ? "482913" : null, ct, d is null ? null : ToDraft(evt, d));
            if (r is null) return new { ok = false, error = "This email has no text yet.", email = me.Email };
            await mail.SendAsync(new OutgoingEmail(me.Email, r.Subject, r.Html, r.Text), ct);
            return new { ok = true, error = (string?)null, email = me.Email };
        }
        catch (Exception ex) { return new { ok = false, error = ex.Message, email = me.Email }; }
    }

    // ================================================================ system messages (any text of the app)

    public sealed record MessageBody(string Key, string? En, string? Ar);

    [HttpGet("messages")]
    public async Task<object> Messages(CancellationToken ct)
    {
        await Need(ct);
        return await db.SystemMessages.AsNoTracking().Select(m => new { m.Key, m.Locale, m.Body, m.UpdatedAt }).ToListAsync(ct);
    }

    [HttpPut("messages")]
    public async Task<IActionResult> SaveMessage(MessageBody b, CancellationToken ct)
    {
        var c = await Need(ct);
        if (b.Key is not { Length: <= 80 } || !KeyRx().IsMatch(b.Key)) throw Err("required", "key");
        foreach (var (loc, text) in new[] { ("en", b.En), ("ar", b.Ar) })
        {
            var body = (text ?? "").Trim();
            if (body.Length > 1000) throw Err("body", loc);
            var row = await db.SystemMessages.FirstOrDefaultAsync(m => m.Key == b.Key && m.Locale == loc, ct);
            if (body.Length == 0) { if (row is not null) db.SystemMessages.Remove(row); continue; }
            if (row is null) db.SystemMessages.Add(row = new SystemMessage { Key = b.Key!, Locale = loc });
            row.Body = body; row.UpdatedAt = clock.UtcNow; row.UpdatedBy = c.UserId;
        }
        audit.Write("settings.system_message", "system_messages", null, null, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ================================================================ uploads

    public sealed record UploadsBody(int MaxMb, int MaxFiles, string[] Extensions);
    private static readonly string[] KnownExtensions = ["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "doc", "docx", "csv", "xls", "xlsx", "ppt", "pptx", "zip"];

    [HttpPut("uploads")]
    public async Task<IActionResult> SaveUploads(UploadsBody b, CancellationToken ct)
    {
        var c = await Need(ct);
        if (b.MaxMb is < 1 or > 50) throw Err("number", "maxMb");
        if (b.MaxFiles is < 1 or > 20) throw Err("number", "maxFiles");
        var exts = (b.Extensions ?? []).Select(e => e.Trim().TrimStart('.').ToLowerInvariant()).Where(KnownExtensions.Contains).Distinct().ToArray();
        if (exts.Length == 0) throw Err("required", "extensions");
        var s = await SiteAsync(ct);
        var before = new { s.UploadMaxMb, s.UploadMaxFiles, s.UploadExtensions };
        s.UploadMaxMb = b.MaxMb; s.UploadMaxFiles = b.MaxFiles; s.UploadExtensions = JsonSerializer.Serialize(exts);
        s.UpdatedAt = clock.UtcNow; s.UpdatedBy = c.UserId;
        audit.Write("settings.uploads", "site_settings", null, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ================================================================ system rules, registration, captcha, password policy

    private static readonly Dictionary<string, (int Min, int Max)> IntRules = new()
    {
        ["reopen_window_days"] = (0, 365), ["auto_close_days"] = (1, 90), ["min_reply_chars"] = (0, 500),
        ["pending_reminder_1_day"] = (1, 60), ["pending_reminder_2_day"] = (1, 60), ["pending_final_day"] = (1, 90), ["no_response_close_days"] = (1, 120),
        ["resolved_reminder_day"] = (1, 60), ["auto_refresh_seconds"] = (0, 600),
        ["password_min_length"] = (8, 128), ["password_expiry_days"] = (7, 730), ["password_warn_1_days"] = (1, 60), ["password_warn_2_days"] = (1, 60), ["password_warn_3_days"] = (1, 60),
    };
    private static readonly string[] BoolRules =
        ["email_enabled", "password_require_upper", "password_require_lower", "password_require_number", "password_require_special", "password_expiry_enabled"];

    [HttpGet("system")]
    public async Task<object> GetSystem(CancellationToken ct)
    {
        await Need(ct);
        var keys = IntRules.Keys.Concat(BoolRules).ToList();
        var rows = await db.AppSettings.AsNoTracking().Where(s => keys.Contains(s.Key)).ToDictionaryAsync(s => s.Key, s => s.Value, ct);
        var cap = await db.CaptchaSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        var site = await db.SiteSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        return new
        {
            settings = rows,
            registrationMode = site?.RegistrationMode ?? "approval",
            captcha = new { enabled = cap?.Enabled ?? false, siteKey = cap?.SiteKey ?? "", hasSecret = cap?.SecretEnc is not null },
        };
    }

    public sealed record SystemBody(Dictionary<string, JsonElement> Settings);

    [HttpPut("system")]
    public async Task<IActionResult> SaveSystem(SystemBody b, CancellationToken ct)
    {
        await Need(ct);
        var before = new Dictionary<string, string>();
        foreach (var (key, value) in b.Settings ?? [])
        {
            string json;
            if (IntRules.TryGetValue(key, out var r))
            {
                if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var n) || n < r.Min || n > r.Max) throw Err("number", key);
                json = n.ToString();
            }
            else if (BoolRules.Contains(key))
            {
                if (value.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw Err("required", key);
                json = value.GetBoolean() ? "true" : "false";
            }
            else throw Err("required", key);
            var row = await db.AppSettings.FirstOrDefaultAsync(s => s.Key == key, ct);
            if (row is null) db.AppSettings.Add(row = new AppSetting { Key = key });
            before[key] = row.Value;
            row.Value = json;
        }
        audit.Write("settings.system", "app_settings", null, before, b.Settings);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    public sealed record RegistrationBody(string Mode);

    [HttpPut("registration")]
    public async Task<IActionResult> SaveRegistration(RegistrationBody b, CancellationToken ct)
    {
        var c = await Need(ct);
        if (b.Mode is not ("closed" or "approval" or "pick_approval" or "pick_auto")) throw Err("required", "mode");
        var s = await SiteAsync(ct);
        audit.Write("settings.registration", "site_settings", null, new { mode = s.RegistrationMode }, new { mode = b.Mode });
        s.RegistrationMode = b.Mode; s.UpdatedAt = clock.UtcNow; s.UpdatedBy = c.UserId;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    public sealed record CaptchaBody(bool Enabled, string SiteKey, string? Secret);

    [HttpPut("captcha")]
    public async Task<IActionResult> SaveCaptcha(CaptchaBody b, CancellationToken ct)
    {
        await Need(ct);
        var cap = await db.CaptchaSettings.FirstOrDefaultAsync(ct) ?? db.CaptchaSettings.Add(new CaptchaSettings { Id = 1 }).Entity;
        var key = (b.SiteKey ?? "").Trim();
        if (!string.IsNullOrWhiteSpace(b.Secret)) cap.SecretEnc = dp.CreateProtector(CaptchaPurpose).Protect(b.Secret.Trim());
        if (b.Enabled && (key.Length == 0 || cap.SecretEnc is null)) throw Err("captchaKeysHint", "siteKey");
        var before = new { cap.Enabled, cap.SiteKey };
        cap.Enabled = b.Enabled; cap.SiteKey = key; cap.Provider = "turnstile";
        audit.Write("settings.captcha", "captcha_settings", null, before, new { b.Enabled, siteKey = key, secretChanged = !string.IsNullOrWhiteSpace(b.Secret) });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ================================================================ sign-in codes

    public sealed record SigninCodesBody(bool Enabled, string Audience, int CodeLength, int ValidMinutes, int MaxAttempts, int CooldownSeconds, int DailyLimit);

    [HttpGet("signin-codes")]
    public async Task<object> SigninCodes(CancellationToken ct)
    {
        await Need(ct);
        return await db.SigninCodeSettings.AsNoTracking().FirstOrDefaultAsync(ct) ?? new SigninCodeSettings();
    }

    [HttpPut("signin-codes")]
    public async Task<IActionResult> SaveSigninCodes(SigninCodesBody b, CancellationToken ct)
    {
        var c = await Need(ct);
        if (b.Audience is not ("customers" or "all")) throw Err("required", "audience");
        if (b.CodeLength is < 4 or > 10) throw Err("number", "codeLength");
        if (b.ValidMinutes is < 1 or > 60) throw Err("number", "validMinutes");
        if (b.MaxAttempts is < 1 or > 10) throw Err("number", "maxAttempts");
        if (b.CooldownSeconds is < 0 or > 600) throw Err("number", "cooldownSeconds");
        if (b.DailyLimit is < 1 or > 100) throw Err("number", "dailyLimit");
        var s = await db.SigninCodeSettings.FirstOrDefaultAsync(ct) ?? db.SigninCodeSettings.Add(new SigninCodeSettings { Id = 1 }).Entity;
        var before = new { s.Enabled, s.Audience, s.CodeLength, s.ValidMinutes, s.MaxAttempts, s.CooldownSeconds, s.DailyLimit };
        s.Enabled = b.Enabled; s.Audience = b.Audience; s.CodeLength = b.CodeLength; s.ValidMinutes = b.ValidMinutes;
        s.MaxAttempts = b.MaxAttempts; s.CooldownSeconds = b.CooldownSeconds; s.DailyLimit = b.DailyLimit;
        s.UpdatedAt = clock.UtcNow; s.UpdatedBy = c.UserId;
        audit.Write("settings.signin_codes", "signin_code_settings", null, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ================================================================ handover (administrators only)

    private const string DemoDomain = "@demo.cts.test";

    [HttpGet("handover")]
    public async Task<object> Handover(CancellationToken ct)
    {
        var c = await Need(ct, adminOnly: true);
        var candidates = await (from p in db.Profiles.AsNoTracking()
                                join t in db.AccountTypes on p.AccountTypeId equals t.Id into tt
                                from t in tt.DefaultIfEmpty()
                                where p.AccountStatus == AccountStatus.Active && p.Id != c.UserId
                                      && db.CcsUserRoles.Any(ur => ur.UserId == p.Id && db.CcsRoles.Any(r => r.Id == ur.RoleId && r.Code != RoleCode.Customer))
                                orderby p.FullName
                                select new { p.Id, p.FullName, p.Email, TypeEn = t == null ? null : t.NameEn, TypeAr = t == null ? null : t.NameAr }).ToListAsync(ct);
        var types = await db.AccountTypes.AsNoTracking().Where(t => !t.IsBuiltin).OrderBy(t => t.NameEn).Select(t => new { t.Id, t.NameEn, t.NameAr }).ToListAsync(ct);
        return new { candidates, types, demo = await DemoSummaryAsync(c.UserId, ct) };
    }

    private async Task<object> DemoSummaryAsync(Guid me, CancellationToken ct)
    {
        var demo = db.Profiles.Where(p => p.Email.EndsWith(DemoDomain)).Select(p => p.Id);
        return new
        {
            users = await demo.CountAsync(ct),
            organizations = await db.Organizations.CountAsync(o => o.Name.EndsWith(" (Demo)"), ct),
            tickets = await db.Tickets.CountAsync(t => demo.Contains(t.RequesterId), ct),
            articles = await db.KbArticles.CountAsync(a => a.Slug.StartsWith("demo-"), ct),
            realTickets = await db.Tickets.CountAsync(t => !demo.Contains(t.RequesterId), ct),
            meIsDemo = await demo.ContainsAsync(me, ct),
        };
    }

    public sealed record TransferBody(Guid NewAdminId, Guid MyTypeId, string Confirm);

    /// <summary>Gives the Administrator role to another active staff member and moves the caller to a normal type.</summary>
    [HttpPost("handover/transfer")]
    public async Task<IActionResult> Transfer(TransferBody b, CancellationToken ct)
    {
        var c = await Need(ct, adminOnly: true);
        if (b.Confirm?.Trim().ToUpperInvariant() is not ("TRANSFER" or "نقل")) throw Err("confirm", "confirm");
        if (b.NewAdminId == c.UserId) throw Err("self", "newAdminId");
        var target = await db.Profiles.FirstOrDefaultAsync(p => p.Id == b.NewAdminId, ct) ?? throw Err("choose", "newAdminId");
        if (target.AccountStatus != AccountStatus.Active) throw Err("notActive", "newAdminId");
        var targetRole = await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id where ur.UserId == target.Id select r.Code).FirstOrDefaultAsync(ct);
        if (targetRole is null or RoleCode.Customer) throw Err("notStaff", "newAdminId");
        var myType = await db.AccountTypes.FirstOrDefaultAsync(t => t.Id == b.MyTypeId && !t.IsBuiltin, ct) ?? throw Err("invalidType", "myTypeId");
        var adminType = await db.AccountTypes.Where(t => t.IsBuiltin).Select(t => (Guid?)t.Id).FirstOrDefaultAsync(ct);
        var adminRole = await db.CcsRoles.Where(r => r.Code == RoleCode.Admin).Select(r => r.Id).FirstAsync(ct);
        var agentRole = await db.CcsRoles.Where(r => r.Code == RoleCode.Agent).Select(r => r.Id).FirstAsync(ct);
        var me = await db.Profiles.FirstAsync(p => p.Id == c.UserId, ct);

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.CcsUserRoles.Where(x => x.UserId == target.Id || x.UserId == me.Id).ExecuteDeleteAsync(ct);
        db.CcsUserRoles.Add(new UserRole { UserId = target.Id, RoleId = adminRole });
        db.CcsUserRoles.Add(new UserRole { UserId = me.Id, RoleId = agentRole });
        target.AccountTypeId = adminType; target.UpdatedAt = clock.UtcNow;
        me.AccountTypeId = myType.Id; me.UpdatedAt = clock.UtcNow;
        await db.AdminScopes.Where(x => x.UserId == target.Id).ExecuteDeleteAsync(ct);
        audit.Write("admin.transfer", "profile", target.Id, new { from = me.Id }, new { to = target.Id, myType = myType.NameEn });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return NoContent();
    }

    /// <summary>Removes the sample people, organizations, articles and tickets. Refused while real tickets exist.</summary>
    [HttpPost("handover/remove-demo")]
    public async Task<object> RemoveDemo(CancellationToken ct)
    {
        var c = await Need(ct, adminOnly: true);
        var demo = db.Profiles.Where(p => p.Email.EndsWith(DemoDomain)).Select(p => p.Id);
        if (await demo.ContainsAsync(c.UserId, ct)) throw Err("callerIsDemo", null, 409);
        if (await db.Tickets.AnyAsync(t => !demo.Contains(t.RequesterId), ct)) throw Err("realTickets", null, 409);
        var counts = new
        {
            users = await demo.CountAsync(ct),
            organizations = await db.Organizations.CountAsync(o => o.Name.EndsWith(" (Demo)"), ct),
            tickets = await db.Tickets.CountAsync(ct),
            articles = await db.KbArticles.CountAsync(a => a.Slug.StartsWith("demo-"), ct),
        };
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        try
        {
            // Every ticket is a demo ticket here (checked above): remove them with everything that hangs off them.
            await db.Notifications.Where(n => n.TicketId != null).ExecuteDeleteAsync(ct);
            await db.TicketLinks.ExecuteDeleteAsync(ct);
            await db.Tickets.ExecuteDeleteAsync(ct);
            var ids = await demo.ToListAsync(ct);
            await db.Organizations.Where(o => o.TeamLeaderId != null && ids.Contains(o.TeamLeaderId.Value)).ExecuteUpdateAsync(s => s.SetProperty(o => o.TeamLeaderId, (Guid?)null), ct);
            await db.Branches.Where(o => o.TeamLeaderId != null && ids.Contains(o.TeamLeaderId.Value)).ExecuteUpdateAsync(s => s.SetProperty(o => o.TeamLeaderId, (Guid?)null), ct);
            await db.KbArticles.Where(a => a.Slug.StartsWith("demo-")).ExecuteDeleteAsync(ct);
            await db.KbArticles.Where(a => a.CreatedBy != null && ids.Contains(a.CreatedBy.Value)).ExecuteUpdateAsync(s => s.SetProperty(a => a.CreatedBy, (Guid?)null), ct);
            await db.EmailTemplates.Where(x => x.UpdatedBy != null && ids.Contains(x.UpdatedBy.Value)).ExecuteUpdateAsync(s => s.SetProperty(x => x.UpdatedBy, (Guid?)null), ct);
            await db.SystemMessages.Where(x => x.UpdatedBy != null && ids.Contains(x.UpdatedBy.Value)).ExecuteUpdateAsync(s => s.SetProperty(x => x.UpdatedBy, (Guid?)null), ct);
            await db.EmailSettings.Where(x => x.UpdatedBy != null && ids.Contains(x.UpdatedBy.Value)).ExecuteUpdateAsync(s => s.SetProperty(x => x.UpdatedBy, (Guid?)null), ct);
            await db.SiteSettings.Where(x => x.UpdatedBy != null && ids.Contains(x.UpdatedBy.Value)).ExecuteUpdateAsync(s => s.SetProperty(x => x.UpdatedBy, (Guid?)null), ct);
            await db.SigninCodeSettings.Where(x => x.UpdatedBy != null && ids.Contains(x.UpdatedBy.Value)).ExecuteUpdateAsync(s => s.SetProperty(x => x.UpdatedBy, (Guid?)null), ct);
            await db.TeamMembers.Where(x => ids.Contains(x.UserId)).ExecuteDeleteAsync(ct);
            await db.CcsUserRoles.Where(x => ids.Contains(x.UserId)).ExecuteDeleteAsync(ct);
            await db.Notifications.Where(x => ids.Contains(x.UserId)).ExecuteDeleteAsync(ct);
            await db.Users.Where(u => ids.Contains(u.Id)).ExecuteDeleteAsync(ct);          // profiles and tokens follow
            var demoOrgs = db.Organizations.Where(o => o.Name.EndsWith(" (Demo)")).Select(o => o.Id);
            await db.Profiles.Where(p => p.OrganizationId != null && demoOrgs.Contains(p.OrganizationId.Value))
                .ExecuteUpdateAsync(s => s.SetProperty(p => p.OrganizationId, (Guid?)null).SetProperty(p => p.BranchId, (Guid?)null), ct);
            await db.AccountTypeAccess.Where(a => demoOrgs.Contains(a.OrganizationId)).ExecuteDeleteAsync(ct);
            await db.AdminScopes.Where(a => demoOrgs.Contains(a.OrganizationId)).ExecuteDeleteAsync(ct);
            await db.StaffPlacements.Where(a => demoOrgs.Contains(a.OrganizationId)).ExecuteDeleteAsync(ct);
            await db.Branches.Where(b => demoOrgs.Contains(b.OrganizationId)).ExecuteDeleteAsync(ct);
            await db.Organizations.Where(o => o.ParentId != null && demoOrgs.Contains(o.ParentId.Value)).ExecuteUpdateAsync(s => s.SetProperty(o => o.ParentId, (Guid?)null), ct);
            await db.Organizations.Where(o => o.Name.EndsWith(" (Demo)")).ExecuteDeleteAsync(ct);
            audit.Write("demo.remove", "system", null, null, counts);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (Exception e) when (e is DbUpdateException or Microsoft.Data.SqlClient.SqlException)
        {
            await tx.RollbackAsync(ct);
            throw new AuthError("generic", 409, e.Message[..Math.Min(200, e.Message.Length)]);
        }
        return counts;
    }

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")] private static partial Regex ColorRx();
    [GeneratedRegex("^[a-z_]{3,40}$")] private static partial Regex EventRx();
    [GeneratedRegex(@"^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+){1,6}$")] private static partial Regex KeyRx();
}
