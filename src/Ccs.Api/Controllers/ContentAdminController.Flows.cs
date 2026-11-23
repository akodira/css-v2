using Ccs.Application.Common;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>
/// Ticket status → several flows. A flow has statuses and button moves; a ticket type or a category (one rule for the whole
/// system, Settings key flow_choice) picks the flow of new tickets; a ticket keeps the flow it started with.
/// </summary>
public sealed partial class ContentAdminController
{
    public sealed record FlowCreateBody(string NameEn, string NameAr, string? Description, Guid? CopyFrom);
    public sealed record FlowSaveBody(string NameEn, string NameAr, string? Description, string[] Statuses, FlowRow[] Rows);
    public sealed record FlowPick(Guid Id, Guid? FlowId);
    public sealed record FlowChoiceBody(string Mode, FlowPick[]? Types, FlowPick[]? Categories);

    [HttpGet("flows")]
    public async Task<object> Flows(CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        var flows = await db.TicketFlows.AsNoTracking().OrderByDescending(f => f.IsDefault).ThenBy(f => f.NameEn).ToListAsync(ct);
        var rows = await db.TicketStatusTransitions.AsNoTracking().ToListAsync(ct);
        var defaultId = flows.FirstOrDefault(f => f.IsDefault)?.Id ?? FlowRules.StandardId;
        var open = await db.Tickets.AsNoTracking().Where(t => t.Status != TicketStatus.Closed)
            .GroupBy(t => new { t.FlowId, t.Status }).Select(g => new { g.Key.FlowId, g.Key.Status, N = g.Count() }).ToListAsync(ct);
        var choice = await db.AppSettings.AsNoTracking().Where(s => s.Key == FlowRules.ChoiceKey).Select(s => s.Value).FirstOrDefaultAsync(ct);
        return new
        {
            choice = (choice ?? "").Contains("category") ? "category" : "type",
            flows = flows.Select(f =>
            {
                var mine = rows.Where(r => r.FlowId == f.Id).Select(r => new FlowRow(r.FromStatus, r.ToStatus, r.Actor, r.RequiresReason)).ToList();
                var statuses = FlowRules.Parse(f.Statuses);
                return new
                {
                    f.Id, f.NameEn, f.NameAr, f.Description, f.IsDefault, Statuses = statuses, Transitions = mine,
                    Problems = FlowRules.Problems(statuses, mine.Select(r => new Transition(r.From, r.To, r.Actor, r.RequiresReason)).ToList()),
                    OpenTickets = open.Where(o => (o.FlowId ?? defaultId) == f.Id).ToDictionary(o => o.Status, o => o.N),
                };
            }),
            types = await db.TicketTypes.AsNoTracking().OrderBy(t => t.SortOrder).Select(t => new { t.Id, t.NameEn, t.NameAr, t.Code, t.FlowId, t.IsActive }).ToListAsync(ct),
            categories = await db.TicketCategories.AsNoTracking().OrderBy(c => c.SortOrder).ThenBy(c => c.NameEn).Select(c => new { c.Id, c.NameEn, c.NameAr, c.FlowId, c.IsActive }).ToListAsync(ct),
        };
    }

    /// <summary>New flow: a copy of another flow (or of the default flow).</summary>
    [HttpPost("flows")]
    public async Task<object> CreateFlow(FlowCreateBody b, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        var (en, ar) = await FlowNamesAsync(null, b.NameEn, b.NameAr, ct);
        var from = b.CopyFrom is Guid c && await db.TicketFlows.AnyAsync(f => f.Id == c, ct) ? c
                 : await db.TicketFlows.Where(f => f.IsDefault).Select(f => (Guid?)f.Id).FirstOrDefaultAsync(ct) ?? FlowRules.StandardId;
        var src = await db.TicketFlows.AsNoTracking().FirstOrDefaultAsync(f => f.Id == from, ct);
        var now = clock.UtcNow;
        var flow = new TicketFlow
        {
            Id = Guid.NewGuid(), NameEn = en, NameAr = ar, Description = Desc(b.Description), IsDefault = false,
            Statuses = src?.Statuses ?? FlowRules.Join(TicketStatus.All), CreatedAt = now, UpdatedAt = now,
        };
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        db.TicketFlows.Add(flow);
        await db.SaveChangesAsync(ct);
        foreach (var r in await db.TicketStatusTransitions.AsNoTracking().Where(x => x.FlowId == from).ToListAsync(ct))
            db.TicketStatusTransitions.Add(new TicketStatusTransition { FlowId = flow.Id, FromStatus = r.FromStatus, ToStatus = r.ToStatus, Actor = r.Actor, RequiresReason = r.RequiresReason });
        audit.Write("flow.create", "ticket_flow", flow.Id, null, new { en, ar, copyFrom = from });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { flow.Id };
    }

