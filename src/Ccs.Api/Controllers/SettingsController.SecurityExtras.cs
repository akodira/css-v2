using Ccs.Domain;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>Settings → Security extras: two-step overview, signed-in devices, signing people out, and the security report.</summary>
public sealed partial class SettingsController
{
    // ================================================================ two-step: who must use it, who has it

    /// <summary>Per group: how many active people and how many have two-step; the staff and admins with their deadline.</summary>
    [HttpGet("security/mfa")]
    public async Task<object> MfaOverview([FromServices] AccountSecurity security, CancellationToken ct)
    {
        await Need(ct);
        var p = await security.PolicyAsync(ct);
        var people = await (from pr in db.Profiles.AsNoTracking()
                            join u in db.Users on pr.Id equals u.Id
                            where pr.AccountStatus == AccountStatus.Active
                            select new { pr.Id, pr.FullName, pr.Email, pr.CreatedAt, u.TwoFactorEnabled }).ToListAsync(ct);
        var roles = (await (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id select new { ur.UserId, r.Code }).ToListAsync(ct))
            .GroupBy(x => x.UserId).ToDictionary(g => g.Key, g => g.Select(x => x.Code).ToList());
        var now = clock.UtcNow;
        var rows = people.Select(x =>
        {
            var rs = roles.GetValueOrDefault(x.Id) ?? [RoleCode.Customer];
            var group = SecurityGroups.Of(rs);
            var deadline = x.TwoFactorEnabled ? null : p.MfaDeadline(group, x.CreatedAt);
            return new
            {
                id = x.Id, name = x.FullName, email = x.Email, group, role = rs.FirstOrDefault(r => r != RoleCode.Customer) ?? RoleCode.Customer,
                on = x.TwoFactorEnabled, deadline, blocked = deadline is not null && now >= deadline,
            };
        }).ToList();
        object Count(string g) => new { total = rows.Count(r => r.group == g), on = rows.Count(r => r.group == g && r.on) };
        return new
        {
            counts = new { admins = Count(SecurityGroups.Admins), staff = Count(SecurityGroups.Staff), customers = Count(SecurityGroups.Customers) },
            people = rows.Where(r => r.group != SecurityGroups.Customers).OrderBy(r => r.on).ThenBy(r => r.name).ToList(),
        };
    }

    // ================================================================ signed-in devices

