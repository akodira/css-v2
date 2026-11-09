using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Ccs.Application.Common;
using Ccs.Domain.Entities;

namespace Ccs.Application.Tickets;

/// <summary>
/// custom_value_check trigger: required, type, range, length, pattern and choices (spec 3, custom fields).
/// Values travel as JSON elements, stored as JSON text in ticket_custom_field_values.value.
/// </summary>
public static class CustomFieldValidator
{
    public static bool IsEmpty(JsonElement? v) =>
        v is null || v.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined
        || (v.Value.ValueKind == JsonValueKind.String && string.IsNullOrWhiteSpace(v.Value.GetString()))
        || (v.Value.ValueKind == JsonValueKind.Array && v.Value.GetArrayLength() == 0);

    /// <summary>Throws ValidationFailedException naming the field key, like the PostgreSQL message.</summary>
    public static string Validate(CustomFieldDefinition f, JsonElement value)
    {
        var rules = JsonDocument.Parse(string.IsNullOrWhiteSpace(f.Validation) ? "{}" : f.Validation).RootElement;
        var choices = ParseChoices(f.Options);
        void Fail(string why) => throw new ValidationFailedException($"field {f.Key} {why}", f.Key);

        switch (f.Type)
        {
            case "text":
            case "long_text":
            {
                if (value.ValueKind != JsonValueKind.String) Fail("must be text");
                var s = value.GetString()!;
                if (Int(rules, "min_length") is int min && s.Length < min) Fail($"must be at least {min} characters");
                var max = Int(rules, "max_length") ?? (f.Type == "text" ? 500 : 5000);
                if (s.Length > max) Fail($"must be at most {max} characters");
                if (Str(rules, "pattern") is string pat && pat.Length > 0
                    && !Regex.IsMatch(s, pat, RegexOptions.None, TimeSpan.FromMilliseconds(100))) Fail("has an invalid format");
                break;
            }
            case "number":
            {
                double n;
                if (value.ValueKind == JsonValueKind.Number) n = value.GetDouble();
                else if (value.ValueKind == JsonValueKind.String && double.TryParse(value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var p)) n = p;
                else { Fail("must be a number"); return ""; }
                if (Num(rules, "min") is double lo && n < lo) Fail($"must be at least {lo}");
                if (Num(rules, "max") is double hi && n > hi) Fail($"must be at most {hi}");
                return JsonSerializer.Serialize(n);
            }
            case "date":
                if (value.ValueKind != JsonValueKind.String || !DateOnly.TryParseExact(value.GetString(), "yyyy-MM-dd", out _)) Fail("must be a date");
                break;
            case "checkbox":
                if (value.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) Fail("must be true or false");
                break;
            case "dropdown":
            case "radio":
                if (value.ValueKind != JsonValueKind.String || !choices.Contains(value.GetString()!)) Fail("must be one of the choices");
                break;
            case "multi_select":
                if (value.ValueKind != JsonValueKind.Array) Fail("must be a list");
                foreach (var item in value.EnumerateArray())
                    if (item.ValueKind != JsonValueKind.String || !choices.Contains(item.GetString()!)) Fail("must be one of the choices");
                break;
            case "file":
                if (value.ValueKind != JsonValueKind.String) Fail("must be an uploaded file");
                break;
            default:
                Fail("has an unknown type");
                break;
        }
        return value.GetRawText();
    }

    /// <summary>Options are stored as ["a","b"] or [{"value":"a","label_en":..}]; accept both.</summary>
    public static HashSet<string> ParseChoices(string optionsJson)
    {
        var set = new HashSet<string>();
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(optionsJson) ? "[]" : optionsJson);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return set;
        foreach (var o in doc.RootElement.EnumerateArray())
        {
            if (o.ValueKind == JsonValueKind.String) set.Add(o.GetString()!);
            else if (o.ValueKind == JsonValueKind.Object && o.TryGetProperty("value", out var v) && v.ValueKind == JsonValueKind.String) set.Add(v.GetString()!);
        }
        return set;
    }

    private static int? Int(JsonElement r, string k) => r.TryGetProperty(k, out var v) && v.TryGetInt32(out var i) ? i : null;
    private static double? Num(JsonElement r, string k) => r.TryGetProperty(k, out var v) && v.TryGetDouble(out var d) ? d : null;
    private static string? Str(JsonElement r, string k) => r.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
