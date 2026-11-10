using System.Text.RegularExpressions;
using Ccs.Application.Access;
using Ccs.Application.Abstractions;
using Ccs.Application.Common;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Identity;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>
/// Admin portal, batch 3: status flow, status names and closure reasons (manage_settings), escalation (admin),
/// knowledge base (manage_kb). Saved replies and the public help center are in their own controllers below.
/// </summary>
[ApiController]
[Authorize]
[Route("api/admin")]
public sealed partial class ContentAdminController(CcsDbContext db, AccessService access, AuditService audit, IClock clock) : ControllerBase
{
    public sealed record FlowRow(string From, string To, string Actor, bool RequiresReason);
    public sealed record FlowBody(FlowRow[] Rows);
    public sealed record LabelBody(string? StaffEn, string? StaffAr, string? CustomerEn, string? CustomerAr, string? DescriptionEn, string? DescriptionAr, string? Tone);
    public sealed record ReasonBody(string? Code, string NameEn, string NameAr, bool CustomerMayReopen, bool IsActive, int SortOrder);
    public sealed record EscalationBody(Guid[]? OrganizationIds, Guid[]? BranchIds, string Mode);
    public sealed record KbCategoryBody(string Slug, string NameEn, string NameAr, int SortOrder, bool IsActive);
    public sealed record KbArticleBody(Guid? CategoryId, string Slug, string TitleEn, string? TitleAr, string BodyEn, string? BodyAr, string Status, string Visibility);

    private static readonly string[] Tones = ["brand", "warn", "ok", "danger", "muted"];
    private static AuthError Err(string code, string? field = null, int status = 400) => new(code, status, field);

    private async Task<AccessContext> Need(string? permission, CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        if (c.Admin || (permission is not null && c.Has(permission))) return c;
        throw new ForbiddenException();
    }

    // ================================================================ status flow

    [HttpGet("status-flow")]
    public async Task<object> Flow(CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        var rows = await db.TicketStatusTransitions.AsNoTracking().OrderBy(r => r.Actor).ThenBy(r => r.FromStatus).ThenBy(r => r.ToStatus).ToListAsync(ct);
        var reasons = await db.ClosureReasons.AsNoTracking().OrderBy(r => r.SortOrder).ThenBy(r => r.NameEn).ToListAsync(ct);
        var used = await db.Tickets.AsNoTracking().Where(t => t.ClosureReason != null).Select(t => t.ClosureReason!).Distinct().ToListAsync(ct);
        var labels = await db.SystemMessages.AsNoTracking()
            .Where(m => m.Key.StartsWith("StaffStatus.") || m.Key.StartsWith("CustomerStatus.") || m.Key.StartsWith("StatusInfo."))
            .Select(m => new { m.Key, m.Locale, m.Body }).ToListAsync(ct);
        return new
        {
            statuses = TicketStatus.All,
            transitions = rows.Select(r => new FlowRow(r.FromStatus, r.ToStatus, r.Actor, r.RequiresReason)),
            reasons = reasons.Select(r => new { r.Code, r.NameEn, r.NameAr, r.CustomerMayReopen, r.IsSystem, r.IsActive, r.SortOrder, InUse = used.Contains(r.Code) }),
            labels,
        };
    }