    /// <summary>Saves a flow's name, statuses and button moves. Refused while the checks find a problem, or when a status
    /// that open tickets of this flow are in would be removed.</summary>
    [HttpPut("flows/{id:guid}")]
    public async Task<IActionResult> SaveFlow(Guid id, FlowSaveBody b, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        var flow = await db.TicketFlows.FirstOrDefaultAsync(f => f.Id == id, ct) ?? throw new NotFoundException();
        var (en, ar) = await FlowNamesAsync(id, b.NameEn, b.NameAr, ct);
        var statuses = (b.Statuses ?? []).Distinct().ToList();
        if (!FlowRules.ValidStatuses(statuses)) throw Err("flowStatuses", "statuses");
        var rows = (b.Rows ?? []).DistinctBy(r => (r.From, r.To, r.Actor)).ToList();
        foreach (var r in rows)
            if (!TicketStatus.IsValid(r.From) || !TicketStatus.IsValid(r.To) || r.From == r.To || r.To == TicketStatus.New || r.Actor is not ("staff" or "customer"))
                throw Err("status", "rows");
        var problems = FlowRules.Problems(statuses, rows.Select(r => new Transition(r.From, r.To, r.Actor, r.RequiresReason)).ToList());
        if (problems.Count > 0) throw new Ccs.Infrastructure.Identity.AuthError("flowProblems", 400, "rows", new Dictionary<string, object?> { ["problems"] = problems });

        var removed = FlowRules.Parse(flow.Statuses).Except(statuses).ToList();
        if (removed.Count > 0)
        {
            var defaultId = await db.TicketFlows.Where(f => f.IsDefault).Select(f => (Guid?)f.Id).FirstOrDefaultAsync(ct) ?? FlowRules.StandardId;
            var stuck = await db.Tickets.CountAsync(t => (t.FlowId ?? defaultId) == id && removed.Contains(t.Status) && t.Status != TicketStatus.Closed, ct);
            if (stuck > 0) throw new Ccs.Infrastructure.Identity.AuthError("flowStatusInUse", 409, "statuses", new Dictionary<string, object?> { ["count"] = stuck });
        }

        var before = new { flow.NameEn, flow.NameAr, flow.Statuses, rows = await db.TicketStatusTransitions.AsNoTracking().Where(x => x.FlowId == id).Select(r => new FlowRow(r.FromStatus, r.ToStatus, r.Actor, r.RequiresReason)).ToListAsync(ct) };
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.TicketStatusTransitions.Where(x => x.FlowId == id).ExecuteDeleteAsync(ct);
        foreach (var r in rows) db.TicketStatusTransitions.Add(new TicketStatusTransition { FlowId = id, FromStatus = r.From, ToStatus = r.To, Actor = r.Actor, RequiresReason = r.RequiresReason });
        flow.NameEn = en; flow.NameAr = ar; flow.Description = Desc(b.Description); flow.Statuses = FlowRules.Join(statuses); flow.UpdatedAt = clock.UtcNow;
        audit.Write("flow.update", "ticket_flow", id, before, new { en, ar, statuses, rows });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return NoContent();
    }

