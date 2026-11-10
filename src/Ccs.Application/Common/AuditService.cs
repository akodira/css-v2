using System.Text.Json;
using Ccs.Application.Abstractions;
using Ccs.Domain.Entities;

namespace Ccs.Application.Common;

/// <summary>write_audit() and the audit_config_change trigger: one row per key action, with before/after values.</summary>
public sealed class AuditService(ICcsDbContext db, ICurrentUser current, IClock clock)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    /// <summary>Objects are serialized; a string that already holds a JSON object or array is stored as it is.</summary>
    private static string? ToJson(object? v)
    {
        if (v is null) return null;
        if (v is string s)
        {
            var t = s.TrimStart();
            if (t.StartsWith('{') || t.StartsWith('['))
            {
                try { using var _ = JsonDocument.Parse(s); return s; } catch (JsonException) { }
            }
            return JsonSerializer.Serialize(new { value = s }, Json);
        }
        return JsonSerializer.Serialize(v, Json);
    }

    /// <summary>Adds the row to the current unit of work; it is saved with the change it describes.</summary>
    public void Write(string action, string entityType, Guid? entityId, object? before, object? after, Guid? actorOverride = null)
    {
        db.AuditLogs.Add(new AuditLog
        {
            ActorId = actorOverride ?? current.UserId,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            Before = ToJson(before),
            After = ToJson(after),
            IpAddress = current.IpAddress,
            CreatedAt = clock.UtcNow,
        });
    }
}
