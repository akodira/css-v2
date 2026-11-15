using System.Text.Json;

namespace Ccs.Infrastructure.Email;

/// <summary>Website and social links from Settings → Branding (site_settings.social_links), in a fixed order.</summary>
public static class SocialLinks
{
    public static readonly string[] Kinds = ["web", "linkedin", "youtube", "facebook", "x"];

    /// <summary>The links that are switched on and filled in, as (kind, url).</summary>
    public static List<(string Kind, string Url)> Parse(string? json)
    {
        var list = new List<(string, string)>();
        if (string.IsNullOrWhiteSpace(json)) return list;
        try
        {
            using var doc = JsonDocument.Parse(json);
            foreach (var k in Kinds)
                if (doc.RootElement.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Object
                    && v.TryGetProperty("on", out var on) && on.ValueKind == JsonValueKind.True
                    && v.TryGetProperty("url", out var u) && u.GetString() is { Length: > 0 } url)
                    list.Add((k, url));
        }
        catch (JsonException) { }
        return list;
    }
}
