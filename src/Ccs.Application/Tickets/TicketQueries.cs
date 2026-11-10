using Ccs.Application.Abstractions;
using Ccs.Application.Access;
using Ccs.Application.Common;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Application.Tickets;

public sealed record TicketListFilter(
    string? View = null,          // mine (customer) | assigned | unassigned | closed | all  (escalated: stage 4)
    string? Status = null,
    string? Priority = null,
    Guid? CategoryId = null,
    Guid? TeamId = null,
    string? Search = null,
    string? Group = null,         // customer chips: active | waiting | resolved | closed
    string? Sla = null);          // on_track | due_soon | breached | paused | completed

public sealed record TicketListItem(
    Guid Id, string Reference, string Subject, string Status, string Priority, string? PriorityColor, string? PriorityEn, string? PriorityAr,
    string CategoryEn, string CategoryAr, string? TeamEn, string? TeamAr, string? AssigneeName, string RequesterName,
    string? SlaState, DateTimeOffset? ResolutionDue, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
    string? RequesterEmail = null, DateTimeOffset? FirstResponseDue = null, DateTimeOffset? FirstRespondedAt = null,
    DateTimeOffset? PausedAt = null, int PausedTotalSeconds = 0, DateTimeOffset? ResolvedAt = null);

public sealed record TicketSummary(int Total, int Active, int Waiting, int Resolved, int Closed, int Unassigned, int Breached);

public sealed record MessageDto(Guid Id, string Kind, string Body, Guid? AuthorId, string? AuthorName, bool AuthorIsStaff,
    DateTimeOffset CreatedAt, DateTimeOffset? EditedAt, IReadOnlyList<AttachmentDto> Attachments);

public sealed record AttachmentDto(Guid Id, string FileName, string MimeType, long SizeBytes, DateTimeOffset CreatedAt);

/// <summary>Staff see raw history; customers get a safe timeline without internal reasons (spec 3).</summary>
public sealed record TimelineEntry(DateTimeOffset At, string? From, string To, string? Reason, string? ClosureReason, string? ByName);

public sealed record TicketDetail(
    Guid Id, string Reference, string Subject, string Description, string Status, string Priority,
    Guid? TypeId, Guid CategoryId, Guid? SubcategoryId, Guid? TeamId, Guid? AssignedAgentId,
    string RequesterName, string RequesterEmail, Guid RequesterId,
    string? ResolutionSummary, string? ClosureReason, int ReopenedCount,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, DateTimeOffset? ResolvedAt, DateTimeOffset? ClosedAt,
    string? SlaState, DateTimeOffset? FirstResponseDue, DateTimeOffset? ResolutionDue,
    IReadOnlyList<MessageDto> Messages, IReadOnlyList<TimelineEntry> Timeline,
    IReadOnlyList<string> AllowedMoves, bool CanSeeInternalNotes, bool CanReply,
    bool CanReopen, bool HasFeedback, bool HasPendingCancellation,
    IReadOnlyDictionary<string, string> CustomValues,
    Names Names);

/// <summary>Display names for the header of the ticket page, in both languages.</summary>
public sealed record Names(string? TypeEn, string? TypeAr, string CategoryEn, string CategoryAr, string? SubcategoryEn, string? SubcategoryAr,
    string? TeamEn, string? TeamAr, string? Assignee, string? PriorityEn, string? PriorityAr, string? PriorityColor,
    string? ClosureEn, string? ClosureAr, bool ClosureAllowsReopen);

public sealed class TicketQueries(ICcsDbContext db, AccessService access)
{
    private static readonly string[] ActiveStatuses =
        [TicketStatus.New, TicketStatus.Open, TicketStatus.InProgress, TicketStatus.PendingInternal, TicketStatus.Reopened];

