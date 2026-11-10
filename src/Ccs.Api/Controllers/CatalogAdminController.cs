using System.Text.Json;
using System.Text.RegularExpressions;
using Ccs.Application.Access;
using Ccs.Application.Abstractions;
using Ccs.Application.Common;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Infrastructure.Identity;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>
/// Admin portal, batch 2: ticket types, categories and subcategories, priorities, custom fields (manage_catalog);
/// SLA targets, working hours and holidays (manage_settings). Each change writes an audit row.
/// </summary>
[ApiController]
[Authorize]
[Route("api/admin")]
public sealed partial class CatalogAdminController(CcsDbContext db, AccessService access, AuditService audit, IClock clock) : ControllerBase
{
    public sealed record TypeBody(string NameEn, string NameAr, string? DescriptionEn, string? DescriptionAr, string? ExamplesEn, string? ExamplesAr,
        int SortOrder, bool IsActive, Guid[] CategoryIds);
    public sealed record CategoryBody(string NameEn, string NameAr, Guid? DefaultTeamId, bool IsActive, int SortOrder, string? PriorityCode,
        bool IsPrivate, bool AutoAssign, Guid[]? TypeIds);
    public sealed record SubcategoryBody(Guid CategoryId, string NameEn, string NameAr, bool IsActive, int SortOrder, string? PriorityCode);
    public sealed record PriorityBody(string NameEn, string NameAr, string Color, string Icon, int SortOrder, bool IsActive,
        int FirstResponseMinutes, int ResolutionMinutes);
    public sealed record ModeBody(string Mode);
    public sealed record FieldOptionRow(string Value, string LabelEn, string? LabelAr);
    public sealed record FieldBody(string Key, string LabelEn, string LabelAr, string Type, FieldOptionRow[]? Options, bool IsRequired,
        bool VisibleToCustomer, Guid? CategoryId, bool IsActive, int SortOrder, double? Min, double? Max, int? MinLength, int? MaxLength, string? Pattern);
    public sealed record SlaBody(int FirstResponseMinutes, int ResolutionMinutes, int WarningThresholdPct, bool PauseOnPendingCustomer,
        bool PauseOnPendingInternal, Guid? BusinessHoursId, string[]? WarnNotify, string[]? BreachNotify);
    public sealed record HoursBody(string Name, string Timezone, Dictionary<string, string[][]> Schedule, bool IsDefault);
    public sealed record HolidayBody(DateOnly Date, string Name);

    private static readonly string[] Colors = ["red", "amber", "blue", "green", "grey", "light"];
    private static readonly string[] Icons = ["alert", "arrow_up", "minus", "arrow_down", "bolt", "flag", "clock", "star"];
    private static readonly string[] FieldTypes = ["text", "long_text", "number", "date", "dropdown", "multi_select", "checkbox", "radio", "file"];
    private static readonly string[] Days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    private static readonly string[] NotifyRoles = ["agent", "team_leader", "admin"];

    private static AuthError Err(string code, string? field = null, int status = 400) => new(code, status, field);

    private async Task Need(string permission, CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        if (!c.Admin && !c.Has(permission)) throw new ForbiddenException();
    }

    // ================================================================ catalogue (one read for the whole screen)

