using Ccs.Application.Abstractions;
using Ccs.Application.Settings;
using Ccs.Domain;
using Ccs.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Application.Tickets;

/// <summary>Which flow a ticket follows, and what that flow allows. A ticket keeps the flow it started with.</summary>
public static class FlowLookup
{
    public static async Task<Guid> DefaultIdAsync(ICcsDbContext db, CancellationToken ct) =>
        await db.TicketFlows.AsNoTracking().Where(f => f.IsDefault).Select(f => (Guid?)f.Id).FirstOrDefaultAsync(ct) ?? FlowRules.StandardId;

    public static async Task<Guid> OfTicketAsync(ICcsDbContext db, Guid? ticketFlowId, CancellationToken ct) =>
        ticketFlowId ?? await DefaultIdAsync(db, ct);

    /// <summary>The statuses of a flow; every status when the flow is unknown (older data, tests without flows).</summary>
    public static async Task<IReadOnlyList<string>> StatusesAsync(ICcsDbContext db, Guid flowId, CancellationToken ct)
    {
        var csv = await db.TicketFlows.AsNoTracking().Where(f => f.Id == flowId).Select(f => f.Statuses).FirstOrDefaultAsync(ct);
        var list = FlowRules.Parse(csv);
        return list.Count == 0 ? TicketStatus.All : list;
    }

    /// <summary>The admin's own statuses: code → the built-in status it behaves like.</summary>
    public static async Task<Dictionary<string, string>> LikesAsync(ICcsDbContext db, CancellationToken ct) =>
        await db.TicketCustomStatuses.AsNoTracking().ToDictionaryAsync(x => x.Code, x => x.BehavesLike, ct);

    /// <summary>The admin's own statuses that have their own customer name (the others show the name of the status they behave like).</summary>
    public static async Task<HashSet<string>> OwnCustomerNamesAsync(ICcsDbContext db, CancellationToken ct) =>
        (await db.SystemMessages.AsNoTracking().Where(m => m.Key.StartsWith("CustomerStatus." + CustomStatuses.Prefix)).Select(m => m.Key).Distinct().ToListAsync(ct))
            .Select(k => k["CustomerStatus.".Length..]).ToHashSet();

    /// <summary>The flow a new ticket starts with: its ticket type's or its category's (Settings: flow_choice), else the default flow.</summary>
    public static async Task<Guid> ForNewTicketAsync(ICcsDbContext db, SettingsService settings, Guid? typeId, Guid categoryId, CancellationToken ct)
    {
        var byCategory = await settings.GetStringAsync(FlowRules.ChoiceKey, "type", ct) == "category";
        Guid? picked = byCategory
            ? await db.TicketCategories.AsNoTracking().Where(c => c.Id == categoryId).Select(c => c.FlowId).FirstOrDefaultAsync(ct)
            : typeId is Guid t ? await db.TicketTypes.AsNoTracking().Where(x => x.Id == t).Select(x => x.FlowId).FirstOrDefaultAsync(ct) : null;
        if (picked is Guid id && await db.TicketFlows.AnyAsync(f => f.Id == id, ct)) return id;
        return await DefaultIdAsync(db, ct);
    }
}
