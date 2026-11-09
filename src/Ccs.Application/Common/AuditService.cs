using System.Text.Json;
using Ccs.Application.Abstractions;
using Ccs.Domain.Entities;

namespace Ccs.Application.Common;

/// <summary>write_audit() and the audit_config_change trigger: one row per key action, with before/after values.</summary>
public sealed class AuditService(ICcsDbContext db, ICurrentUser current, IClock clock)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    /// <summary>Adds the row to the current unit of work; it is saved with the change it describes.</summary>
    public void Write(string action, string entityType, Guid? entityId, object? before, object? after, Guid? actorOverride = null)
    {
        db.AuditLogs.Add(new AuditLog
        {
            ActorId = actorOverride ?? current.UserId,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            Before = before is null ? null : JsonSerializer.Serialize(before, Json),
            After = after is null ? null : JsonSerializer.Serialize(after, Json),
            IpAddress = current.IpAddress,
            CreatedAt = clock.UtcNow,
        });
    }
}
