using Ccs.Application.Access;
using Ccs.Application.Abstractions;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>In-app notifications of the signed-in person (the bell).</summary>
[ApiController]
[Authorize]
[Route("api/notifications")]
public sealed class NotificationsController(AccessService access, CcsDbContext db, IClock clock) : ControllerBase
{
    [HttpGet]
    public async Task<object> List([FromQuery] int page = 1, CancellationToken ct = default)
    {
        var c = await access.RequireSignedInAsync(ct);
        page = Math.Max(1, page);
        var q = db.Notifications.AsNoTracking().Where(n => n.UserId == c.UserId && n.Channel == "in_app");
        var total = await q.CountAsync(ct);
        var items = await q.OrderByDescending(n => n.CreatedAt).Skip((page - 1) * 30).Take(30)
            .Select(n => new { n.Id, n.EventType, n.TicketId, n.Payload, n.ReadAt, n.CreatedAt }).ToListAsync(ct);
        return new { items, total, page, pageSize = 30 };
    }

    [HttpPost("{id:guid}/read")]
    public async Task<IActionResult> MarkRead(Guid id, CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        await db.Notifications.Where(n => n.Id == id && n.UserId == c.UserId && n.ReadAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, clock.UtcNow), ct);
        return NoContent();
    }

    [HttpPost("read-all")]
    public async Task<IActionResult> MarkAll(CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        await db.Notifications.Where(n => n.UserId == c.UserId && n.Channel == "in_app" && n.ReadAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, clock.UtcNow), ct);
        return NoContent();
    }
}
