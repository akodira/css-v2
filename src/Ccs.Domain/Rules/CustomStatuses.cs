namespace Ccs.Domain.Rules;

/// <summary>
/// The admin's own statuses. Each one behaves like a built-in working or waiting status: the ticket's Status is that
/// built-in one (so the SLA timer, reminders, auto-close and reports work unchanged) and Ticket.CustomStatus holds the code.
/// </summary>
public static class CustomStatuses
{
    public const string Prefix = "c_";

    /// <summary>What a custom status may behave like.</summary>
    public static readonly IReadOnlyList<string> Likes = [TicketStatus.InProgress, TicketStatus.PendingCustomer, TicketStatus.PendingInternal];

    public static bool IsCode(string? s) =>
        s is { Length: > 2 and <= 20 } && s.StartsWith(Prefix, StringComparison.Ordinal) && s[2..].All(ch => ch is (>= 'a' and <= 'z') or (>= '0' and <= '9'));

    public static string NewCode() => Prefix + Guid.NewGuid().ToString("N")[..10];

    /// <summary>Customers see pending_internal as "in progress".</summary>
    public static string Mask(string s) => s == TicketStatus.PendingInternal ? TicketStatus.InProgress : s;

    /// <summary>The status code a customer sees: the custom one when it has its own customer name, else the masked built-in one.</summary>
    public static string CustomerView(string status, string? custom, IReadOnlySet<string> ownCustomerName) =>
        custom is not null && ownCustomerName.Contains(custom) ? custom : Mask(status);

    /// <summary>The built-in status a flow status behaves like (itself for a built-in one).</summary>
    public static string KindOf(string s, IReadOnlyDictionary<string, string>? like) =>
        like is not null && like.TryGetValue(s, out var k) ? k : s;
}
