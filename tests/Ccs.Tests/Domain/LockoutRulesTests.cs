using Ccs.Domain.Rules;

namespace Ccs.Tests.Domain;

/// <summary>The account lockout counting rule (Settings → Security → Account lockout).</summary>
public class LockoutRulesTests
{
    static readonly DateTimeOffset T0 = new(2026, 11, 22, 10, 0, 0, TimeSpan.Zero);
    static readonly LockoutPolicy P = new(); // 5 attempts, 15 min window, 30 min lock, 15 min reset

    static LockoutRules.Counter Fail(LockoutRules.Counter c, int minutes) => LockoutRules.AddFailure(c, P, T0.AddMinutes(minutes));

    [Fact]
    public void Five_failures_within_the_window_lock()
    {
        var c = default(LockoutRules.Counter);
        for (var i = 0; i < 5; i++) c = Fail(c, i * 2);
        Assert.Equal(5, c.Failed);
        Assert.True(LockoutRules.ShouldLock(c, P));
    }

    [Fact]
    public void Four_failures_do_not_lock()
    {
        var c = default(LockoutRules.Counter);
        for (var i = 0; i < 4; i++) c = Fail(c, i);
        Assert.False(LockoutRules.ShouldLock(c, P));
    }

    [Fact]
    public void Count_starts_over_after_the_reset_period_without_failures()
    {
        var c = Fail(Fail(Fail(default, 0), 1), 2);
        c = Fail(c, 2 + 16); // 16 minutes after the last failure
        Assert.Equal(1, c.Failed);
        Assert.Equal(T0.AddMinutes(18), c.WindowStart);
    }

    [Fact]
    public void Count_starts_over_when_the_window_has_passed()
    {
        // Failures every 10 minutes: never 15 minutes apart, but the window (15 min from the first) runs out.
        var c = Fail(Fail(default, 0), 10);
        Assert.Equal(2, c.Failed);
        c = Fail(c, 20);
        Assert.Equal(1, c.Failed);
    }

    [Fact]
    public void Disabled_policy_never_locks()
    {
        var off = P with { Enabled = false };
        Assert.False(LockoutRules.ShouldLock(new LockoutRules.Counter(50, T0, T0), off));
        Assert.Null(off.ShownRemaining(4));
    }

    [Theory]
    [InlineData(0, null)]
    [InlineData(2, null)]
    [InlineData(3, 2)]
    [InlineData(4, 1)]
    [InlineData(5, null)]
    public void Remaining_attempts_shown_only_when_two_or_fewer(int failed, int? shown) => Assert.Equal(shown, P.ShownRemaining(failed));

    [Fact]
    public void Lock_until_uses_duration_or_forever_without_automatic_unlock()
    {
        Assert.Equal(T0.AddMinutes(30), P.LockUntil(T0));
        Assert.Equal(DateTimeOffset.MaxValue, (P with { AutoUnlock = false }).LockUntil(T0));
    }
}
