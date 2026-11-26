using Ccs.Api.Cleanup;
using Ccs.Domain;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>Settings → Clean up data (administrators only): choose, preview (exact, rolled back), then remove.</summary>
public sealed partial class SettingsController
{
    public sealed record CleanupRunBody(CleanupRequest Request, string Confirm, bool BackupConfirmed);

    /// <summary>Lists for the pickers that are small enough to send whole.</summary>
    [HttpGet("cleanup")]
    public async Task<object> CleanupOptions(CancellationToken ct)
    {
        await Need(ct, adminOnly: true);
        var orgs = await db.Organizations.AsNoTracking().OrderBy(o => o.Name).Select(o => new
        {
            o.Id, o.Name, o.IsActive,
            Branches = db.Branches.Where(b => b.OrganizationId == o.Id).OrderBy(b => b.Name).Select(b => new { b.Id, b.Name, b.IsActive }).ToList(),
            People = db.Profiles.Count(p => p.OrganizationId == o.Id),
        }).ToListAsync(ct);
        return new
        {
            counts = new
            {
                tickets = await db.Tickets.CountAsync(ct),
                customers = await db.Profiles.CountAsync(p => db.CcsUserRoles.Any(ur => ur.UserId == p.Id && db.CcsRoles.Any(r => r.Id == ur.RoleId && r.Code == RoleCode.Customer)), ct),
                notifications = await db.Notifications.CountAsync(ct),
                sessions = await db.RefreshTokens.CountAsync(ct),
            },
            teams = await db.Teams.AsNoTracking().OrderBy(t => t.NameEn).Select(t => new { t.Id, t.NameEn, t.NameAr, t.IsActive }).ToListAsync(ct),
            organizations = orgs,
            types = await db.TicketTypes.AsNoTracking().OrderBy(t => t.NameEn).Select(t => new { t.Id, t.NameEn, t.NameAr, t.IsActive }).ToListAsync(ct),
            categories = await db.TicketCategories.AsNoTracking().OrderBy(t => t.NameEn).Select(t => new { t.Id, t.NameEn, t.NameAr, t.IsActive }).ToListAsync(ct),
            subcategories = await db.TicketSubcategories.AsNoTracking().OrderBy(t => t.NameEn).Select(t => new { t.Id, t.NameEn, t.NameAr, t.IsActive }).ToListAsync(ct),
            fields = await db.CustomFieldDefinitions.AsNoTracking().OrderBy(t => t.LabelEn).Select(t => new { t.Id, NameEn = t.LabelEn, NameAr = t.LabelAr, t.IsActive }).ToListAsync(ct),
            kbArticles = await db.KbArticles.AsNoTracking().OrderBy(a => a.TitleEn).Select(a => new { a.Id, NameEn = a.TitleEn, NameAr = a.TitleAr }).ToListAsync(ct),
            kbCategories = await db.KbCategories.AsNoTracking().OrderBy(a => a.NameEn).Select(a => new { a.Id, a.NameEn, a.NameAr }).ToListAsync(ct),
            canned = await db.CannedResponses.AsNoTracking().OrderBy(a => a.Title).Select(a => new { a.Id, Name = a.Title }).ToListAsync(ct),
            calendars = await db.BusinessHours.AsNoTracking().Where(h => !h.IsDefault).OrderBy(h => h.Name).Select(h => new { h.Id, h.Name }).ToListAsync(ct),
        };
    }

    /// <summary>Search customers or staff for the pickers (first 50).</summary>
    [HttpGet("cleanup/people")]
    public async Task<object> CleanupPeople(string kind, string? q, CancellationToken ct)
    {
        var c = await Need(ct, adminOnly: true);
        var staff = kind == "staff";
        var query = db.Profiles.AsNoTracking().Where(p => p.Id != c.UserId && db.CcsUserRoles.Any(ur => ur.UserId == p.Id
            && db.CcsRoles.Any(r => r.Id == ur.RoleId && (staff ? r.Code != RoleCode.Customer : r.Code == RoleCode.Customer))));
        if (!string.IsNullOrWhiteSpace(q)) { var s = q.Trim(); query = query.Where(p => p.FullName.Contains(s) || p.Email.Contains(s)); }
        return await query.OrderBy(p => p.FullName).Take(50).Select(p => new
        {
            p.Id, p.FullName, p.Email, p.AccountStatus,
            Tickets = db.Tickets.Count(t => t.RequesterId == p.Id),
            Role = (from ur in db.CcsUserRoles join r in db.CcsRoles on ur.RoleId equals r.Id where ur.UserId == p.Id select r.Code).FirstOrDefault(),
        }).ToListAsync(ct);
    }

    /// <summary>Search tickets by reference or subject for the picker (first 50).</summary>
    [HttpGet("cleanup/tickets")]
    public async Task<object> CleanupTickets(string? q, CancellationToken ct)
    {
        await Need(ct, adminOnly: true);
        var query = db.Tickets.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(q)) { var s = q.Trim(); query = query.Where(t => t.Reference.Contains(s) || t.Subject.Contains(s)); }
        return await query.OrderByDescending(t => t.CreatedAt).Take(50).Select(t => new { t.Id, t.Reference, t.Subject, t.Status, t.CreatedAt }).ToListAsync(ct);
    }

    /// <summary>Exact numbers for the selection: every step runs, then everything is rolled back.</summary>
    [HttpPost("cleanup/preview")]
    public async Task<object> CleanupPreview(CleanupRequest b, [FromServices] CleanupService cleanup, CancellationToken ct)
    {
        var c = await Need(ct, adminOnly: true);
        return new { counts = (await Guard(() => cleanup.RunAsync(b, c.UserId, commit: false, ct))).Counts };
    }

    [HttpPost("cleanup/run")]
    public async Task<object> CleanupRun(CleanupRunBody b, [FromServices] CleanupService cleanup, [FromServices] ILogger<SettingsController> log, CancellationToken ct)
    {
        var c = await Need(ct, adminOnly: true);
        if (b.Confirm?.Trim().ToUpperInvariant() is not ("DELETE" or "حذف")) throw Err("confirm", "confirm");
        if (!b.BackupConfirmed) throw Err("backup", "backupConfirmed");
        var r = await Guard(() => cleanup.RunAsync(b.Request, c.UserId, commit: true, ct));
        audit.Write("cleanup.run", "system", null, null, new { counts = r.Counts, selection = b.Request });
        await db.SaveChangesAsync(ct);
        // Files go after the commit: a failed delete leaves an orphan file, never a ticket without its file.
        foreach (var path in r.FilesToDelete)
        {
            try { await files.DeleteAsync(path, CancellationToken.None); }
            catch (Exception e) { log.LogWarning(e, "Clean up: could not delete file {Path}", path); }
        }
        return new { counts = r.Counts };
    }

    /// <summary>A link the clean-up does not know about turns into a clear 409 instead of a server error.</summary>
    private static async Task<T> Guard<T>(Func<Task<T>> run)
    {
        try { return await run(); }
        catch (Microsoft.Data.SqlClient.SqlException e) when (e.Number == 547)
        {
            throw Err("cleanupBlocked", null, 409);
        }
    }
}
