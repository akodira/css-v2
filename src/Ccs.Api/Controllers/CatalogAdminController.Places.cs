using Ccs.Application.Common;
using Ccs.Application.Tickets;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>
/// Own catalog per place. Organization and branch admins choose ticket types, categories, sub-categories and kinds of team
/// from the system (a branch also from its organization) or create their own, tick which categories each type shows in
/// their place, and choose what their customers see. The system admin can open any place.
/// </summary>
public sealed partial class CatalogAdminController
{
    public sealed record PlaceBody(Guid OrganizationId, Guid? BranchId);
    public sealed record UseBody(Guid OrganizationId, Guid? BranchId, string ItemKind, Guid[] Ids, bool Use);
    public sealed record LinkRow(Guid TypeId, Guid CategoryId);
    public sealed record LinksBody(Guid OrganizationId, Guid? BranchId, LinkRow[] Links);
    public sealed record ViewBody(Guid OrganizationId, Guid? BranchId, bool ShowOrganization, bool ShowBranch, bool ShowSystem);
    public sealed record PlaceTypeBody(Guid OrganizationId, Guid? BranchId, TypeBody Item);
    public sealed record PlaceCategoryBody(Guid OrganizationId, Guid? BranchId, CategoryBody Item);
    public sealed record PlaceSubBody(Guid OrganizationId, Guid? BranchId, SubcategoryBody Item);

    /// <summary>The places the caller manages: the system admin all; organization and branch admins the places of their scope.</summary>
    private sealed record PlaceScope(bool Admin, HashSet<Guid> Orgs, HashSet<Guid> Branches)
    {
        public bool Covers(Guid org, Guid? branch) => Admin || Orgs.Contains(org) || (branch is Guid b && Branches.Contains(b));
    }

    private async Task<PlaceScope> PlaceScopeAsync(CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        if (c.Admin) return new PlaceScope(true, [], []);
        if (!c.Staff || c.ScopeLevel is not ("organization" or "branch")) throw new ForbiddenException();
        var scopes = await db.AdminScopes.AsNoTracking().Where(s => s.UserId == c.UserId).ToListAsync(ct);
        var tree = await db.Organizations.AsNoTracking().Select(o => new { o.Id, o.ParentId }).ToListAsync(ct);
        var orgs = new HashSet<Guid>();
        var queue = new Queue<Guid>(scopes.Where(s => s.BranchId is null).Select(s => s.OrganizationId));
        while (queue.Count > 0)
        {
            var id = queue.Dequeue();
            if (!orgs.Add(id)) continue;
            foreach (var child in tree.Where(o => o.ParentId == id)) queue.Enqueue(child.Id);
        }
        return new PlaceScope(false, orgs, scopes.Where(s => s.BranchId is not null).Select(s => s.BranchId!.Value).ToHashSet());
    }

    /// <summary>Checks the place exists (a branch belongs to the organization) and the caller manages it.</summary>
    private async Task<PlaceScope> PlaceAsync(Guid org, Guid? branch, CancellationToken ct)
    {
        var me = await PlaceScopeAsync(ct);
        if (branch is Guid b ? !await db.Branches.AnyAsync(x => x.Id == b && x.OrganizationId == org, ct) : !await db.Organizations.AnyAsync(o => o.Id == org, ct))
            throw new NotFoundException();
        if (!me.Covers(org, branch)) throw Err("outOfScope", null, 403);
        return me;
    }

    private IQueryable<PlaceCatalogItem> Used(Guid org, Guid? branch, string kind) =>
        db.PlaceCatalog.Where(x => x.OrganizationId == org && x.BranchId == branch && x.ItemKind == kind);

    // ------------------------------------------------------------------ read

