using System.Text.Json;

namespace Ccs.Domain.Rules;

/// <summary>
/// Audit log for people who are not administrators (security audit M-07): they see who did what and when, and the
/// names of the fields that changed, but never the old and new values (names, emails, phone numbers, settings).
/// </summary>
public static class AuditFields
{
    private static readonly HashSet<string> Ignored = ["updated_at", "created_at", "id"];

    /// <summary>Names of the fields whose value differs between the two JSON objects (same rule as the audit page).</summary>
    public static IReadOnlyList<string> Changed(string? before, string? after)
    {
        var b = Parse(before);
        var a = Parse(after);
        return b.Keys.Union(a.Keys)
            .Where(k => !Ignored.Contains(k))
            .Where(k => (b.TryGetValue(k, out var x) ? x : "null") != (a.TryGetValue(k, out var y) ? y : "null"))
            .ToList();
    }

    private static Dictionary<string, string> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return [];
            var d = new Dictionary<string, string>();
            foreach (var p in doc.RootElement.EnumerateObject()) d[p.Name] = p.Value.GetRawText();
            return d;
        }
        catch (JsonException) { return []; }
    }
}
