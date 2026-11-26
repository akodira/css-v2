using System.Text.Json;

namespace Ccs.Domain.Rules;

/// <summary>
/// Settings → Reassign tickets: whether an agent may hand over a ticket assigned to them, and to whom.
/// A branch without its own rule uses its organization's, an organization uses the one above it, and the top
/// uses the default (app setting "reassign_default"). With nothing set anywhere, reassigning is off.
/// </summary>
public sealed record ReassignRule(bool On, IReadOnlyList<string> To, bool ReasonRequired, bool Once)
{
    public const string Agents = "agents", Leader = "leader", Queue = "queue", Auto = "auto";
    public static readonly string[] Targets = [Agents, Leader, Queue, Auto];
    public static readonly ReassignRule Off = new(false, [], true, false);

    private sealed record Json(bool On, string[]? To, string? Reason, bool Once);
    private static readonly JsonSerializerOptions Opts = new(JsonSerializerDefaults.Web);

    /// <summary>Reads a stored rule; null or unreadable text means "no rule of its own".</summary>
    public static ReassignRule? Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var j = JsonSerializer.Deserialize<Json>(json, Opts);
            if (j is null) return null;
            return new ReassignRule(j.On, (j.To ?? []).Where(Targets.Contains).Distinct().ToArray(), j.Reason != "opt", j.Once);
        }
        catch (JsonException) { return null; }
    }

    public string ToJson() => JsonSerializer.Serialize(new Json(On, On ? To.ToArray() : [], ReasonRequired ? "req" : "opt", On && Once), Opts);

    /// <summary>Checks a rule an administrator saves: known targets only, and at least one when it is on.</summary>
    public static string? Problem(bool on, IEnumerable<string>? to)
    {
        var list = (to ?? []).ToList();
        if (list.Any(t => !Targets.Contains(t))) return "to";
        if (on && list.Count == 0) return "to";
        return null;
    }

    /// <summary>The rule that applies: the branch's own, else the nearest organization's (ticket's organization first), else the default.</summary>
    public static ReassignRule Resolve(string? branch, IEnumerable<string?> organizationsBottomUp, string? fallback)
    {
        if (Parse(branch) is { } b) return b;
        foreach (var o in organizationsBottomUp) if (Parse(o) is { } r) return r;
        return Parse(fallback) ?? Off;
    }
}