    /// <summary>Replaces the whole table of allowed moves (the screen sends every row).</summary>
    [HttpPut("status-flow")]
    public async Task<IActionResult> SaveFlow(FlowBody b, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        var rows = (b.Rows ?? []).DistinctBy(r => (r.From, r.To, r.Actor)).ToList();
        foreach (var r in rows)
        {
            if (!TicketStatus.IsValid(r.From) || !TicketStatus.IsValid(r.To) || r.From == r.To || r.Actor is not ("staff" or "customer"))
                throw Err("status", "rows");
            if (r.To == TicketStatus.New) throw Err("status", "rows");                     // nothing moves back to New
        }
        // Staff must always be able to take a new ticket forward and finish an open one.
        if (!rows.Any(r => r.Actor == "staff" && r.From == TicketStatus.New)) throw Err("flowNewStuck", "rows");
        if (!rows.Any(r => r.Actor == "staff" && r.To == TicketStatus.Resolved)) throw Err("flowNoResolve", "rows");

        var before = await db.TicketStatusTransitions.AsNoTracking().Select(r => new FlowRow(r.FromStatus, r.ToStatus, r.Actor, r.RequiresReason)).ToListAsync(ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.TicketStatusTransitions.ExecuteDeleteAsync(ct);
        foreach (var r in rows) db.TicketStatusTransitions.Add(new TicketStatusTransition { FromStatus = r.From, ToStatus = r.To, Actor = r.Actor, RequiresReason = r.RequiresReason });
        audit.Write("status_flow.update", "ticket_status_transitions", null, before, rows);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return NoContent();
    }

    /// <summary>Renames a status and sets its colour and description. Empty values go back to the standard text.</summary>
    [HttpPut("status-labels/{status}")]
    public async Task<IActionResult> SaveLabel(string status, LabelBody b, CancellationToken ct)
    {
        var c = await Need(Permission.ManageSettings, ct);
        if (!TicketStatus.IsValid(status)) throw new NotFoundException();
        if (!string.IsNullOrEmpty(b.Tone) && !Tones.Contains(b.Tone)) throw Err("color", "tone");
        var values = new (string Key, string Locale, string? Body)[]
        {
            ($"StaffStatus.{status}", "en", b.StaffEn), ($"StaffStatus.{status}", "ar", b.StaffAr),
            ($"CustomerStatus.{status}", "en", b.CustomerEn), ($"CustomerStatus.{status}", "ar", b.CustomerAr),
            ($"StatusInfo.{status}_desc", "en", b.DescriptionEn), ($"StatusInfo.{status}_desc", "ar", b.DescriptionAr),
            ($"StatusInfo.{status}_tone", "en", b.Tone), ($"StatusInfo.{status}_tone", "ar", b.Tone),
        };
        foreach (var (key, loc, body) in values)
        {
            var text = (body ?? "").Trim();
            if (text.Length > 500) throw Err("locationLong", key);
            var row = await db.SystemMessages.FirstOrDefaultAsync(m => m.Key == key && m.Locale == loc, ct);
            if (text.Length == 0) { if (row is not null) db.SystemMessages.Remove(row); continue; }
            if (row is null) db.SystemMessages.Add(row = new SystemMessage { Key = key, Locale = loc });
            row.Body = text; row.UpdatedAt = clock.UtcNow; row.UpdatedBy = c.UserId;
        }
        audit.Write("status_label.update", "system_messages", null, null, new { status, b });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("closure-reasons")]
    public async Task<object> CreateReason(ReasonBody b, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        var code = Slug(string.IsNullOrWhiteSpace(b.Code) ? b.NameEn : b.Code);
        if (code.Length < 2) throw Err("name", "nameEn");
        if (await db.ClosureReasons.AnyAsync(r => r.Code == code, ct)) throw Err("duplicate", "code", 409);
        var r = new ClosureReason { Code = code };
        await ApplyReasonAsync(r, b, ct);
        db.ClosureReasons.Add(r);
        audit.Write("closure_reason.create", "closure_reason", null, null, new { code, b.NameEn, b.NameAr, b.CustomerMayReopen });
        await db.SaveChangesAsync(ct);
        return new { code };
    }

    [HttpPut("closure-reasons/{code}")]
    public async Task<IActionResult> UpdateReason(string code, ReasonBody b, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        var r = await db.ClosureReasons.FirstOrDefaultAsync(x => x.Code == code, ct) ?? throw new NotFoundException();
        if (r.IsSystem && !b.IsActive) throw Err("builtinLocked", "isActive");
        var before = new { r.NameEn, r.NameAr, r.CustomerMayReopen, r.IsActive, r.SortOrder };
        await ApplyReasonAsync(r, b, ct);
        audit.Write("closure_reason.update", "closure_reason", null, before, new { code, b.NameEn, b.NameAr, b.CustomerMayReopen, b.IsActive, b.SortOrder });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("closure-reasons/{code}")]
    public async Task<IActionResult> DeleteReason(string code, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        var r = await db.ClosureReasons.FirstOrDefaultAsync(x => x.Code == code, ct) ?? throw new NotFoundException();
        if (r.IsSystem) throw Err("builtinLocked");
        if (await db.Tickets.AnyAsync(t => t.ClosureReason == code, ct)) throw Err("inUse", null, 409);
        db.ClosureReasons.Remove(r);
        audit.Write("closure_reason.delete", "closure_reason", null, new { code, r.NameEn }, null);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task ApplyReasonAsync(ClosureReason r, ReasonBody b, CancellationToken ct)
    {
        var (en, ar) = (Name(b.NameEn, "nameEn"), Name(b.NameAr, "nameAr"));
        if (await db.ClosureReasons.AnyAsync(x => x.Code != r.Code && (x.NameEn == en || x.NameAr == ar), ct)) throw Err("nameTaken", "nameEn", 409);
        if (b.SortOrder is < 0 or > 1000) throw Err("number", "sortOrder");
        r.NameEn = en; r.NameAr = ar; r.CustomerMayReopen = b.CustomerMayReopen; r.IsActive = b.IsActive; r.SortOrder = b.SortOrder; r.UpdatedAt = clock.UtcNow;
    }

    // ================================================================ escalation

    [HttpGet("escalation")]
    public async Task<object> Escalation(CancellationToken ct)
    {
        await Need(null, ct);
        var orgs = await (from o in db.Organizations.AsNoTracking()
                          join p in db.Profiles on o.TeamLeaderId equals p.Id into lp
                          from p in lp.DefaultIfEmpty()
                          orderby o.Name
                          select new { o.Id, o.Name, o.ParentId, o.IsActive, Mode = o.EscalationMode, Leader = p == null ? null : p.FullName }).ToListAsync(ct);
        var branches = await (from b in db.Branches.AsNoTracking()
                              join p in db.Profiles on b.TeamLeaderId equals p.Id into lp
                              from p in lp.DefaultIfEmpty()
                              orderby b.Name
                              select new { b.Id, b.OrganizationId, b.Name, b.IsActive, Mode = b.EscalationMode, Leader = p == null ? null : p.FullName }).ToListAsync(ct);
        return new { orgs, branches };
    }

    /// <summary>Applies one mode to the ticked organizations and branches. "inherit" clears a branch's own setting.</summary>
    [HttpPut("escalation")]
    public async Task<IActionResult> SaveEscalation(EscalationBody b, CancellationToken ct)
    {
        await Need(null, ct);
        if (b.Mode is not ("any" or "next" or "off" or "inherit")) throw Err("required", "mode");
        var orgIds = b.OrganizationIds ?? []; var branchIds = b.BranchIds ?? [];
        if (orgIds.Length == 0 && branchIds.Length == 0) throw Err("required", "organizationIds");
        if (orgIds.Length > 0 && b.Mode == "inherit") throw Err("required", "mode");
        var now = clock.UtcNow;
        if (orgIds.Length > 0)
            await db.Organizations.Where(o => orgIds.Contains(o.Id)).ExecuteUpdateAsync(s => s.SetProperty(o => o.EscalationMode, b.Mode).SetProperty(o => o.UpdatedAt, now), ct);
        if (branchIds.Length > 0)
        {
            string? mode = b.Mode == "inherit" ? null : b.Mode;
            await db.Branches.Where(x => branchIds.Contains(x.Id)).ExecuteUpdateAsync(s => s.SetProperty(x => x.EscalationMode, mode).SetProperty(x => x.UpdatedAt, now), ct);
        }
        audit.Write("escalation.update", "organization", null, null, new { b.Mode, orgIds, branchIds });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ================================================================ knowledge base (admin)

    [HttpGet("kb")]
    public async Task<object> Kb(CancellationToken ct)
    {
        await Need(Permission.ManageKb, ct);
        var cats = await db.KbCategories.AsNoTracking().OrderBy(c => c.SortOrder).ThenBy(c => c.NameEn).ToListAsync(ct);
        var arts = await db.KbArticles.AsNoTracking().OrderByDescending(a => a.UpdatedAt).ToListAsync(ct);
        return new { categories = cats, articles = arts };
    }

    [HttpPost("kb-categories")]
    public async Task<object> CreateKbCategory(KbCategoryBody b, CancellationToken ct)
    {
        await Need(Permission.ManageKb, ct);
        var c = new KbCategory { Id = Guid.NewGuid() };
        await ApplyKbCategoryAsync(c, b, ct);
        db.KbCategories.Add(c);
        audit.Write("kb_category.create", "kb_category", c.Id, null, b);
        await db.SaveChangesAsync(ct);
        return new { c.Id };
    }

    [HttpPut("kb-categories/{id:guid}")]
    public async Task<IActionResult> UpdateKbCategory(Guid id, KbCategoryBody b, CancellationToken ct)
    {
        await Need(Permission.ManageKb, ct);
        var c = await db.KbCategories.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var before = new { c.Slug, c.NameEn, c.NameAr, c.SortOrder, c.IsActive };
        await ApplyKbCategoryAsync(c, b, ct);
        audit.Write("kb_category.update", "kb_category", id, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("kb-categories/{id:guid}")]
    public async Task<IActionResult> DeleteKbCategory(Guid id, CancellationToken ct)
    {
        await Need(Permission.ManageKb, ct);
        var c = await db.KbCategories.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (await db.KbArticles.AnyAsync(a => a.CategoryId == id, ct)) throw Err("inUse", null, 409);
        db.KbCategories.Remove(c);
        audit.Write("kb_category.delete", "kb_category", id, new { c.Slug, c.NameEn }, null);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("kb-articles")]
    public async Task<object> CreateArticle(KbArticleBody b, CancellationToken ct)
    {
        var c = await Need(Permission.ManageKb, ct);
        var a = new KbArticle { Id = Guid.NewGuid(), CreatedBy = c.UserId, CreatedAt = clock.UtcNow };
        await ApplyArticleAsync(a, b, ct);
        db.KbArticles.Add(a);
        audit.Write("kb_article.create", "kb_article", a.Id, null, new { b.Slug, b.TitleEn, b.Status, b.Visibility });
        await db.SaveChangesAsync(ct);
        return new { a.Id };
    }

    [HttpPut("kb-articles/{id:guid}")]
    public async Task<IActionResult> UpdateArticle(Guid id, KbArticleBody b, CancellationToken ct)
    {
        await Need(Permission.ManageKb, ct);
        var a = await db.KbArticles.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var before = new { a.Slug, a.TitleEn, a.Status, a.Visibility, a.CategoryId };
        await ApplyArticleAsync(a, b, ct);
        audit.Write("kb_article.update", "kb_article", id, before, new { b.Slug, b.TitleEn, b.Status, b.Visibility, b.CategoryId });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("kb-articles/{id:guid}")]
    public async Task<IActionResult> DeleteArticle(Guid id, CancellationToken ct)
    {
        await Need(Permission.ManageKb, ct);
        var a = await db.KbArticles.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        db.KbArticles.Remove(a);                       // feedback follows (ON DELETE CASCADE)
        audit.Write("kb_article.delete", "kb_article", id, new { a.Slug, a.TitleEn }, null);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task ApplyKbCategoryAsync(KbCategory c, KbCategoryBody b, CancellationToken ct)
    {
        var (en, ar) = (Name(b.NameEn, "nameEn"), Name(b.NameAr, "nameAr"));
        var slug = CheckSlug(string.IsNullOrWhiteSpace(b.Slug) ? Slug(en).Replace('_', '-') : b.Slug.Trim().ToLowerInvariant());
        if (await db.KbCategories.AnyAsync(x => x.Id != c.Id && x.Slug == slug, ct)) throw Err("duplicate", "slug", 409);
        if (await db.KbCategories.AnyAsync(x => x.Id != c.Id && (x.NameEn == en || x.NameAr == ar), ct)) throw Err("nameTaken", "nameEn", 409);
        if (b.SortOrder is < 0 or > 1000) throw Err("number", "sortOrder");
        c.Slug = slug; c.NameEn = en; c.NameAr = ar; c.SortOrder = b.SortOrder; c.IsActive = b.IsActive;
    }

    private async Task ApplyArticleAsync(KbArticle a, KbArticleBody b, CancellationToken ct)
    {
        var title = (b.TitleEn ?? "").Trim();
        if (title.Length is < 3 or > 200) throw Err("title", "titleEn");
        var body = (b.BodyEn ?? "").Trim();
        if (body.Length < 10) throw Err("body", "bodyEn");
        if (b.Status is not ("draft" or "published" or "archived")) throw Err("status", "status");
        if (b.Visibility is not ("public" or "customers" or "internal")) throw Err("visibility", "visibility");
        if (b.CategoryId is Guid cat && !await db.KbCategories.AnyAsync(c => c.Id == cat, ct)) throw Err("notFound", "categoryId");
        var slug = CheckSlug(string.IsNullOrWhiteSpace(b.Slug) ? Slug(title).Replace('_', '-') : b.Slug.Trim().ToLowerInvariant());
        if (await db.KbArticles.AnyAsync(x => x.Id != a.Id && x.Slug == slug, ct)) throw Err("duplicate", "slug", 409);
        var titleAr = string.IsNullOrWhiteSpace(b.TitleAr) ? null : b.TitleAr.Trim();
        if (titleAr is { Length: > 200 }) throw Err("title", "titleAr");
        a.CategoryId = b.CategoryId; a.Slug = slug; a.TitleEn = title; a.TitleAr = titleAr;
        a.BodyEn = body; a.BodyAr = string.IsNullOrWhiteSpace(b.BodyAr) ? null : b.BodyAr.Trim();
        if (b.Status == "published" && a.Status != "published") a.PublishedAt = clock.UtcNow;
        a.Status = b.Status; a.Visibility = b.Visibility; a.UpdatedAt = clock.UtcNow;
    }

    // ================================================================ helpers

    private static string Name(string? v, string field)
    {
        var s = (v ?? "").Trim();
        if (s.Length is < 2 or > 120) throw Err("name", field);
        return s;
    }

    private static string CheckSlug(string s) => SlugOk().IsMatch(s) ? s : throw Err("slug", "slug");

    internal static string Slug(string? v)
    {
        var s = SlugRx().Replace((v ?? "").Trim().ToLowerInvariant(), "_").Trim('_');
        if (s.Length > 38) s = s[..38].Trim('_');
        return s;
    }

    [GeneratedRegex("[^a-z0-9]+")] private static partial Regex SlugRx();
    [GeneratedRegex("^[a-z0-9][a-z0-9-]{1,79}$")] private static partial Regex SlugOk();
}

/// <summary>Saved replies: personal ones for their owner, shared ones for all staff (manage_canned to edit them).</summary>
[ApiController]
[Authorize]
[Route("api/canned")]
public sealed class CannedController(CcsDbContext db, AccessService access, AuditService audit, IClock clock) : ControllerBase
{
    public sealed record CannedBody(string Title, string Body, string Language, bool IsShared);

    private async Task<AccessContext> Staff(CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        return c.Staff ? c : throw new ForbiddenException();
    }

    [HttpGet]
    public async Task<object> List(CancellationToken ct)
    {
        var c = await Staff(ct);
        var rows = await (from r in db.CannedResponses.AsNoTracking()
                          join p in db.Profiles on r.OwnerId equals p.Id
                          where r.IsActive && (r.OwnerId == c.UserId || r.IsShared)
                          orderby r.IsShared, r.Title
                          select new { r.Id, r.Title, r.Body, r.Language, r.IsShared, Owner = p.FullName, Mine = r.OwnerId == c.UserId }).ToListAsync(ct);
        return new { items = rows, canShare = c.Admin || c.Has(Permission.ManageCanned) };
    }

    [HttpPost]
    public async Task<object> Create(CannedBody b, CancellationToken ct)
    {
        var c = await Staff(ct);
        if (b.IsShared && !(c.Admin || c.Has(Permission.ManageCanned))) throw new ForbiddenException();
        var r = new CannedResponse { Id = Guid.NewGuid(), OwnerId = c.UserId, CreatedAt = clock.UtcNow, IsActive = true };
        await ApplyAsync(r, b, ct);
        db.CannedResponses.Add(r);
        audit.Write("canned.create", "canned_response", r.Id, null, new { b.Title, b.IsShared });
        await db.SaveChangesAsync(ct);
        return new { r.Id };
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, CannedBody b, CancellationToken ct)
    {
        var c = await Staff(ct);
        var r = await EditableAsync(c, id, ct);
        if (b.IsShared && !(c.Admin || c.Has(Permission.ManageCanned))) throw new ForbiddenException();
        await ApplyAsync(r, b, ct);
        audit.Write("canned.update", "canned_response", id, null, new { b.Title, b.IsShared });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var c = await Staff(ct);
        var r = await EditableAsync(c, id, ct);
        db.CannedResponses.Remove(r);
        audit.Write("canned.delete", "canned_response", id, new { r.Title }, null);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task<CannedResponse> EditableAsync(AccessContext c, Guid id, CancellationToken ct)
    {
        var r = await db.CannedResponses.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var ok = r.IsShared ? c.Admin || c.Has(Permission.ManageCanned) : r.OwnerId == c.UserId;
        return ok ? r : throw new ForbiddenException();
    }

    private async Task ApplyAsync(CannedResponse r, CannedBody b, CancellationToken ct)
    {
        var title = (b.Title ?? "").Trim(); var body = (b.Body ?? "").Trim();
        if (title.Length is < 2 or > 120) throw new AuthError("titleLength", 400, "title");
        if (body.Length is < 2 or > 5000) throw new AuthError("bodyLength", 400, "body");
        if (b.Language is not ("any" or "en" or "ar")) throw new AuthError("generic", 400, "language");
        var taken = b.IsShared
            ? await db.CannedResponses.AnyAsync(x => x.Id != r.Id && x.IsShared && x.Title == title, ct)
            : await db.CannedResponses.AnyAsync(x => x.Id != r.Id && !x.IsShared && x.OwnerId == r.OwnerId && x.Title == title, ct);
        if (taken) throw new AuthError("nameTaken", 409, "title");
        r.Title = title; r.Body = body; r.Language = b.Language; r.IsShared = b.IsShared; r.UpdatedAt = clock.UtcNow;
    }
}

/// <summary>Help center: published articles the caller may read (public, signed-in, or staff-only), and the helpful vote.</summary>
[ApiController]
[Route("api/kb")]
public sealed class KbController(CcsDbContext db, AccessService access, IClock clock) : ControllerBase
{
    public sealed record VoteBody(bool Helpful);

    private async Task<IQueryable<KbArticle>> VisibleAsync(CancellationToken ct)
    {
        var c = await access.GetContextAsync(ct);
        var signedIn = c.UserId != Guid.Empty && c.Active;
        var q = db.KbArticles.AsNoTracking().Where(a => a.Status == "published");
        return c.Internal && signedIn ? q : signedIn ? q.Where(a => a.Visibility != "internal") : q.Where(a => a.Visibility == "public");
    }

    [HttpGet]
    public async Task<object> List([FromQuery] string? q, [FromQuery] string? category, CancellationToken ct)
    {
        var arts = await VisibleAsync(ct);
        var cats = await db.KbCategories.AsNoTracking().Where(c => c.IsActive).OrderBy(c => c.SortOrder).ThenBy(c => c.NameEn)
            .Select(c => new { c.Id, c.Slug, c.NameEn, c.NameAr }).ToListAsync(ct);
        if (!string.IsNullOrWhiteSpace(category))
        {
            var cid = cats.FirstOrDefault(c => c.Slug == category)?.Id;
            arts = arts.Where(a => a.CategoryId == cid);
        }
        if (!string.IsNullOrWhiteSpace(q))
        {
            var s = q.Trim();
            if (s.Length > 100) s = s[..100];
            arts = arts.Where(a => a.TitleEn.Contains(s) || (a.TitleAr != null && a.TitleAr.Contains(s)) || a.BodyEn.Contains(s) || (a.BodyAr != null && a.BodyAr.Contains(s)));
        }
        var items = await arts.OrderByDescending(a => a.PublishedAt).Take(200)
            .Select(a => new { a.Id, a.Slug, a.TitleEn, a.TitleAr, a.CategoryId, a.Visibility, a.UpdatedAt,
                               Excerpt = a.BodyEn.Length > 220 ? a.BodyEn.Substring(0, 220) : a.BodyEn,
                               ExcerptAr = a.BodyAr == null ? null : a.BodyAr.Length > 220 ? a.BodyAr.Substring(0, 220) : a.BodyAr })
            .ToListAsync(ct);
        return new { categories = cats, items };
    }

    [HttpGet("{slug}")]
    public async Task<object> Get(string slug, CancellationToken ct)
    {
        var a = await (await VisibleAsync(ct)).FirstOrDefaultAsync(x => x.Slug == slug, ct) ?? throw new NotFoundException();
        var c = await access.GetContextAsync(ct);
        bool? myVote = c.UserId == Guid.Empty ? null
            : await db.KbFeedback.Where(f => f.ArticleId == a.Id && f.UserId == c.UserId).Select(f => (bool?)f.Helpful).FirstOrDefaultAsync(ct);
        var related = await (await VisibleAsync(ct)).Where(x => x.Id != a.Id && x.CategoryId == a.CategoryId && a.CategoryId != null)
            .OrderByDescending(x => x.PublishedAt).Take(5).Select(x => new { x.Slug, x.TitleEn, x.TitleAr }).ToListAsync(ct);
        return new
        {
            a.Id, a.Slug, a.TitleEn, a.TitleAr, a.BodyEn, a.BodyAr, a.CategoryId, a.UpdatedAt, a.HelpfulCount, a.NotHelpfulCount,
            MyVote = myVote, SignedIn = c.UserId != Guid.Empty, Related = related,
        };
    }

    [Authorize]
    [HttpPost("{slug}/feedback")]
    public async Task<object> Vote(string slug, VoteBody b, CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        var a = await (await VisibleAsync(ct)).FirstOrDefaultAsync(x => x.Slug == slug, ct) ?? throw new NotFoundException();
        var row = await db.KbFeedback.FirstOrDefaultAsync(f => f.ArticleId == a.Id && f.UserId == c.UserId, ct);
        if (row is null) db.KbFeedback.Add(new KbFeedback { ArticleId = a.Id, UserId = c.UserId, Helpful = b.Helpful, CreatedAt = clock.UtcNow });
        else row.Helpful = b.Helpful;
        await db.SaveChangesAsync(ct);
        // Counts are recomputed from the votes, so changing a vote never double-counts.
        var yes = await db.KbFeedback.CountAsync(f => f.ArticleId == a.Id && f.Helpful, ct);
        var no = await db.KbFeedback.CountAsync(f => f.ArticleId == a.Id && !f.Helpful, ct);
        await db.KbArticles.Where(x => x.Id == a.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.HelpfulCount, yes).SetProperty(x => x.NotHelpfulCount, no), ct);
        return new { helpfulCount = yes, notHelpfulCount = no, myVote = b.Helpful };
    }
}
