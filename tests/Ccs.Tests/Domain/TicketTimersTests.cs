using Ccs.Domain;
using Ccs.Domain.Rules;
using Xunit;

namespace Ccs.Tests.Domain;

public class TicketTimersTests
{
    [Theory]
    [InlineData(TicketStatus.PendingCustomer, true, TicketStatus.InProgress)]
    [InlineData(TicketStatus.PendingCustomer, false, TicketStatus.InProgress)]
    [InlineData(TicketStatus.Resolved, true, TicketStatus.Reopened)]
    [InlineData(TicketStatus.Resolved, false, null)]
    [InlineData(TicketStatus.InProgress, true, null)]
    [InlineData(TicketStatus.New, true, null)]
    [InlineData(TicketStatus.Reopened, true, null)]
    public void Customer_reply_moves_only_waiting_and_resolved_tickets(string status, bool reopens, string? expected)
        => Assert.Equal(expected, TicketTimers.AfterCustomerReply(status, reopens));

    private static readonly DateTimeOffset Since = new(2026, 11, 1, 9, 0, 0, TimeSpan.Zero);
    private static DateTimeOffset Boundary(int days) => Since.AddDays(days);

    [Theory]
    [InlineData(0, 3, 0)]     // just entered
    [InlineData(2, 3, 0)]     // before the first reminder
    [InlineData(3, 3, 1)]     // day 3: first
    [InlineData(5, 3, 1)]
    [InlineData(6, 3, 2)]     // day 6: second
    [InlineData(10, 3, 3)]
    [InlineData(10, 0, 0)]    // 0 = off
    [InlineData(1, 1, 1)]
    public void Internal_reminder_repeats_every_n_days(int daysWaited, int every, int expected)
        => Assert.Equal(expected, TicketTimers.InternalReminderStage(Since.AddDays(daysWaited), every, Boundary));

    [Fact]
    public void Internal_reminder_stage_is_capped()
        => Assert.Equal(30, TicketTimers.InternalReminderStage(Since.AddDays(1000), 1, Boundary));
}
