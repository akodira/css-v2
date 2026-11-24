using System.Text.RegularExpressions;

namespace Ccs.Domain.Rules;

/// <summary>
/// Ticket number, e.g. INC-26-0073: the parts in order, always joined by the separator. Edited under Settings → System.
/// Parts: type (ticket type code, or the prefix when the type has none), prefix, yy, yyyy, mm, seq (the shared counter).
/// The longest possible number (4+6+4+2+8 characters + 4 separators) fits the 30-character column.
/// </summary>
public sealed record TicketNumberFormat(string[] Parts, string Separator, string Prefix, int Digits, string Reset)
{
    public static readonly string[] KnownParts = ["type", "prefix", "yy", "yyyy", "mm", "seq"];
    public static readonly string[] Separators = ["-", "/", ".", "_"];
    public static readonly string[] Resets = ["yearly", "monthly", "never"];
    public static readonly TicketNumberFormat Default = new(["type", "yy", "seq"], "-", "CTS", 4, "yearly");

    public static TicketNumberFormat Normalize(string[]? parts, string? separator, string? prefix, int digits, string? reset) => new(
        (parts ?? []).Select(p => (p ?? "").Trim().ToLowerInvariant()).ToArray(),
        (separator ?? "").Trim(), (prefix ?? "").Trim().ToUpperInvariant(), digits, (reset ?? "").Trim().ToLowerInvariant());

    /// <summary>Null when valid, else the error key: part, dup, seq, year, month, separator, prefix, digits, reset.</summary>
    public string? Validate()
    {
        if (Parts.Any(p => !KnownParts.Contains(p))) return "part";
        if (Parts.Count(p => p == "seq") != 1) return "seq";
        if (Parts.Distinct().Count() != Parts.Length || (Parts.Contains("yy") && Parts.Contains("yyyy"))) return "dup";
        if (!Resets.Contains(Reset)) return "reset";
        var hasYear = Parts.Contains("yy") || Parts.Contains("yyyy");
        if (Reset == "yearly" && !hasYear) return "year";
        if (Reset == "monthly" && !(hasYear && Parts.Contains("mm"))) return "month";
        if (!Separators.Contains(Separator)) return "separator";
        if (Prefix.Length is < 1 or > 6 || !Prefix.All(char.IsAsciiLetterOrDigit)) return "prefix";
        if (Digits is < 3 or > 8) return "digits";
        return null;
    }

    public string Render(string? typeCode, DateTimeOffset at, int seq)
    {
        var d = at.UtcDateTime;
        return string.Join(Separator, Parts.Select(p => p switch
        {
            "type" => string.IsNullOrWhiteSpace(typeCode) ? Prefix : typeCode,
            "prefix" => Prefix,
            "yy" => (d.Year % 100).ToString("D2"),
            "yyyy" => d.Year.ToString("D4"),
            "mm" => d.Month.ToString("D2"),
            "seq" => seq.ToString("D" + Digits),
            _ => "",
        }));
    }

    /// <summary>Key of the counter row: the year, year*100+month, or 0 when the counter never restarts.</summary>
    public int PeriodKey(DateTimeOffset at)
    {
        var d = at.UtcDateTime;
        return Reset switch { "monthly" => d.Year * 100 + d.Month, "never" => 0, _ => d.Year };
    }
}

/// <summary>Ticket type code used in the ticket number: 2 to 4 letters A–Z.</summary>
public static class TicketTypeCode
{
    public static string? Normalize(string? code) => string.IsNullOrWhiteSpace(code) ? null : code.Trim().ToUpperInvariant();
    public static bool IsValid(string? code) => code is null || (code.Length is >= 2 and <= 4 && code.All(char.IsAsciiLetterUpper));
}

/// <summary>
/// The mobile number format from Settings → System: country code, how many digits people type locally, and what the
/// local number starts with. Stored as the country code plus the local number without its leading 0
/// (Egypt: 01001234567 → +201001234567).
/// </summary>
public sealed record PhoneFormat(string Country, string CountryCode, int Length, IReadOnlyList<string> Starts)
{
    public static readonly PhoneFormat Default = new("EG", "+20", 11, ["01"]);

    private string CodeDigits => CountryCode.TrimStart('+');

