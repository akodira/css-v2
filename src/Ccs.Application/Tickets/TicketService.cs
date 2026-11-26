using System.Text.Json;
using Ccs.Application.Abstractions;
using Ccs.Application.Access;
using Ccs.Application.Common;
using Ccs.Application.Notifications;
using Ccs.Application.Settings;
using Ccs.Application.Sla;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Application.Tickets;

public sealed record CreateTicketCommand(
    Guid TypeId,
    Guid CategoryId,
    Guid? SubcategoryId,
    string Subject,
    string Description,
    Dictionary<string, JsonElement>? CustomValues,
    string? Priority,
    Guid? RequesterId = null);   // set only when staff create on behalf of a customer

public sealed record CreatedTicket(Guid Id, string Reference);

public sealed record ChangeStatusCommand(string To, string? Reason, string? Resolution, string? ClosureReason);

public sealed record AssignCommand(Guid TeamId, Guid? AgentId, string? Reason);

/// <summary>
/// Ticket writes (spec 8, TicketService + AssignmentService core). Each public method is one transaction
/// that also writes the history, the audit log and the notifications, exactly like the PostgreSQL functions.
/// </summary>
public sealed class TicketService(
    ICcsDbContext db, AccessService access, SlaService sla, NotificationService notifications,
    AuditService audit, SettingsService settings, IClock clock, PlaceCatalog places)
{
    public const int MaxTicketsPerHour = 15;
    public const int MaxMessagesPerMinute = 20;

    // ------------------------------------------------------------------ create

    /// <summary>create_ticket() and create_ticket_for_customer().</summary>
    public async Task<CreatedTicket> CreateAsync(CreateTicketCommand cmd, CancellationToken ct = default)
    {
        var c = await access.RequireSignedInAsync(ct);
        var now = clock.UtcNow;
        Guid requester;
        bool onBehalf = cmd.RequesterId is Guid r && r != c.UserId;

        if (onBehalf)
        {
            if (!c.Has(Permission.CreateForCustomer)) throw new ForbiddenException("not allowed to create tickets for customers");
            requester = cmd.RequesterId!.Value;
            var cust = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(p => p.Id == requester, ct)
                       ?? throw new ValidationFailedException("customer not found", "requesterId");
            var isCustomer = await (from ur in db.UserRoles join ro in db.Roles on ur.RoleId equals ro.Id
                                    where ur.UserId == requester && ro.Code == RoleCode.Customer select 1).AnyAsync(ct);
            if (!isCustomer || cust.AccountStatus != AccountStatus.Active) throw new ValidationFailedException("customer is not active", "requesterId");
            if (!c.AllScope && !AccessRules.InScope(c, cust.OrganizationId, cust.BranchId))
                throw new ForbiddenException("customer is outside your scope");
        }
        else
        {
            if (!c.Customer) throw new ForbiddenException("only customers can create tickets");
            requester = c.UserId;
            // limit_ticket_rate: 15 per hour per customer; staff creating for customers are exempt.
            var hourAgo = now.AddHours(-1);
            if (await db.Tickets.CountAsync(t => t.RequesterId == requester && t.CreatedAt > hourAgo, ct) >= MaxTicketsPerHour)
                throw new RateLimitedException("rate limit: too many tickets");
        }

        var subject = (cmd.Subject ?? "").Trim();
        var description = (cmd.Description ?? "").Trim();
        if (subject.Length is < 3 or > 200) throw new ValidationFailedException("subject must be 3-200 characters", "subject");
        if (description.Length is < 10 or > 10000) throw new ValidationFailedException("description must be 10-10000 characters", "description");

        var category = await db.TicketCategories.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == cmd.CategoryId && x.IsActive && (!x.IsPrivate || c.Internal), ct)
            ?? throw new ValidationFailedException("invalid category", "categoryId");
        TicketSubcategory? sub = null;
        if (cmd.SubcategoryId is Guid sid)
            sub = await db.TicketSubcategories.AsNoTracking().FirstOrDefaultAsync(s => s.Id == sid && s.CategoryId == category.Id && s.IsActive, ct)
                  ?? throw new ValidationFailedException("invalid subcategory", "subcategoryId");

        // Type is required on every new ticket and must offer the chosen category, in what the customer's place shows them.
        var allowed = await places.ForUserAsync(requester, ct);
        if (!allowed.Categories.Contains(category.Id)) throw new ValidationFailedException("invalid category", "categoryId");
        if (sub is not null && !allowed.Subcategories.Contains(sub.Id)) throw new ValidationFailedException("invalid subcategory", "subcategoryId");
        if (!allowed.Links.Contains((cmd.TypeId, category.Id))) throw new ValidationFailedException("invalid ticket type", "typeId");

        // Priority: the customer picks only in "customer" mode; otherwise the category/subcategory may fix it.
        var site = await db.SiteSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        var customerPicks = site?.PriorityMode == "customer";
        string priority;
        if (customerPicks)
        {
            if (cmd.Priority is null || !await db.Priorities.AnyAsync(p => p.Code == cmd.Priority && p.IsActive, ct))
                throw new ValidationFailedException("priority is required", "priority");
            priority = cmd.Priority;
        }
        else
        {
            priority = sub?.PriorityCode ?? category.PriorityCode ?? "normal";
            if (onBehalf && c.Staff && cmd.Priority is not null && await db.Priorities.AnyAsync(p => p.Code == cmd.Priority && p.IsActive, ct))
                priority = sub?.PriorityCode ?? category.PriorityCode ?? cmd.Priority;   // staff may set it unless fixed
        }

        // Custom fields: visible-to-customer fields for customers; all fields for staff.
        var values = cmd.CustomValues ?? new Dictionary<string, JsonElement>();
        var fields = await db.CustomFieldDefinitions.AsNoTracking()
            .Where(f => f.IsActive && (f.CategoryId == null || f.CategoryId == category.Id) && (onBehalf || f.VisibleToCustomer))
            .ToListAsync(ct);
        var toStore = new List<(Guid FieldId, string Json)>();
        foreach (var f in fields)
        {
            values.TryGetValue(f.Key, out var v);
            JsonElement? val = values.ContainsKey(f.Key) ? v : null;
            if (CustomFieldValidator.IsEmpty(val))
            {
                if (f.IsRequired) throw new ValidationFailedException($"field {f.Key} is required", f.Key);
                continue;
            }
            toStore.Add((f.Id, CustomFieldValidator.Validate(f, val!.Value)));
        }

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        // Ticket number (Settings → System), e.g. INC-26-0073. One counter shared by all types; a value whose number
        // already exists (possible after the format was changed) is skipped.
        var format = await settings.GetTicketNumberFormatAsync(ct);
        var typeCode = await db.TicketTypes.AsNoTracking().Where(y => y.Id == cmd.TypeId).Select(y => y.Code).FirstOrDefaultAsync(ct);
        var reference = "";
        for (var tries = 0; tries < 50; tries++)
        {
            reference = format.Render(typeCode, now, await db.NextTicketNumberAsync(format.PeriodKey(now), ct));
            if (!await db.Tickets.AnyAsync(x => x.Reference == reference, ct)) break;
        }
        var flowId = await FlowLookup.ForNewTicketAsync(db, settings, cmd.TypeId, category.Id, ct);
        var routed = await RouteAsync(category, requester, ct);
        // The ticket keeps the customer's place at this moment (visibility, reports and escalation follow it).
        var place = await db.Profiles.AsNoTracking().Where(p => p.Id == requester).Select(p => new { p.OrganizationId, p.BranchId }).FirstOrDefaultAsync(ct);
        var ticket = new Ticket
        {
            Id = Guid.NewGuid(),
            Reference = reference,
            RequesterId = requester,
            OrganizationId = place?.OrganizationId,
            BranchId = place?.BranchId,
            Subject = subject,
            Description = description,
            TicketTypeId = cmd.TypeId,
            CategoryId = category.Id,
            SubcategoryId = sub?.Id,
            Priority = priority,
            Status = TicketStatus.New,
            FlowId = flowId,
            TeamId = routed?.TeamId ?? (category.TeamKindId is null ? category.DefaultTeamId : null),
            CreatedBy = c.UserId,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Tickets.Add(ticket);
        // No navigation properties: save the ticket first so its rows (fields, history) never reach SQL Server before it.
        await db.SaveChangesAsync(ct);
        foreach (var (fieldId, json) in toStore)
            db.TicketCustomFieldValues.Add(new TicketCustomFieldValue { TicketId = ticket.Id, FieldId = fieldId, Value = json });

        db.TicketStatusHistory.Add(new TicketStatusHistory
        {
            Id = Guid.NewGuid(), TicketId = ticket.Id, FromStatus = null, ToStatus = TicketStatus.New, ChangedBy = c.UserId,
            Reason = onBehalf ? "Created by staff for the customer" : "Ticket submitted", CreatedAt = now,
        });
        audit.Write("ticket.created", "ticket", ticket.Id, null, new
        {
            reference = ticket.Reference, priority, priority_by = customerPicks ? "customer" : "system",
            on_behalf = onBehalf ? requester : (Guid?)null,
        });
        await db.SaveChangesAsync(ct);

        await sla.StartAsync(ticket, ct);
        await notifications.OnTicketCreatedAsync(ticket, ct);
        if (ticket.TeamId is null && category.TeamKindId is Guid needKind) await NoTeamAsync(ticket, needKind, ct);
        else await AutoAssignAsync(ticket, ct, routed?.Step);
        await SaveAsync(ct);
        await tx.CommitAsync(ct);
        return new CreatedTicket(ticket.Id, ticket.Reference);
    }

    // ------------------------------------------------------------------ status

    /// <summary>change_ticket_status(): checks the editable flow table, then writes history, SLA and audit.</summary>
    public async Task ChangeStatusAsync(Guid ticketId, ChangeStatusCommand cmd, CancellationToken ct = default)
    {
        var (c, facts) = await access.RequireTicketAsync(ticketId, ct);
        var actor = c.Staff ? StatusActor.Staff
                  : facts.RequesterId == c.UserId ? StatusActor.Customer
                  : throw new ForbiddenException();

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await db.Tickets.FirstAsync(x => x.Id == ticketId, ct);
        var flowId = await FlowLookup.OfTicketAsync(db, t.FlowId, ct);
        var flow = await db.TicketStatusTransitions.AsNoTracking().Where(x => x.FlowId == flowId)
            .Select(x => new Transition(x.FromStatus, x.ToStatus, x.Actor, x.RequiresReason)).ToListAsync(ct);
        var activeReasons = await db.ClosureReasons.Where(r => r.IsActive).Select(r => r.Code).ToListAsync(ct);
        bool? mayReopen = t.ClosureReason is null ? null
            : await db.ClosureReasons.Where(r => r.Code == t.ClosureReason).Select(r => (bool?)r.CustomerMayReopen).FirstOrDefaultAsync(ct);

        var like = await FlowLookup.LikesAsync(db, ct);
        var decision = StatusFlow.Evaluate(new StatusChangeRequest(
            t.CustomStatus ?? t.Status, cmd.To, actor, cmd.Reason, cmd.Resolution, cmd.ClosureReason,
            c.Has(Permission.Resolve), c.Has(Permission.Close), t.ClosedAt, mayReopen,
            await settings.GetIntAsync("reopen_window_days", 30, ct), clock.UtcNow, activeReasons), flow);
        if (!decision.Allowed)
            throw decision.Error!.StartsWith("not allowed") || decision.Error.StartsWith("transition") || decision.Error.StartsWith("this ticket") || decision.Error.StartsWith("the reopen")
                ? (AppException)new ForbiddenException(decision.Error) : new ValidationFailedException(decision.Error);

        // A custom status is stored as the built-in status it behaves like, plus its own code.
        var (to, toCustom) = FlowRules.Target(cmd.To, like);
        var from = t.Status;
        var fromCustom = t.CustomStatus;
        var now = clock.UtcNow;
        var before = new { status = t.Status, custom_status = t.CustomStatus, closure_reason = t.ClosureReason };
        t.Status = to;
        t.CustomStatus = toCustom;
        t.UpdatedAt = now;
        if (to == TicketStatus.Resolved) { t.ResolutionSummary = decision.Resolution; t.ResolvedAt = now; t.ResolvedBy = c.UserId; }
        if (to == TicketStatus.Closed) { t.ClosedAt = now; t.ClosureReason = decision.ClosureReasonToStore; t.ClosedBy = c.UserId; }
        if (to == TicketStatus.Reopened) { t.ClosedAt = null; t.ClosureReason = null; t.ClosedBy = null; t.ReopenedCount++; }

        var h = new TicketStatusHistory
        {
            Id = Guid.NewGuid(), TicketId = t.Id, FromStatus = from, ToStatus = to, FromCustom = fromCustom, ToCustom = toCustom, ChangedBy = c.UserId,
            Reason = decision.Reason, ClosureReason = decision.ClosureReasonToStore, CreatedAt = now,
        };
        db.TicketStatusHistory.Add(h);

        if (TicketStatus.IsPending(from)) await sla.ResumeAsync(t.Id, ct);
        if (TicketStatus.IsPending(to))
        {
            var pol = await (from r in db.TicketSlaRecords join p in db.SlaPolicies on r.PolicyId equals p.Id
                             where r.TicketId == t.Id select p).AsNoTracking().FirstOrDefaultAsync(ct);
            if (pol is not null && ((to == TicketStatus.PendingCustomer && pol.PauseOnPendingCustomer)
                                 || (to == TicketStatus.PendingInternal && pol.PauseOnPendingInternal)))
                await sla.PauseAsync(t.Id, ct);
        }
        if (to == TicketStatus.Resolved) await sla.CompleteAsync(t.Id, ct);
        else if (to == TicketStatus.Reopened) await sla.StartReopenCycleAsync(t.Id, ct);

        audit.Write("ticket.status_changed", "ticket", t.Id, before,
            new { status = to, custom_status = toCustom, reason = decision.Reason, closure_reason = decision.ClosureReasonToStore });
        await notifications.OnStatusAsync(h, t, ct);
        await SaveAsync(ct);
        await tx.CommitAsync(ct);
    }

    // ------------------------------------------------------------------ messages

    /// <summary>add_message(): replies, internal notes, first-response tracking and automatic status moves.</summary>
    public async Task<Guid> AddMessageAsync(Guid ticketId, string kind, string body, CancellationToken ct = default)
    {
        var (c, facts) = await access.RequireTicketAsync(ticketId, ct);
        body = (body ?? "").Trim();
        if (body.Length is < 1 or > 10000) throw new ValidationFailedException("message must be 1-10000 characters", "body");
        if (kind is not (MessageKind.PublicReply or MessageKind.InternalNote)) throw new ValidationFailedException("invalid message kind", "kind");

        var now = clock.UtcNow;
        var minuteAgo = now.AddMinutes(-1);
        if (await db.TicketMessages.CountAsync(m => m.AuthorId == c.UserId && m.Kind != MessageKind.System && m.CreatedAt > minuteAgo, ct) >= MaxMessagesPerMinute)
            throw new RateLimitedException("rate limit: too many messages");

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await db.Tickets.FirstAsync(x => x.Id == ticketId, ct);
        var isCustomer = t.RequesterId == c.UserId && !c.Staff;
        if (isCustomer)
        {
            if (kind != MessageKind.PublicReply) throw new ForbiddenException("customers can only post public replies");
            if (t.Status == TicketStatus.Closed) throw new ForbiddenException("ticket is closed; reopen it first");
        }
        else
        {
            if (!c.Staff || !c.Has(Permission.Reply)) throw new ForbiddenException();
            if (kind == MessageKind.InternalNote && !AccessRules.CanSeeInternalNotes(c, facts)) throw new ForbiddenException();
            // Spec 3: staff cannot reply to a closed ticket until it is reopened.
            if (kind == MessageKind.PublicReply && t.Status == TicketStatus.Closed) throw new ForbiddenException("ticket is closed; reopen it first");
        }

        var msg = new TicketMessage { Id = Guid.NewGuid(), TicketId = t.Id, AuthorId = c.UserId, Kind = kind, Body = body, CreatedAt = now };
        db.TicketMessages.Add(msg);
        t.UpdatedAt = now;

        var autoMove = isCustomer ? TicketTimers.AfterCustomerReply(t.Status, await settings.GetBoolAsync("resolved_reply_reopens", true, ct)) : null;
        if (autoMove == TicketStatus.InProgress)
        {
            AddHistory(t, TicketStatus.InProgress, c.UserId, "Customer replied", now);
            await sla.ResumeAsync(t.Id, ct);
        }
        else if (autoMove == TicketStatus.Reopened)
        {
            // Settings → System rules: a reply on a Resolved ticket reopens it, so the automatic close stops and the team is told.
            // A flow without Reopened sends it back to In progress instead.
            var back = FlowRules.AfterResolvedReply(await FlowLookup.StatusesAsync(db, await FlowLookup.OfTicketAsync(db, t.FlowId, ct), ct));
            AddHistory(t, back, c.UserId, "Customer replied after the ticket was resolved", now);
            t.ReopenedCount++;
            await sla.StartReopenCycleAsync(t.Id, ct);
            audit.Write("ticket.status_changed", "ticket", t.Id, new { status = TicketStatus.Resolved },
                new { status = back, reason = "Customer replied after the ticket was resolved" });
        }

        var minReply = await settings.GetIntAsync("min_reply_chars", 20, ct);
        if (!isCustomer && kind == MessageKind.PublicReply && body.Length >= minReply)
        {
            if (t.Status is TicketStatus.New or TicketStatus.Open)
                AddHistory(t, TicketStatus.InProgress, c.UserId, "First reply to the customer", now);
            await sla.MarkFirstResponseAsync(t.Id, ct);
        }

        await notifications.OnMessageAsync(msg, t, ct);
        await SaveAsync(ct);
        await tx.CommitAsync(ct);
        return msg.Id;
    }

    // ------------------------------------------------------------------ assignment

    /// <summary>assign_ticket(): leaders/admins assign anyone; agents claim unassigned tickets in their own team.</summary>
    public async Task AssignAsync(Guid ticketId, AssignCommand cmd, CancellationToken ct = default)
    {
        var (c, facts) = await access.RequireTicketAsync(ticketId, ct);
        if (!c.Staff) throw new ForbiddenException();
        if (!await db.Teams.AnyAsync(x => x.Id == cmd.TeamId && x.IsActive, ct)) throw new ValidationFailedException("invalid team", "teamId");
        if (!AccessRules.CanAssign(c, facts, cmd.TeamId, cmd.AgentId)) throw new ForbiddenException("not allowed to assign this ticket");

        if (cmd.AgentId is Guid agent)
        {
            var ok = await (from m in db.TeamMembers
                            join ur in db.UserRoles on m.UserId equals ur.UserId
                            join r in db.Roles on ur.RoleId equals r.Id
                            where m.TeamId == cmd.TeamId && m.UserId == agent && (r.Code == RoleCode.Agent || r.Code == RoleCode.TeamLeader)
                            select 1).AnyAsync(ct);
            if (!ok) throw new ValidationFailedException("agent does not belong to the selected team", "agentId");
            // Security audit L-05: same checks as auto-assign, since assigning gives the agent full access to the ticket.
            if (!await db.Profiles.AnyAsync(p => p.Id == agent && p.AccountStatus == AccountStatus.Active, ct))
                throw new ValidationFailedException("agent is not active", "agentId");
            if (!await access.UserInScopeAsync(agent, facts.RequesterId, ct))
                throw new ValidationFailedException("agent cannot serve this customer", "agentId");
        }

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await db.Tickets.FirstAsync(x => x.Id == ticketId, ct);
        var now = clock.UtcNow;
        var before = new { team_id = t.TeamId, agent_id = t.AssignedAgentId };
        var a = new TicketAssignment
        {
            Id = Guid.NewGuid(), TicketId = t.Id, FromAgent = t.AssignedAgentId, ToAgent = cmd.AgentId, FromTeam = t.TeamId,
            ToTeam = cmd.TeamId, AssignedBy = c.UserId, Reason = string.IsNullOrWhiteSpace(cmd.Reason) ? null : cmd.Reason.Trim(), CreatedAt = now,
        };
        db.TicketAssignments.Add(a);
        var teamChanged = t.TeamId != cmd.TeamId;
        t.TeamId = cmd.TeamId;
        t.AssignedAgentId = cmd.AgentId;
        t.UpdatedAt = now;
        if (t.Status == TicketStatus.New && FlowRules.AfterAssign(await FlowLookup.StatusesAsync(db, await FlowLookup.OfTicketAsync(db, t.FlowId, ct), ct)) is string toOpen)
            AddHistory(t, toOpen, c.UserId, "Assigned", now);

        await notifications.OnAssignmentAsync(a, t, ct);
        audit.Write("ticket.assigned", "ticket", t.Id, before, new { team_id = cmd.TeamId, agent_id = cmd.AgentId });
        await SaveAsync(ct);
        if (cmd.AgentId is null && teamChanged) await AutoAssignAsync(t, ct);
        await SaveAsync(ct);
        await tx.CommitAsync(ct);
    }

    /// <summary>
    /// Teams per place: the category's kind of team in the customer's branch, then their organization (and the ones above
    /// it), then a central team (Settings → System → Ticket routing). Null when the category has no kind or nothing fits.
    /// </summary>
    public async Task<(Guid TeamId, string Step)?> RouteAsync(TicketCategory category, Guid requesterId, CancellationToken ct = default)
    {
        if (category.TeamKindId is not Guid kind) return null;
        var teams = await db.Teams.AsNoTracking().Where(t => t.KindId == kind && t.IsActive)
            .Select(t => new TeamRouting.TeamAt(t.Id, t.OrganizationId, t.BranchId)).ToListAsync(ct);
        var who = await db.Profiles.AsNoTracking().Where(p => p.Id == requesterId).Select(p => new { p.OrganizationId, p.BranchId }).FirstOrDefaultAsync(ct);
        var chain = new List<Guid>();
        if (who?.OrganizationId is Guid org)
        {
            var parents = await db.Organizations.AsNoTracking().ToDictionaryAsync(o => o.Id, o => o.ParentId, ct);
            for (Guid? cur = org; cur is Guid c && !chain.Contains(c); cur = parents.GetValueOrDefault(c)) chain.Add(c);
        }
        var central = await db.TeamKinds.AsNoTracking().Where(k => k.Id == kind).Select(k => k.CentralFallback).FirstOrDefaultAsync(ct);
        return TeamRouting.Pick(teams, chain, who?.BranchId, await settings.GetRoutingAsync(ct), central);
    }

    /// <summary>No team of the needed kind fits: the ticket waits unassigned; the organization admins (or system admins) are told.</summary>
    private async Task NoTeamAsync(Ticket t, Guid kind, CancellationToken ct)
    {
        var routing = await settings.GetRoutingAsync(ct);
        var req = new { t.OrganizationId, t.BranchId };   // the place the ticket was created in
        var admins = new List<Guid>();
        if (routing.Notify == "org" && req?.OrganizationId is Guid org)
            admins = await db.AdminScopes.Where(s => s.OrganizationId == org && (s.BranchId == null || s.BranchId == req.BranchId))
                .Select(s => s.UserId).Distinct().ToListAsync(ct);
        if (admins.Count == 0)
            admins = await (from ur in db.UserRoles join r in db.Roles on ur.RoleId equals r.Id where r.Code == RoleCode.Admin select ur.UserId).Distinct().ToListAsync(ct);
        var kindName = await db.TeamKinds.AsNoTracking().Where(k => k.Id == kind).Select(k => new { k.NameEn, k.NameAr }).FirstOrDefaultAsync(ct);
        var payload = await notifications.TicketPayloadAsync(t.Id, new Dictionary<string, object?> { ["team"] = kindName?.NameEn, ["teamAr"] = kindName?.NameAr }, ct);
        foreach (var a in admins) await notifications.NotifyAsync(a, NotificationEvent.TicketNoTeam, t.Id, payload, "ticket:" + t.Id, ct);
    }

    /// <summary>
    /// auto_assign_ticket(): who in the ticket's team gets it. Candidates are active team members with "Gets tickets
    /// automatically" on, in the customer's place, and (when the category names people for this team) one of them.
    /// The team's method (or the default) then decides: fewest open tickets, take turns, shared with the team (everyone is
    /// told; the first to take it gets it) or the team leader chooses. A category can switch automatic assignment off.
    /// </summary>
    public async Task<Guid?> AutoAssignAsync(Ticket t, CancellationToken ct = default, string? step = null)
    {
        if (t.TeamId is not Guid team || t.AssignedAgentId is not null) return null;
        var catAuto = await db.TicketCategories.Where(x => x.Id == t.CategoryId).Select(x => (bool?)x.AutoAssign).FirstOrDefaultAsync(ct);
        if (catAuto == false) return null;
        var teamRow = await db.Teams.FirstAsync(x => x.Id == team, ct);
        var method = teamRow.AssignMethod ?? (await settings.GetRoutingAsync(ct)).Method;

        var candidates = await (from m in db.TeamMembers
                                join p in db.Profiles on m.UserId equals p.Id
                                where m.TeamId == team && p.AccountStatus == AccountStatus.Active && p.AutoAssign
                                      && (from ur in db.UserRoles join r in db.Roles on ur.RoleId equals r.Id
                                          where ur.UserId == m.UserId && (r.Code == RoleCode.Agent || r.Code == RoleCode.TeamLeader)
                                          select 1).Any()
                                orderby p.FullName, m.UserId
                                select new
                                {
                                    m.UserId,
                                    Load = db.Tickets.Count(o => o.AssignedAgentId == m.UserId && o.Status != TicketStatus.Resolved && o.Status != TicketStatus.Closed),
                                }).ToListAsync(ct);
        var chosen = await db.CategoryPeople.Where(x => x.CategoryId == t.CategoryId && x.TeamId == team).Select(x => x.UserId).ToListAsync(ct);
        var pool = new List<(Guid UserId, int Load)>();
        foreach (var x in candidates)
            if ((chosen.Count == 0 || chosen.Contains(x.UserId)) && await access.UserInScopeAsync(x.UserId, t.RequesterId, ct)) pool.Add((x.UserId, x.Load));
        var leaders = await db.TeamMembers.Where(m => m.TeamId == team && m.IsLeader).Select(m => m.UserId).ToListAsync(ct);
        var by = leaders.Cast<Guid?>().FirstOrDefault() ?? t.CreatedBy ?? t.RequesterId;
        var now = clock.UtcNow;
        var where = step ?? "team";   // "team": staff moved it to this team

        // Nobody can take it automatically, or the team gives tickets out by hand: it waits in the team list.
        if (pool.Count == 0 || method is TeamRouting.Shared or TeamRouting.Leader)
        {
            var why = pool.Count == 0 ? "nobody" : method;
            db.TicketAssignments.Add(new TicketAssignment
            {
                Id = Guid.NewGuid(), TicketId = t.Id, ToTeam = team, FromTeam = team, AssignedBy = by, Reason = $"auto:{why}:{where}", CreatedAt = now,
            });
            var tell = method == TeamRouting.Shared && pool.Count > 0 ? pool.Select(x => x.UserId).ToList() : leaders;
            var payload = await notifications.TicketPayloadAsync(t.Id, new Dictionary<string, object?> { ["team"] = teamRow.NameEn, ["teamAr"] = teamRow.NameAr }, ct);
            foreach (var u in tell) await notifications.NotifyAsync(u, NotificationEvent.TeamTicketWaiting, t.Id, payload, "ticket:" + t.Id, ct);
            return null;
        }

        var agent = method == TeamRouting.Turns
            ? TeamRouting.NextInLine(pool.Select(x => x.UserId).ToList(), teamRow.LastAutoUserId)
            : TeamRouting.PickFewest(pool, Random.Shared.Next);
        if (method == TeamRouting.Turns) teamRow.LastAutoUserId = agent;

        t.AssignedAgentId = agent;
        t.UpdatedAt = now;
        var a = new TicketAssignment
        {
            Id = Guid.NewGuid(), TicketId = t.Id, FromAgent = null, ToAgent = agent, FromTeam = team, ToTeam = team,
            AssignedBy = leaders.Cast<Guid?>().FirstOrDefault() ?? agent, Reason = $"auto:{method}:{where}", CreatedAt = now,
        };
        db.TicketAssignments.Add(a);
        if (t.Status == TicketStatus.New && FlowRules.AfterAssign(await FlowLookup.StatusesAsync(db, await FlowLookup.OfTicketAsync(db, t.FlowId, ct), ct)) is string toOpen)
            AddHistory(t, toOpen, null, "Auto-assigned", now);
        await notifications.OnAssignmentAsync(a, t, ct);
        return agent;
    }

    // ------------------------------------------------------------------ priority

    /// <summary>set_ticket_priority(): staff only; a category or subcategory can fix the priority.</summary>
    public async Task SetPriorityAsync(Guid ticketId, string priority, CancellationToken ct = default, string? reason = null)
    {
        var (c, _) = await access.RequireTicketAsync(ticketId, ct);
        if (!c.Staff) throw new ForbiddenException("only staff can set priority");
        // Security audit L-04: priority drives the SLA targets, so it needs the same right as changing the category.
        if (!c.Has(Permission.ChangeCategory)) throw new ForbiddenException("not allowed to change priority");
        if (!await db.Priorities.AnyAsync(p => p.Code == priority && p.IsActive, ct)) throw new ValidationFailedException("invalid priority", "priority");

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await db.Tickets.FirstAsync(x => x.Id == ticketId, ct);
        var site = await db.SiteSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        if (site?.PriorityMode != "customer")
        {
            var fixedCode = await (from cat in db.TicketCategories
                                   where cat.Id == t.CategoryId
                                   select db.TicketSubcategories.Where(s => s.Id == t.SubcategoryId).Select(s => s.PriorityCode).FirstOrDefault() ?? cat.PriorityCode)
                                  .FirstOrDefaultAsync(ct);
            if (fixedCode is not null && fixedCode != priority) throw new ValidationFailedException("priority is fixed by the category", "priority");
        }
        if (t.Priority == priority) return;
        var old = t.Priority;
        t.Priority = priority;
        t.UpdatedAt = clock.UtcNow;
        await sla.ApplyPriorityAsync(t.Id, priority, ct);
        await notifications.OnPriorityAsync(t, old, c.UserId, ct);
        audit.Write("ticket.priority_changed", "ticket", t.Id, new { priority = old }, new { priority, reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim() });
        await SaveAsync(ct);
        await tx.CommitAsync(ct);
    }

    // ------------------------------------------------------------------ helpers

    // Automatic moves (first reply, customer reply, assignment) notify like trg_notify_status does.
    private readonly List<(TicketStatusHistory History, Ticket Ticket)> _autoMoves = [];

    private void AddHistory(Ticket t, string to, Guid? by, string reason, DateTimeOffset now)
    {
        var h = new TicketStatusHistory
        {
            Id = Guid.NewGuid(), TicketId = t.Id, FromStatus = t.Status, ToStatus = to, FromCustom = t.CustomStatus, ChangedBy = by, Reason = reason, CreatedAt = now,
        };
        db.TicketStatusHistory.Add(h);
        _autoMoves.Add((h, t));
        t.Status = to;
        t.CustomStatus = null;
    }

    private async Task SaveAsync(CancellationToken ct)
    {
        foreach (var (h, t) in _autoMoves) await notifications.OnStatusAsync(h, t, ct);
        _autoMoves.Clear();
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { throw new ConflictException("the ticket was changed by someone else; reload and try again"); }
    }
}
