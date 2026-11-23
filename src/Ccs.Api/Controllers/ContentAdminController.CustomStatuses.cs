using Ccs.Application.Common;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>
/// Ticket status → the admin's own statuses. Each behaves like In progress, Pending customer or Pending internal; its names and
/// colour are texts like the built-in ones. A flow uses it once the admin adds it to that flow.
/// </summary>
public sealed partial class ContentAdminController
{
    public sealed record CustomStatusBody(string? StaffEn, string? StaffAr, string? CustomerEn, string? CustomerAr, string? Tone, string? BehavesLike);
    public sealed record CustomStatusLikeBody(string? BehavesLike);

    [HttpPost("custom-statuses")]
    public async Task<object> CreateCustomStatus(CustomStatusBody b, CancellationToken ct)
    {
        var c = await Need(Permission.ManageSettings, ct);
        var like = Like(b.BehavesLike);
        if (await db.TicketCustomStatuses.CountAsync(ct) >= 30) throw Err("customStatusLimit", null, 409);
        var code = CustomStatuses.NewCode();
        var label = new LabelBody(b.StaffEn, b.StaffAr, b.CustomerEn, b.CustomerAr, null, null, string.IsNullOrEmpty(b.Tone) ? "brand" : b.Tone);
        await CustomNamesAsync(code, label, ct);
        var sort = (await db.TicketCustomStatuses.MaxAsync(x => (int?)x.SortOrder, ct) ?? 0) + 10;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        db.TicketCustomStatuses.Add(new TicketCustomStatus { Code = code, BehavesLike = like, SortOrder = sort, CreatedAt = clock.UtcNow });
        await WriteLabelsAsync(code, label, c.UserId, ct);
        audit.Write("custom_status.create", "ticket_custom_statuses", null, null, new { code, like, b });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { code };
    }

    /// <summary>Changes what a status behaves like. Refused while a flow uses it: the flow's checks were made for the old behaviour.</summary>
    [HttpPut("custom-statuses/{code}")]
    public async Task<IActionResult> SaveCustomStatus(string code, CustomStatusLikeBody b, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        var row = await db.TicketCustomStatuses.FirstOrDefaultAsync(x => x.Code == code, ct) ?? throw new NotFoundException();
        var like = Like(b.BehavesLike);
        if (like == row.BehavesLike) return NoContent();
        if (await InFlowsAsync(code, ct)) throw Err("customStatusInFlow", "behavesLike", 409);
        audit.Write("custom_status.update", "ticket_custom_statuses", null, new { code, like = row.BehavesLike }, new { code, like });
        row.BehavesLike = like;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Deleted only when no flow and no open ticket uses it. Its names stay, so old history still reads well.</summary>
    [HttpDelete("custom-statuses/{code}")]
    public async Task<IActionResult> DeleteCustomStatus(string code, CancellationToken ct)
    {
        await Need(Permission.ManageSettings, ct);
        var row = await db.TicketCustomStatuses.FirstOrDefaultAsync(x => x.Code == code, ct) ?? throw new NotFoundException();
        if (await InFlowsAsync(code, ct)) throw Err("customStatusInFlow", null, 409);
        if (await db.Tickets.AnyAsync(t => t.CustomStatus == code, ct)) throw Err("customStatusInUse", null, 409);
        db.TicketCustomStatuses.Remove(row);
        audit.Write("custom_status.delete", "ticket_custom_statuses", null, new { code, like = row.BehavesLike }, null);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private string Like(string? s) => CustomStatuses.Likes.Contains(s ?? "") ? s! : throw Err("required", "behavesLike");

    private async Task<bool> InFlowsAsync(string code, CancellationToken ct) =>
        (await db.TicketFlows.AsNoTracking().Select(f => f.Statuses).ToListAsync(ct)).Any(s => FlowRules.Parse(s).Contains(code));

    /// <summary>The admin's own statuses need both staff names (2–60 characters), and no two may share an English or Arabic name.</summary>
    private async Task CustomNamesAsync(string code, LabelBody b, CancellationToken ct)
    {
        var en = (b.StaffEn ?? "").Trim(); var ar = (b.StaffAr ?? "").Trim();
        if (en.Length is < 2 or > 60) throw Err("name", "staffEn");
        if (ar.Length is < 2 or > 60) throw Err("name", "staffAr");
        if ((b.CustomerEn ?? "").Trim().Length > 60) throw Err("name", "customerEn");
        if ((b.CustomerAr ?? "").Trim().Length > 60) throw Err("name", "customerAr");
        var key = "StaffStatus." + code;
        var taken = await db.SystemMessages.AsNoTracking()
            .Where(m => m.Key.StartsWith("StaffStatus." + CustomStatuses.Prefix) && m.Key != key && ((m.Locale == "en" && m.Body == en) || (m.Locale == "ar" && m.Body == ar)))
            .Select(m => m.Key).ToListAsync(ct);
        var live = await db.TicketCustomStatuses.AsNoTracking().Select(x => "StaffStatus." + x.Code).ToListAsync(ct);
        if (taken.Any(live.Contains)) throw Err("nameTaken", "staffEn", 409);
    }
}
