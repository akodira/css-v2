using Ccs.Application.Access;
using Ccs.Application.Settings;
using Ccs.Domain;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>Public site data for the Angular shell: branding, menus, registration mode, upload and password rules.</summary>
[ApiController]
[Route("api/site")]
public sealed class SiteController(CcsDbContext db, SettingsService settings, Ccs.Application.Abstractions.IFileStore files, CaptchaVerifier captchaCheck) : ControllerBase
{
    [HttpGet]
    [ResponseCache(NoStore = true)]   // settings changes show at once
    public async Task<object> Get(CancellationToken ct)
    {
        var s = await db.SiteSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        var captcha = await captchaCheck.StateAsync(ct);
        var codes = await db.SigninCodeSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        var messages = await db.SystemMessages.AsNoTracking().Select(m => new { m.Key, m.Locale, m.Body }).ToListAsync(ct);
        return new
        {
            site = s,
            captcha = new { enabled = captcha.Active, provider = "turnstile", siteKey = captcha.SiteKey },   // hidden on a configuration fault (6.7)
            signinCodes = new { enabled = codes?.Enabled == true && (codes.ForCustomers || codes.ForStaff || codes.ForAdmins), length = codes?.CodeLength ?? 6,
                validMinutes = codes?.ValidMinutes ?? 10, cooldownSeconds = codes?.CooldownSeconds ?? 60 },
            passwordPolicy = await settings.GetPasswordPolicyAsync(ct),
            phoneFormat = await settings.GetPhoneFormatAsync(ct),
            autoRefreshSeconds = await settings.GetIntAsync("auto_refresh_seconds", 30, ct),
            minReplyChars = await settings.GetIntAsync("min_reply_chars", 20, ct),
            reopenWindowDays = await settings.GetIntAsync("reopen_window_days", 30, ct),
            systemMessages = messages,
        };
    }

    /// <summary>Logo and browser icon uploaded under Settings → Branding (anyone may load them).</summary>
    [HttpGet("branding/{name}")]
    [ResponseCache(Duration = 86400)]
    public async Task<IActionResult> Branding(string name, CancellationToken ct)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(name, @"^(logo|favicon|wordmark|wordmarkdark|footerlogo|signinpic)-[0-9a-f]{32}\.(png|jpg|jpeg|webp|svg|ico)$")) return NotFound();
        var stream = await files.OpenReadAsync("branding/" + name, ct);
        if (stream is null) return NotFound();
        var type = Path.GetExtension(name) switch { ".png" => "image/png", ".jpg" or ".jpeg" => "image/jpeg", ".webp" => "image/webp", ".svg" => "image/svg+xml", _ => "image/x-icon" };
        Response.Headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'";   // an uploaded SVG cannot run script
        return File(stream, type);
    }

    /// <summary>Pictures placed in email templates from the editor. Email apps load them from here.</summary>
    [HttpGet("email-images/{name}")]
    [ResponseCache(Duration = 86400)]
    public async Task<IActionResult> EmailImage(string name, CancellationToken ct)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(name, @"^[0-9a-f]{32}\.(png|jpg|jpeg|gif|webp)$")) return NotFound();
        var stream = await files.OpenReadAsync("email-images/" + name, ct);
        if (stream is null) return NotFound();
        var type = Path.GetExtension(name) switch { ".png" => "image/png", ".gif" => "image/gif", ".webp" => "image/webp", _ => "image/jpeg" };
        return File(stream, type);
    }

    /// <summary>Small icons drawn in every email (person, shield, website and social media).</summary>
    [HttpGet("email-assets/{name}.png")]
    [ResponseCache(Duration = 604800)]
    public IActionResult EmailAsset(string name)
    {
        var s = Ccs.Infrastructure.Email.EmailAssets.Open(name);
        return s is null ? NotFound() : File(s, "image/png");
    }

    [HttpGet("menus")]
    public async Task<object> Menus(CancellationToken ct) =>
        await db.MenuItems.AsNoTracking().Where(m => m.IsVisible).OrderBy(m => m.Area).ThenBy(m => m.SortOrder)
            .Select(m => new { m.Id, m.Area, m.ParentId, m.Kind, m.LabelEn, m.LabelAr, m.Href, m.Audience, m.NewTab, m.SortOrder, m.SystemKey })
            .ToListAsync(ct);

    /// <summary>Organizations and branches offered on the sign-up form in the "pick" registration modes.</summary>
    [HttpGet("signup-options")]
    public async Task<object> SignupOptions(CancellationToken ct)
    {
        var mode = await db.SiteSettings.Select(x => x.RegistrationMode).FirstOrDefaultAsync(ct);
        if (mode is not ("pick_approval" or "pick_auto")) return new { mode, organizations = Array.Empty<object>() };
        var orgs = await db.Organizations.AsNoTracking().Where(o => o.IsActive).OrderBy(o => o.Name)
            .Select(o => new { o.Id, o.Name, Branches = db.Branches.Where(b => b.OrganizationId == o.Id && b.IsActive).OrderBy(b => b.Name).Select(b => new { b.Id, b.Name }).ToList() })
            .ToListAsync(ct);
        return new { mode, organizations = orgs };
    }
}

