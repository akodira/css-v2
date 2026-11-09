using Ccs.Application.Abstractions;
using Ccs.Application.Access;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Application.Tickets;

public sealed record TypeOption(Guid Id, string NameEn, string NameAr, string DescriptionEn, string DescriptionAr,
    string ExamplesEn, string ExamplesAr, IReadOnlyList<Guid> CategoryIds);
public sealed record CategoryOption(Guid Id, string NameEn, string NameAr, string? FixedPriority, IReadOnlyList<SubcategoryOption> Subcategories);
public sealed record SubcategoryOption(Guid Id, string NameEn, string NameAr, string? FixedPriority);
public sealed record PriorityOption(string Code, string NameEn, string NameAr, string Color, string Icon);
public sealed record FieldOption(Guid Id, string Key, string LabelEn, string LabelAr, string Type, string Options, bool IsRequired,
    string Validation, bool VisibleToCustomer, Guid? CategoryId);
public sealed record NewTicketOptions(IReadOnlyList<TypeOption> Types, IReadOnlyList<CategoryOption> Categories,
    IReadOnlyList<PriorityOption> Priorities, IReadOnlyList<FieldOption> Fields, bool CustomerPicksPriority);

/// <summary>Everything the "new ticket" form needs: type, then category, then subcategory and custom fields.</summary>
public sealed class CatalogQueries(ICcsDbContext db, AccessService access)
{
    public async Task<NewTicketOptions> NewTicketOptionsAsync(CancellationToken ct = default)
    {
        var c = await access.RequireSignedInAsync(ct);
        var links = await db.TicketTypeCategories.AsNoTracking().ToListAsync(ct);
        var types = (await db.TicketTypes.AsNoTracking().Where(t => t.IsActive).OrderBy(t => t.SortOrder).ThenBy(t => t.NameEn).ToListAsync(ct))
            .Select(t => new TypeOption(t.Id, t.NameEn, t.NameAr, t.DescriptionEn, t.DescriptionAr, t.ExamplesEn, t.ExamplesAr,
                links.Where(l => l.TypeId == t.Id).Select(l => l.CategoryId).ToList()))
            .ToList();
        var subs = await db.TicketSubcategories.AsNoTracking().Where(s => s.IsActive).OrderBy(s => s.SortOrder).ThenBy(s => s.NameEn).ToListAsync(ct);
        var cats = (await db.TicketCategories.AsNoTracking().Where(x => x.IsActive && (!x.IsPrivate || c.Internal))
                .OrderBy(x => x.SortOrder).ThenBy(x => x.NameEn).ToListAsync(ct))
            .Select(x => new CategoryOption(x.Id, x.NameEn, x.NameAr, x.PriorityCode,
                subs.Where(s => s.CategoryId == x.Id).Select(s => new SubcategoryOption(s.Id, s.NameEn, s.NameAr, s.PriorityCode)).ToList()))
            .ToList();
        var prios = await db.Priorities.AsNoTracking().Where(p => p.IsActive).OrderBy(p => p.SortOrder)
            .Select(p => new PriorityOption(p.Code, p.NameEn, p.NameAr, p.Color, p.Icon)).ToListAsync(ct);
        var fields = await db.CustomFieldDefinitions.AsNoTracking().Where(f => f.IsActive && (f.VisibleToCustomer || c.Internal))
            .OrderBy(f => f.SortOrder)
            .Select(f => new FieldOption(f.Id, f.Key, f.LabelEn, f.LabelAr, f.Type, f.Options, f.IsRequired, f.Validation, f.VisibleToCustomer, f.CategoryId))
            .ToListAsync(ct);
        var site = await db.SiteSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        return new NewTicketOptions(types, cats, prios, fields, site?.PriorityMode == "customer");
    }
}
