using Ccs.Domain;
using Ccs.Domain.Rules;

namespace Ccs.Tests.Domain;

/// <summary>Business time: default Sunday-Thursday 09:00-17:00 Africa/Cairo (spec 4).</summary>
public class CalendarAndSlaTests
{
    const string Week = """{"sun":[["09:00","17:00"]],"mon":[["09:00","17:00"]],"tue":[["09:00","17:00"]],"wed":[["09:00","17:00"]],"thu":[["09:00","17:00"]],"fri":[],"sat":[]}""";
    static readonly BusinessCalendar Cairo = BusinessCalendar.FromJson("Africa/Cairo", Week, [new DateOnly(2026, 11, 12)]);   // Thu 12 Nov = holiday
    static readonly TimeZoneInfo Tz = BusinessCalendar.ResolveTimeZone("Africa/Cairo");

    static DateTimeOffset Local(int y, int m, int d, int h, int min = 0)
    {
        var dt = new DateTime(y, m, d, h, min, 0, DateTimeKind.Unspecified);
        return new DateTimeOffset(dt, Tz.GetUtcOffset(dt));
    }

    [Fact]
    public void Adds_minutes_inside_the_same_day() =>
        Assert.Equal(Local(2026, 11, 9, 11), Cairo.AddBusinessMinutes(Local(2026, 11, 9, 10), 60));   // Monday

    [Fact]
    public void Rolls_over_to_the_next_working_day() =>
        Assert.Equal(Local(2026, 11, 10, 10), Cairo.AddBusinessMinutes(Local(2026, 11, 9, 16), 120));

    [Fact]
    public void Skips_weekend_and_holiday()
    {
        // Wed 11 Nov 16:00 + 2h: 1h Wednesday, Thursday is a holiday, Fri/Sat closed -> Sunday 15 Nov 10:00
        Assert.Equal(Local(2026, 11, 15, 10), Cairo.AddBusinessMinutes(Local(2026, 11, 11, 16), 120));
    }

    [Fact]
    public void Starting_before_opening_counts_from_opening() =>
        Assert.Equal(Local(2026, 11, 9, 9, 15), Cairo.AddBusinessMinutes(Local(2026, 11, 9, 6), 15));

    [Fact]
    public void Minutes_between_is_the_inverse_of_add()
    {
        var from = Local(2026, 11, 11, 15);
        var to = Cairo.AddBusinessMinutes(from, 600);
        Assert.Equal(600, Cairo.BusinessMinutesBetween(from, to), 3);
    }

    [Fact]
    public void Lifecycle_boundary_is_opening_time_of_day_n_and_09_00_when_closed()
    {
        Assert.Equal(Local(2026, 11, 11, 9), Cairo.LifecycleBoundary(Local(2026, 11, 9, 16), 2));   // Wed opening
        Assert.Equal(Local(2026, 11, 13, 9), Cairo.LifecycleBoundary(Local(2026, 11, 9, 16), 4));   // Friday: closed -> 09:00
    }

    [Fact]
    public void No_calendar_means_wall_clock()
    {
        var t = Local(2026, 11, 13, 22);
        Assert.Equal(t.AddMinutes(90), WallClock.AddMinutes(null, t, 90));
    }

    [Fact]
    public void Sla_is_due_soon_at_80_percent_used_and_breached_after_due()
    {
        var start = Local(2026, 11, 9, 9);
        var due = Cairo.AddBusinessMinutes(start, 240);   // normal: 4 h first response
        var snap = new SlaSnapshot(null, due, null, 240, 960, 80);
        Assert.Equal(SlaState.OnTrack, SlaClock.Evaluate(snap, Local(2026, 11, 9, 12), Cairo).State);     // 3h used, 1h left
        Assert.Equal(SlaState.DueSoon, SlaClock.Evaluate(snap, Local(2026, 11, 9, 12, 20), Cairo).State); // 40 min left <= 48
        Assert.Equal(SlaState.Breached, SlaClock.Evaluate(snap, Local(2026, 11, 9, 13, 1), Cairo).State);
        Assert.Equal(SlaClock.FirstResponse, SlaClock.Evaluate(snap, start, Cairo).Clock);
    }

    [Fact]
    public void After_first_response_the_resolution_clock_runs()
    {
        var snap = new SlaSnapshot(Local(2026, 11, 9, 10), Local(2026, 11, 9, 13), Local(2026, 11, 10, 17), 240, 960, 80);
        Assert.Equal(SlaClock.Resolution, SlaClock.Evaluate(snap, Local(2026, 11, 9, 14), Cairo).Clock);
    }

    [Fact]
    public void Priority_change_counts_business_time_not_wall_clock()
    {
        // Ticket opened Thu 10 Nov... use Wed 16:00; new target 4h must skip the night, not land at 20:00.
        var (_, resolution) = SlaClock.RecalculateForPriority(Local(2026, 11, 11, 16), 0, 15, 240, Cairo);
        Assert.Equal(Local(2026, 11, 15, 12), resolution);   // 1h Wed, Thu holiday, weekend, 3h Sunday
    }
}
