namespace Ccs.Domain.Rules;

public sealed record Transition(string From, string To, string Actor, bool RequiresReason);

public enum StatusActor { Staff, Customer }

/// <summary>Everything change_ticket_status() checked before writing. Pure: no database.</summary>
public sealed record StatusChangeRequest(
    string CurrentStatus,
    string TargetStatus,
    StatusActor Actor,
    string? Reason,
    string? Resolution,
    string? ClosureReason,
    bool HasResolvePermission,
    bool HasClosePermission,
    // reopen checks (customer only)
    DateTimeOffset? ClosedAt,
    bool? CurrentClosureAllowsReopen,
    int ReopenWindowDays,
    DateTimeOffset Now,
    IReadOnlyCollection<string> ActiveClosureReasons);

public sealed record StatusChangeDecision(bool Allowed, string? Error, string? ClosureReasonToStore, string? Reason, string? Resolution)
{
    public static StatusChangeDecision Deny(string error) => new(false, error, null, null, null);
}

public static class StatusFlow
{
    public static string ActorCode(StatusActor a) => a == StatusActor.Staff ? "staff" : "customer";

    /// <summary>Port of change_ticket_status() validation. Messages match the PostgreSQL ones.</summary>
    public static StatusChangeDecision Evaluate(StatusChangeRequest r, IEnumerable<Transition> flow)
    {
        if (!TicketStatus.IsValid(r.TargetStatus)) return StatusChangeDecision.Deny("invalid status");

        if (r.Actor == StatusActor.Staff && r.TargetStatus == TicketStatus.Resolved && !r.HasResolvePermission)
            return StatusChangeDecision.Deny("not allowed to resolve tickets");
        if (r.Actor == StatusActor.Staff && r.TargetStatus == TicketStatus.Closed && !r.HasClosePermission)
            return StatusChangeDecision.Deny("not allowed to close tickets");

        var actor = ActorCode(r.Actor);
        var move = flow.FirstOrDefault(t => t.From == r.CurrentStatus && t.To == r.TargetStatus && t.Actor == actor);
        if (move is null)
            return StatusChangeDecision.Deny($"transition {r.CurrentStatus} to {r.TargetStatus} is not allowed");

        var reason = Clean(r.Reason);
        if (move.RequiresReason && reason is null) return StatusChangeDecision.Deny("a reason is required");

        string? resolution = null;
        if (r.TargetStatus == TicketStatus.Resolved)
        {
            resolution = Clean(r.Resolution);
            if (resolution is null || resolution.Length < 5) return StatusChangeDecision.Deny("resolution details are required");
        }

        string? closure = null;
        if (r.TargetStatus == TicketStatus.Closed)
        {
            if (r.Actor == StatusActor.Customer)
            {
                closure = ClosureReasonCode.ResolvedConfirmed;
            }
            else
            {
                closure = Clean(r.ClosureReason);
                if (closure is null || !r.ActiveClosureReasons.Contains(closure) || ClosureReasonCode.SystemOnly.Contains(closure))
                    return StatusChangeDecision.Deny("a closure reason is required");
            }
        }

        if (r.Actor == StatusActor.Customer && r.CurrentStatus == TicketStatus.Closed)
        {
            if (r.CurrentClosureAllowsReopen == false) return StatusChangeDecision.Deny("this ticket cannot be reopened by the customer");
            if (r.ClosedAt is null || r.ClosedAt < r.Now.AddDays(-r.ReopenWindowDays))
                return StatusChangeDecision.Deny("the reopen window has passed");
        }

        return new StatusChangeDecision(true, null, closure, reason, resolution);
    }

    /// <summary>
    /// Port of status_flow_problems(): codes shown on the admin status-flow screen.
    /// unreachable:X (nothing leads to X), no_resolve:X (staff cannot reach resolved from X),
    /// no_close:X (X can never end closed; resolved->closed is assumed, the timers close it).
    /// </summary>
    public static IReadOnlyList<string> Problems(IReadOnlyCollection<Transition> flow)
    {
        var problems = new List<string>();
        string[] active = [TicketStatus.New, TicketStatus.Open, TicketStatus.InProgress, TicketStatus.PendingCustomer, TicketStatus.PendingInternal, TicketStatus.Reopened];
        foreach (var s in TicketStatus.All)
            if (s != TicketStatus.New && !flow.Any(t => t.To == s)) problems.Add("unreachable:" + s);

        var staffEdges = flow.Where(t => t.Actor == "staff").Select(t => (t.From, t.To)).ToList();
        foreach (var s in active)
            if (!Reaches(s, TicketStatus.Resolved, staffEdges)) problems.Add("no_resolve:" + s);

        var allEdges = flow.Select(t => (t.From, t.To)).Append((TicketStatus.Resolved, TicketStatus.Closed)).ToList();
        foreach (var s in TicketStatus.All)
            if (s != TicketStatus.Closed && !Reaches(s, TicketStatus.Closed, allEdges)) problems.Add("no_close:" + s);
        return problems;
    }

    private static bool Reaches(string from, string target, List<(string From, string To)> edges)
    {
        var seen = new HashSet<string> { from };
        var queue = new Queue<string>([from]);
        while (queue.Count > 0)
        {
            var n = queue.Dequeue();
            if (n == target) return true;
            foreach (var (f, t) in edges)
                if (f == n && seen.Add(t)) queue.Enqueue(t);
        }
        return false;
    }

    private static string? Clean(string? s)
    {
        var v = s?.Trim();
        return string.IsNullOrEmpty(v) ? null : v;
    }
}
