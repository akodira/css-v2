using Ccs.Application;
using Ccs.Application.Abstractions;
using Ccs.Infrastructure.Email;
using Ccs.Infrastructure.Files;
using Ccs.Infrastructure.Identity;
using Ccs.Infrastructure.Jobs;
using Ccs.Infrastructure.Persistence;
using Hangfire;
using Hangfire.SqlServer;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Ccs.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddCcsInfrastructure(this IServiceCollection services, IConfiguration config, bool runJobs)
    {
        var cs = config.GetConnectionString("Ccs") ?? throw new InvalidOperationException("ConnectionStrings:Ccs is missing.");

        services.AddDbContext<CcsDbContext>(o => o.UseSqlServer(cs, sql =>
        {
            // No retrying strategy: SQL Server runs on the same machine, and a retrying strategy
            // rejects the explicit transactions used by ticket and admin changes.
            sql.CommandTimeout(60);
        }));
        services.AddScoped<ICcsDbContext>(sp => sp.GetRequiredService<CcsDbContext>());

        // Identity: stores in SQL Server, our bcrypt-aware hasher, password rules from settings.
        services.AddIdentityCore<AppUser>(o =>
            {
                o.User.RequireUniqueEmail = true;
                o.SignIn.RequireConfirmedEmail = true;
                o.Lockout.MaxFailedAccessAttempts = 10;
                o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
                // Length/character rules come from SettingsPasswordValidator (editable in Admin).
                o.Password.RequiredLength = 1;
                o.Password.RequireDigit = o.Password.RequireLowercase = o.Password.RequireUppercase = o.Password.RequireNonAlphanumeric = false;
                o.Password.RequiredUniqueChars = 1;
            })
            .AddRoles<IdentityRole<Guid>>()
            .AddEntityFrameworkStores<CcsDbContext>()
            .AddDefaultTokenProviders()
            .AddPasswordValidator<SettingsPasswordValidator>();
        services.AddScoped<IPasswordHasher<AppUser>, BcryptCompatiblePasswordHasher>();
        services.AddScoped<IMfaStatus, MfaStatus>();

        // Data Protection keys on disk (same folder for every API instance) - protects SMTP and captcha secrets.
        var keys = config["DataProtection:KeysFolder"];
        var dp = services.AddDataProtection().SetApplicationName("ccs-v2");
        if (!string.IsNullOrWhiteSpace(keys))
        {
            dp.PersistKeysToFileSystem(new DirectoryInfo(keys));
            // Production (Windows Server): keys at rest are encrypted with machine DPAPI. CI runs on Linux, where DPAPI does not exist.
            if (OperatingSystem.IsWindows()) dp.ProtectKeysWithDpapi(protectToLocalMachine: true);
        }

        services.Configure<JwtOptions>(config.GetSection(JwtOptions.Section));
        services.Configure<FileStoreOptions>(config.GetSection(FileStoreOptions.Section));
        services.Configure<AppUrlOptions>(config.GetSection(AppUrlOptions.Section));

        services.AddScoped<TokenService>();
        services.AddScoped<AuthService>();
        services.AddScoped<TemplateMailer>();
        services.AddScoped<IEmailSender, SmtpEmailSender>();
        services.AddScoped<EmailDispatcher>();
        services.AddSingleton<LocalFileStore>();
        services.AddSingleton<IFileStore>(sp => sp.GetRequiredService<LocalFileStore>());
        services.AddSingleton<IFileScanner, DefenderFileScanner>();
        services.AddScoped<CcsJobs>();

        services.AddCcsApplication();

        services.AddHangfire(h => h
            .SetDataCompatibilityLevel(CompatibilityLevel.Version_180)
            .UseSimpleAssemblyNameTypeSerializer()
            .UseRecommendedSerializerSettings()
            .UseSqlServerStorage(cs, new SqlServerStorageOptions
            {
                SchemaName = "HangFire",
                PrepareSchemaIfNecessary = true,
                QueuePollInterval = TimeSpan.FromSeconds(15),
            }));
        // On a web farm run the worker in exactly one place (Api with Jobs:Enabled=true, or the Windows service).
        if (runJobs) services.AddHangfireServer(o => o.WorkerCount = 2);
        return services;
    }
}