    [HttpGet("catalog")]
    public async Task<object> Catalog(CancellationToken ct)
    {
        await Need(Permission.ManageCatalog, ct);
        var types = await db.TicketTypes.AsNoTracking().OrderBy(t => t.SortOrder).ThenBy(t => t.NameEn).ToListAsync(ct);
        var links = await db.TicketTypeCategories.AsNoTracking().ToListAsync(ct);
        var cats = await db.TicketCategories.AsNoTracking().OrderBy(c => c.SortOrder).ThenBy(c => c.NameEn).ToListAsync(ct);
        var subs = await db.TicketSubcategories.AsNoTracking().OrderBy(s => s.SortOrder).ThenBy(s => s.NameEn).ToListAsync(ct);
        var byType = await db.Tickets.AsNoTracking().Where(t => t.TicketTypeId != null).GroupBy(t => t.TicketTypeId).Select(g => new { Id = g.Key!.Value, N = g.Count() }).ToListAsync(ct);
        var byCat = await db.Tickets.AsNoTracking().GroupBy(t => t.CategoryId).Select(g => new { Id = g.Key, N = g.Count() }).ToListAsync(ct);
        var bySub = await db.Tickets.AsNoTracking().Where(t => t.SubcategoryId != null).GroupBy(t => t.SubcategoryId).Select(g => new { Id = g.Key!.Value, N = g.Count() }).ToListAsync(ct);
        var fields = await db.CustomFieldDefinitions.AsNoTracking().OrderBy(f => f.SortOrder).ThenBy(f => f.LabelEn).ToListAsync(ct);
        var used = await db.TicketCustomFieldValues.AsNoTracking().Select(v => v.FieldId).Distinct().ToListAsync(ct);
        var teams = await db.Teams.AsNoTracking().OrderBy(t => t.NameEn).Select(t => new { t.Id, t.NameEn, t.NameAr, t.IsActive }).ToListAsync(ct);
        var prios = await db.Priorities.AsNoTracking().OrderBy(p => p.SortOrder).Select(p => new { p.Code, p.NameEn, p.NameAr, p.Color, p.IsActive }).ToListAsync(ct);
        int N<T>(IEnumerable<T> rows, Func<T, bool> hit, Func<T, int> n) => rows.Where(hit).Select(n).FirstOrDefault();

        return new
        {
            types = types.Select(t => new
            {
                t.Id, t.NameEn, t.NameAr, t.DescriptionEn, t.DescriptionAr, t.ExamplesEn, t.ExamplesAr, t.SortOrder, t.IsActive,
                CategoryIds = links.Where(l => l.TypeId == t.Id).Select(l => l.CategoryId),
                Tickets = N(byType, x => x.Id == t.Id, x => x.N),
            }),
            categories = cats.Select(c => new
            {
                c.Id, c.NameEn, c.NameAr, c.DefaultTeamId, c.IsActive, c.SortOrder, c.PriorityCode, c.IsPrivate, c.AutoAssign,
                TypeIds = links.Where(l => l.CategoryId == c.Id).Select(l => l.TypeId),
                Tickets = N(byCat, x => x.Id == c.Id, x => x.N),
                Subcategories = subs.Where(s => s.CategoryId == c.Id).Select(s => new
                {
                    s.Id, s.CategoryId, s.NameEn, s.NameAr, s.IsActive, s.SortOrder, s.PriorityCode,
                    Tickets = N(bySub, x => x.Id == s.Id, x => x.N),
                }),
            }),
            fields = fields.Select(f => new
            {
                f.Id, f.Key, f.LabelEn, f.LabelAr, f.Type, f.Options, f.IsRequired, f.Validation, f.VisibleToCustomer, f.CategoryId,
                f.IsActive, f.SortOrder, HasValues = used.Contains(f.Id),
            }),
            teams,
            priorities = prios,
        };
    }

    // ================================================================ ticket types

    [HttpPost("ticket-types")]
    public async Task<object> CreateType(TypeBody b, CancellationToken ct)
    {
        await Need(Permission.ManageCatalog, ct);
        var t = new TicketType { Id = Guid.NewGuid(), CreatedAt = clock.UtcNow };
        await ApplyTypeAsync(t, b, ct);
        db.TicketTypes.Add(t);
        await db.SaveChangesAsync(ct);                 // the type first: the links point at it
        await LinkTypeAsync(t.Id, b.CategoryIds, ct);
        audit.Write("ticket_type.create", "ticket_type", t.Id, null, b);
        await db.SaveChangesAsync(ct);
        return new { t.Id };
    }

