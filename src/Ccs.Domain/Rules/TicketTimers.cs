namespace Ccs.Domain.Rules;

/// <summary>Automatic ticket moves and reminders that are not rows of the status flow table (Settings → System rules).</summary>
public static class TicketTimers
{
    /// <summary>
    /// Status after a customer's reply: "Waiting for you" goes back to In progress; "Resolved" becomes Reopened when
    /// "A customer reply on a Resolved ticket reopens it" is on (so the auto-close stops and the team is told). Otherwise no change (null).
    /// </summary>
    public static string? AfterCustomerReply(string status, bool resolvedReplyReopens) => status switch
    {
        TicketStatus.PendingCustomer => TicketStatus.InProgress,
        TicketStatus.Resolved when resolvedReplyReopens => TicketStatus.Reopened,
        _ => null,
    };

    /// <summary>
    /// How many "Pending internal" reminders are due: one every <paramref name="everyDays"/> days after the ticket entered the status,
    /// using the same day boundary as the other ticket timers. 0 days = off. Each stage is sent once (the stage is part of the dedupe key).
    /// </summary>
    public static int InternalReminderStage(DateTimeOffset now, int everyDays, Func<int, DateTimeOffset> boundaryAfterDays, int max = 30)
    {
        if (everyDays <= 0) return 0;
        var n = 0;
        while (n < max && now >= boundaryAfterDays((n + 1) * everyDays)) n++;
        return n;
    }
}
