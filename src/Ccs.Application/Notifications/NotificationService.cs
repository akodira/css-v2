using System.Text.Json;
using Ccs.Application.Abstractions;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Application.Notifications;

/// <summary>
/// notify() and the trg_notify_* triggers. Every event writes an in-app row and, where the rules say so,
/// an email row. The dedupe key stops repeats. Email rows are sent later by EmailDispatchJob.
/// </summary>
public sealed class NotificationService(ICcsDbContext db, IClock clock)
{
    /// <summary>Events staff receive by email (everything else is in-app only for staff). Customers get email for all.</summary>
    private static readonly HashSet<string> StaffEmailEvents =
    [
        NotificationEvent.TicketAssigned, NotificationEvent.SlaWarning, NotificationEvent.SlaBreach,
        NotificationEvent.TicketReopened, NotificationEvent.TicketEscalated, NotificationEvent.CancellationRequested,
        NotificationEvent.PasswordExpiring,
    ];

    private readonly HashSet<string> _pendingKeys = [];

    public async Task NotifyAsync(Guid? userId, string evt, Guid? ticketId, object payload, string source, CancellationToken ct = default)
    {
        if (userId is not Guid uid) return;
        var active = await db.Profiles.AnyAsync(p => p.Id == uid && p.AccountStatus == AccountStatus.Active, ct);
        if (!active) return;

        var staff = await (from ur in db.UserRoles join r in db.Roles on ur.RoleId equals r.Id
                           where ur.UserId == uid && r.Code != RoleCode.Customer select 1).AnyAsync(ct);
        var email = !staff || StaffEmailEvents.Contains(evt);
        var json = payload as string ?? JsonSerializer.Serialize(payload, new JsonSerializerOptions(JsonSerializerDefaults.Web));

        await AddAsync(uid, evt, ticketId, "in_app", json, $"{evt}:{source}:{uid}:in_app", ct);
        if (email) await AddAsync(uid, evt, ticketId, "email", json, $"{evt}:{source}:{uid}:email", ct);
    }

    private async Task AddAsync(Guid uid, string evt, Guid? ticketId, string channel, string payload, string key, CancellationToken ct)
    {
        // ON CONFLICT (dedupe_key) DO NOTHING: skip keys already stored or already queued in this unit of work.
        if (!_pendingKeys.Add(key)) return;
        if (await db.Notifications.AnyAsync(n => n.DedupeKey == key, ct)) return;
        db.Notifications.Add(new Notification
        {
            UserId = uid, EventType = evt, TicketId = ticketId, Channel = channel, Payload = payload,
            DedupeKey = key, Status = "pending", CreatedAt = clock.UtcNow,
        });
    }

    public async Task<object> TicketPayloadAsync(Guid ticketId, IDictionary<string, object?>? extra = null, CancellationToken ct = default)
    {
        var t = await db.Tickets.AsNoTracking().Where(x => x.Id == ticketId)
            .Select(x => new { x.Reference, x.Subject }).FirstAsync(ct);
        var d = new Dictionary<string, object?> { ["reference"] = t.Reference, ["subject"] = t.Subject };
        if (extra is not null) foreach (var (k, v) in extra) d[k] = v;
        return d;
    }

    /// <summary>ticket_handlers(): the assigned agent, or the team leaders when nobody is assigned.</summary>
    public async Task<List<Guid>> HandlersAsync(Guid ticketId, CancellationToken ct = default)
    {
        var t = await db.Tickets.AsNoTracking().Where(x => x.Id == ticketId).Select(x => new { x.AssignedAgentId, x.TeamId }).FirstAsync(ct);
        if (t.AssignedAgentId is Guid a) return [a];
        if (t.TeamId is not Guid team) return [];
        return await db.TeamMembers.Where(m => m.TeamId == team && m.IsLeader).Select(m => m.UserId).ToListAsync(ct);
    }

