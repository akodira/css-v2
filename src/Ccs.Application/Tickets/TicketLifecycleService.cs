using System.Text.Json;
using Ccs.Application.Abstractions;
using Ccs.Application.Access;
using Ccs.Application.Common;
using Ccs.Application.Notifications;
using Ccs.Application.Sla;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Application.Tickets;

public sealed record EscalationTarget(Guid Id, string Name, string Label, string RuleKey);
public sealed record TicketLinkDto(string Kind, string Direction, Guid? OtherId, string? OtherReference);
public sealed record CancellationDto(Guid Id, string Reason, string Status, string? RequesterName, DateTimeOffset CreatedAt, string? DecisionNote);
public sealed record FeedbackDto(int Rating, string? Comment);
public sealed record StaffFieldDto(Guid Id, string Key, string LabelEn, string LabelAr, string Type, string Options, bool IsRequired);
public sealed record TicketLifecycle(
    IReadOnlyList<TicketLinkDto> Links, CancellationDto? Cancellation, FeedbackDto? Feedback,
    IReadOnlyList<EscalationTarget> EscalationTargets, bool CanEscalate, bool CanChangeCategory, bool CanClose,
    IReadOnlyList<StaffFieldDto> StaffFields, IReadOnlyDictionary<string, string> StaffValues);