    [HttpGet("place-catalog")]
    public async Task<object> PlaceCatalogRead([FromQuery] Guid? org, [FromQuery] Guid? branch, CancellationToken ct)
    {
        var me = await PlaceScopeAsync(ct);
        var orgs = await db.Organizations.AsNoTracking().Where(o => o.IsActive).OrderBy(o => o.Name).Select(o => new { o.Id, o.Name }).ToListAsync(ct);
        var branches = await db.Branches.AsNoTracking().Where(b => b.IsActive).OrderBy(b => b.Name).Select(b => new { b.Id, b.OrganizationId, b.Name }).ToListAsync(ct);
        var places = orgs.Where(o => me.Covers(o.Id, null)).Select(o => new { OrganizationId = o.Id, BranchId = (Guid?)null, o.Name, OrganizationName = o.Name })
            .Concat(branches.Where(b => me.Covers(b.OrganizationId, b.Id))
                .Select(b => new { b.OrganizationId, BranchId = (Guid?)b.Id, b.Name, OrganizationName = orgs.FirstOrDefault(o => o.Id == b.OrganizationId)?.Name ?? "" }))
            .OrderBy(p => p.OrganizationName).ThenBy(p => p.BranchId.HasValue).ThenBy(p => p.Name).ToList();
        if (org is not Guid o0) return new { places };
        await PlaceAsync(o0, branch, ct);
        Guid? b0 = branch;

        var used = await db.PlaceCatalog.AsNoTracking().Where(x => x.OrganizationId == o0 && x.BranchId == b0).ToListAsync(ct);
        // A branch also chooses from its organization: the organization's own items it uses.
        var orgUsed = b0 is null ? [] : await db.PlaceCatalog.AsNoTracking().Where(x => x.OrganizationId == o0 && x.BranchId == null).ToListAsync(ct);
        bool Visible(Guid? ownOrg, Guid? ownBranch) => ownOrg is null || (ownOrg == o0 && (ownBranch == b0 || (b0 is not null && ownBranch is null)));
        bool Offered(string kind, Guid id, Guid? ownOrg, Guid? ownBranch) =>
            ownOrg is null || (ownOrg == o0 && ownBranch == b0) || (b0 is not null && ownOrg == o0 && ownBranch is null && orgUsed.Any(x => x.ItemKind == kind && x.ItemId == id));
        bool IsUsed(string kind, Guid id) => used.Any(x => x.ItemKind == kind && x.ItemId == id);

        var kinds = (await db.TeamKinds.AsNoTracking().OrderBy(k => k.SortOrder).ThenBy(k => k.NameEn).ToListAsync(ct)).Where(k => Visible(k.OrganizationId, k.BranchId)).ToList();
        var types = (await db.TicketTypes.AsNoTracking().OrderBy(t => t.SortOrder).ThenBy(t => t.NameEn).ToListAsync(ct)).Where(t => Visible(t.OrganizationId, t.BranchId)).ToList();
        var cats = (await db.TicketCategories.AsNoTracking().OrderBy(c => c.SortOrder).ThenBy(c => c.NameEn).ToListAsync(ct)).Where(c => Visible(c.OrganizationId, c.BranchId)).ToList();
        var subs = (await db.TicketSubcategories.AsNoTracking().OrderBy(s => s.SortOrder).ThenBy(s => s.NameEn).ToListAsync(ct)).Where(s => Visible(s.OrganizationId, s.BranchId)).ToList();

        // Tickets of this place's customers (a branch: its customers; an organization: all of its customers).
        var mine = db.Tickets.AsNoTracking().Where(t => db.Profiles.Any(p => p.Id == t.RequesterId && p.OrganizationId == o0 && (b0 == null || p.BranchId == b0)));
        var byType = await mine.Where(t => t.TicketTypeId != null).GroupBy(t => t.TicketTypeId!.Value).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
        var byCat = await mine.GroupBy(t => t.CategoryId).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
        var bySub = await mine.Where(t => t.SubcategoryId != null).GroupBy(t => t.SubcategoryId!.Value).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);

        // Which team takes each kind here: the place's own, the organization's (for a branch), else the central one.
        var teams = await db.Teams.AsNoTracking().Where(t => t.IsActive && t.KindId != null && (t.OrganizationId == null || t.OrganizationId == o0)).ToListAsync(ct);
        var counts = await db.TeamMembers.AsNoTracking().GroupBy(m => m.TeamId).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
        object? Handler(TeamKind k)
        {
            var t = teams.FirstOrDefault(x => x.KindId == k.Id && x.OrganizationId == o0 && x.BranchId == b0);
            var at = "own";
            if (t is null && b0 is not null) { t = teams.FirstOrDefault(x => x.KindId == k.Id && x.OrganizationId == o0 && x.BranchId == null); at = "organization"; }
            if (t is null && k.OrganizationId is null && k.CentralFallback) { t = teams.FirstOrDefault(x => x.KindId == k.Id && x.OrganizationId == null); at = "central"; }
            return t is null ? null : new { TeamId = t.Id, t.NameEn, t.NameAr, At = at, Members = counts.GetValueOrDefault(t.Id) };
        }