    /// <summary>sla_recipients(): agent, team leaders and/or admins, by the policy's rule.</summary>
    public async Task<List<Guid>> SlaRecipientsAsync(Guid ticketId, IReadOnlyCollection<string> roles, CancellationToken ct = default)
    {
        var result = new HashSet<Guid>();
        var t = await db.Tickets.AsNoTracking().Where(x => x.Id == ticketId).Select(x => new { x.AssignedAgentId, x.TeamId }).FirstAsync(ct);
        if (roles.Contains("agent") && t.AssignedAgentId is Guid a) result.Add(a);
        if (roles.Contains("team_leader") && t.TeamId is Guid team)
            result.UnionWith(await db.TeamMembers.Where(m => m.TeamId == team && m.IsLeader).Select(m => m.UserId).ToListAsync(ct));
        if (roles.Contains("admin"))
            result.UnionWith(await (from ur in db.UserRoles join r in db.Roles on ur.RoleId equals r.Id
                                    where r.Code == RoleCode.Admin select ur.UserId).ToListAsync(ct));
        return [.. result];
    }

    // ---- Trigger ports -------------------------------------------------------------------

    public async Task OnTicketCreatedAsync(Ticket t, CancellationToken ct = default) =>
        await NotifyAsync(t.RequesterId, NotificationEvent.TicketCreated, t.Id,
            new Dictionary<string, object?> { ["reference"] = t.Reference, ["subject"] = t.Subject }, t.Id.ToString(), ct);

    public async Task OnAssignmentAsync(TicketAssignment a, Ticket t, CancellationToken ct = default)
    {
        if (a.ToAgent is not null && a.ToAgent != a.AssignedBy)
            await NotifyAsync(a.ToAgent, NotificationEvent.TicketAssigned, t.Id, Payload(t), a.Id.ToString(), ct);
    }

    public async Task OnMessageAsync(TicketMessage m, Ticket t, CancellationToken ct = default)
    {
        if (m.Kind != MessageKind.PublicReply) return;
        if (m.AuthorId != t.RequesterId)
            await NotifyAsync(t.RequesterId, NotificationEvent.AgentReply, t.Id, Payload(t), m.Id.ToString(), ct);
        else
            foreach (var h in await HandlersAsync(t.Id, ct))
                await NotifyAsync(h, NotificationEvent.CustomerReply, t.Id, Payload(t), m.Id.ToString(), ct);
    }

    public async Task OnStatusAsync(TicketStatusHistory h, Ticket t, CancellationToken ct = default)
    {
        if (h.FromStatus is null) return;
        var evt = h.ToStatus switch
        {
            TicketStatus.Resolved => NotificationEvent.TicketResolved,
            TicketStatus.Closed => NotificationEvent.TicketClosed,
            TicketStatus.Reopened => NotificationEvent.TicketReopened,
            _ => NotificationEvent.StatusChanged,
        };
        // Customers see pending_internal as "in progress", so that change is not news to them.
        string Mask(string s) => s == TicketStatus.PendingInternal ? TicketStatus.InProgress : s;
        var from = Mask(h.FromStatus);
        var to = Mask(h.ToStatus);
        if (h.ChangedBy != t.RequesterId && (evt != NotificationEvent.StatusChanged || from != to))
            await NotifyAsync(t.RequesterId, evt, t.Id, Payload(t, ("status", to)), h.Id.ToString(), ct);
        if (h.ToStatus == TicketStatus.Reopened)
            foreach (var handler in await HandlersAsync(t.Id, ct))
                if (handler != h.ChangedBy)
                    await NotifyAsync(handler, NotificationEvent.TicketReopened, t.Id, Payload(t), h.Id.ToString(), ct);
    }

    public async Task OnPriorityAsync(Ticket t, string oldPriority, Guid? actor, CancellationToken ct = default)
    {
        if (t.Priority != oldPriority && t.AssignedAgentId is not null && t.AssignedAgentId != actor)
            await NotifyAsync(t.AssignedAgentId, NotificationEvent.PriorityChanged, t.Id, Payload(t, ("priority", t.Priority)), Guid.NewGuid().ToString(), ct);
    }

    private static Dictionary<string, object?> Payload(Ticket t, params (string Key, object? Value)[] extra)
    {
        var d = new Dictionary<string, object?> { ["reference"] = t.Reference, ["subject"] = t.Subject };
        foreach (var (k, v) in extra) d[k] = v;
        return d;
    }
}
