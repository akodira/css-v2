namespace Ccs.Domain.Rules;

/// <summary>
/// Settings → Security → Account lockout policy (app_settings lockout_*). Defaults are the ones the policy page starts with.
/// </summary>
public sealed record LockoutPolicy(bool Enabled = true, int MaxAttempts = 5, int WindowMinutes = 15, int DurationMinutes = 30,
    int ResetMinutes = 15, bool AutoUnlock = true, bool NotifyUser = true, bool NotifyAdmins = true)
{
    /// <summary>"Locked until" for a lock that starts now: the lock duration, or (no automatic unlock) until an admin unlocks it.</summary>
    public DateTimeOffset LockUntil(DateTimeOffset now) => AutoUnlock ? now.AddMinutes(DurationMinutes) : DateTimeOffset.MaxValue;

    /// <summary>Attempts left before the lock, shown only when 2 or fewer remain (the same rule for every address, known or not).</summary>
    public int? ShownRemaining(int failed) => Enabled && MaxAttempts - failed is var left && left is > 0 and <= 2 ? left : null;
}

/// <summary>
/// The counting rule, in one place: a failure starts a new count when the previous failure is older than the reset period
/// or the current count started longer ago than the time window; otherwise it adds one. The database applies the same rule
/// in a single UPDATE for real accounts (so attempts at the same moment are all counted); addresses without an account
/// use this in memory, so both give identical answers.
/// </summary>
public static class LockoutRules
{
    public readonly record struct Counter(int Failed, DateTimeOffset? WindowStart, DateTimeOffset? LastFailed);

    public static bool StartsOver(Counter c, LockoutPolicy p, DateTimeOffset now) =>
        c.LastFailed is null || c.WindowStart is null
        || c.LastFailed < now.AddMinutes(-p.ResetMinutes)
        || c.WindowStart < now.AddMinutes(-p.WindowMinutes);

    public static Counter AddFailure(Counter c, LockoutPolicy p, DateTimeOffset now) =>
        StartsOver(c, p, now) ? new Counter(1, now, now) : new Counter(c.Failed + 1, c.WindowStart, now);

    public static bool ShouldLock(Counter c, LockoutPolicy p) => p.Enabled && c.Failed >= p.MaxAttempts;
}