/// <summary>
/// The ticket actions around the main flow, ported from the v1 PostgreSQL functions:
/// change_ticket_category, escalate_ticket / escalation_targets / escalate_ticket_flow, mark_ticket_duplicate,
/// mark_ticket_spam, set_staff_custom_values, edit_message / delete_message, cancel_ticket / decide_cancellation /
/// withdraw_cancellation, submit_feedback and link_follow_up.
/// </summary>
public sealed class TicketLifecycleService(
    ICcsDbContext db, AccessService access, SlaService sla, NotificationService notifications, AuditService audit, IClock clock)
{
    public static readonly TimeSpan EditWindow = TimeSpan.FromMinutes(5);

    private static string Reason(string? r)
    {
        var s = (r ?? "").Trim();
        if (s.Length is < 3 or > 1000) throw new ValidationFailedException("a reason is required", "reason");
        return s;
    }

    // ------------------------------------------------------------------ read model for the ticket pages

    public async Task<TicketLifecycle> GetAsync(Guid ticketId, CancellationToken ct = default)
    {
        var (c, facts) = await access.RequireTicketAsync(ticketId, ct);
        var t = await db.Tickets.AsNoTracking().FirstAsync(x => x.Id == ticketId, ct);

        var raw = await db.TicketLinks.AsNoTracking().Where(l => l.TicketId == ticketId || l.LinkedTicketId == ticketId).ToListAsync(ct);
        var links = new List<TicketLinkDto>();
        foreach (var l in raw)
        {
            var from = l.TicketId == ticketId;
            var other = from ? l.LinkedTicketId : l.TicketId;
            var of = await access.GetFactsAsync(other, ct);
            var visible = of is not null && AccessRules.CanAccessTicket(c, of);
            var reference = visible ? await db.Tickets.Where(x => x.Id == other).Select(x => x.Reference).FirstOrDefaultAsync(ct) : null;
            links.Add(new TicketLinkDto(l.Kind, from ? "from" : "to", visible ? other : null, reference));
        }

        var req = await (from r in db.TicketCancellationRequests.AsNoTracking()
                         join p in db.Profiles on r.RequestedBy equals p.Id
                         where r.TicketId == ticketId orderby r.CreatedAt descending
                         select new CancellationDto(r.Id, r.Reason, r.Status, p.FullName, r.CreatedAt, r.DecisionNote)).FirstOrDefaultAsync(ct);
        var fb = await db.CustomerFeedback.AsNoTracking().Where(f => f.TicketId == ticketId).Select(f => new FeedbackDto(f.Rating, f.Comment)).FirstOrDefaultAsync(ct);

        var works = c.Staff;
        var canClose = works && (c.Admin || c.Has(Permission.Close)) && t.Status != TicketStatus.Closed;
        var leads = t.TeamId is Guid team && c.LeaderOfTeams.Contains(team);
        List<StaffFieldDto> staffFields = [];
        Dictionary<string, string> staffValues = [];
        if (c.Internal)
        {
            var defs = await db.CustomFieldDefinitions.AsNoTracking()
                .Where(f => f.IsActive && !f.VisibleToCustomer && (f.CategoryId == null || f.CategoryId == t.CategoryId)).OrderBy(f => f.SortOrder).ToListAsync(ct);
            staffFields = defs.Select(f => new StaffFieldDto(f.Id, f.Key, f.LabelEn, f.LabelAr, f.Type, f.Options, f.IsRequired)).ToList();
            var ids = defs.Select(f => f.Id).ToList();
            staffValues = (await db.TicketCustomFieldValues.AsNoTracking().Where(v => v.TicketId == ticketId && ids.Contains(v.FieldId)).ToListAsync(ct))
                .ToDictionary(v => defs.First(f => f.Id == v.FieldId).Key, v => v.Value);
        }
        return new TicketLifecycle(links,
            req is null ? null : c.Internal || req.Status == "pending" ? req : req with { DecisionNote = req.Status == "rejected" ? req.DecisionNote : null },
            fb, works ? await EscalationTargetsAsync(c, t, ct) : [],
            CanEscalate: works && (c.Admin || leads),
            CanChangeCategory: works && (c.Admin || c.Has(Permission.ChangeCategory)) && t.Status != TicketStatus.Closed,
            CanClose: canClose, staffFields, staffValues);
    }

    // ------------------------------------------------------------------ category

    public async Task ChangeCategoryAsync(Guid ticketId, Guid categoryId, Guid? subcategoryId, string? reason, CancellationToken ct = default)
    {
        var (c, _) = await access.RequireTicketAsync(ticketId, ct);
        if (!c.Staff || !(c.Admin || c.Has(Permission.ChangeCategory))) throw new ForbiddenException();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await db.Tickets.FirstAsync(x => x.Id == ticketId, ct);
        if (t.Status == TicketStatus.Closed) throw new ForbiddenException("ticket_closed");
        var cat = await db.TicketCategories.AsNoTracking().FirstOrDefaultAsync(x => x.Id == categoryId && (x.IsActive || x.Id == t.CategoryId), ct)
                  ?? throw new ValidationFailedException("invalid category", "categoryId");
        TicketSubcategory? sub = null;
        if (subcategoryId is Guid sid)
            sub = await db.TicketSubcategories.AsNoTracking().FirstOrDefaultAsync(s => s.Id == sid && s.CategoryId == categoryId && (s.IsActive || s.Id == t.SubcategoryId), ct)
                  ?? throw new ValidationFailedException("invalid subcategory", "subcategoryId");
        if (t.CategoryId == categoryId && t.SubcategoryId == subcategoryId) return;

        var before = new { categoryId = t.CategoryId, subcategoryId = t.SubcategoryId, priority = t.Priority };
        t.CategoryId = categoryId; t.SubcategoryId = subcategoryId; t.UpdatedAt = clock.UtcNow;
        var fixedCode = sub?.PriorityCode ?? cat.PriorityCode;
        if (fixedCode is not null && fixedCode != t.Priority)
        {
            var old = t.Priority;
            t.Priority = fixedCode;
            await sla.ApplyPriorityAsync(t.Id, fixedCode, ct);
            await notifications.OnPriorityAsync(t, old, c.UserId, ct);
        }
        var note = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        audit.Write("ticket.category_changed", "ticket", t.Id, before, new { categoryId, subcategoryId, priority = t.Priority, reason = note });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    // ------------------------------------------------------------------ escalation

    private sealed record ChainRow(int Pos, string? Key, Guid Leader, string? Label);

    /// <summary>escalation_chain(): branch leader (or the team's leader), then each organization leader up the hierarchy.</summary>
    private async Task<List<ChainRow>> ChainAsync(Ticket t, CancellationToken ct)
    {
        var req = await db.Profiles.AsNoTracking().Where(p => p.Id == t.RequesterId).Select(p => new { p.OrganizationId, p.BranchId }).FirstAsync(ct);
        var rows = new List<ChainRow>();
        var br = req.BranchId is Guid b ? await db.Branches.AsNoTracking().Where(x => x.Id == b && x.TeamLeaderId != null).Select(x => new { x.TeamLeaderId, x.Name }).FirstOrDefaultAsync(ct) : null;
        if (br is not null) rows.Add(new ChainRow(0, "branch", br.TeamLeaderId!.Value, br.Name));
        else if (t.TeamId is Guid team)
        {
            var tl = await (from m in db.TeamMembers join p in db.Profiles on m.UserId equals p.Id
                            where m.TeamId == team && m.IsLeader && p.AccountStatus == AccountStatus.Active select m.UserId).FirstOrDefaultAsync(ct);
            if (tl != Guid.Empty) rows.Add(new ChainRow(0, "branch", tl, null));
        }
        if (req.OrganizationId is Guid org)
        {
            var orgs = await db.Organizations.AsNoTracking().Select(o => new { o.Id, o.ParentId, o.TeamLeaderId, o.Name }).ToListAsync(ct);
            var cur = orgs.FirstOrDefault(o => o.Id == org);
            for (var depth = 0; cur is not null && depth <= 30; depth++)
            {
                if (cur.TeamLeaderId is Guid lid) rows.Add(new ChainRow(1 + depth, cur.ParentId is not null ? "level:" + cur.Id : null, lid, cur.Name));
                cur = cur.ParentId is Guid pid ? orgs.FirstOrDefault(o => o.Id == pid) : null;
            }
        }
        return rows;
    }

    /// <summary>escalation_targets(): who the caller may escalate this ticket to (organization/branch escalation mode off | next | any).</summary>
    private async Task<List<EscalationTarget>> EscalationTargetsAsync(AccessContext c, Ticket t, CancellationToken ct)
    {
        var me = c.UserId;
        var modes = await (from p in db.Profiles
                           join o in db.Organizations on p.OrganizationId equals (Guid?)o.Id into oj from o in oj.DefaultIfEmpty()
                           join b in db.Branches on p.BranchId equals (Guid?)b.Id into bj from b in bj.DefaultIfEmpty()
                           where p.Id == t.RequesterId select new { Branch = b == null ? null : b.EscalationMode, Org = o == null ? null : o.EscalationMode })
                          .FirstOrDefaultAsync(ct);
        var mode = modes?.Branch ?? modes?.Org ?? "any";
        if (mode == "off") return [];
        var chain = await ChainAsync(t, ct);
        var mine = chain.Where(r => r.Leader == me).ToList();
        int pos; string? key;
        if (mine.Count > 0) { pos = mine.Max(r => r.Pos); key = mine.First(r => r.Pos == pos).Key ?? "top"; }
        else
        {
            pos = -1; key = null;
            var member = t.TeamId is Guid team && await db.TeamMembers.AnyAsync(m => m.TeamId == team && m.UserId == me && !m.IsLeader, ct);
            if (member || t.AssignedAgentId == me) key = "agent";
        }
        if (key is null or "top") return [];
        var cand = chain.Where(r => r.Pos > pos && r.Leader != me).GroupBy(r => r.Leader).Select(g => g.OrderBy(r => r.Pos).First()).OrderBy(r => r.Pos).ToList();
        if (mode == "next") cand = cand.Take(1).ToList();
        var ids = cand.Select(r => r.Leader).ToList();
        var names = await db.Profiles.AsNoTracking().Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.FullName, ct);
        return cand.Where(r => names.ContainsKey(r.Leader)).Select(r => new EscalationTarget(r.Leader, names[r.Leader], r.Label ?? "", key)).ToList();
    }

    /// <summary>escalate_ticket_flow(): hand the ticket to the chosen leader up the chain.</summary>
    public async Task EscalateToAsync(Guid ticketId, Guid target, string? reason, CancellationToken ct = default)
    {
        var (c, _) = await access.RequireTicketAsync(ticketId, ct);
        if (!c.Staff) throw new ForbiddenException();
        var t = await db.Tickets.FirstAsync(x => x.Id == ticketId, ct);
        var x = (await EscalationTargetsAsync(c, t, ct)).FirstOrDefault(e => e.Id == target) ?? throw new ForbiddenException("not allowed to escalate this ticket");
        var r = Reason(reason);
        var before = t.AssignedAgentId;
        t.AssignedAgentId = target; t.UpdatedAt = clock.UtcNow;
        await notifications.NotifyAsync(target, NotificationEvent.TicketEscalated, t.Id,
            await notifications.TicketPayloadAsync(t.Id, new Dictionary<string, object?> { ["reason"] = r }, ct), Guid.NewGuid().ToString(), ct);
        audit.Write("ticket.escalated", "ticket", t.Id, new { assigned_agent_id = before }, new { rule = x.RuleKey, to = target, reason = r });
        await db.SaveChangesAsync(ct);
    }

    /// <summary>escalate_ticket(): an administrator or the ticket team's leader alerts every administrator.</summary>
    public async Task EscalateAsync(Guid ticketId, string? reason, CancellationToken ct = default)
    {
        var (c, facts) = await access.RequireTicketAsync(ticketId, ct);
        if (!(c.Admin || (facts.TeamId is Guid team && c.LeaderOfTeams.Contains(team)))) throw new ForbiddenException("not allowed to escalate this ticket");
        var r = Reason(reason);
        var admins = await (from ur in db.UserRoles join ro in db.Roles on ur.RoleId equals ro.Id
                            where ro.Code == RoleCode.Admin && ur.UserId != c.UserId select ur.UserId).ToListAsync(ct);
        var payload = await notifications.TicketPayloadAsync(ticketId, new Dictionary<string, object?> { ["reason"] = r }, ct);
        var src = Guid.NewGuid().ToString();
        foreach (var a in admins) await notifications.NotifyAsync(a, NotificationEvent.TicketEscalated, ticketId, payload, src, ct);
        audit.Write("ticket.escalated", "ticket", ticketId, null, new { reason = r });
        await db.SaveChangesAsync(ct);
    }

    // ------------------------------------------------------------------ duplicate / spam / internal close

    private async Task CloseInternalAsync(Ticket t, string code, Guid by, string note, CancellationToken ct)
    {
        if (t.Status == TicketStatus.Closed) return;
        var now = clock.UtcNow;
        var h = new TicketStatusHistory { Id = Guid.NewGuid(), TicketId = t.Id, FromStatus = t.Status, ToStatus = TicketStatus.Closed, ChangedBy = by, Reason = note, ClosureReason = code, CreatedAt = now };
        t.Status = TicketStatus.Closed; t.ClosedAt = now; t.ClosureReason = code; t.ClosedBy = by; t.UpdatedAt = now;
        db.TicketStatusHistory.Add(h);
        await sla.CompleteAsync(t.Id, ct);
        await notifications.OnStatusAsync(h, t, ct);
    }

    private async Task RejectPendingAsync(Guid ticketId, Guid by, string note, CancellationToken ct) =>
        await db.TicketCancellationRequests.Where(r => r.TicketId == ticketId && r.Status == "pending")
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, "rejected").SetProperty(r => r.DecidedBy, by)
                .SetProperty(r => r.DecidedAt, clock.UtcNow).SetProperty(r => r.DecisionNote, note), ct);

    private AccessContext RequireCloser(AccessContext c) => c.Staff && (c.Admin || c.Has(Permission.Close)) ? c : throw new ForbiddenException("not allowed to close tickets");

    public async Task MarkDuplicateAsync(Guid ticketId, string originalReference, CancellationToken ct = default)
    {
        var (c, _) = await access.RequireTicketAsync(ticketId, ct);
        RequireCloser(c);
        var refText = (originalReference ?? "").Trim().ToUpperInvariant();
        var orig = await db.Tickets.AsNoTracking().Where(x => x.Reference == refText).Select(x => new { x.Id, x.Reference }).FirstOrDefaultAsync(ct)
                   ?? throw new ValidationFailedException("ticket not found", "reference");
        if (orig.Id == ticketId) throw new ValidationFailedException("ticket not found", "reference");
        var of = await access.GetFactsAsync(orig.Id, ct);
        if (of is null || !AccessRules.CanAccessTicket(c, of)) throw new ValidationFailedException("ticket not found", "reference");

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await db.Tickets.FirstAsync(x => x.Id == ticketId, ct);
        var link = await db.TicketLinks.FirstOrDefaultAsync(l => l.TicketId == ticketId && l.Kind == "duplicate_of", ct);
        if (link is null) db.TicketLinks.Add(new TicketLink { Id = Guid.NewGuid(), TicketId = ticketId, LinkedTicketId = orig.Id, Kind = "duplicate_of", CreatedBy = c.UserId, CreatedAt = clock.UtcNow });
        else { link.LinkedTicketId = orig.Id; link.CreatedBy = c.UserId; }
        await RejectPendingAsync(ticketId, c.UserId, "Ticket closed as a duplicate", ct);
        await CloseInternalAsync(t, ClosureReasonCode.Duplicate, c.UserId, "Duplicate of " + orig.Reference, ct);
        audit.Write("ticket.marked_duplicate", "ticket", ticketId, null, new { original = orig.Id });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    public async Task MarkSpamAsync(Guid ticketId, CancellationToken ct = default)
    {
        var (c, _) = await access.RequireTicketAsync(ticketId, ct);
        RequireCloser(c);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await db.Tickets.FirstAsync(x => x.Id == ticketId, ct);
        await RejectPendingAsync(ticketId, c.UserId, "Ticket closed as spam", ct);
        await CloseInternalAsync(t, ClosureReasonCode.Spam, c.UserId, "Marked as spam", ct);
        audit.Write("ticket.marked_spam", "ticket", ticketId, null, null);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    // ------------------------------------------------------------------ staff-only custom fields

    public async Task SetStaffFieldsAsync(Guid ticketId, Dictionary<string, JsonElement> values, CancellationToken ct = default)
    {
        var (c, facts) = await access.RequireTicketAsync(ticketId, ct);
        if (!c.Staff || !AccessRules.CanWriteTicket(c, facts, clock.UtcNow)) throw new ForbiddenException();
        var cat = await db.Tickets.Where(x => x.Id == ticketId).Select(x => x.CategoryId).FirstAsync(ct);
        var defs = await db.CustomFieldDefinitions.AsNoTracking().Where(f => f.IsActive && !f.VisibleToCustomer && (f.CategoryId == null || f.CategoryId == cat)).ToListAsync(ct);
        foreach (var f in defs)
        {
            var row = await db.TicketCustomFieldValues.FirstOrDefaultAsync(v => v.TicketId == ticketId && v.FieldId == f.Id, ct);
            var has = values.TryGetValue(f.Key, out var v) && v.ValueKind != JsonValueKind.Null && !(v.ValueKind == JsonValueKind.String && v.GetString() == "");
            if (!has) { if (row is not null) db.TicketCustomFieldValues.Remove(row); continue; }
            var json = CustomFieldValidator.Validate(f, v);
            if (row is null) db.TicketCustomFieldValues.Add(new TicketCustomFieldValue { TicketId = ticketId, FieldId = f.Id, Value = json });
            else row.Value = json;
        }
        audit.Write("ticket.fields_updated", "ticket", ticketId, null, values);
        await db.SaveChangesAsync(ct);
    }

    // ------------------------------------------------------------------ edit / delete own comment (5-minute window)

    private async Task<TicketMessage> OwnMessageAsync(Guid ticketId, Guid messageId, CancellationToken ct)
    {
        var (c, _) = await access.RequireTicketAsync(ticketId, ct);
        var m = await db.TicketMessages.FirstOrDefaultAsync(x => x.Id == messageId && x.TicketId == ticketId, ct);
        if (m is null || m.AuthorId != c.UserId || m.Kind == MessageKind.System || m.DeletedAt is not null) throw new NotFoundException("comment not found");
        if (m.CreatedAt < clock.UtcNow - EditWindow) throw new ForbiddenException("edit window closed");
        var status = await db.Tickets.Where(x => x.Id == ticketId).Select(x => x.Status).FirstAsync(ct);
        if (status == TicketStatus.Closed && !c.Staff) throw new ForbiddenException("ticket is closed; reopen it first");
        return m;
    }

    public async Task EditMessageAsync(Guid ticketId, Guid messageId, string? body, CancellationToken ct = default)
    {
        var text = (body ?? "").Trim();
        if (text.Length is < 1 or > 10000) throw new ValidationFailedException("message must be 1-10000 characters", "body");
        var m = await OwnMessageAsync(ticketId, messageId, ct);
        var before = m.Body;
        m.Body = text; m.EditedAt = clock.UtcNow;
        audit.Write("comment.edited", "ticket", ticketId, new { message_id = m.Id, body = before }, new { body = text });
        await db.SaveChangesAsync(ct);
    }

    public async Task DeleteMessageAsync(Guid ticketId, Guid messageId, CancellationToken ct = default)
    {
        var m = await OwnMessageAsync(ticketId, messageId, ct);
        var before = m.Body;
        m.Body = "-"; m.DeletedAt = clock.UtcNow;
        audit.Write("comment.deleted", "ticket", ticketId, new { message_id = m.Id, body = before }, null);
        await db.SaveChangesAsync(ct);
    }

    // ------------------------------------------------------------------ cancellation

    /// <summary>cancel_ticket(): before any staff reply the ticket closes at once; afterwards staff decide.</summary>
    public async Task<string> CancelAsync(Guid ticketId, string? reason, CancellationToken ct = default)
    {
        var (c, facts) = await access.RequireTicketAsync(ticketId, ct);
        if (facts.RequesterId != c.UserId) throw new NotFoundException("ticket not found");
        var r = Reason(reason);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await db.Tickets.FirstAsync(x => x.Id == ticketId, ct);
        if (t.Status is TicketStatus.Closed or TicketStatus.Resolved) throw new ForbiddenException("this ticket cannot be cancelled");
        if (await db.TicketCancellationRequests.AnyAsync(x => x.TicketId == ticketId && x.Status == "pending", ct)) throw new ConflictException("a cancellation request is already pending");
        var started = t.Status is not (TicketStatus.New or TicketStatus.Open)
            || await db.TicketMessages.AnyAsync(m => m.TicketId == ticketId && m.Kind == MessageKind.PublicReply && m.AuthorId != t.RequesterId, ct);
        var now = clock.UtcNow;
        string mode;
        if (!started)
        {
            db.TicketCancellationRequests.Add(new TicketCancellationRequest { Id = Guid.NewGuid(), TicketId = ticketId, RequestedBy = c.UserId, Reason = r, Status = "approved", DecidedBy = c.UserId, DecidedAt = now, DecisionNote = "Cancelled by the customer before any reply", CreatedAt = now });
            await CloseInternalAsync(t, ClosureReasonCode.Cancelled, c.UserId, r, ct);
            audit.Write("ticket.cancelled", "ticket", ticketId, null, new { reason = r, mode = "direct" });
            mode = "cancelled";
        }
        else
        {
            db.TicketCancellationRequests.Add(new TicketCancellationRequest { Id = Guid.NewGuid(), TicketId = ticketId, RequestedBy = c.UserId, Reason = r, Status = "pending", CreatedAt = now });
            var payload = await notifications.TicketPayloadAsync(ticketId, new Dictionary<string, object?> { ["reason"] = r }, ct);
            foreach (var h in await notifications.HandlersAsync(ticketId, ct))
                await notifications.NotifyAsync(h, NotificationEvent.CancellationRequested, ticketId, payload, "cr:" + now.ToUnixTimeSeconds(), ct);
            audit.Write("ticket.cancellation_requested", "ticket", ticketId, null, new { reason = r });
            mode = "requested";
        }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return mode;
    }

    public async Task DecideCancellationAsync(Guid ticketId, Guid requestId, bool approve, string? note, CancellationToken ct = default)
    {
        var (c, _) = await access.RequireTicketAsync(ticketId, ct);
        RequireCloser(c);
        var n = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (n is { Length: > 1000 }) throw new ValidationFailedException("note is too long", "note");
        if (!approve && n is null) throw new ValidationFailedException("a reason is required", "note");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var r = await db.TicketCancellationRequests.FirstOrDefaultAsync(x => x.Id == requestId && x.TicketId == ticketId && x.Status == "pending", ct)
                ?? throw new NotFoundException("request not found");
        r.Status = approve ? "approved" : "rejected"; r.DecidedBy = c.UserId; r.DecidedAt = clock.UtcNow; r.DecisionNote = n;
        if (approve)
        {
            var t = await db.Tickets.FirstAsync(x => x.Id == ticketId, ct);
            await CloseInternalAsync(t, ClosureReasonCode.Cancelled, c.UserId, n ?? r.Reason, ct);
        }
        else
            await notifications.NotifyAsync(r.RequestedBy, NotificationEvent.CancellationRejected, ticketId,
                await notifications.TicketPayloadAsync(ticketId, new Dictionary<string, object?> { ["reason"] = n }, ct), "cx:" + requestId, ct);
        audit.Write(approve ? "ticket.cancellation_approved" : "ticket.cancellation_rejected", "ticket", ticketId, null, new { note = n });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    public async Task WithdrawCancellationAsync(Guid ticketId, CancellationToken ct = default)
    {
        var (c, _) = await access.RequireTicketAsync(ticketId, ct);
        var n = await db.TicketCancellationRequests.Where(x => x.TicketId == ticketId && x.RequestedBy == c.UserId && x.Status == "pending")
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, "withdrawn").SetProperty(x => x.DecidedAt, clock.UtcNow), ct);
        if (n == 0) throw new ValidationFailedException("no pending request");
        audit.Write("ticket.cancellation_withdrawn", "ticket", ticketId, null, null);
        await db.SaveChangesAsync(ct);
    }

    // ------------------------------------------------------------------ satisfaction and follow-up

    public async Task SubmitFeedbackAsync(Guid ticketId, int rating, string? comment, CancellationToken ct = default)
    {
        var (c, facts) = await access.RequireTicketAsync(ticketId, ct);
        if (facts.RequesterId != c.UserId) throw new NotFoundException("ticket not found");
        var status = await db.Tickets.Where(x => x.Id == ticketId).Select(x => x.Status).FirstAsync(ct);
        if (status is not (TicketStatus.Resolved or TicketStatus.Closed)) throw new ForbiddenException("feedback is available once the ticket is resolved");
        if (rating is < 1 or > 5) throw new ValidationFailedException("rating must be 1-5", "rating");
        var text = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim();
        if (text is { Length: > 2000 }) throw new ValidationFailedException("comment is too long", "comment");
        var row = await db.CustomerFeedback.FirstOrDefaultAsync(x => x.TicketId == ticketId, ct);
        if (row is null) db.CustomerFeedback.Add(new CustomerFeedback { TicketId = ticketId, Rating = (short)rating, Comment = text, SubmittedBy = c.UserId, CreatedAt = clock.UtcNow });
        else { row.Rating = (short)rating; row.Comment = text; }
        await db.SaveChangesAsync(ct);
    }

    /// <summary>link_follow_up(): the new ticket continues an older one (both the customer's own, or any visible to staff).</summary>
    public async Task LinkFollowUpAsync(Guid newTicket, Guid oldTicket, CancellationToken ct = default)
    {
        if (newTicket == oldTicket) throw new NotFoundException("ticket not found");
        var (c, nf) = await access.RequireTicketAsync(newTicket, ct);
        var (_, of) = await access.RequireTicketAsync(oldTicket, ct);
        if (!c.Staff && (nf.RequesterId != c.UserId || of.RequesterId != c.UserId)) throw new ForbiddenException();
        if (await db.TicketLinks.AnyAsync(l => l.TicketId == newTicket && l.Kind == "follow_up_of", ct)) return;
        db.TicketLinks.Add(new TicketLink { Id = Guid.NewGuid(), TicketId = newTicket, LinkedTicketId = oldTicket, Kind = "follow_up_of", CreatedBy = c.UserId, CreatedAt = clock.UtcNow });
        await db.SaveChangesAsync(ct);
    }
}
