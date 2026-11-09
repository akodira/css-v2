using System.Text.Json;
using Ccs.Application.Abstractions;
using Ccs.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Application.Settings;

/// <summary>Typed reads of ccs.app_settings (key/value JSON rows). Cached for the request.</summary>
public sealed class SettingsService(ICcsDbContext db)
{
    private Dictionary<string, string>? _cache;

    private async Task<Dictionary<string, string>> AllAsync(CancellationToken ct)
        => _cache ??= await db.AppSettings.AsNoTracking().ToDictionaryAsync(s => s.Key, s => s.Value, ct);

    public async Task<int> GetIntAsync(string key, int fallback, CancellationToken ct = default)
    {
        var all = await AllAsync(ct);
        if (!all.TryGetValue(key, out var raw)) return fallback;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            return doc.RootElement.ValueKind switch
            {
                JsonValueKind.Number => doc.RootElement.GetInt32(),
                JsonValueKind.String when int.TryParse(doc.RootElement.GetString(), out var v) => v,
                _ => fallback,
            };
        }
        catch (JsonException) { return fallback; }
    }

    public async Task<bool> GetBoolAsync(string key, bool fallback, CancellationToken ct = default)
    {
        var all = await AllAsync(ct);
        if (!all.TryGetValue(key, out var raw)) return fallback;
        return raw.Trim() switch { "true" => true, "false" => false, _ => fallback };
    }

    public async Task SetAsync(string key, object value, CancellationToken ct = default)
    {
        var json = JsonSerializer.Serialize(value);
        var row = await db.AppSettings.FirstOrDefaultAsync(s => s.Key == key, ct);
        if (row is null) db.AppSettings.Add(new() { Key = key, Value = json });
        else row.Value = json;
        _cache = null;
    }

    public async Task<PasswordPolicy> GetPasswordPolicyAsync(CancellationToken ct = default) => new(
        MinLength: await GetIntAsync("password_min_length", 10, ct),
        RequireUpper: await GetBoolAsync("password_require_upper", true, ct),
        RequireLower: await GetBoolAsync("password_require_lower", true, ct),
        RequireNumber: await GetBoolAsync("password_require_number", true, ct),
        RequireSpecial: await GetBoolAsync("password_require_special", true, ct),
        ExpiryEnabled: await GetBoolAsync("password_expiry_enabled", false, ct),
        ExpiryDays: await GetIntAsync("password_expiry_days", 90, ct),
        Warn1Days: await GetIntAsync("password_warn_1_days", 7, ct),
        Warn2Days: await GetIntAsync("password_warn_2_days", 4, ct),
        Warn3Days: await GetIntAsync("password_warn_3_days", 1, ct));
}
