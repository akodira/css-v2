using System.Text.RegularExpressions;

namespace Ccs.Domain.Rules;

/// <summary>Settings → Security extras (app_settings). Defaults are the ones the pages start with.</summary>
public sealed record SecurityExtras(
    bool HistoryEnabled = true, int HistoryCount = 5,
    int StaffMaxHours = 12, int CustomerMaxDays = 14,
    bool MfaAdmins = false, bool MfaStaff = false, bool MfaCustomers = false, int MfaSetupDays = 7,
    DateTimeOffset? MfaAdminsSince = null, DateTimeOffset? MfaStaffSince = null, DateTimeOffset? MfaCustomersSince = null,
    bool AlertsEnabled = true, bool AlertAdmins = true, int KnownDays = 90)
{
    /// <summary>Longest a sign-in lasts before signing in again: staff (and admins) in hours, customers in days.</summary>
    public TimeSpan MaxSession(string group) => group == SecurityGroups.Customers ? TimeSpan.FromDays(CustomerMaxDays) : TimeSpan.FromHours(StaffMaxHours);

    public bool MfaRequired(string group) => group switch { SecurityGroups.Admins => MfaAdmins, SecurityGroups.Staff => MfaStaff, _ => MfaCustomers };

    /// <summary>
    /// When a person who must use two-step but has not set it up is stopped: the setup days counted from when the rule
    /// was switched on, or from when the account was made if that is later. Null = not required.
    /// </summary>
    public DateTimeOffset? MfaDeadline(string group, DateTimeOffset accountCreated)
    {
        if (!MfaRequired(group)) return null;
        var since = group switch { SecurityGroups.Admins => MfaAdminsSince, SecurityGroups.Staff => MfaStaffSince, _ => MfaCustomersSince } ?? accountCreated;
        return (since > accountCreated ? since : accountCreated).AddDays(MfaSetupDays);
    }
}

public static class SecurityGroups
{
    public const string Admins = "admins", Staff = "staff", Customers = "customers";

    /// <summary>Same grouping as the sign-in codes: admin role, any other staff role, or customer only.</summary>
    public static string Of(IReadOnlyCollection<string> roles) =>
        roles.Contains(RoleCode.Admin) ? Admins : roles.Any(r => r != RoleCode.Customer) ? Staff : Customers;
}

/// <summary>Plain names for devices and addresses on the sessions pages and in sign-in alerts.</summary>
public static partial class DeviceInfo
{
    /// <summary>"Chrome on Windows", "Safari on iPhone"… from a browser's user agent; versions are ignored on purpose.</summary>
    public static string Label(string? userAgent)
    {
        var ua = userAgent ?? "";
        if (ua.Length == 0) return "Unknown device";
        string browser =
            ua.Contains("Edg/") || ua.Contains("EdgA/") || ua.Contains("EdgiOS/") ? "Edge" :
            ua.Contains("OPR/") || ua.Contains("Opera") ? "Opera" :
            ua.Contains("SamsungBrowser/") ? "Samsung Internet" :
            ua.Contains("Firefox/") || ua.Contains("FxiOS/") ? "Firefox" :
            ua.Contains("Chrome/") || ua.Contains("CriOS/") ? "Chrome" :
            ua.Contains("Safari/") ? "Safari" :
            ua.StartsWith("Mozilla/", StringComparison.Ordinal) ? "Browser" : "App";
        string os =
            ua.Contains("iPhone") ? "iPhone" : ua.Contains("iPad") ? "iPad" :
            ua.Contains("Android") ? "Android" :
            ua.Contains("Windows") ? "Windows" :
            ua.Contains("Mac OS X") || ua.Contains("Macintosh") ? "Mac" :
            ua.Contains("CrOS") ? "ChromeOS" : ua.Contains("Linux") ? "Linux" : "";
        return os.Length == 0 ? browser : $"{browser} on {os}";
    }

    /// <summary>"41.233.x.x" / "2a02:…": enough to recognise a network, not the full address.</summary>
    public static string MaskIp(string? ip)
    {
        if (string.IsNullOrWhiteSpace(ip)) return "";
        if (ip.StartsWith("::ffff:", StringComparison.Ordinal)) ip = ip[7..];
        var m = Ipv4().Match(ip);
        if (m.Success) return $"{m.Groups[1].Value}.{m.Groups[2].Value}.x.x";
        var parts = ip.Split(':', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length >= 2 ? $"{parts[0]}:{parts[1]}:…" : ip;
    }

    [GeneratedRegex(@"^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$")]
    private static partial Regex Ipv4();
}