    public async Task<PagedResult<TicketListItem>> ListAsync(TicketListFilter f, PageRequest page, CancellationToken ct = default)
    {
        var c = await access.RequireSignedInAsync(ct);
        var q = access.VisibleTickets(db.Tickets.AsNoTracking(), c);

        switch (f.View)
        {
            case "mine": q = q.Where(t => t.RequesterId == c.UserId); break;
            case "assigned": q = q.Where(t => t.AssignedAgentId == c.UserId && t.Status != TicketStatus.Closed); break;
            case "unassigned": q = q.Where(t => t.AssignedAgentId == null && t.Status != TicketStatus.Closed && t.Status != TicketStatus.Resolved); break;
            case "closed": q = q.Where(t => t.Status == TicketStatus.Closed); break;
            case "escalated":
                var esc = await EscalatedIdsAsync(c, ct);
                q = q.Where(t => esc.Contains(t.Id));
                break;
        }
        if (!string.IsNullOrEmpty(f.Sla)) q = q.Where(t => db.TicketSlaRecords.Any(r => r.TicketId == t.Id && r.State == f.Sla));
        if (!string.IsNullOrEmpty(f.Status)) q = q.Where(t => t.Status == f.Status);
        q = f.Group switch
        {
            "active" => q.Where(t => ActiveStatuses.Contains(t.Status)),
            "open" => q.Where(t => t.Status != TicketStatus.Resolved && t.Status != TicketStatus.Closed),   // staff "Active"
            "finished" => q.Where(t => t.Status == TicketStatus.Resolved || t.Status == TicketStatus.Closed),
            "waiting" => q.Where(t => t.Status == TicketStatus.PendingCustomer),
            "resolved" => q.Where(t => t.Status == TicketStatus.Resolved),
            "closed" => q.Where(t => t.Status == TicketStatus.Closed),
            _ => q,
        };
        if (!string.IsNullOrEmpty(f.Priority)) q = q.Where(t => t.Priority == f.Priority);
        if (f.CategoryId is Guid cat) q = q.Where(t => t.CategoryId == cat);
        if (f.TeamId is Guid team) q = q.Where(t => t.TeamId == team);
        if (!string.IsNullOrWhiteSpace(f.Search))
        {
            var s = f.Search.Trim();
            q = q.Where(t => t.Reference.Contains(s) || t.Subject.Contains(s)
                             || db.Profiles.Any(p => p.Id == t.RequesterId && (p.FullName.Contains(s) || p.Email.Contains(s))));
        }

        var total = await q.CountAsync(ct);
        // Every list sorts by a column header; default newest updated first (spec 7).
        q = (page.Sort, page.Desc) switch
        {
            ("reference" or "ticket", false) => q.OrderBy(t => t.Seq),
            ("reference" or "ticket", true) => q.OrderByDescending(t => t.Seq),
            ("category", false) => q.OrderBy(t => db.TicketCategories.Where(x => x.Id == t.CategoryId).Select(x => x.NameEn).FirstOrDefault()),
            ("category", true) => q.OrderByDescending(t => db.TicketCategories.Where(x => x.Id == t.CategoryId).Select(x => x.NameEn).FirstOrDefault()),
            ("subject", false) => q.OrderBy(t => t.Subject),
            ("subject", true) => q.OrderByDescending(t => t.Subject),
            ("status", false) => q.OrderBy(t => t.Status),
            ("status", true) => q.OrderByDescending(t => t.Status),
            ("priority", false) => q.OrderBy(t => db.Priorities.Where(p => p.Code == t.Priority).Select(p => p.SortOrder).FirstOrDefault()),
            ("priority", true) => q.OrderByDescending(t => db.Priorities.Where(p => p.Code == t.Priority).Select(p => p.SortOrder).FirstOrDefault()),
            ("created", false) => q.OrderBy(t => t.CreatedAt),
            ("created", true) => q.OrderByDescending(t => t.CreatedAt),
            ("updated", false) => q.OrderBy(t => t.UpdatedAt),
            _ => q.OrderByDescending(t => t.UpdatedAt),
        };

        var items = await (from t in q
                           join tcat in db.TicketCategories on t.CategoryId equals tcat.Id
                           join req in db.Profiles on t.RequesterId equals req.Id
                           join sr in db.TicketSlaRecords on t.Id equals sr.TicketId into srs
                           from sr in srs.DefaultIfEmpty()
                           select new TicketListItem(
                               t.Id, t.Reference, t.Subject, t.Status, t.Priority,
                               db.Priorities.Where(p => p.Code == t.Priority).Select(p => p.Color).FirstOrDefault(),
                               db.Priorities.Where(p => p.Code == t.Priority).Select(p => p.NameEn).FirstOrDefault(),
                               db.Priorities.Where(p => p.Code == t.Priority).Select(p => p.NameAr).FirstOrDefault(),
                               tcat.NameEn, tcat.NameAr,
                               db.Teams.Where(x => x.Id == t.TeamId).Select(x => x.NameEn).FirstOrDefault(),
                               db.Teams.Where(x => x.Id == t.TeamId).Select(x => x.NameAr).FirstOrDefault(),
                               db.Profiles.Where(x => x.Id == t.AssignedAgentId).Select(x => x.FullName).FirstOrDefault(),
                               req.FullName,
                               sr == null ? null : sr.State,
                               sr == null ? null : sr.ResolutionDue,
                               t.CreatedAt, t.UpdatedAt, req.Email,
                               sr == null ? null : sr.FirstResponseDue,
                               sr == null ? null : sr.FirstRespondedAt,
                               sr == null ? null : sr.PausedAt,
                               sr == null ? 0 : sr.PausedTotalSeconds,
                               t.ResolvedAt))
                          .Skip((page.SafePage - 1) * page.SafeSize).Take(page.SafeSize).ToListAsync(ct);
        return new PagedResult<TicketListItem>(items, total, page.SafePage, page.SafeSize);
    }

