using Ccs.Application.Access;
using Ccs.Application.Common;
using Ccs.Domain;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>
/// Everything the staff ticket page shows besides the ticket itself (v1 console/tickets/[id]):
/// customer phone, team leaders, SLA clocks, assignment history and the choices of the Assignment and Priority forms.
/// </summary>
[ApiController]
[Authorize]
[Route("api/tickets/{id:guid}/staff")]
public sealed class TicketStaffController(CcsDbContext db, AccessService access) : ControllerBase
{
    [HttpGet]
    public async Task<object> Get(Guid id, CancellationToken ct)
    {
        var (c, _) = await access.RequireTicketAsync(id, ct);
        if (!c.Internal) throw new ForbiddenException();
        var t = await db.Tickets.AsNoTracking().FirstAsync(x => x.Id == id, ct);
        var phone = await db.Profiles.AsNoTracking().Where(p => p.Id == t.RequesterId).Select(p => p.Phone).FirstOrDefaultAsync(ct);

        var members = await (from m in db.TeamMembers.AsNoTracking()
                             join p in db.Profiles on m.UserId equals p.Id
                             where p.AccountStatus == AccountStatus.Active
                             orderby p.FullName
                             select new { m.TeamId, m.UserId, m.IsLeader, p.FullName }).ToListAsync(ct);
        var teams = await db.Teams.AsNoTracking().Where(x => x.IsActive).OrderBy(x => x.NameEn).Select(x => new { x.Id, x.NameEn, x.NameAr }).ToListAsync(ct);
        var leaders = members.Where(m => m.IsLeader && m.TeamId == t.TeamId).Select(m => m.FullName).ToList();

        var sla = await db.TicketSlaRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TicketId == id, ct);

        var rows = await db.TicketAssignments.AsNoTracking().Where(a => a.TicketId == id).OrderBy(a => a.CreatedAt).ToListAsync(ct);
        var people = rows.SelectMany(a => new[] { a.ToAgent, (Guid?)a.AssignedBy }).Where(x => x != null).Select(x => x!.Value).Distinct().ToList();
        var names = await db.Profiles.AsNoTracking().Where(p => people.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.FullName, ct);
        var teamNames = await db.Teams.AsNoTracking().ToDictionaryAsync(x => x.Id, x => new { x.NameEn, x.NameAr }, ct);
        var assignments = rows.Select(a => new
        {
            at = a.CreatedAt,
            teamEn = a.ToTeam is Guid tm && teamNames.TryGetValue(tm, out var n1) ? n1.NameEn : null,
            teamAr = a.ToTeam is Guid tm2 && teamNames.TryGetValue(tm2, out var n2) ? n2.NameAr : null,
            agent = a.ToAgent is Guid ag && names.TryGetValue(ag, out var an) ? an : null,
            by = names.GetValueOrDefault(a.AssignedBy),
            a.Reason,
        });

        // ticket_fixed_priority(): the category's or subcategory's priority, unless customers pick the priority.
        var mode = await db.SiteSettings.AsNoTracking().Select(s => s.PriorityMode).FirstOrDefaultAsync(ct);
        string? fixedPriority = null;
        if (mode != "customer")
        {
            var sub = t.SubcategoryId is Guid sid ? await db.TicketSubcategories.AsNoTracking().Where(s => s.Id == sid).Select(s => s.PriorityCode).FirstOrDefaultAsync(ct) : null;
            fixedPriority = sub ?? await db.TicketCategories.AsNoTracking().Where(x => x.Id == t.CategoryId).Select(x => x.PriorityCode).FirstOrDefaultAsync(ct);
        }
        var priorities = await db.Priorities.AsNoTracking().Where(p => p.IsActive || p.Code == t.Priority).OrderBy(p => p.SortOrder)
            .Select(p => new { p.Code, p.NameEn, p.NameAr, p.Color }).ToListAsync(ct);

        bool canWork = c.Staff;
        bool inTeam = t.TeamId is Guid team && c.Teams.Contains(team);
        bool canReassign = c.Admin || (canWork && c.Has(Permission.AssignOthers) && (inTeam || c.Has(Permission.AllTeams)));
        bool canClaim = canWork && c.Has(Permission.AssignSelf) && t.AssignedAgentId == null && t.TeamId != null && inTeam;

        // Status form: the staff moves from here, without Resolved/Closed for people who may not do them (v1).
        var moves = await db.TicketStatusTransitions.AsNoTracking().Where(x => x.FromStatus == t.Status && x.Actor == "staff")
            .Select(x => new { to = x.ToStatus, x.RequiresReason }).ToListAsync(ct);
        moves = moves.Where(m => (m.to != TicketStatus.Resolved || c.Admin || c.Has(Permission.Resolve))
                              && (m.to != TicketStatus.Closed || c.Admin || c.Has(Permission.Close))).ToList();
        string[] systemClosures = ["resolved_confirmed", "auto_closed", "cancelled"];
        var closureReasons = await db.ClosureReasons.AsNoTracking().Where(r => r.IsActive && !systemClosures.Contains(r.Code))
            .OrderBy(r => r.SortOrder).Select(r => new { r.Code, r.NameEn, r.NameAr }).ToListAsync(ct);

        return new
        {
            moves = canWork ? moves.Cast<object>().ToList() : [],
            closureReasons,
            requesterPhone = phone,
            teamLeaders = leaders,
            sla = sla is null ? null : new { sla.State, sla.FirstResponseDue, sla.ResolutionDue, sla.FirstRespondedAt, sla.ResolvedAt, sla.PausedAt, sla.PausedTotalSeconds },
            assignments,
            teams,
            members = members.Select(m => new { m.TeamId, m.UserId, m.FullName }),
            priorities, fixedPriority,
            canWork, canReassign, canClaim,
            serverNow = DateTimeOffset.UtcNow,
        };
    }
}
