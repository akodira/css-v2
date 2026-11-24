using Ccs.Application.Abstractions;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Application.Tickets;

/// <summary>What one customer may pick on the new ticket form: types, categories, sub-categories and which categories each type shows.</summary>
public sealed record CustomerCatalog(HashSet<Guid> Types, HashSet<Guid> Categories, HashSet<Guid> Subcategories, HashSet<(Guid Type, Guid Category)> Links);

/// <summary>
/// Own catalog per place. The system's items have no owner. Each organization and branch uses items chosen from the system
/// (a branch also from its organization) plus its own. A customer sees the items of the places their own place ticks under
/// "What your customers see": their organization, their branch and/or the system. No setting = all three.
/// </summary>
public sealed class PlaceCatalog(ICcsDbContext db)
{
    public const string Kind = "kind", Type = "type", Category = "cat", Subcategory = "sub";
    public static bool IsItemKind(string? k) => k is Kind or Type or Category or Subcategory;

    /// <summary>The places whose items this customer sees: (null, null) = the system.</summary>
    public async Task<List<(Guid? Org, Guid? Branch)>> SourcesAsync(Guid? org, Guid? branch, CancellationToken ct = default)
    {
        if (org is null) return [(null, null)];
        var v = await db.PlaceCustomerViews.AsNoTracking().FirstOrDefaultAsync(x => x.OrganizationId == org && x.BranchId == branch, ct);
        var list = new List<(Guid?, Guid?)>();
        if (v?.ShowSystem ?? true) list.Add((null, null));
        if (v?.ShowOrganization ?? true) list.Add((org, null));
        if (branch is not null && (v?.ShowBranch ?? true)) list.Add((org, branch));
        if (list.Count == 0) list.Add((null, null));
        return list;
    }

    public async Task<CustomerCatalog> ForUserAsync(Guid userId, CancellationToken ct = default)
    {
        var p = await db.Profiles.AsNoTracking().Where(x => x.Id == userId).Select(x => new { x.OrganizationId, x.BranchId }).FirstOrDefaultAsync(ct);
        return await ForPlaceAsync(p?.OrganizationId, p?.BranchId, ct);
    }

    public async Task<CustomerCatalog> ForPlaceAsync(Guid? org, Guid? branch, CancellationToken ct = default)
    {
        var result = new CustomerCatalog([], [], [], []);
        foreach (var (o, b) in await SourcesAsync(org, branch, ct))
        {
            if (o is null) await AddSystemAsync(result, ct);
            else await AddPlaceAsync(result, o.Value, b, ct);
        }
        return Trim(result);
    }

    /// <summary>Staff working on a ticket with no customer picked yet: every active item and every link.</summary>
    public async Task<CustomerCatalog> EverythingAsync(CancellationToken ct = default)
    {
        var r = new CustomerCatalog(
            (await db.TicketTypes.AsNoTracking().Where(t => t.IsActive).Select(t => t.Id).ToListAsync(ct)).ToHashSet(),
            (await db.TicketCategories.AsNoTracking().Where(c => c.IsActive).Select(c => c.Id).ToListAsync(ct)).ToHashSet(),
            (await db.TicketSubcategories.AsNoTracking().Where(s => s.IsActive).Select(s => s.Id).ToListAsync(ct)).ToHashSet(), []);
        foreach (var l in await db.TicketTypeCategories.AsNoTracking().ToListAsync(ct)) r.Links.Add((l.TypeId, l.CategoryId));
        foreach (var l in await db.PlaceTypeCategories.AsNoTracking().ToListAsync(ct)) r.Links.Add((l.TypeId, l.CategoryId));
        return Trim(r);
    }

    private async Task AddSystemAsync(CustomerCatalog r, CancellationToken ct)
    {
        var types = await db.TicketTypes.AsNoTracking().Where(t => t.IsActive && t.OrganizationId == null).Select(t => t.Id).ToListAsync(ct);
        var cats = await db.TicketCategories.AsNoTracking().Where(c => c.IsActive && c.OrganizationId == null).Select(c => c.Id).ToListAsync(ct);
        var subs = await db.TicketSubcategories.AsNoTracking().Where(s => s.IsActive && s.OrganizationId == null).Select(s => s.Id).ToListAsync(ct);
        r.Types.UnionWith(types); r.Categories.UnionWith(cats); r.Subcategories.UnionWith(subs);
        var t = types.ToHashSet(); var c = cats.ToHashSet();
        foreach (var l in await db.TicketTypeCategories.AsNoTracking().ToListAsync(ct))
            if (t.Contains(l.TypeId) && c.Contains(l.CategoryId)) r.Links.Add((l.TypeId, l.CategoryId));
    }

    private async Task AddPlaceAsync(CustomerCatalog r, Guid org, Guid? branch, CancellationToken ct)
    {
        var used = await db.PlaceCatalog.AsNoTracking().Where(x => x.OrganizationId == org && x.BranchId == branch).ToListAsync(ct);
        List<Guid> Ids(string k) => used.Where(x => x.ItemKind == k).Select(x => x.ItemId).ToList();
        var (ti, ci, si) = (Ids(Type), Ids(Category), Ids(Subcategory));
        var types = await db.TicketTypes.AsNoTracking().Where(t => t.IsActive && ti.Contains(t.Id)).Select(t => t.Id).ToListAsync(ct);
        var cats = await db.TicketCategories.AsNoTracking().Where(c => c.IsActive && ci.Contains(c.Id)).Select(c => c.Id).ToListAsync(ct);
        var subs = await db.TicketSubcategories.AsNoTracking().Where(s => s.IsActive && si.Contains(s.Id)).Select(s => s.Id).ToListAsync(ct);
        r.Types.UnionWith(types); r.Categories.UnionWith(cats); r.Subcategories.UnionWith(subs);
        var t = types.ToHashSet(); var c = cats.ToHashSet();
        foreach (var l in await db.PlaceTypeCategories.AsNoTracking().Where(x => x.OrganizationId == org && x.BranchId == branch).ToListAsync(ct))
            if (t.Contains(l.TypeId) && c.Contains(l.CategoryId)) r.Links.Add((l.TypeId, l.CategoryId));
    }

    /// <summary>Sub-categories only under categories that are offered.</summary>
    private CustomerCatalog Trim(CustomerCatalog r)
    {
        var parents = db.TicketSubcategories.AsNoTracking().Where(s => r.Subcategories.Contains(s.Id)).Select(s => new { s.Id, s.CategoryId }).ToList();
        foreach (var p in parents) if (!r.Categories.Contains(p.CategoryId)) r.Subcategories.Remove(p.Id);
        return r;
    }
}