    [HttpPost("flows/{id:guid}/default")]
    public async Task<IActionResult> MakeDefault(Guid id, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        if (!await db.TicketFlows.AnyAsync(f => f.Id == id, ct)) throw new NotFoundException();
        // Tickets that relied on "the default flow" keep the flow they started with.
        var oldDefault = await db.TicketFlows.Where(f => f.IsDefault).Select(f => (Guid?)f.Id).FirstOrDefaultAsync(ct) ?? FlowRules.StandardId;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        if (oldDefault != id) await db.Tickets.Where(t => t.FlowId == null && t.Status != TicketStatus.Closed).ExecuteUpdateAsync(s => s.SetProperty(t => t.FlowId, oldDefault), ct);
        await db.TicketFlows.ExecuteUpdateAsync(s => s.SetProperty(f => f.IsDefault, f => f.Id == id), ct);
        audit.Write("flow.default", "ticket_flow", id, new { oldDefault }, new { id });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return NoContent();
    }

    [HttpDelete("flows/{id:guid}")]
    public async Task<IActionResult> DeleteFlow(Guid id, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        var flow = await db.TicketFlows.FirstOrDefaultAsync(f => f.Id == id, ct) ?? throw new NotFoundException();
        if (flow.IsDefault) throw Err("flowDefault", null, 409);
        if (await db.TicketTypes.AnyAsync(t => t.FlowId == id, ct) || await db.TicketCategories.AnyAsync(c => c.FlowId == id, ct)) throw Err("flowInUse", null, 409);
        if (await db.Tickets.AnyAsync(t => t.FlowId == id && t.Status != TicketStatus.Closed, ct)) throw Err("flowOpenTickets", null, 409);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        // Closed tickets of this flow follow the default flow if they are ever reopened.
        await db.Tickets.Where(t => t.FlowId == id).ExecuteUpdateAsync(s => s.SetProperty(t => t.FlowId, (Guid?)null), ct);
        await db.TicketStatusTransitions.Where(x => x.FlowId == id).ExecuteDeleteAsync(ct);
        db.TicketFlows.Remove(flow);
        audit.Write("flow.delete", "ticket_flow", id, new { flow.NameEn, flow.NameAr }, null);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return NoContent();
    }

    /// <summary>Who uses which flow: by ticket type or by category, and the flow of each. Only new tickets are affected.</summary>
    [HttpPut("flow-choice")]
    public async Task<IActionResult> SaveChoice(FlowChoiceBody b, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        if (b.Mode is not ("type" or "category")) throw Err("required", "mode");
        var picks = (b.Types ?? []).Concat(b.Categories ?? []).Where(p => p.FlowId is not null).Select(p => p.FlowId!.Value).Distinct().ToList();
        if (await db.TicketFlows.CountAsync(f => picks.Contains(f.Id), ct) != picks.Count) throw Err("notFound", "flowId");
        foreach (var p in b.Types ?? [])
            await db.TicketTypes.Where(t => t.Id == p.Id).ExecuteUpdateAsync(s => s.SetProperty(t => t.FlowId, p.FlowId), ct);
        foreach (var p in b.Categories ?? [])
            await db.TicketCategories.Where(c => c.Id == p.Id).ExecuteUpdateAsync(s => s.SetProperty(c => c.FlowId, p.FlowId), ct);
        var row = await db.AppSettings.FirstOrDefaultAsync(s => s.Key == FlowRules.ChoiceKey, ct);
        var json = System.Text.Json.JsonSerializer.Serialize(b.Mode);
        if (row is null) db.AppSettings.Add(new AppSetting { Key = FlowRules.ChoiceKey, Value = json });
        else row.Value = json;
        audit.Write("flow.choice", "system_settings", null, null, b);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task<(string En, string Ar)> FlowNamesAsync(Guid? self, string? en, string? ar, CancellationToken ct)
    {
        var e = (en ?? "").Trim(); var a = (ar ?? "").Trim();
        if (e.Length is < 2 or > 80) throw Err("name", "nameEn");
        if (a.Length is < 2 or > 80) throw Err("name", "nameAr");
        if (await db.TicketFlows.AnyAsync(f => f.Id != self && f.NameEn == e, ct)) throw Err("nameTaken", "nameEn", 409);
        return (e, a);
    }

    private static string Desc(string? d) { var x = (d ?? "").Trim(); return x.Length > 300 ? x[..300] : x; }
}
