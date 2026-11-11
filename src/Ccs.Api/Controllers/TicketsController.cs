using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Ccs.Application.Common;
using Ccs.Application.Tickets;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Ccs.Api.Controllers;

public sealed record CreateTicketBody([Required] Guid TypeId, [Required] Guid CategoryId, Guid? SubcategoryId,
    [Required] string Subject, [Required] string Description, Dictionary<string, JsonElement>? CustomValues,
    string? Priority, Guid? RequesterId);
public sealed record StatusBody([Required] string To, string? Reason, string? Resolution, string? ClosureReason);
public sealed record MessageBody([Required] string Kind, [Required] string Body);
public sealed record AssignBody([Required] Guid TeamId, Guid? AgentId, string? Reason);
public sealed record PriorityBody([Required] string Priority, string? Reason);

/// <summary>Thin controller: every rule lives in TicketService / TicketQueries / AccessService.</summary>
[ApiController]
[Authorize]
[Route("api/tickets")]
public sealed class TicketsController(TicketService tickets, TicketQueries queries, CatalogQueries catalog) : ControllerBase
{
    /// <summary>Lists only what the caller may see. Sort by any column; default newest updated first.</summary>
    [HttpGet]
    public Task<PagedResult<TicketListItem>> List([FromQuery] TicketListFilter filter, [FromQuery] PageRequest paging, CancellationToken ct) =>
        queries.ListAsync(filter, paging, ct);

    [HttpGet("summary")]
    public Task<TicketSummary> Summary([FromQuery] bool mine, CancellationToken ct) => queries.SummaryAsync(mine, ct);

    [HttpGet("options")]
    public Task<NewTicketOptions> Options(CancellationToken ct) => catalog.NewTicketOptionsAsync(ct);

    [HttpGet("{id:guid}")]
    public Task<TicketDetail> Get(Guid id, CancellationToken ct) => queries.GetAsync(id, ct);

    [HttpPost]
    [EnableRateLimiting("writes")]
    public async Task<ActionResult<CreatedTicket>> Create(CreateTicketBody b, CancellationToken ct)
    {
        var created = await tickets.CreateAsync(new CreateTicketCommand(b.TypeId, b.CategoryId, b.SubcategoryId, b.Subject,
            b.Description, b.CustomValues, b.Priority, b.RequesterId), ct);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    [HttpPost("{id:guid}/status")]
    public async Task<IActionResult> ChangeStatus(Guid id, StatusBody b, CancellationToken ct)
    {
        await tickets.ChangeStatusAsync(id, new ChangeStatusCommand(b.To, b.Reason, b.Resolution, b.ClosureReason), ct);
        return NoContent();
    }

    [HttpPost("{id:guid}/messages")]
    [EnableRateLimiting("writes")]
    public async Task<ActionResult<object>> AddMessage(Guid id, MessageBody b, CancellationToken ct) =>
        Ok(new { id = await tickets.AddMessageAsync(id, b.Kind, b.Body, ct) });

    [HttpPost("{id:guid}/assign")]
    public async Task<IActionResult> Assign(Guid id, AssignBody b, CancellationToken ct)
    {
        await tickets.AssignAsync(id, new AssignCommand(b.TeamId, b.AgentId, b.Reason), ct);
        return NoContent();
    }

    [HttpPost("{id:guid}/priority")]
    public async Task<IActionResult> SetPriority(Guid id, PriorityBody b, CancellationToken ct)
    {
        await tickets.SetPriorityAsync(id, b.Priority, ct, b.Reason);
        return NoContent();
    }
}
