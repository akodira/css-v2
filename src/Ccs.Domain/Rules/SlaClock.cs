namespace Ccs.Domain.Rules;

public sealed record SlaSnapshot(
    DateTimeOffset? FirstRespondedAt,
    DateTimeOffset? FirstResponseDue,
    DateTimeOffset? ResolutionDue,
    int FirstResponseMinutes,
    int ResolutionMinutes,
    int WarningThresholdPct);

public sealed record SlaEvaluation(string Clock, string State, DateTimeOffset? Due);

/// <summary>Port of the state rule inside sla_tick().</summary>
public static class SlaClock
{
    public const string FirstResponse = "first_response";
    public const string Resolution = "resolution";

    public static SlaEvaluation Evaluate(SlaSnapshot s, DateTimeOffset now, BusinessCalendar? cal)
    {
        var (clock, due, total) = s.FirstRespondedAt is null
            ? (FirstResponse, s.FirstResponseDue, s.FirstResponseMinutes)
            : (Resolution, s.ResolutionDue, s.ResolutionMinutes);

        if (due is null) return new SlaEvaluation(clock, SlaState.OnTrack, null);
        if (now > due) return new SlaEvaluation(clock, SlaState.Breached, due);

        // "Due soon" once 80% (the threshold) of the target is used: remaining <= total * (100 - pct) / 100
        var remaining = WallClock.MinutesBetween(cal, now, due.Value);
        var state = remaining <= total * (100 - s.WarningThresholdPct) / 100.0 ? SlaState.DueSoon : SlaState.OnTrack;
        return new SlaEvaluation(clock, state, due);
    }

    /// <summary>
    /// Priority change. Fixes the known issue in spec 4: today the deadline shifts by wall clock.
    /// v2 re-counts the new target in business minutes from the cycle start, plus time spent paused.
    /// </summary>
    public static (DateTimeOffset FirstResponseDue, DateTimeOffset ResolutionDue) RecalculateForPriority(
        DateTimeOffset cycleStartedAt, int pausedSeconds, int firstResponseMinutes, int resolutionMinutes, BusinessCalendar? cal)
    {
        var start = cycleStartedAt.AddSeconds(pausedSeconds);
        return (WallClock.AddMinutes(cal, start, firstResponseMinutes), WallClock.AddMinutes(cal, start, resolutionMinutes));
    }
}
