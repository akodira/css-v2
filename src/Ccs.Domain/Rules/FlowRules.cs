namespace Ccs.Domain.Rules;

/// <summary>
/// Several ticket flows. A flow is a set of statuses (always New, In progress, Resolved and Closed) and the button moves
/// between them. Automatic moves (assignment, first reply, customer reply, the timers) are built in and only go to a status
/// the ticket's flow has. A ticket keeps the flow it started with until it is closed.
/// </summary>
public static class FlowRules
{
    /// <summary>The Standard flow made from the old single table; also the fallback when nothing else is set.</summary>
    public static readonly Guid StandardId = new("f1000000-0000-4000-8000-000000000001");

    public static readonly IReadOnlyList<string> Required = [TicketStatus.New, TicketStatus.InProgress, TicketStatus.Resolved, TicketStatus.Closed];

    /// <summary>"type" (default) or "category": which one picks the flow of a new ticket.</summary>
    public const string ChoiceKey = "flow_choice";

    public static IReadOnlyList<string> Parse(string? csv) =>
        (csv ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct().ToList();

    public static string Join(IEnumerable<string> statuses) => string.Join(',', TicketStatus.All.Where(statuses.Contains));

    public static bool ValidStatuses(IReadOnlyCollection<string> statuses) =>
        statuses.Count > 0 && statuses.All(TicketStatus.IsValid) && Required.All(statuses.Contains);

    /// <summary>Assignment moves a New ticket to Open, when the flow has Open.</summary>
    public static string? AfterAssign(IReadOnlyCollection<string> statuses) => statuses.Contains(TicketStatus.Open) ? TicketStatus.Open : null;

    /// <summary>A customer reply on a Resolved ticket: Reopened when the flow has it, otherwise back to In progress.</summary>
    public static string AfterResolvedReply(IReadOnlyCollection<string> statuses) =>
        statuses.Contains(TicketStatus.Reopened) ? TicketStatus.Reopened : TicketStatus.InProgress;

    /// <summary>The moves the system makes by itself, for the checks (from → to).</summary>
    public static IEnumerable<(string From, string To)> Automatic(IReadOnlyCollection<string> statuses)
    {
        if (statuses.Contains(TicketStatus.Open)) { yield return (TicketStatus.New, TicketStatus.Open); yield return (TicketStatus.Open, TicketStatus.InProgress); }
        else yield return (TicketStatus.New, TicketStatus.InProgress);                       // first reply
        if (statuses.Contains(TicketStatus.PendingCustomer))
        {
            yield return (TicketStatus.PendingCustomer, TicketStatus.InProgress);            // customer replies
            yield return (TicketStatus.PendingCustomer, TicketStatus.Closed);                // no reply timer
        }
        yield return (TicketStatus.Resolved, TicketStatus.Closed);                           // closes after N days
        yield return (TicketStatus.Resolved, AfterResolvedReply(statuses));                  // customer replies
    }

    /// <summary>
    /// Codes shown before a flow is saved: missing:X, outside:A>B, unreachable:X, no_resolve:X (staff cannot get a working
    /// ticket to Resolved), stuck:X (a waiting status with no way out). Empty = the flow is safe to save.
    /// </summary>
    public static IReadOnlyList<string> Problems(IReadOnlyCollection<string> statuses, IReadOnlyCollection<Transition> moves)
    {
        var p = new List<string>();
        foreach (var r in Required) if (!statuses.Contains(r)) p.Add("missing:" + r);
        foreach (var m in moves)
            if (!statuses.Contains(m.From) || !statuses.Contains(m.To)) p.Add($"outside:{m.From}>{m.To}");
        if (p.Count > 0) return p;

        var auto = Automatic(statuses).ToList();
        var edges = moves.Select(m => (m.From, m.To)).Concat(auto).ToList();
        foreach (var s in statuses)
            if (s != TicketStatus.New && !edges.Any(e => e.To == s)) p.Add("unreachable:" + s);

        // Staff (plus what the system does by itself) must be able to get every working ticket to Resolved.
        var staffEdges = moves.Where(m => m.Actor == "staff").Select(m => (m.From, m.To)).Concat(auto).ToList();
        foreach (var s in statuses.Where(x => x is TicketStatus.New or TicketStatus.Open or TicketStatus.InProgress or TicketStatus.Reopened))
            if (!Reaches(s, TicketStatus.Resolved, staffEdges)) p.Add("no_resolve:" + s);
        foreach (var s in statuses.Where(TicketStatus.IsPending))
            if (!edges.Any(e => e.From == s)) p.Add("stuck:" + s);
        return p;
    }

    private static bool Reaches(string from, string target, List<(string From, string To)> edges)
    {
        var seen = new HashSet<string> { from };
        var queue = new Queue<string>([from]);
        while (queue.Count > 0)
        {
            var n = queue.Dequeue();
            if (n == target) return true;
            foreach (var (f, t) in edges) if (f == n && seen.Add(t)) queue.Enqueue(t);
        }
        return false;
    }
}
