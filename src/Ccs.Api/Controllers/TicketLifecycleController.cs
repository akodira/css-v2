using System.Text.Json;
using Ccs.Application.Tickets;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Ccs.Api.Controllers;

/// <summary>Ticket actions beyond reply / status / assign / priority. Every rule lives in TicketLifecycleService.</summary>
[ApiController]
[Authorize]
[Route("api/tickets/{id:guid}")]
[EnableRateLimiting("writes")]
public sealed class TicketLifecycleController(TicketLifecycleService svc) : ControllerBase
{
    public sealed record CategoryBody(Guid CategoryId, Guid? SubcategoryId, string? Reason);
    public sealed record ReasonBody(string? Reason);
    public sealed record EscalateToBody(Guid Target, string? Reason);
    public sealed record DuplicateBody(string Reference);
    public sealed record BodyText(string? Body);
    public sealed record DecisionBody(bool Approve, string? Note);
    public sealed record FeedbackBody(int Rating, string? Comment);
    public sealed record FollowUpBody(Guid Of);

    [HttpGet("lifecycle"), DisableRateLimiting]
    public Task<TicketLifecycle> Get(Guid id, CancellationToken ct) => svc.GetAsync(id, ct);

    [HttpPost("category")]
    public async Task<IActionResult> Category(Guid id, CategoryBody b, CancellationToken ct) { await svc.ChangeCategoryAsync(id, b.CategoryId, b.SubcategoryId, b.Reason, ct); return NoContent(); }

    [HttpPost("escalate")]
    public async Task<IActionResult> Escalate(Guid id, ReasonBody b, CancellationToken ct) { await svc.EscalateAsync(id, b.Reason, ct); return NoContent(); }

    [HttpPost("escalate-to")]
    public async Task<IActionResult> EscalateTo(Guid id, EscalateToBody b, CancellationToken ct) { await svc.EscalateToAsync(id, b.Target, b.Reason, ct); return NoContent(); }

    [HttpPost("duplicate")]
    public async Task<IActionResult> Duplicate(Guid id, DuplicateBody b, CancellationToken ct) { await svc.MarkDuplicateAsync(id, b.Reference, ct); return NoContent(); }

    [HttpPost("spam")]
    public async Task<IActionResult> Spam(Guid id, CancellationToken ct) { await svc.MarkSpamAsync(id, ct); return NoContent(); }

    [HttpPut("staff-fields")]
    public async Task<IActionResult> StaffFields(Guid id, Dictionary<string, JsonElement> values, CancellationToken ct) { await svc.SetStaffFieldsAsync(id, values, ct); return NoContent(); }

    [HttpPut("messages/{messageId:guid}")]
    public async Task<IActionResult> EditMessage(Guid id, Guid messageId, BodyText b, CancellationToken ct) { await svc.EditMessageAsync(id, messageId, b.Body, ct); return NoContent(); }

    [HttpDelete("messages/{messageId:guid}")]
    public async Task<IActionResult> DeleteMessage(Guid id, Guid messageId, CancellationToken ct) { await svc.DeleteMessageAsync(id, messageId, ct); return NoContent(); }

    [HttpPost("cancel")]
    public async Task<object> Cancel(Guid id, ReasonBody b, CancellationToken ct) => new { mode = await svc.CancelAsync(id, b.Reason, ct) };

    [HttpPost("cancel/withdraw")]
    public async Task<IActionResult> Withdraw(Guid id, CancellationToken ct) { await svc.WithdrawCancellationAsync(id, ct); return NoContent(); }

    [HttpPost("cancellations/{requestId:guid}")]
    public async Task<IActionResult> Decide(Guid id, Guid requestId, DecisionBody b, CancellationToken ct) { await svc.DecideCancellationAsync(id, requestId, b.Approve, b.Note, ct); return NoContent(); }

    [HttpPost("feedback")]
    public async Task<IActionResult> Feedback(Guid id, FeedbackBody b, CancellationToken ct) { await svc.SubmitFeedbackAsync(id, b.Rating, b.Comment, ct); return NoContent(); }

    [HttpPost("follow-up")]
    public async Task<IActionResult> FollowUp(Guid id, FollowUpBody b, CancellationToken ct) { await svc.LinkFollowUpAsync(id, b.Of, ct); return NoContent(); }
}