        var view = await db.PlaceCustomerViews.AsNoTracking().FirstOrDefaultAsync(v => v.OrganizationId == o0 && v.BranchId == b0, ct);
        var sysLinks = await db.TicketTypeCategories.AsNoTracking().ToListAsync(ct);
        var orgLinks = b0 is null ? [] : await db.PlaceTypeCategories.AsNoTracking().Where(x => x.OrganizationId == o0 && x.BranchId == null).ToListAsync(ct);
        var links = await db.PlaceTypeCategories.AsNoTracking().Where(x => x.OrganizationId == o0 && x.BranchId == b0).Select(x => new { x.TypeId, x.CategoryId }).ToListAsync(ct);
        return new
        {
            places,
            place = places.FirstOrDefault(p => p.OrganizationId == o0 && p.BranchId == b0),
            view = new { ShowOrganization = view?.ShowOrganization ?? true, ShowBranch = view?.ShowBranch ?? true, ShowSystem = view?.ShowSystem ?? true },
            kinds = kinds.Select(k => new
            {
                k.Id, k.NameEn, k.NameAr, OwnerOrganizationId = k.OrganizationId, OwnerBranchId = k.BranchId,
                Used = IsUsed(PlaceCatalog.Kind, k.Id), Offered = Offered(PlaceCatalog.Kind, k.Id, k.OrganizationId, k.BranchId), HandledBy = Handler(k),
            }),
            types = types.Select(t => new
            {
                t.Id, t.Code, t.NameEn, t.NameAr, t.DescriptionEn, t.DescriptionAr, t.ExamplesEn, t.ExamplesAr, t.SortOrder, t.IsActive,
                OwnerOrganizationId = t.OrganizationId, OwnerBranchId = t.BranchId,
                Used = IsUsed(PlaceCatalog.Type, t.Id), Offered = Offered(PlaceCatalog.Type, t.Id, t.OrganizationId, t.BranchId), Tickets = byType.GetValueOrDefault(t.Id),
                // The categories this type shows where it comes from: ticked for you when you choose it.
                SourceCategoryIds = t.OrganizationId is null ? sysLinks.Where(l => l.TypeId == t.Id).Select(l => l.CategoryId).ToList()
                    : orgLinks.Where(l => l.TypeId == t.Id).Select(l => l.CategoryId).ToList(),
            }),
            categories = cats.Select(c => new
            {
                c.Id, c.NameEn, c.NameAr, c.TeamKindId, c.IsActive, c.SortOrder, c.PriorityCode, c.IsPrivate, c.AutoAssign,
                OwnerOrganizationId = c.OrganizationId, OwnerBranchId = c.BranchId,
                Used = IsUsed(PlaceCatalog.Category, c.Id), Offered = Offered(PlaceCatalog.Category, c.Id, c.OrganizationId, c.BranchId), Tickets = byCat.GetValueOrDefault(c.Id),
                Subcategories = subs.Where(s => s.CategoryId == c.Id).Select(s => new
                {
                    s.Id, s.CategoryId, s.NameEn, s.NameAr, s.IsActive, s.SortOrder, s.PriorityCode, OwnerOrganizationId = s.OrganizationId, OwnerBranchId = s.BranchId,
                    Used = IsUsed(PlaceCatalog.Subcategory, s.Id), Offered = Offered(PlaceCatalog.Subcategory, s.Id, s.OrganizationId, s.BranchId), Tickets = bySub.GetValueOrDefault(s.Id),
                }),
            }),
            links,
            priorities = await db.Priorities.AsNoTracking().OrderBy(p => p.SortOrder).Select(p => new { p.Code, p.NameEn, p.NameAr, p.Color, p.Icon, p.IsActive }).ToListAsync(ct),
        };
    }

    // ------------------------------------------------------------------ choose from current / stop using

    [HttpPost("place-catalog/use")]
    public async Task<IActionResult> PlaceUse(UseBody b, CancellationToken ct)
    {
        await PlaceAsync(b.OrganizationId, b.BranchId, ct);
        if (!PlaceCatalog.IsItemKind(b.ItemKind)) throw Err("required", "itemKind");
        var ids = (b.Ids ?? []).Distinct().ToList();
        if (b.Use) foreach (var id in ids) await UseItemAsync(b.OrganizationId, b.BranchId, b.ItemKind, id, ct);
        else foreach (var id in ids) await StopItemAsync(b.OrganizationId, b.BranchId, b.ItemKind, id, ct);
        audit.Write(b.Use ? "place_catalog.use" : "place_catalog.stop", "place_catalog", b.BranchId ?? b.OrganizationId, null, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Who made an item: (organization, branch); (null, null) = the system.</summary>
    private async Task<(Guid? Org, Guid? Branch)?> OwnerAsync(string kind, Guid id, CancellationToken ct)
    {
        var r = kind switch
        {
            PlaceCatalog.Kind => await db.TeamKinds.Where(x => x.Id == id).Select(x => new OwnerRow(x.OrganizationId, x.BranchId)).FirstOrDefaultAsync(ct),
            PlaceCatalog.Type => await db.TicketTypes.Where(x => x.Id == id).Select(x => new OwnerRow(x.OrganizationId, x.BranchId)).FirstOrDefaultAsync(ct),
            PlaceCatalog.Category => await db.TicketCategories.Where(x => x.Id == id).Select(x => new OwnerRow(x.OrganizationId, x.BranchId)).FirstOrDefaultAsync(ct),
            _ => await db.TicketSubcategories.Where(x => x.Id == id).Select(x => new OwnerRow(x.OrganizationId, x.BranchId)).FirstOrDefaultAsync(ct),
        };
        return r is null ? null : (r.Org, r.Branch);
    }
    private sealed record OwnerRow(Guid? Org, Guid? Branch);

    /// <summary>The system's items, the place's own, and for a branch the items its organization uses of its own.</summary>
    private async Task<bool> OfferedAsync(Guid org, Guid? branch, string kind, Guid id, CancellationToken ct)
    {
        var owner = await OwnerAsync(kind, id, ct);
        if (owner is not var (o, b)) return false;
        if (o is null) return true;
        if (o == org && b == branch) return true;
        return branch is not null && o == org && b is null && await Used(org, null, kind).AnyAsync(x => x.ItemId == id, ct);
    }

    private async Task AddUseAsync(Guid org, Guid? branch, string kind, Guid id, CancellationToken ct)
    {
        if (await Used(org, branch, kind).AnyAsync(x => x.ItemId == id, ct)) return;
        if (db.PlaceCatalog.Local.Any(x => x.OrganizationId == org && x.BranchId == branch && x.ItemKind == kind && x.ItemId == id)) return;
        db.PlaceCatalog.Add(new PlaceCatalogItem { Id = Guid.NewGuid(), OrganizationId = org, BranchId = branch, ItemKind = kind, ItemId = id });
    }

    private async Task AddLinkAsync(Guid org, Guid? branch, Guid type, Guid cat, CancellationToken ct)
    {
        if (await db.PlaceTypeCategories.AnyAsync(x => x.OrganizationId == org && x.BranchId == branch && x.TypeId == type && x.CategoryId == cat, ct)) return;
        if (db.PlaceTypeCategories.Local.Any(x => x.OrganizationId == org && x.BranchId == branch && x.TypeId == type && x.CategoryId == cat)) return;
        db.PlaceTypeCategories.Add(new PlaceTypeCategory { Id = Guid.NewGuid(), OrganizationId = org, BranchId = branch, TypeId = type, CategoryId = cat });
    }

    /// <summary>The categories a type shows where it comes from (the system, or the organization for a branch).</summary>
    private async Task<List<Guid>> SourceLinksAsync(Guid org, string side, Guid id, (Guid? Org, Guid? Branch) owner, CancellationToken ct)
    {
        if (owner.Org is null)
            return side == "type" ? await db.TicketTypeCategories.Where(l => l.TypeId == id).Select(l => l.CategoryId).ToListAsync(ct)
                                  : await db.TicketTypeCategories.Where(l => l.CategoryId == id).Select(l => l.TypeId).ToListAsync(ct);
        return side == "type" ? await db.PlaceTypeCategories.Where(l => l.OrganizationId == org && l.BranchId == null && l.TypeId == id).Select(l => l.CategoryId).ToListAsync(ct)
                              : await db.PlaceTypeCategories.Where(l => l.OrganizationId == org && l.BranchId == null && l.CategoryId == id).Select(l => l.TypeId).ToListAsync(ct);
    }

    private async Task UseItemAsync(Guid org, Guid? branch, string kind, Guid id, CancellationToken ct)
    {
        if (!await OfferedAsync(org, branch, kind, id, ct)) throw Err("notFound", "ids");
        var owner = (await OwnerAsync(kind, id, ct))!.Value;
        await AddUseAsync(org, branch, kind, id, ct);
        var usedCats = await Used(org, branch, PlaceCatalog.Category).Select(x => x.ItemId).ToListAsync(ct);
        var usedTypes = await Used(org, branch, PlaceCatalog.Type).Select(x => x.ItemId).ToListAsync(ct);
        switch (kind)
        {
            case PlaceCatalog.Type:
                // Ticks for you the categories it shows where it comes from, among the ones you use.
                foreach (var c in await SourceLinksAsync(org, "type", id, owner, ct)) if (usedCats.Contains(c)) await AddLinkAsync(org, branch, id, c, ct);
                break;
            case PlaceCatalog.Category:
                var cat = await db.TicketCategories.AsNoTracking().FirstAsync(c => c.Id == id, ct);
                if (cat.TeamKindId is Guid k) await AddUseAsync(org, branch, PlaceCatalog.Kind, k, ct);
                // Its sub-categories come with it.
                foreach (var s in await db.TicketSubcategories.AsNoTracking().Where(s => s.CategoryId == id && s.IsActive).Select(s => s.Id).ToListAsync(ct))
                    if (await OfferedAsync(org, branch, PlaceCatalog.Subcategory, s, ct)) await AddUseAsync(org, branch, PlaceCatalog.Subcategory, s, ct);
                foreach (var t in await SourceLinksAsync(org, "cat", id, owner, ct)) if (usedTypes.Contains(t)) await AddLinkAsync(org, branch, t, id, ct);
                break;
            case PlaceCatalog.Subcategory:
                var parent = await db.TicketSubcategories.Where(s => s.Id == id).Select(s => s.CategoryId).FirstAsync(ct);
                if (!usedCats.Contains(parent)) throw Err("required", "categoryId");
                break;
        }
    }

    private async Task StopItemAsync(Guid org, Guid? branch, string kind, Guid id, CancellationToken ct)
    {
        await Used(org, branch, kind).Where(x => x.ItemId == id).ExecuteDeleteAsync(ct);
        if (kind == PlaceCatalog.Type)
            await db.PlaceTypeCategories.Where(x => x.OrganizationId == org && x.BranchId == branch && x.TypeId == id).ExecuteDeleteAsync(ct);
        if (kind == PlaceCatalog.Category)
        {
            await db.PlaceTypeCategories.Where(x => x.OrganizationId == org && x.BranchId == branch && x.CategoryId == id).ExecuteDeleteAsync(ct);
            var subs = await db.TicketSubcategories.Where(s => s.CategoryId == id).Select(s => s.Id).ToListAsync(ct);
            await Used(org, branch, PlaceCatalog.Subcategory).Where(x => subs.Contains(x.ItemId)).ExecuteDeleteAsync(ct);
        }
    }

    // ------------------------------------------------------------------ which categories each type shows here; what customers see

    [HttpPut("place-catalog/links")]
    public async Task<IActionResult> PlaceLinks(LinksBody b, CancellationToken ct)
    {
        await PlaceAsync(b.OrganizationId, b.BranchId, ct);
        var types = await Used(b.OrganizationId, b.BranchId, PlaceCatalog.Type).Select(x => x.ItemId).ToListAsync(ct);
        var cats = await Used(b.OrganizationId, b.BranchId, PlaceCatalog.Category).Select(x => x.ItemId).ToListAsync(ct);
        var rows = (b.Links ?? []).Distinct().ToList();
        if (rows.Any(r => !types.Contains(r.TypeId) || !cats.Contains(r.CategoryId))) throw Err("notFound", "links");
        await db.PlaceTypeCategories.Where(x => x.OrganizationId == b.OrganizationId && x.BranchId == b.BranchId).ExecuteDeleteAsync(ct);
        foreach (var r in rows)
            db.PlaceTypeCategories.Add(new PlaceTypeCategory { Id = Guid.NewGuid(), OrganizationId = b.OrganizationId, BranchId = b.BranchId, TypeId = r.TypeId, CategoryId = r.CategoryId });
        audit.Write("place_catalog.links", "place_catalog", b.BranchId ?? b.OrganizationId, null, rows);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPut("place-catalog/view")]
    public async Task<IActionResult> PlaceView(ViewBody b, CancellationToken ct)
    {
        await PlaceAsync(b.OrganizationId, b.BranchId, ct);
        var showBranch = b.BranchId is not null && b.ShowBranch;
        if (!b.ShowOrganization && !showBranch && !b.ShowSystem) throw Err("required", "view");
        var v = await db.PlaceCustomerViews.FirstOrDefaultAsync(x => x.OrganizationId == b.OrganizationId && x.BranchId == b.BranchId, ct);
        if (v is null) db.PlaceCustomerViews.Add(v = new PlaceCustomerView { Id = Guid.NewGuid(), OrganizationId = b.OrganizationId, BranchId = b.BranchId });
        var before = new { v.ShowOrganization, v.ShowBranch, v.ShowSystem };
        v.ShowOrganization = b.ShowOrganization; v.ShowBranch = b.BranchId is null || b.ShowBranch; v.ShowSystem = b.ShowSystem;
        audit.Write("place_catalog.view", "place_catalog", b.BranchId ?? b.OrganizationId, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ------------------------------------------------------------------ create your own

    private async Task<T> OwnAsync<T>(IQueryable<T> q, Guid org, Guid? branch, CancellationToken ct) where T : class =>
        await q.FirstOrDefaultAsync(ct) ?? throw new NotFoundException();

    [HttpPost("place-catalog/types")]
    public async Task<object> PlaceCreateType(PlaceTypeBody b, CancellationToken ct)
    {
        await PlaceAsync(b.OrganizationId, b.BranchId, ct);
        var t = new TicketType { Id = Guid.NewGuid(), CreatedAt = clock.UtcNow, OrganizationId = b.OrganizationId, BranchId = b.BranchId };
        await ApplyTypeAsync(t, b.Item, ct);
        db.TicketTypes.Add(t);
        await db.SaveChangesAsync(ct);
        await AddUseAsync(b.OrganizationId, b.BranchId, PlaceCatalog.Type, t.Id, ct);
        await SetTypeLinksAsync(b.OrganizationId, b.BranchId, t.Id, b.Item.CategoryIds, ct);
        audit.Write("ticket_type.create", "ticket_type", t.Id, null, b);
        await db.SaveChangesAsync(ct);
        return new { t.Id };
    }

    [HttpPut("place-catalog/types/{id:guid}")]
    public async Task<IActionResult> PlaceUpdateType(Guid id, PlaceTypeBody b, CancellationToken ct)
    {
        await PlaceAsync(b.OrganizationId, b.BranchId, ct);
        var t = await OwnAsync(db.TicketTypes.Where(x => x.Id == id && x.OrganizationId == b.OrganizationId && x.BranchId == b.BranchId), b.OrganizationId, b.BranchId, ct);
        var before = new { t.Code, t.NameEn, t.NameAr, t.IsActive, t.SortOrder };
        await ApplyTypeAsync(t, b.Item, ct);
        await SetTypeLinksAsync(b.OrganizationId, b.BranchId, id, b.Item.CategoryIds, ct);
        audit.Write("ticket_type.update", "ticket_type", id, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task SetTypeLinksAsync(Guid org, Guid? branch, Guid type, Guid[]? categoryIds, CancellationToken ct)
    {
        var cats = await Used(org, branch, PlaceCatalog.Category).Select(x => x.ItemId).ToListAsync(ct);
        var ids = (categoryIds ?? []).Distinct().ToList();
        if (ids.Any(c => !cats.Contains(c))) throw Err("notFound", "categoryIds");
        await db.PlaceTypeCategories.Where(x => x.OrganizationId == org && x.BranchId == branch && x.TypeId == type).ExecuteDeleteAsync(ct);
        foreach (var c in ids) db.PlaceTypeCategories.Add(new PlaceTypeCategory { Id = Guid.NewGuid(), OrganizationId = org, BranchId = branch, TypeId = type, CategoryId = c });
    }

    [HttpPost("place-catalog/categories")]
    public async Task<object> PlaceCreateCategory(PlaceCategoryBody b, CancellationToken ct)
    {
        await PlaceAsync(b.OrganizationId, b.BranchId, ct);
        await CheckKindAsync(b.OrganizationId, b.BranchId, b.Item.TeamKindId, ct);
        var c = new TicketCategory { Id = Guid.NewGuid(), OrganizationId = b.OrganizationId, BranchId = b.BranchId };
        await ApplyCategoryAsync(c, b.Item with { DefaultTeamId = null }, ct);
        db.TicketCategories.Add(c);
        await db.SaveChangesAsync(ct);
        await AddUseAsync(b.OrganizationId, b.BranchId, PlaceCatalog.Category, c.Id, ct);
        if (c.TeamKindId is Guid k) await AddUseAsync(b.OrganizationId, b.BranchId, PlaceCatalog.Kind, k, ct);
        var types = await Used(b.OrganizationId, b.BranchId, PlaceCatalog.Type).Select(x => x.ItemId).ToListAsync(ct);
        foreach (var t in (b.Item.TypeIds ?? []).Distinct())
        {
            if (!types.Contains(t)) throw Err("notFound", "typeIds");
            db.PlaceTypeCategories.Add(new PlaceTypeCategory { Id = Guid.NewGuid(), OrganizationId = b.OrganizationId, BranchId = b.BranchId, TypeId = t, CategoryId = c.Id });
        }
        audit.Write("category.create", "ticket_category", c.Id, null, b);
        await db.SaveChangesAsync(ct);
        return new { c.Id };
    }

    [HttpPut("place-catalog/categories/{id:guid}")]
    public async Task<IActionResult> PlaceUpdateCategory(Guid id, PlaceCategoryBody b, CancellationToken ct)
    {
        await PlaceAsync(b.OrganizationId, b.BranchId, ct);
        var c = await OwnAsync(db.TicketCategories.Where(x => x.Id == id && x.OrganizationId == b.OrganizationId && x.BranchId == b.BranchId), b.OrganizationId, b.BranchId, ct);
        await CheckKindAsync(b.OrganizationId, b.BranchId, b.Item.TeamKindId, ct);
        var before = new { c.NameEn, c.NameAr, c.TeamKindId, c.IsActive, c.SortOrder, c.PriorityCode, c.IsPrivate, c.AutoAssign };
        await ApplyCategoryAsync(c, b.Item with { DefaultTeamId = null }, ct);
        if (c.TeamKindId is Guid k) await AddUseAsync(b.OrganizationId, b.BranchId, PlaceCatalog.Kind, k, ct);
        audit.Write("category.update", "ticket_category", id, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>A place's own category is handled by a kind of team the place can see: the system's, its organization's or its own.</summary>
    private async Task CheckKindAsync(Guid org, Guid? branch, Guid? kind, CancellationToken ct)
    {
        if (kind is not Guid k) return;
        var owner = await OwnerAsync(PlaceCatalog.Kind, k, ct);
        if (owner is not var (o, b) || !(o is null || (o == org && (b == branch || b is null)))) throw Err("notFound", "teamKindId");
    }

    [HttpPost("place-catalog/subcategories")]
    public async Task<object> PlaceCreateSub(PlaceSubBody b, CancellationToken ct)
    {
        await PlaceAsync(b.OrganizationId, b.BranchId, ct);
        if (!await Used(b.OrganizationId, b.BranchId, PlaceCatalog.Category).AnyAsync(x => x.ItemId == b.Item.CategoryId, ct)) throw Err("notFound", "categoryId");
        var s = new TicketSubcategory { Id = Guid.NewGuid(), OrganizationId = b.OrganizationId, BranchId = b.BranchId };
        await ApplySubAsync(s, b.Item, ct);
        db.TicketSubcategories.Add(s);
        await db.SaveChangesAsync(ct);
        await AddUseAsync(b.OrganizationId, b.BranchId, PlaceCatalog.Subcategory, s.Id, ct);
        audit.Write("subcategory.create", "ticket_subcategory", s.Id, null, b);
        await db.SaveChangesAsync(ct);
        return new { s.Id };
    }

    [HttpPut("place-catalog/subcategories/{id:guid}")]
    public async Task<IActionResult> PlaceUpdateSub(Guid id, PlaceSubBody b, CancellationToken ct)
    {
        await PlaceAsync(b.OrganizationId, b.BranchId, ct);
        var s = await OwnAsync(db.TicketSubcategories.Where(x => x.Id == id && x.OrganizationId == b.OrganizationId && x.BranchId == b.BranchId), b.OrganizationId, b.BranchId, ct);
        if (s.CategoryId != b.Item.CategoryId) throw Err("required", "categoryId");
        var before = new { s.NameEn, s.NameAr, s.IsActive, s.SortOrder, s.PriorityCode };
        await ApplySubAsync(s, b.Item, ct);
        audit.Write("subcategory.update", "ticket_subcategory", id, before, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Deletes a place's own type, category or sub-category that no ticket uses yet.</summary>
    [HttpDelete("place-catalog/{kind}/{id:guid}")]
    public async Task<IActionResult> PlaceDelete(string kind, Guid id, [FromQuery] Guid org, [FromQuery] Guid? branch, CancellationToken ct)
    {
        await PlaceAsync(org, branch, ct);
        switch (kind)
        {
            case "types":
                var t = await OwnAsync(db.TicketTypes.Where(x => x.Id == id && x.OrganizationId == org && x.BranchId == branch), org, branch, ct);
                if (await db.Tickets.AnyAsync(x => x.TicketTypeId == id, ct)) throw Err("ticketTypeInUse", null, 409);
                await db.PlaceCatalog.Where(x => x.ItemKind == PlaceCatalog.Type && x.ItemId == id).ExecuteDeleteAsync(ct);
                db.TicketTypes.Remove(t);
                break;
            case "categories":
                var c = await OwnAsync(db.TicketCategories.Where(x => x.Id == id && x.OrganizationId == org && x.BranchId == branch), org, branch, ct);
                if (await db.Tickets.AnyAsync(x => x.CategoryId == id, ct)) throw Err("inUse", null, 409);
                var subs = await db.TicketSubcategories.Where(s => s.CategoryId == id).Select(s => s.Id).ToListAsync(ct);
                await db.PlaceCatalog.Where(x => (x.ItemKind == PlaceCatalog.Category && x.ItemId == id) || (x.ItemKind == PlaceCatalog.Subcategory && subs.Contains(x.ItemId))).ExecuteDeleteAsync(ct);
                await db.TicketTypeCategories.Where(l => l.CategoryId == id).ExecuteDeleteAsync(ct);
                db.TicketCategories.Remove(c);
                break;
            case "subcategories":
                var s0 = await OwnAsync(db.TicketSubcategories.Where(x => x.Id == id && x.OrganizationId == org && x.BranchId == branch), org, branch, ct);
                if (await db.Tickets.AnyAsync(x => x.SubcategoryId == id, ct)) throw Err("inUse", null, 409);
                await db.PlaceCatalog.Where(x => x.ItemKind == PlaceCatalog.Subcategory && x.ItemId == id).ExecuteDeleteAsync(ct);
                db.TicketSubcategories.Remove(s0);
                break;
            default: throw new NotFoundException();
        }
        audit.Write("place_catalog.delete", kind, id, null, null);
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { throw Err("inUse", null, 409); }
        return NoContent();
    }
}
