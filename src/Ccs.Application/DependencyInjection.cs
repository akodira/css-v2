using Ccs.Application.Abstractions;
using Ccs.Application.Access;
using Ccs.Application.Common;
using Ccs.Application.Notifications;
using Ccs.Application.Settings;
using Ccs.Application.Sla;
using Ccs.Application.Tickets;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Ccs.Application;

public static class DependencyInjection
{
    /// <summary>All application services are scoped: one instance (and one AccessContext) per request or job run.</summary>
    public static IServiceCollection AddCcsApplication(this IServiceCollection services)
    {
        services.TryAddSingleton<IClock, SystemClock>();
        services.AddScoped<SettingsService>();
        services.AddScoped<AccessService>();
        services.AddScoped<AuditService>();
        services.AddScoped<NotificationService>();
        services.AddScoped<CalendarProvider>();
        services.AddScoped<SlaService>();
        services.AddScoped<LifecycleService>();
        services.AddScoped<TicketService>();
        services.AddScoped<TicketLifecycleService>();
        services.AddScoped<TicketQueries>();
        services.AddScoped<CatalogQueries>();
        return services;
    }
}