    /// <summary>Every live sign-in (one row per device), newest use first.</summary>
    [HttpGet("security/sessions")]
    public async Task<object> AllSessions([FromServices] TokenService tokens, CancellationToken ct)
    {
        await Need(ct);
        var list = await tokens.SessionsAsync(null, ct);
        var ids = list.Select(x => x.UserId).Distinct().ToList();
        var names = await db.Profiles.AsNoTracking().Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => new { p.FullName, p.Email }, ct);
        return list.Where(x => names.ContainsKey(x.UserId)).OrderByDescending(x => x.LastUsed).Take(500).Select(x => new
        {
            id = x.Id, userId = x.UserId, name = names[x.UserId].FullName, email = names[x.UserId].Email,
            device = DeviceInfo.Label(x.UserAgent), ip = DeviceInfo.MaskIp(x.IpAddress), startedAt = x.StartedAt, lastUsed = x.LastUsed,
        }).ToList();
    }

    public sealed record ReasonBody(string? Reason);

    private static string ReasonOf(ReasonBody b)
    {
        var reason = (b.Reason ?? "").Trim();
        if (reason.Length is < 5 or > 300) throw Err("unlockReason", "reason");
        return reason;
    }

    /// <summary>Signs one device out at once (admins only); the reason goes to the Audit log.</summary>
    [HttpPost("security/sessions/{sessionId:guid}/end")]
    public async Task<IActionResult> EndSession(Guid sessionId, ReasonBody b, [FromServices] TokenService tokens, CancellationToken ct)
    {
        await Need(ct, adminOnly: true);
        var reason = ReasonOf(b);
        var owner = await db.RefreshTokens.AsNoTracking().Where(r => r.SessionId == sessionId || r.Id == sessionId).Select(r => (Guid?)r.UserId).FirstOrDefaultAsync(ct);
        if (owner is null || !await tokens.RevokeSessionAsync(sessionId, null, ct)) return NotFound();
        audit.Write("auth.session_ended", "user", owner, null, new { by = "admin", reason });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Signs a person out everywhere (lost laptop, left the company); admins only, with a reason.</summary>
    [HttpPost("security/sign-out/{userId:guid}")]
    public async Task<IActionResult> SignOutEverywhere(Guid userId, ReasonBody b, [FromServices] TokenService tokens, CancellationToken ct)
    {
        await Need(ct, adminOnly: true);
        var reason = ReasonOf(b);
        if (!await db.Profiles.AnyAsync(p => p.Id == userId, ct)) return NotFound();
        await tokens.RevokeAllAsync(userId, ct);
        audit.Write("auth.sessions_ended", "user", userId, null, new { by = "admin", reason });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ================================================================ security report (from the Audit log)

    private static readonly string[] ReportActions = ["auth.login_failed", "auth.locked", "auth.new_device", "auth.unlocked_manual"];

    public sealed record ReportDay(string Day, int Failed, int Locks);
    public sealed record ReportCount(string Name, int Count);
    public sealed record SecurityReport(int Days, int Failed, int Locks, int NewDevices, int AdminUnlocks,
        List<ReportDay> PerDay, List<ReportCount> Accounts, List<ReportCount> Addresses);

    private async Task<SecurityReport> BuildReportAsync(int days, CancellationToken ct)
    {
        if (days is not (7 or 30 or 90)) days = 7;
        var cairo = TimeZoneInfo.FindSystemTimeZoneById(OperatingSystem.IsWindows() ? "Egypt Standard Time" : "Africa/Cairo");
        DateOnly DayOf(DateTimeOffset t) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(t, cairo).DateTime);
        var first = DayOf(clock.UtcNow).AddDays(1 - days);
        var since = clock.UtcNow.AddDays(-days - 1);
        var rows = (await db.AuditLogs.AsNoTracking().Where(a => ReportActions.Contains(a.Action) && a.CreatedAt > since)
                .Select(a => new { a.Action, a.EntityId, a.IpAddress, a.After, a.CreatedAt }).Take(200_000).ToListAsync(ct))
            .Select(a => new { a.Action, a.EntityId, a.IpAddress, a.After, Day = DayOf(a.CreatedAt) }).Where(a => a.Day >= first).ToList();
        var failed = rows.Where(a => a.Action == "auth.login_failed").ToList();
        var perDay = Enumerable.Range(0, days).Select(i => first.AddDays(i))
            .Select(d => new ReportDay(d.ToString("yyyy-MM-dd"), failed.Count(a => a.Day == d), rows.Count(a => a.Day == d && a.Action == "auth.locked"))).ToList();
        var ids = failed.Where(a => a.EntityId != null).Select(a => a.EntityId!.Value).Distinct().ToList();
        var emails = await db.Profiles.AsNoTracking().Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Email, ct);
        static string? Unknown(string? after)
        {
            try { return after is not null && System.Text.Json.JsonDocument.Parse(after).RootElement.TryGetProperty("unknown", out var u) ? u.GetString() : null; }
            catch (System.Text.Json.JsonException) { return null; }
        }
        // "(no account)" rows are addresses that have no account, shortened when they were recorded.
        var accounts = failed.GroupBy(a => a.EntityId is Guid id ? emails.GetValueOrDefault(id) ?? "?" : "(no account) " + (Unknown(a.After) ?? "?"))
            .Select(g => new ReportCount(g.Key, g.Count())).OrderByDescending(x => x.Count).Take(10).ToList();
        var ips = failed.Where(a => !string.IsNullOrEmpty(a.IpAddress)).GroupBy(a => DeviceInfo.MaskIp(a.IpAddress))
            .Select(g => new ReportCount(g.Key, g.Count())).OrderByDescending(x => x.Count).Take(10).ToList();
        return new SecurityReport(days, failed.Count, rows.Count(a => a.Action == "auth.locked"), rows.Count(a => a.Action == "auth.new_device"),
            rows.Count(a => a.Action == "auth.unlocked_manual"), perDay, accounts, ips);
    }

    [HttpGet("security/report")]
    public async Task<SecurityReport> Report(int days, CancellationToken ct)
    {
        await Need(ct);
        return await BuildReportAsync(days, ct);
    }

    /// <summary>The same report as an Excel file (four sheets), headings in the caller's language.</summary>
    [HttpGet("security/report.xlsx")]
    public async Task<IActionResult> ReportExcel(int days, string? lang, CancellationToken ct)
    {
        await Need(ct);
        var r = await BuildReportAsync(days, ct);
        var ar = lang == "ar";
        string T(string en, string a) => ar ? a : en;
        static IReadOnlyList<object?> Row(params object?[] v) => v;
        var file = SimpleXlsx.Build([
            new(T("Summary", "الملخص"), [
                Row(T("Item", "البند"), T("Count", "العدد")),
                Row(T("Period (days)", "المدة (بالأيام)"), r.Days),
                Row(T("Failed sign-ins", "محاولات الدخول غير الناجحة"), r.Failed),
                Row(T("Accounts locked", "مرات إيقاف الحسابات"), r.Locks),
                Row(T("New-device sign-ins", "الدخول من أجهزة جديدة"), r.NewDevices),
                Row(T("Unlocked by admins", "الحسابات التي فتحها المسؤولون"), r.AdminUnlocks)]),
            new(T("Per day", "حسب اليوم"), [Row(T("Day", "اليوم"), T("Failed sign-ins", "المحاولات غير الناجحة"), T("Locks", "مرات الإيقاف")),
                .. r.PerDay.Select(d => Row(d.Day, d.Failed, d.Locks))]),
            new(T("Accounts", "الحسابات"), [Row(T("Account", "الحساب"), T("Failed sign-ins", "المحاولات غير الناجحة")), .. r.Accounts.Select(a => Row(a.Name, a.Count))]),
            new(T("Addresses", "عناوين الشبكة"), [Row(T("Network address", "عنوان الشبكة"), T("Failed sign-ins", "المحاولات غير الناجحة")), .. r.Addresses.Select(a => Row(a.Name, a.Count))]),
        ]);
        return File(file, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"security-report-{r.Days}d-{clock.UtcNow:yyyyMMdd}.xlsx");
    }
}