    /// <summary>Null when valid, else the field in error: countryCode, length or starts.</summary>
    public string? Validate()
    {
        if (!Regex.IsMatch(CountryCode, @"^\+[1-9][0-9]{0,3}$")) return "countryCode";
        if (Length is < 4 or > 15) return "length";
        if (Starts.Count > 10 || Starts.Any(s => !Regex.IsMatch(s, @"^[0-9]{1,5}$") || s.Length >= Length)) return "starts";
        if (Country.Length != 0 && !Regex.IsMatch(Country, "^[A-Z]{2}$")) return "countryCode";
        return null;
    }

    public static PhoneFormat Normalize(string? country, string? code, int length, IEnumerable<string?>? starts)
    {
        var c = (code ?? "").Trim().Replace(" ", "");
        if (c.Length > 0 && !c.StartsWith('+')) c = "+" + c;
        var s = (starts ?? []).Select(x => (x ?? "").Trim()).Where(x => x.Length > 0).Distinct().ToArray();
        return new((country ?? "").Trim().ToUpperInvariant(), c, length, s);
    }

    private bool LocalOk(string local) => local.Length == Length && (Starts.Count == 0 || Starts.Any(local.StartsWith));

    /// <summary>The local number as people type it (digits only), or null when the input does not fit the format.
    /// Accepts the local form, or the international one with +, 00 or just the country code in front.</summary>
    public string? Local(string? input)
    {
        if (string.IsNullOrWhiteSpace(input) || input.Contains('@')) return null;
        var t = input.Trim();
        if (!Regex.IsMatch(t, @"^\+?[0-9 ()\-.]+$")) return null;
        var plus = t.StartsWith('+');
        var d = Regex.Replace(t, @"\D", "");
        if (!plus && LocalOk(d)) return d;
        if (!plus && d.StartsWith("00")) { d = d[2..]; plus = true; }
        if (d.StartsWith(CodeDigits))
        {
            var rest = d[CodeDigits.Length..];
            if (LocalOk(rest)) return rest;
            if (LocalOk("0" + rest)) return "0" + rest;
        }
        return null;
    }

    /// <summary>What is stored: +{code}{local without one leading 0}; null when the input does not fit.</summary>
    public string? Normalize(string? input) => Local(input) is string l ? CountryCode + (l.StartsWith('0') ? l[1..] : l) : null;

    public bool LooksLikePhone(string input) => Normalize(input) is not null;
}

public sealed record PasswordPolicy(int MinLength = 10, bool RequireUpper = true, bool RequireLower = true,
    bool RequireNumber = true, bool RequireSpecial = true, bool ExpiryEnabled = false, int ExpiryDays = 90,
    int Warn1Days = 7, int Warn2Days = 4, int Warn3Days = 1)
{
    /// <summary>Returns the codes of every unmet rule (empty = valid). Codes match the front-end messages.</summary>
    public IReadOnlyList<string> Check(string password)
    {
        var errors = new List<string>();
        if (password.Length < MinLength) errors.Add("min_length");
        if (RequireUpper && !password.Any(char.IsUpper)) errors.Add("upper");
        if (RequireLower && !password.Any(char.IsLower)) errors.Add("lower");
        if (RequireNumber && !password.Any(char.IsDigit)) errors.Add("number");
        if (RequireSpecial && password.All(char.IsLetterOrDigit)) errors.Add("special");
        return errors;
    }

    /// <summary>Port of password_expiry_tick() staging: 0 none, 1/2/3 warnings, 4 expired.</summary>
    public int Stage(DateTimeOffset changedAt, DateTimeOffset now)
    {
        if (!ExpiryEnabled) return 0;
        var left = (changedAt.AddDays(ExpiryDays) - now).TotalDays;
        if (left <= 0) return 4;
        if (left <= Warn3Days) return 3;
        if (left <= Warn2Days) return 2;
        if (left <= Warn1Days) return 1;
        return 0;
    }
}

/// <summary>Links allowed in system messages, menus and emails: https, mailto, tel and site paths (spec 5).</summary>
public static partial class SafeLink
{
    [GeneratedRegex(@"^(/[A-Za-z0-9/_?=&#.%-]*|https://[^\s<>""']+|mailto:[^\s<>""']+|tel:[+0-9 ()-]+)$")]
    private static partial Regex Allowed();

    public static bool IsAllowed(string? href) => href is not null && href.Length <= 300 && Allowed().IsMatch(href) && !href.StartsWith("//");
}