    [HttpPut("ticket-types/{id:guid}")]
    public async Task<IActionResult> UpdateType(Guid id, TypeBody b, CancellationToken ct)
    {
        await Need(Permission.ManageCatalog, ct);
        var t = await db.TicketTypes.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (t.IsActive && !b.IsActive && !await db.TicketTypes.AnyAsync(x => x.Id != id && x.IsActive, ct)) throw Err("lastTicketType");
        var before = new { t.NameEn, t.NameAr, t.IsActive, t.SortOrder };
        await ApplyTypeAsync(t, b, ct);
        await LinkTypeAsync(id, b.CategoryIds, ct);
        audit.Write("ticket_type.update", "ticket_type", id, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("ticket-types/{id:guid}")]
    public async Task<IActionResult> DeleteType(Guid id, CancellationToken ct)
    {
        await Need(Permission.ManageCatalog, ct);
        var t = await db.TicketTypes.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (await db.Tickets.AnyAsync(x => x.TicketTypeId == id, ct)) throw Err("ticketTypeInUse", null, 409);
        if (t.IsActive && !await db.TicketTypes.AnyAsync(x => x.Id != id && x.IsActive, ct)) throw Err("lastTicketType");
        await db.TicketTypeCategories.Where(l => l.TypeId == id).ExecuteDeleteAsync(ct);
        db.TicketTypes.Remove(t);
        audit.Write("ticket_type.delete", "ticket_type", id, new { t.NameEn, t.NameAr }, null);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task ApplyTypeAsync(TicketType t, TypeBody b, CancellationToken ct)
    {
        var (en, ar) = (Name(b.NameEn, "nameEn"), Name(b.NameAr, "nameAr"));
        if (await db.TicketTypes.AnyAsync(x => x.Id != t.Id && (x.NameEn == en || x.NameAr == ar), ct)) throw Err("nameTaken", "nameEn", 409);
        t.NameEn = en; t.NameAr = ar;
        t.DescriptionEn = Text(b.DescriptionEn, 1000); t.DescriptionAr = Text(b.DescriptionAr, 1000);
        t.ExamplesEn = Text(b.ExamplesEn, 1000); t.ExamplesAr = Text(b.ExamplesAr, 1000);
        t.SortOrder = Sort(b.SortOrder); t.IsActive = b.IsActive;
    }

    private async Task LinkTypeAsync(Guid typeId, Guid[]? categoryIds, CancellationToken ct)
    {
        var ids = (categoryIds ?? []).Distinct().ToList();
        if (await db.TicketCategories.CountAsync(c => ids.Contains(c.Id), ct) != ids.Count) throw Err("notFound", "categoryIds");
        await db.TicketTypeCategories.Where(l => l.TypeId == typeId).ExecuteDeleteAsync(ct);
        foreach (var c in ids) db.TicketTypeCategories.Add(new TicketTypeCategory { TypeId = typeId, CategoryId = c });
    }

    // ================================================================ categories and subcategories

    [HttpPost("categories")]
    public async Task<object> CreateCategory(CategoryBody b, CancellationToken ct)
    {
        await Need(Permission.ManageCatalog, ct);
        var c = new TicketCategory { Id = Guid.NewGuid() };
        await ApplyCategoryAsync(c, b, ct);
        db.TicketCategories.Add(c);
        await db.SaveChangesAsync(ct);
        if (b.TypeIds is not null) await LinkCategoryAsync(c.Id, b.TypeIds, ct);
        audit.Write("category.create", "ticket_category", c.Id, null, b);
        await db.SaveChangesAsync(ct);
        return new { c.Id };
    }

    [HttpPut("categories/{id:guid}")]
    public async Task<IActionResult> UpdateCategory(Guid id, CategoryBody b, CancellationToken ct)
    {
        await Need(Permission.ManageCatalog, ct);
        var c = await db.TicketCategories.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var before = new { c.NameEn, c.NameAr, c.DefaultTeamId, c.IsActive, c.SortOrder, c.PriorityCode, c.IsPrivate, c.AutoAssign };
        await ApplyCategoryAsync(c, b, ct);
        if (b.TypeIds is not null) await LinkCategoryAsync(id, b.TypeIds, ct);
        audit.Write("category.update", "ticket_category", id, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("categories/{id:guid}")]
    public async Task<IActionResult> DeleteCategory(Guid id, CancellationToken ct)
    {
        await Need(Permission.ManageCatalog, ct);
        var c = await db.TicketCategories.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (await db.Tickets.AnyAsync(t => t.CategoryId == id, ct)) throw Err("inUse", null, 409);
        await db.TicketTypeCategories.Where(l => l.CategoryId == id).ExecuteDeleteAsync(ct);
        db.TicketCategories.Remove(c);                 // subcategories and category fields follow (ON DELETE CASCADE)
        audit.Write("category.delete", "ticket_category", id, new { c.NameEn, c.NameAr }, null);
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { throw Err("inUse", null, 409); }
        return NoContent();
    }

    [HttpPost("subcategories")]
    public async Task<object> CreateSub(SubcategoryBody b, CancellationToken ct)
    {
        await Need(Permission.ManageCatalog, ct);
        var s = new TicketSubcategory { Id = Guid.NewGuid() };
        await ApplySubAsync(s, b, ct);
        db.TicketSubcategories.Add(s);
        audit.Write("subcategory.create", "ticket_subcategory", s.Id, null, b);
        await db.SaveChangesAsync(ct);
        return new { s.Id };
    }

    [HttpPut("subcategories/{id:guid}")]
    public async Task<IActionResult> UpdateSub(Guid id, SubcategoryBody b, CancellationToken ct)
    {
        await Need(Permission.ManageCatalog, ct);
        var s = await db.TicketSubcategories.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (s.CategoryId != b.CategoryId && await db.Tickets.AnyAsync(t => t.SubcategoryId == id, ct)) throw Err("inUse", "categoryId", 409);
        var before = new { s.CategoryId, s.NameEn, s.NameAr, s.IsActive, s.SortOrder, s.PriorityCode };
        await ApplySubAsync(s, b, ct);
        audit.Write("subcategory.update", "ticket_subcategory", id, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("subcategories/{id:guid}")]
    public async Task<IActionResult> DeleteSub(Guid id, CancellationToken ct)
    {
        await Need(Permission.ManageCatalog, ct);
        var s = await db.TicketSubcategories.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (await db.Tickets.AnyAsync(t => t.SubcategoryId == id, ct)) throw Err("inUse", null, 409);
        db.TicketSubcategories.Remove(s);
        audit.Write("subcategory.delete", "ticket_subcategory", id, new { s.NameEn, s.NameAr }, null);
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { throw Err("inUse", null, 409); }
        return NoContent();
    }

    private async Task ApplyCategoryAsync(TicketCategory c, CategoryBody b, CancellationToken ct)
    {
        var (en, ar) = (Name(b.NameEn, "nameEn"), Name(b.NameAr, "nameAr"));
        if (await db.TicketCategories.AnyAsync(x => x.Id != c.Id && (x.NameEn == en || x.NameAr == ar), ct)) throw Err("nameTaken", "nameEn", 409);
        if (b.DefaultTeamId is Guid tm && !await db.Teams.AnyAsync(t => t.Id == tm, ct)) throw Err("notFound", "defaultTeamId");
        await CheckPriorityAsync(b.PriorityCode, ct);
        c.NameEn = en; c.NameAr = ar; c.DefaultTeamId = b.DefaultTeamId; c.IsActive = b.IsActive; c.SortOrder = Sort(b.SortOrder);
        c.PriorityCode = Blank(b.PriorityCode); c.IsPrivate = b.IsPrivate; c.AutoAssign = b.AutoAssign;
    }

    private async Task LinkCategoryAsync(Guid categoryId, Guid[] typeIds, CancellationToken ct)
    {
        var ids = typeIds.Distinct().ToList();
        if (await db.TicketTypes.CountAsync(t => ids.Contains(t.Id), ct) != ids.Count) throw Err("notFound", "typeIds");
        await db.TicketTypeCategories.Where(l => l.CategoryId == categoryId).ExecuteDeleteAsync(ct);
        foreach (var t in ids) db.TicketTypeCategories.Add(new TicketTypeCategory { TypeId = t, CategoryId = categoryId });
    }

    private async Task ApplySubAsync(TicketSubcategory s, SubcategoryBody b, CancellationToken ct)
    {
        var (en, ar) = (Name(b.NameEn, "nameEn"), Name(b.NameAr, "nameAr"));
        if (!await db.TicketCategories.AnyAsync(c => c.Id == b.CategoryId, ct)) throw Err("notFound", "categoryId");
        if (await db.TicketSubcategories.AnyAsync(x => x.Id != s.Id && x.CategoryId == b.CategoryId && (x.NameEn == en || x.NameAr == ar), ct))
            throw Err("nameTaken", "nameEn", 409);
        await CheckPriorityAsync(b.PriorityCode, ct);
        s.CategoryId = b.CategoryId; s.NameEn = en; s.NameAr = ar; s.IsActive = b.IsActive; s.SortOrder = Sort(b.SortOrder);
        s.PriorityCode = Blank(b.PriorityCode);
    }

    // ================================================================ priorities

    [HttpGet("priorities")]
    public async Task<object> Priorities(CancellationToken ct)
    {
        await Need(Permission.ManageCatalog, ct);
        var rows = await db.Priorities.AsNoTracking().OrderBy(p => p.SortOrder).ToListAsync(ct);
        var sla = await db.SlaPolicies.AsNoTracking().Where(p => p.IsActive).ToListAsync(ct);
        var cats = await db.TicketCategories.AsNoTracking().Where(c => c.PriorityCode != null).Select(c => c.PriorityCode!).ToListAsync(ct);
        var subs = await db.TicketSubcategories.AsNoTracking().Where(c => c.PriorityCode != null).Select(c => c.PriorityCode!).ToListAsync(ct);
        var tickets = await db.Tickets.AsNoTracking().GroupBy(t => t.Priority).Select(g => new { g.Key, N = g.Count() }).ToListAsync(ct);
        var mode = await db.SiteSettings.AsNoTracking().Select(s => s.PriorityMode).FirstOrDefaultAsync(ct) ?? "system";
        return new
        {
            mode,
            priorities = rows.Select(p =>
            {
                var pol = sla.FirstOrDefault(s => s.Priority == p.Code);
                return new
                {
                    p.Code, p.NameEn, p.NameAr, p.Color, p.Icon, p.SortOrder, p.IsActive,
                    FirstResponseMinutes = pol?.FirstResponseMinutes, ResolutionMinutes = pol?.ResolutionMinutes,
                    UsedBy = cats.Count(c => c == p.Code) + subs.Count(c => c == p.Code),
                    Tickets = tickets.FirstOrDefault(t => t.Key == p.Code)?.N ?? 0,
                    IsDefault = p.Code == "normal",
                };
            }),
        };
    }

    [HttpPost("priorities")]
    public async Task<object> CreatePriority(PriorityBody b, CancellationToken ct)
    {
        await Need(Permission.ManageCatalog, ct);
        var code = Slug(b.NameEn);
        if (code.Length < 2) throw Err("priorityName", "nameEn");
        var n = 2; var baseCode = code;
        while (await db.Priorities.AnyAsync(p => p.Code == code, ct)) code = $"{baseCode}_{n++}";
        var p = new Priority { Code = code, CreatedAt = clock.UtcNow };
        await ApplyPriorityAsync(p, b, ct);
        db.Priorities.Add(p);
        await db.SaveChangesAsync(ct);                 // the priority first: the SLA row points at it
        await UpsertSlaAsync(code, b.FirstResponseMinutes, b.ResolutionMinutes, null, ct);
        audit.Write("priority.create", "priority", null, null, new { code, b.NameEn, b.NameAr, b.Color, b.FirstResponseMinutes, b.ResolutionMinutes });
        await db.SaveChangesAsync(ct);
        return new { code };
    }

    [HttpPut("priorities/{code}")]
    public async Task<IActionResult> UpdatePriority(string code, PriorityBody b, CancellationToken ct)
    {
        await Need(Permission.ManageCatalog, ct);
        var p = await db.Priorities.FirstOrDefaultAsync(x => x.Code == code, ct) ?? throw new NotFoundException();
        if (code == "normal" && !b.IsActive) throw Err("defaultPriority");
        var before = new { p.NameEn, p.NameAr, p.Color, p.Icon, p.SortOrder, p.IsActive };
        await ApplyPriorityAsync(p, b, ct);
        await UpsertSlaAsync(code, b.FirstResponseMinutes, b.ResolutionMinutes, null, ct);
        audit.Write("priority.update", "priority", null, before, new { code, b.NameEn, b.NameAr, b.Color, b.Icon, b.SortOrder, b.IsActive, b.FirstResponseMinutes, b.ResolutionMinutes });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("priorities/{code}")]
    public async Task<IActionResult> DeletePriority(string code, CancellationToken ct)
    {
        await Need(Permission.ManageCatalog, ct);
        if (code == "normal") throw Err("defaultPriority");
        var p = await db.Priorities.FirstOrDefaultAsync(x => x.Code == code, ct) ?? throw new NotFoundException();
        if (await db.Tickets.AnyAsync(t => t.Priority == code, ct)
            || await db.TicketCategories.AnyAsync(c => c.PriorityCode == code, ct)
            || await db.TicketSubcategories.AnyAsync(c => c.PriorityCode == code, ct)) throw Err("inUse", null, 409);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        try
        {
            await db.SlaPolicies.Where(s => s.Priority == code).ExecuteDeleteAsync(ct);
            db.Priorities.Remove(p);
            audit.Write("priority.delete", "priority", null, new { code, p.NameEn, p.NameAr }, null);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (Exception e) when (e is DbUpdateException or Microsoft.Data.SqlClient.SqlException)
        {
            await tx.RollbackAsync(ct);
            throw Err("inUse", null, 409);
        }
        return NoContent();
    }

    [HttpPut("priorities-mode")]
    public async Task<IActionResult> PriorityMode(ModeBody b, CancellationToken ct)
    {
        await Need(Permission.ManageCatalog, ct);
        if (b.Mode is not ("system" or "customer")) throw Err("required", "mode");
        var s = await db.SiteSettings.FirstOrDefaultAsync(ct) ?? throw new NotFoundException();
        var before = s.PriorityMode;
        s.PriorityMode = b.Mode;
        audit.Write("settings.priority_mode", "site_settings", null, new { mode = before }, new { mode = b.Mode });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task ApplyPriorityAsync(Priority p, PriorityBody b, CancellationToken ct)
    {
        var en = (b.NameEn ?? "").Trim(); var ar = (b.NameAr ?? "").Trim();
        if (en.Length is < 1 or > 60) throw Err("priorityName", "nameEn");
        if (ar.Length is < 1 or > 60) throw Err("priorityName", "nameAr");
        if (await db.Priorities.AnyAsync(x => x.Code != p.Code && (x.NameEn == en || x.NameAr == ar), ct)) throw Err("nameTaken", "nameEn", 409);
        if (!Colors.Contains(b.Color)) throw Err("color", "color");
        if (!Icons.Contains(b.Icon)) throw Err("required", "icon");
        if (b.SortOrder is < 0 or > 1000) throw Err("number", "sortOrder");
        p.NameEn = en; p.NameAr = ar; p.Color = b.Color; p.Icon = b.Icon; p.SortOrder = b.SortOrder; p.IsActive = b.IsActive;
    }

    // ================================================================ custom fields

    [HttpPost("fields")]
    public async Task<object> CreateField(FieldBody b, CancellationToken ct)
    {
        await Need(Permission.ManageCatalog, ct);
        var key = (b.Key ?? "").Trim();
        if (!KeyRx().IsMatch(key)) throw Err("key", "key");
        if (await db.CustomFieldDefinitions.AnyAsync(f => f.Key == key, ct)) throw Err("duplicate", "key", 409);
        var f = new CustomFieldDefinition { Id = Guid.NewGuid(), Key = key };
        await ApplyFieldAsync(f, b, false, ct);
        db.CustomFieldDefinitions.Add(f);
        audit.Write("custom_field.create", "custom_field", f.Id, null, b);
        await db.SaveChangesAsync(ct);
        return new { f.Id };
    }

    [HttpPut("fields/{id:guid}")]
    public async Task<IActionResult> UpdateField(Guid id, FieldBody b, CancellationToken ct)
    {
        await Need(Permission.ManageCatalog, ct);
        var f = await db.CustomFieldDefinitions.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var hasValues = await db.TicketCustomFieldValues.AnyAsync(v => v.FieldId == id, ct);
        var before = new { f.LabelEn, f.LabelAr, f.Type, f.Options, f.IsRequired, f.Validation, f.VisibleToCustomer, f.CategoryId, f.IsActive };
        await ApplyFieldAsync(f, b, hasValues, ct);
        audit.Write("custom_field.update", "custom_field", id, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("fields/{id:guid}")]
    public async Task<IActionResult> DeleteField(Guid id, CancellationToken ct)
    {
        await Need(Permission.ManageCatalog, ct);
        var f = await db.CustomFieldDefinitions.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (await db.TicketCustomFieldValues.AnyAsync(v => v.FieldId == id, ct)) throw Err("inUse", null, 409);
        db.CustomFieldDefinitions.Remove(f);
        audit.Write("custom_field.delete", "custom_field", id, new { f.Key, f.LabelEn }, null);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task ApplyFieldAsync(CustomFieldDefinition f, FieldBody b, bool hasValues, CancellationToken ct)
    {
        var (en, ar) = (Name(b.LabelEn, "labelEn"), Name(b.LabelAr, "labelAr"));
        if (!FieldTypes.Contains(b.Type)) throw Err("type", "type");
        if (hasValues && b.Type != f.Type) throw Err("typeLocked", "type");
        if (b.CategoryId is Guid cat && !await db.TicketCategories.AnyAsync(c => c.Id == cat, ct)) throw Err("notFound", "categoryId");
        if (await db.CustomFieldDefinitions.AnyAsync(x => x.Id != f.Id && x.CategoryId == b.CategoryId && x.LabelEn == en, ct)) throw Err("nameTaken", "labelEn", 409);
        if (b.IsRequired && !b.VisibleToCustomer) throw Err("staffOnlyRequired", "isRequired");

        var options = "[]";
        if (b.Type is "dropdown" or "multi_select" or "radio")
        {
            var rows = (b.Options ?? []).Select(o => new FieldOptionRow((o.Value ?? "").Trim(), (o.LabelEn ?? "").Trim(), o.LabelAr?.Trim())).ToList();
            if (rows.Count == 0 || rows.Any(o => !OptionRx().IsMatch(o.Value)) || rows.Select(o => o.Value).Distinct().Count() != rows.Count)
                throw Err("options", "options");
            options = JsonSerializer.Serialize(rows.Select(o => new
            {
                value = o.Value, label_en = o.LabelEn.Length > 0 ? o.LabelEn : o.Value, label_ar = string.IsNullOrEmpty(o.LabelAr) ? (o.LabelEn.Length > 0 ? o.LabelEn : o.Value) : o.LabelAr,
            }));
        }

        var rules = new Dictionary<string, object>();
        if (b.Type == "number")
        {
            if (b.Min is double mn) rules["min"] = mn;
            if (b.Max is double mx) rules["max"] = mx;
            if (b.Min > b.Max) throw Err("range", "min");
        }
        if (b.Type is "text" or "long_text")
        {
            if (b.MinLength is < 0 || b.MaxLength is < 0) throw Err("number", "minLength");
            if (b.MinLength is int a) rules["min_length"] = a;
            if (b.MaxLength is int z) rules["max_length"] = z;
            if (b.MinLength > b.MaxLength) throw Err("range", "minLength");
            if (!string.IsNullOrWhiteSpace(b.Pattern))
            {
                try { _ = new Regex(b.Pattern, RegexOptions.None, TimeSpan.FromMilliseconds(100)); }
                catch (ArgumentException) { throw Err("pattern", "pattern"); }
                rules["pattern"] = b.Pattern;
            }
        }

        f.LabelEn = en; f.LabelAr = ar; f.Type = b.Type; f.Options = options; f.Validation = JsonSerializer.Serialize(rules);
        f.IsRequired = b.IsRequired; f.VisibleToCustomer = b.VisibleToCustomer; f.CategoryId = b.CategoryId;
        f.IsActive = b.IsActive; f.SortOrder = Sort(b.SortOrder);
    }

    // ================================================================ SLA, working hours, holidays

    [HttpGet("sla")]
    public async Task<object> Sla(CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        var prios = await db.Priorities.AsNoTracking().OrderBy(p => p.SortOrder).ToListAsync(ct);
        var pols = await db.SlaPolicies.AsNoTracking().Where(p => p.IsActive).ToListAsync(ct);
        var hours = await db.BusinessHours.AsNoTracking().OrderByDescending(h => h.IsDefault).ThenBy(h => h.Name).ToListAsync(ct);
        var hols = await db.Holidays.AsNoTracking().OrderBy(h => h.HolidayDate).ToListAsync(ct);
        return new
        {
            policies = prios.Select(p =>
            {
                var s = pols.FirstOrDefault(x => x.Priority == p.Code);
                var (warn, breach) = Notify(s?.EscalationRules);
                return new
                {
                    Priority = p.Code, p.NameEn, p.NameAr, p.Color, p.IsActive,
                    FirstResponseMinutes = s?.FirstResponseMinutes ?? 0, ResolutionMinutes = s?.ResolutionMinutes ?? 0,
                    WarningThresholdPct = s?.WarningThresholdPct ?? 80, PauseOnPendingCustomer = s?.PauseOnPendingCustomer ?? true,
                    PauseOnPendingInternal = s?.PauseOnPendingInternal ?? false, BusinessHoursId = s?.BusinessHoursId, WarnNotify = warn, BreachNotify = breach,
                    HasPolicy = s is not null,
                };
            }),
            hours = hours.Select(h => new
            {
                h.Id, h.Name, h.Timezone, h.IsDefault, Schedule = Schedule(h.WeeklySchedule),
                Holidays = hols.Where(x => x.BusinessHoursId == h.Id).Select(x => new { x.Id, Date = x.HolidayDate, x.Name }),
            }),
        };
    }

    [HttpPut("sla/{priority}")]
    public async Task<IActionResult> SaveSla(string priority, SlaBody b, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        if (!await db.Priorities.AnyAsync(p => p.Code == priority, ct)) throw new NotFoundException();
        if (b.WarningThresholdPct is < 1 or > 99) throw Err("percent", "warningThresholdPct");
        if (b.BusinessHoursId is Guid bh && !await db.BusinessHours.AnyAsync(h => h.Id == bh, ct)) throw Err("notFound", "businessHoursId");
        var warn = (b.WarnNotify ?? []).Where(NotifyRoles.Contains).Distinct().ToArray();
        var breach = (b.BreachNotify ?? []).Where(NotifyRoles.Contains).Distinct().ToArray();
        var pol = await UpsertSlaAsync(priority, b.FirstResponseMinutes, b.ResolutionMinutes, b.BusinessHoursId, ct);
        var before = new { pol.WarningThresholdPct, pol.PauseOnPendingCustomer, pol.PauseOnPendingInternal, pol.EscalationRules };
        pol.WarningThresholdPct = b.WarningThresholdPct;
        pol.PauseOnPendingCustomer = b.PauseOnPendingCustomer;
        pol.PauseOnPendingInternal = b.PauseOnPendingInternal;
        pol.EscalationRules = JsonSerializer.Serialize(new object[] { new { @event = "warning", notify = warn }, new { @event = "breach", notify = breach } });
        audit.Write("sla.update", "sla_policy", pol.Id, before, new { priority, b.FirstResponseMinutes, b.ResolutionMinutes, b.WarningThresholdPct, warn, breach });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>The active policy of a priority, created with the default calendar and notify rules when missing.</summary>
    private async Task<SlaPolicy> UpsertSlaAsync(string priority, int frm, int rm, Guid? hoursId, CancellationToken ct)
    {
        if (frm < 1) throw Err("slaNumber", "firstResponseMinutes");
        if (rm < 1) throw Err("slaNumber", "resolutionMinutes");
        if (rm < frm) throw Err("slaOrder", "resolutionMinutes");
        var pol = db.SlaPolicies.Local.FirstOrDefault(p => p.Priority == priority && p.IsActive)
                  ?? await db.SlaPolicies.FirstOrDefaultAsync(p => p.Priority == priority && p.IsActive, ct);
        if (pol is null)
        {
            var name = await db.Priorities.Where(p => p.Code == priority).Select(p => p.NameEn).FirstAsync(ct);
            pol = new SlaPolicy
            {
                Id = Guid.NewGuid(), Name = name, Priority = priority, IsActive = true,
                BusinessHoursId = hoursId ?? await db.BusinessHours.Where(h => h.IsDefault).Select(h => (Guid?)h.Id).FirstOrDefaultAsync(ct),
                EscalationRules = """[{"event":"warning","notify":["agent","team_leader"]},{"event":"breach","notify":["agent","team_leader","admin"]}]""",
            };
            db.SlaPolicies.Add(pol);
        }
        else if (hoursId is not null) pol.BusinessHoursId = hoursId;
        pol.FirstResponseMinutes = frm;
        pol.ResolutionMinutes = rm;
        return pol;
    }

    [HttpPost("business-hours")]
    public async Task<object> CreateHours(HoursBody b, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        var h = new BusinessHours { Id = Guid.NewGuid(), CreatedAt = clock.UtcNow };
        await ApplyHoursAsync(h, b, ct);
        db.BusinessHours.Add(h);
        audit.Write("business_hours.create", "business_hours", h.Id, null, new { h.Name, h.Timezone, h.WeeklySchedule, h.IsDefault });
        await db.SaveChangesAsync(ct);
        return new { h.Id };
    }

    [HttpPut("business-hours/{id:guid}")]
    public async Task<IActionResult> UpdateHours(Guid id, HoursBody b, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        var h = await db.BusinessHours.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (h.IsDefault && !b.IsDefault) throw Err("calendarInUse", "isDefault");
        var before = new { h.Name, h.Timezone, h.WeeklySchedule, h.IsDefault };
        await ApplyHoursAsync(h, b, ct);
        audit.Write("business_hours.update", "business_hours", id, before, new { h.Name, h.Timezone, h.WeeklySchedule, h.IsDefault });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("business-hours/{id:guid}")]
    public async Task<IActionResult> DeleteHours(Guid id, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        var h = await db.BusinessHours.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (h.IsDefault || await db.SlaPolicies.AnyAsync(p => p.BusinessHoursId == id, ct)) throw Err("calendarInUse", null, 409);
        if (await db.Organizations.AnyAsync(o => o.BusinessHoursId == id, ct) || await db.Branches.AnyAsync(o => o.BusinessHoursId == id, ct)
            || await db.Teams.AnyAsync(o => o.BusinessHoursId == id, ct)) throw Err("inUse", null, 409);
        db.BusinessHours.Remove(h);                    // holidays follow (ON DELETE CASCADE)
        audit.Write("business_hours.delete", "business_hours", id, new { h.Name }, null);
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { throw Err("inUse", null, 409); }
        return NoContent();
    }

    [HttpPost("business-hours/{id:guid}/holidays")]
    public async Task<object> AddHoliday(Guid id, HolidayBody b, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        if (!await db.BusinessHours.AnyAsync(h => h.Id == id, ct)) throw new NotFoundException();
        var name = (b.Name ?? "").Trim();
        if (name.Length is < 2 or > 100) throw Err("name", "name");
        if (b.Date.Year is < 2000 or > 2100) throw Err("date", "date");
        if (await db.Holidays.AnyAsync(h => h.BusinessHoursId == id && h.HolidayDate == b.Date, ct)) throw Err("duplicate", "date", 409);
        var x = new Holiday { Id = Guid.NewGuid(), BusinessHoursId = id, HolidayDate = b.Date, Name = name };
        db.Holidays.Add(x);
        audit.Write("holiday.create", "holiday", x.Id, null, new { b.Date, name });
        await db.SaveChangesAsync(ct);
        return new { x.Id };
    }

    [HttpDelete("holidays/{id:guid}")]
    public async Task<IActionResult> DeleteHoliday(Guid id, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        var x = await db.Holidays.FirstOrDefaultAsync(h => h.Id == id, ct) ?? throw new NotFoundException();
        db.Holidays.Remove(x);
        audit.Write("holiday.delete", "holiday", id, new { x.HolidayDate, x.Name }, null);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task ApplyHoursAsync(BusinessHours h, HoursBody b, CancellationToken ct)
    {
        var name = (b.Name ?? "").Trim();
        if (name.Length is < 2 or > 100) throw Err("name", "name");
        var tz = (b.Timezone ?? "").Trim();
        try { _ = TimeZoneInfo.FindSystemTimeZoneById(tz); } catch { throw Err("timezone", "timezone"); }
        var schedule = new Dictionary<string, string[][]>();
        foreach (var d in Days)
        {
            var windows = b.Schedule is not null && b.Schedule.TryGetValue(d, out var w) ? w : [];
            foreach (var win in windows)
            {
                if (win.Length != 2 || !TimeOnly.TryParseExact(win[0], "HH:mm", out var s) || !TimeOnly.TryParseExact(win[1], "HH:mm", out var e))
                    throw Err("time", d);
                if (e <= s) throw Err("endBeforeStart", d);
            }
            schedule[d] = windows;
        }
        h.Name = name; h.Timezone = tz; h.WeeklySchedule = JsonSerializer.Serialize(schedule);
        if (b.IsDefault && !h.IsDefault)
        {
            await db.BusinessHours.Where(x => x.IsDefault && x.Id != h.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.IsDefault, false), ct);
            h.IsDefault = true;
        }
    }

    private static Dictionary<string, string[][]> Schedule(string json)
    {
        try { return JsonSerializer.Deserialize<Dictionary<string, string[][]>>(json) ?? []; } catch { return []; }
    }

    private static (string[] Warn, string[] Breach) Notify(string? rules)
    {
        string[] warn = ["agent", "team_leader"], breach = ["agent", "team_leader", "admin"];
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(rules) ? "[]" : rules);
            foreach (var r in doc.RootElement.EnumerateArray())
            {
                if (!r.TryGetProperty("event", out var e) || !r.TryGetProperty("notify", out var n) || n.ValueKind != JsonValueKind.Array) continue;
                var list = n.EnumerateArray().Select(x => x.GetString() ?? "").ToArray();
                if (e.GetString() == "warning") warn = list; else if (e.GetString() == "breach") breach = list;
            }
        }
        catch (JsonException) { }
        return (warn, breach);
    }

    // ================================================================ helpers

    private async Task CheckPriorityAsync(string? code, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(code) && !await db.Priorities.AnyAsync(p => p.Code == code, ct)) throw Err("notFound", "priorityCode");
    }

    private static string Name(string? v, string field)
    {
        var s = (v ?? "").Trim();
        if (s.Length is < 2 or > 120) throw Err("name", field);
        return s;
    }

    private static string Text(string? v, int max)
    {
        var s = (v ?? "").Trim();
        if (s.Length > max) throw Err("locationLong");
        return s;
    }

    private static int Sort(int v) => v is < 0 or > 1000 ? throw Err("number", "sortOrder") : v;
    private static string? Blank(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();

    private static string Slug(string? v)
    {
        var s = SlugRx().Replace((v ?? "").Trim().ToLowerInvariant(), "_").Trim('_');
        if (s.Length > 36) s = s[..36];
        return s.Length > 0 && char.IsLetter(s[0]) ? s : "p_" + s;
    }

    [GeneratedRegex("^[a-z][a-z0-9_]{1,40}$")] private static partial Regex KeyRx();
    [GeneratedRegex("^[A-Za-z0-9._-]{1,60}$")] private static partial Regex OptionRx();
    [GeneratedRegex("[^a-z0-9]+")] private static partial Regex SlugRx();
}
