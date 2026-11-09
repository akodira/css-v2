using System.Globalization;
using System.Text.Json;

namespace Ccs.Domain.Rules;

/// <summary>
/// Business-time maths. Port of sla_day_windows, add_business_minutes, business_minutes_between
/// and lifecycle_boundary. A null calendar means plain wall-clock time, exactly like today.
/// </summary>
public sealed class BusinessCalendar
{
    private static readonly string[] DayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    private const int MaxDays = 800;   // same 2-year safety stop as PostgreSQL

    public TimeZoneInfo TimeZone { get; }
    private readonly Dictionary<DayOfWeek, List<(TimeOnly Start, TimeOnly End)>> _week;
    private readonly HashSet<DateOnly> _holidays;

    public BusinessCalendar(TimeZoneInfo tz, Dictionary<DayOfWeek, List<(TimeOnly, TimeOnly)>> week, IEnumerable<DateOnly> holidays)
    {
        TimeZone = tz;
        _week = week;
        _holidays = [.. holidays];
    }

    /// <summary>Builds a calendar from the stored JSON: {"sun":[["09:00","17:00"]],...}.</summary>
    public static BusinessCalendar FromJson(string timezoneId, string weeklyScheduleJson, IEnumerable<DateOnly> holidays)
    {
        var tz = ResolveTimeZone(timezoneId);
        var week = new Dictionary<DayOfWeek, List<(TimeOnly, TimeOnly)>>();
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(weeklyScheduleJson) ? "{}" : weeklyScheduleJson);
        for (var i = 0; i < 7; i++)
        {
            var list = new List<(TimeOnly, TimeOnly)>();
            if (doc.RootElement.TryGetProperty(DayKeys[i], out var day) && day.ValueKind == JsonValueKind.Array)
            {
                foreach (var w in day.EnumerateArray())
                {
                    if (w.ValueKind != JsonValueKind.Array || w.GetArrayLength() < 2) continue;
                    var s = TimeOnly.Parse(w[0].GetString()!, CultureInfo.InvariantCulture);
                    var e = TimeOnly.Parse(w[1].GetString()!, CultureInfo.InvariantCulture);
                    list.Add((s, e));
                }
            }
            week[(DayOfWeek)i] = list;
        }
        return new BusinessCalendar(tz, week, holidays);
    }

    /// <summary>IANA ids ("Africa/Cairo") work on Windows from .NET 6 via ICU; Windows ids are accepted too.</summary>
    public static TimeZoneInfo ResolveTimeZone(string id)
    {
        if (TimeZoneInfo.TryFindSystemTimeZoneById(id, out var tz)) return tz;
        if (TimeZoneInfo.TryConvertIanaIdToWindowsId(id, out var win) && TimeZoneInfo.TryFindSystemTimeZoneById(win, out tz)) return tz;
        throw new InvalidOperationException($"Unknown time zone '{id}'.");
    }

    /// <summary>Working windows of one local day, as UTC instants. Empty on holidays and closed days.</summary>
    public IEnumerable<(DateTimeOffset Start, DateTimeOffset End)> DayWindows(DateOnly day)
    {
        if (_holidays.Contains(day)) yield break;
        if (!_week.TryGetValue(day.DayOfWeek, out var windows)) yield break;
        foreach (var (s, e) in windows.OrderBy(w => w.Start))
        {
            var ws = ToUtc(day, s);
            var we = ToUtc(day, e);
            if (we > ws) yield return (ws, we);
        }
    }

    public DateTimeOffset AddBusinessMinutes(DateTimeOffset from, double minutes)
    {
        var remaining = Math.Max(minutes, 0);
        var day = LocalDate(from);
        for (var i = 0; i <= MaxDays; i++)
        {
            foreach (var (ws, we) in DayWindows(day))
            {
                if (we <= from) continue;
                var start = ws > from ? ws : from;
                var available = (we - start).TotalMinutes;
                if (remaining <= available) return start.AddMinutes(remaining);
                remaining -= available;
            }
            day = day.AddDays(1);
        }
        return from.AddMinutes(Math.Max(minutes, 0));   // no working time found in two years
    }

    public double BusinessMinutesBetween(DateTimeOffset from, DateTimeOffset to)
    {
        if (to <= from) return 0;
        var day = LocalDate(from);
        var end = LocalDate(to);
        double total = 0;
        for (var i = 0; i <= MaxDays && day <= end; i++, day = day.AddDays(1))
        {
            foreach (var (ws, we) in DayWindows(day))
            {
                if (we > from && ws < to)
                    total += ((we < to ? we : to) - (ws > from ? ws : from)).TotalMinutes;
            }
        }
        return total;
    }

    /// <summary>
    /// Port of lifecycle_boundary(): the moment a "day N" reminder becomes due. It is the opening time of the
    /// local calendar day N days after <paramref name="since"/> (09:00 when that day is closed).
    /// </summary>
    public DateTimeOffset LifecycleBoundary(DateTimeOffset since, int days)
    {
        var day = LocalDate(since).AddDays(days);
        var first = DayWindows(day).Select(w => (DateTimeOffset?)w.Start).FirstOrDefault();
        var open = first is null ? new TimeOnly(9, 0) : TimeOnly.FromDateTime(TimeZoneInfo.ConvertTime(first.Value, TimeZone).DateTime);
        return ToUtc(day, open);
    }

    /// <summary>The same rule with no calendar: Africa/Cairo, 09:00.</summary>
    public static DateTimeOffset LifecycleBoundaryDefault(DateTimeOffset since, int days)
    {
        var tz = ResolveTimeZone("Africa/Cairo");
        var local = TimeZoneInfo.ConvertTime(since, tz);
        var day = DateOnly.FromDateTime(local.DateTime).AddDays(days);
        var dt = day.ToDateTime(new TimeOnly(9, 0));
        return new DateTimeOffset(dt, tz.GetUtcOffset(dt)).ToUniversalTime();
    }

    public DateOnly LocalDate(DateTimeOffset instant) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, TimeZone).DateTime);

    private DateTimeOffset ToUtc(DateOnly day, TimeOnly time)
    {
        var local = day.ToDateTime(time, DateTimeKind.Unspecified);
        // Inside a DST gap PostgreSQL moves forward; do the same.
        if (TimeZone.IsInvalidTime(local)) local = local.AddHours(1);
        return new DateTimeOffset(local, TimeZone.GetUtcOffset(local)).ToUniversalTime();
    }
}

/// <summary>Wall-clock fallback used when no calendar applies (p_bh is null in PostgreSQL).</summary>
public static class WallClock
{
    public static DateTimeOffset AddMinutes(BusinessCalendar? cal, DateTimeOffset from, double minutes) =>
        cal?.AddBusinessMinutes(from, minutes) ?? from.AddMinutes(Math.Max(minutes, 0));

    public static double MinutesBetween(BusinessCalendar? cal, DateTimeOffset from, DateTimeOffset to) =>
        cal?.BusinessMinutesBetween(from, to) ?? Math.Max(0, (to - from).TotalMinutes);

    public static DateTimeOffset LifecycleBoundary(BusinessCalendar? cal, DateTimeOffset since, int days) =>
        cal?.LifecycleBoundary(since, days) ?? BusinessCalendar.LifecycleBoundaryDefault(since, days);
}
