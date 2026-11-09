using Ccs.Application.Sla;
using Ccs.Infrastructure.Email;
using Hangfire;
using Microsoft.Extensions.Logging;

namespace Ccs.Infrastructure.Jobs;

/// <summary>
/// The background jobs of spec 4 and 6, on Hangfire with SQL Server storage.
/// Hangfire runs each job in its own DI scope, so services get a fresh DbContext per run.
/// </summary>
public sealed class CcsJobs(SlaService sla, LifecycleService lifecycle, EmailDispatcher emails, ILogger<CcsJobs> log)
{
    /// <summary>Every minute: SLA states, warnings, breaches (sla_tick).</summary>
    [DisableConcurrentExecution(timeoutInSeconds: 50)]
    [AutomaticRetry(Attempts = 0)]
    public async Task SlaTickAsync()
    {
        var changed = await sla.TickAsync();
        if (changed > 0) log.LogInformation("SLA tick: {Changed} state changes", changed);
    }

    /// <summary>
    /// Every 15 minutes: reminders, automatic closing, password expiry. Reminders use day boundaries at the
    /// calendar's opening time (09:00 Cairo by default), and the dedupe keys make each one fire once.
    /// </summary>
    [DisableConcurrentExecution(timeoutInSeconds: 600)]
    [AutomaticRetry(Attempts = 0)]
    public async Task LifecycleTickAsync()
    {
        var r = await lifecycle.TickAsync();
        log.LogInformation("Lifecycle tick: {@Result}", r);
    }

    /// <summary>Every minute: send queued email notifications, retrying failures.</summary>
    [DisableConcurrentExecution(timeoutInSeconds: 50)]
    [AutomaticRetry(Attempts = 0)]
    public async Task SendEmailsAsync()
    {
        var sent = await emails.RunAsync();
        if (sent > 0) log.LogInformation("Sent {Count} notification emails", sent);
    }

    public static void Schedule(IRecurringJobManager jobs)
    {
        jobs.AddOrUpdate<CcsJobs>("sla-tick", j => j.SlaTickAsync(), Cron.Minutely());
        jobs.AddOrUpdate<CcsJobs>("lifecycle-tick", j => j.LifecycleTickAsync(), "*/15 * * * *");
        jobs.AddOrUpdate<CcsJobs>("send-emails", j => j.SendEmailsAsync(), Cron.Minutely());
    }
}
