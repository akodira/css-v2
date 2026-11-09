using System.Text.RegularExpressions;

namespace Ccs.Domain.Rules;

public static partial class TicketReference
{
    /// <summary>CTS-2026-000073: prefix, year, running number per year.</summary>
    public static string Format(int year, int number, string prefix = "CTS") => $"{prefix}-{year}-{number:D6}";
}

/// <summary>Egyptian mobile numbers: "+2" then 11 digits; the "+2" may be left out (spec 5).</summary>
public static partial class EgyptPhone
{
    [GeneratedRegex(@"^(?:\+?2)?(01[0-9]{9})$")]
    private static partial Regex Pattern();

    /// <summary>Returns +201xxxxxxxxx, or null when the input is not an Egyptian mobile number.</summary>
    public static string? Normalize(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        var digits = input.Trim().Replace(" ", "").Replace("-", "");
        var m = Pattern().Match(digits);
        return m.Success ? "+2" + m.Groups[1].Value : null;
    }

    public static bool LooksLikePhone(string input) => !input.Contains('@') && Normalize(input) is not null;
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