/// <summary>The signed-in person: profile, roles, permissions, scope (drives menus and screens in Angular).</summary>
[ApiController]
[Authorize]
[Route("api/me")]
public sealed class MeController(AccessService access, CcsDbContext db, SettingsService settings) : ControllerBase
{
    [HttpGet]
    public async Task<object> Get([FromServices] Ccs.Infrastructure.Identity.AccountSecurity security, CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        var p = await db.Profiles.AsNoTracking().FirstAsync(x => x.Id == c.UserId, ct);
        var roles = await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id where ur.UserId == c.UserId select r.Code).ToListAsync(ct);
        var mfa = await db.Users.Where(u => u.Id == c.UserId).Select(u => u.TwoFactorEnabled).FirstOrDefaultAsync(ct);
        var unread = await db.Notifications.CountAsync(n => n.UserId == c.UserId && n.Channel == "in_app" && n.ReadAt == null, ct);
        var due = await security.MfaDueAsync(c.UserId, mfa, ct);
        return new
        {
            p.Id, p.FullName, p.Email, p.Phone, p.PreferredLocale, p.OrganizationId, p.BranchId,
            roles, permissions = c.Permissions.OrderBy(x => x), c.Admin, staff = c.Staff, viewer = c.Viewer,
            customer = roles.Contains(RoleCode.Customer), scopeLevel = c.ScopeLevel, teams = c.Teams, leadsTeam = c.LeaderOfTeams.Count > 0, mfaEnabled = mfa,
            unreadNotifications = unread, p.PasswordChangedAt, p.AccountStatus,
            idleTimeoutMinutes = await settings.GetIntAsync("idle_timeout_minutes", 5, ct),
            // Settings → Security → Two-step: must set it up by "deadline"; "blocked" once that time has passed.
            mfaSetup = due.Required ? new { deadline = due.Deadline, blocked = due.Blocked } : null,
        };
    }

    // ------------------------------------------------------------------ my signed-in devices

    private Guid? MySession => Guid.TryParse(User.FindFirst(Ccs.Infrastructure.Identity.CcsClaims.Session)?.Value, out var s) ? s : null;

    /// <summary>Where I am signed in: one row per device, this one first.</summary>
    [HttpGet("sessions")]
    public async Task<object> Sessions([FromServices] Ccs.Infrastructure.Identity.TokenService tokens, CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        var mine = MySession;
        return (await tokens.SessionsAsync(c.UserId, ct))
            .Select(x => new { x.Id, device = Ccs.Domain.Rules.DeviceInfo.Label(x.UserAgent), ip = Ccs.Domain.Rules.DeviceInfo.MaskIp(x.IpAddress), x.StartedAt, x.LastUsed, current = x.Id == mine })
            .OrderByDescending(x => x.current).ThenByDescending(x => x.LastUsed).ToList();
    }

    /// <summary>Signs one of my other devices out (at once).</summary>
    [HttpDelete("sessions/{id:guid}")]
    public async Task<IActionResult> EndSession(Guid id, [FromServices] Ccs.Infrastructure.Identity.TokenService tokens, [FromServices] Ccs.Application.Common.AuditService audit, CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        if (id == MySession) throw new Ccs.Infrastructure.Identity.AuthError("thisDevice", 400);
        if (!await tokens.RevokeSessionAsync(id, c.UserId, ct)) return NotFound();
        audit.Write("auth.session_ended", "user", c.UserId, null, new { by = "self" });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Signs out every device except this one.</summary>
    [HttpPost("sessions/sign-out-others")]
    public async Task<object> EndOthers([FromServices] Ccs.Infrastructure.Identity.TokenService tokens, [FromServices] Ccs.Application.Common.AuditService audit, CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        var n = MySession is Guid mine ? await tokens.RevokeOthersAsync(c.UserId, mine, ct) : 0;
        audit.Write("auth.sessions_ended", "user", c.UserId, null, new { by = "self", others = true });
        await db.SaveChangesAsync(ct);
        return new { ended = n };
    }

    public sealed record ProfileBody(string? FullName, string? Phone, string? PreferredLocale);

    /// <summary>My Account: a person changes only their own name, phone and language (v1 updateProfileAction).</summary>
    [HttpPut]
    public async Task<IActionResult> Update(ProfileBody b, CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        var name = (b.FullName ?? "").Trim();
        if (name.Length is < 2 or > 120) throw new Ccs.Infrastructure.Identity.AuthError("nameRequired", 400, "fullName");
        var raw = (b.Phone ?? "").Trim();
        if (raw.Length == 0) throw new Ccs.Infrastructure.Identity.AuthError("phoneRequired", 400, "phone");
        // Egyptian mobile (11 digits starting 01), stored as +201xxxxxxxxx like at registration.
        var phone = (await settings.GetPhoneFormatAsync(ct)).Normalize(raw) ?? throw new Ccs.Infrastructure.Identity.AuthError("phoneInvalid", 400, "phone");
        if (b.PreferredLocale is not ("en" or "ar")) throw new Ccs.Infrastructure.Identity.AuthError("generic", 400, "preferredLocale");
        if (await db.Profiles.AnyAsync(x => x.Phone == phone && x.Id != c.UserId, ct)) throw new Ccs.Infrastructure.Identity.AuthError("phoneTaken", 400, "phone");
        var p = await db.Profiles.FirstAsync(x => x.Id == c.UserId, ct);
        p.FullName = name; p.Phone = phone; p.PreferredLocale = b.PreferredLocale!; p.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }
}