    /// <summary>Summary cards (customer home and console queue).</summary>
    /// <summary>my_escalated_tickets(): tickets escalated to me, or escalated by an agent in a team I lead.</summary>
    public async Task<List<Guid>> EscalatedIdsAsync(Ccs.Domain.Rules.AccessContext c, CancellationToken ct = default)
    {
        if (!c.Staff) return [];
        var rows = await db.AuditLogs.AsNoTracking().Where(a => a.Action == "ticket.escalated" && a.EntityId != null)
            .Select(a => new { Id = a.EntityId!.Value, a.After }).ToListAsync(ct);
        var me = c.UserId.ToString();
        var ids = new HashSet<Guid>();
        var leaderRules = new List<Guid>();
        foreach (var r in rows)
        {
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(r.After ?? "{}");
                var root = doc.RootElement;
                if (root.TryGetProperty("to", out var to) && string.Equals(to.GetString(), me, StringComparison.OrdinalIgnoreCase)) ids.Add(r.Id);
                else if (root.TryGetProperty("rule", out var rule) && rule.GetString() is "agent" or "agent_to_leader") leaderRules.Add(r.Id);
            }
            catch (System.Text.Json.JsonException) { }
        }
        if (leaderRules.Count > 0 && c.LeaderOfTeams.Count > 0)
        {
            var lead = c.LeaderOfTeams.ToList();
            ids.UnionWith(await db.Tickets.AsNoTracking().Where(t => leaderRules.Contains(t.Id) && t.TeamId != null && lead.Contains(t.TeamId.Value)).Select(t => t.Id).ToListAsync(ct));
        }
        return [.. ids];
    }

    public async Task<TicketSummary> SummaryAsync(bool onlyMine, CancellationToken ct = default)
    {
        var c = await access.RequireSignedInAsync(ct);
        var q = access.VisibleTickets(db.Tickets.AsNoTracking(), c);
        if (onlyMine) q = q.Where(t => t.RequesterId == c.UserId);
        var byStatus = await q.GroupBy(t => t.Status).Select(g => new { Status = g.Key, N = g.Count() }).ToListAsync(ct);
        int N(params string[] statuses) => byStatus.Where(x => statuses.Contains(x.Status)).Sum(x => x.N);
        var unassigned = await q.CountAsync(t => t.AssignedAgentId == null && t.Status != TicketStatus.Resolved && t.Status != TicketStatus.Closed, ct);
        var breached = await q.CountAsync(t => db.TicketSlaRecords.Any(r => r.TicketId == t.Id && r.State == SlaState.Breached)
                                               && t.Status != TicketStatus.Closed && t.Status != TicketStatus.Resolved, ct);
        return new TicketSummary(byStatus.Sum(x => x.N), N(ActiveStatuses), N(TicketStatus.PendingCustomer),
            N(TicketStatus.Resolved), N(TicketStatus.Closed), unassigned, breached);
    }

    public async Task<TicketDetail> GetAsync(Guid id, CancellationToken ct = default)
    {
        var (c, facts) = await access.RequireTicketAsync(id, ct);
        var t = await db.Tickets.AsNoTracking().FirstAsync(x => x.Id == id, ct);
        var req = await db.Profiles.AsNoTracking().FirstAsync(p => p.Id == t.RequesterId, ct);
        var internalNotes = AccessRules.CanSeeInternalNotes(c, facts);
        var isCustomerView = !c.Internal;

        var msgs = await db.TicketMessages.AsNoTracking()
            .Where(m => m.TicketId == id && m.DeletedAt == null && (m.Kind != MessageKind.InternalNote || internalNotes))
            .OrderBy(m => m.CreatedAt).ToListAsync(ct);
        var authorIds = msgs.Where(m => m.AuthorId != null).Select(m => m.AuthorId!.Value).Distinct().ToList();
        var authors = await db.Profiles.AsNoTracking().Where(p => authorIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.FullName, ct);
        var staffIds = (await (from ur in db.UserRoles join r in db.Roles on ur.RoleId equals r.Id
                               where authorIds.Contains(ur.UserId) && r.Code != RoleCode.Customer select ur.UserId).ToListAsync(ct)).ToHashSet();
        var visibleMsgIds = msgs.Select(m => m.Id).ToList();
        var atts = await db.TicketAttachments.AsNoTracking()
            .Where(a => a.TicketId == id && a.ScanStatus != "infected" && (a.MessageId == null || visibleMsgIds.Contains(a.MessageId.Value)))
            .ToListAsync(ct);

        var messages = msgs.Select(m => new MessageDto(m.Id, m.Kind, m.Body, m.AuthorId,
            m.AuthorId is Guid aid && authors.TryGetValue(aid, out var n) ? n : null,
            m.AuthorId is Guid sid && staffIds.Contains(sid), m.CreatedAt, m.EditedAt,
            atts.Where(a => a.MessageId == m.Id).Select(ToDto).ToList())).ToList();
        if (atts.Any(a => a.MessageId == null))
            messages.Insert(0, new MessageDto(Guid.Empty, "ticket_files", "", t.RequesterId, req.FullName, false, t.CreatedAt, null,
                atts.Where(a => a.MessageId == null).Select(ToDto).ToList()));

        var history = await db.TicketStatusHistory.AsNoTracking().Where(h => h.TicketId == id).OrderBy(h => h.CreatedAt).ToListAsync(ct);
        var changers = history.Where(h => h.ChangedBy != null).Select(h => h.ChangedBy!.Value).Distinct().ToList();
        var changerNames = await db.Profiles.AsNoTracking().Where(p => changers.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.FullName, ct);
        var timeline = history
            .Where(h => !isCustomerView || h.FromStatus is null || CustomerStatus(h.FromStatus) != CustomerStatus(h.ToStatus))
            .Select(h => isCustomerView
                ? new TimelineEntry(h.CreatedAt, CustomerStatus(h.FromStatus), CustomerStatus(h.ToStatus)!, null, h.ClosureReason, null)
                : new TimelineEntry(h.CreatedAt, h.FromStatus, h.ToStatus, h.Reason, h.ClosureReason,
                    h.ChangedBy is Guid b && changerNames.TryGetValue(b, out var nm) ? nm : null))
            .ToList();

        var actor = c.Staff ? "staff" : t.RequesterId == c.UserId ? "customer" : null;
        List<string> moves = actor is null ? [] : await db.TicketStatusTransitions.AsNoTracking()
            .Where(x => x.FromStatus == t.Status && x.Actor == actor).Select(x => x.ToStatus).ToListAsync(ct);

        var sla = await db.TicketSlaRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TicketId == id, ct);
        var custom = await (from v in db.TicketCustomFieldValues join f in db.CustomFieldDefinitions on v.FieldId equals f.Id
                            where v.TicketId == id && (f.VisibleToCustomer || c.Internal) select new { f.Key, v.Value }).ToListAsync(ct);

        return new TicketDetail(
            t.Id, t.Reference, t.Subject, t.Description, isCustomerView ? CustomerStatus(t.Status)! : t.Status, t.Priority,
            t.TicketTypeId, t.CategoryId, t.SubcategoryId, t.TeamId, t.AssignedAgentId,
            req.FullName, req.Email, req.Id, t.ResolutionSummary, t.ClosureReason, t.ReopenedCount,
            t.CreatedAt, t.UpdatedAt, t.ResolvedAt, t.ClosedAt,
            c.Internal ? sla?.State : null, c.Internal ? sla?.FirstResponseDue : null, c.Internal ? sla?.ResolutionDue : null,
            messages, timeline, moves, internalNotes,
            CanReply: t.Status != TicketStatus.Closed && (c.Staff ? c.Has(Permission.Reply) : t.RequesterId == c.UserId),
            CanReopen: moves.Contains(TicketStatus.Reopened),
            HasFeedback: await db.CustomerFeedback.AnyAsync(x => x.TicketId == id, ct),
            HasPendingCancellation: await db.TicketCancellationRequests.AnyAsync(x => x.TicketId == id && x.Status == "pending", ct),
            CustomValues: custom.ToDictionary(x => x.Key, x => x.Value),
            Names: await NamesAsync(t, ct));
    }

    private async Task<Names> NamesAsync(Ticket t, CancellationToken ct)
    {
        var type = t.TicketTypeId is Guid ty ? await db.TicketTypes.AsNoTracking().FirstOrDefaultAsync(x => x.Id == ty, ct) : null;
        var cat = await db.TicketCategories.AsNoTracking().FirstAsync(x => x.Id == t.CategoryId, ct);
        var sub = t.SubcategoryId is Guid sid ? await db.TicketSubcategories.AsNoTracking().FirstOrDefaultAsync(x => x.Id == sid, ct) : null;
        var team = t.TeamId is Guid tid ? await db.Teams.AsNoTracking().FirstOrDefaultAsync(x => x.Id == tid, ct) : null;
        var agent = t.AssignedAgentId is Guid aid ? await db.Profiles.AsNoTracking().Where(x => x.Id == aid).Select(x => x.FullName).FirstOrDefaultAsync(ct) : null;
        var prio = await db.Priorities.AsNoTracking().FirstOrDefaultAsync(x => x.Code == t.Priority, ct);
        var cr = t.ClosureReason is string code ? await db.ClosureReasons.AsNoTracking().FirstOrDefaultAsync(x => x.Code == code, ct) : null;
        return new Names(type?.NameEn, type?.NameAr, cat.NameEn, cat.NameAr, sub?.NameEn, sub?.NameAr, team?.NameEn, team?.NameAr, agent,
            prio?.NameEn, prio?.NameAr, prio?.Color, cr?.NameEn, cr?.NameAr, cr?.CustomerMayReopen ?? true);
    }

    /// <summary>Customers see pending_internal as "in progress" (same masking as the notification trigger).</summary>
    private static string? CustomerStatus(string? s) => s == TicketStatus.PendingInternal ? TicketStatus.InProgress : s;

    private static AttachmentDto ToDto(TicketAttachment a) => new(a.Id, a.FileName, a.MimeType, a.SizeBytes, a.CreatedAt);
}
