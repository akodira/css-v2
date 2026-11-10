using System.IdentityModel.Tokens.Jwt;
using System.Threading.RateLimiting;
using Ccs.Api.Controllers;
using Ccs.Api.Middleware;
using Ccs.Application.Abstractions;
using Ccs.Infrastructure;
using Ccs.Infrastructure.Identity;
using Ccs.Infrastructure.Jobs;
using Hangfire;
using Hangfire.Dashboard;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.IdentityModel.Tokens;
using Serilog;

// Server command for the installer (first administrator); does not start the web server.
if (args.Length > 0 && args[0] is "create-admin" or "import-supabase")
{
    try { Environment.ExitCode = args[0] == "create-admin" ? await Ccs.Api.AdminSetup.RunAsync(args) : await Ccs.Api.SupabaseImport.RunAsync(args); }
    catch (Exception e) { Console.Error.WriteLine(e.Message); Environment.ExitCode = 1; }
    return;
}

var builder = WebApplication.CreateBuilder(args);

// ---- Logging: Serilog to rolling files (spec 10) -------------------------------------------------
builder.Host.UseSerilog((ctx, lc) => lc.ReadFrom.Configuration(ctx.Configuration).Enrich.FromLogContext());

// ---- Services --------------------------------------------------------------------------------
var runJobs = builder.Configuration.GetValue("Jobs:Enabled", true);
builder.Services.AddCcsInfrastructure(builder.Configuration, runJobs);
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, HttpCurrentUser>();
builder.Services.AddScoped<CaptchaVerifier>();
builder.Services.AddHttpClient("captcha", c => c.Timeout = TimeSpan.FromSeconds(10));
builder.Services.AddExceptionHandler<AppExceptionHandler>();
builder.Services.AddProblemDetails();
builder.Services.AddControllers().AddJsonOptions(o => o.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase);

var jwt = builder.Configuration.GetSection(JwtOptions.Section).Get<JwtOptions>() ?? new JwtOptions();
if (string.IsNullOrWhiteSpace(jwt.SigningKey) || Convert.FromBase64String(jwt.SigningKey).Length < 32)
    throw new InvalidOperationException("Jwt:SigningKey must be at least 32 random bytes (base64). Set it in the environment.");

JwtSecurityTokenHandler.DefaultMapInboundClaims = false;   // keep "sub", "aal", "purpose" as they are
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.MapInboundClaims = false;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = jwt.Issuer, ValidAudience = jwt.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Convert.FromBase64String(jwt.SigningKey)),
            ValidateIssuer = true, ValidateAudience = true, ValidateLifetime = true, ValidateIssuerSigningKey = true,
            ClockSkew = TimeSpan.FromSeconds(30),
            RoleClaimType = System.Security.Claims.ClaimTypes.Role, NameClaimType = JwtRegisteredClaimNames.Sub,
        };
    });
builder.Services.AddAuthorization(o =>
{
    // A normal session: any valid token EXCEPT the 5-minute "purpose=mfa" step token.
    o.DefaultPolicy = new AuthorizationPolicyBuilder(JwtBearerDefaults.AuthenticationScheme)
        .RequireAuthenticatedUser()
        .RequireAssertion(c => !c.User.HasClaim(x => x.Type == CcsClaims.Purpose))
        .Build();
    o.AddPolicy("MfaStep", p => p.RequireAuthenticatedUser().RequireClaim(CcsClaims.Purpose, "mfa"));
});

// ---- Rate limiting: per person (or IP when anonymous). Database counters in the services do the business limits. ----
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    static string Key(HttpContext h) => h.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? h.Connection.RemoteIpAddress?.ToString() ?? "anon";
    o.AddPolicy("auth", h => RateLimitPartition.GetSlidingWindowLimiter(Key(h), _ => new SlidingWindowRateLimiterOptions
        { PermitLimit = 20, Window = TimeSpan.FromMinutes(5), SegmentsPerWindow = 5, QueueLimit = 0 }));
    o.AddPolicy("writes", h => RateLimitPartition.GetFixedWindowLimiter(Key(h), _ => new FixedWindowRateLimiterOptions
        { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy("uploads", h => RateLimitPartition.GetFixedWindowLimiter(Key(h), _ => new FixedWindowRateLimiterOptions
        { PermitLimit = 60, Window = TimeSpan.FromMinutes(10), QueueLimit = 0 }));   // spec 3: 60 uploads per 10 minutes
});

// Two-domain hosting only (open decision #2): allow exactly the Angular address.
var webOrigin = builder.Configuration["Cors:WebOrigin"];
if (!string.IsNullOrWhiteSpace(webOrigin))
    builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins(webOrigin).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

builder.Services.AddHealthChecks().AddSqlServer(builder.Configuration.GetConnectionString("Ccs")!, name: "sql");
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "CCS v2 API", Version = "v1" });
    var xml = Path.Combine(AppContext.BaseDirectory, "Ccs.Api.xml");
    if (File.Exists(xml)) c.IncludeXmlComments(xml);
});
builder.Services.AddHsts(o => { o.MaxAge = TimeSpan.FromDays(365); o.IncludeSubDomains = true; });

var app = builder.Build();

// Hosted in IIS as the /api application inside the web site (no reverse proxy). IIS hands the app PathBase=/api;
// put it back into the path so the routes stay "api/...", the same as when the API runs on its own.
app.Use((ctx, next) =>
{
    if (ctx.Request.PathBase.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase))
    {
        ctx.Request.Path = ctx.Request.PathBase.Add(ctx.Request.Path);
        ctx.Request.PathBase = PathString.Empty;
    }
    return next();
});
app.UseRouting();   // explicit: routing must run AFTER the path fix above (otherwise it is added first and matches nothing)

// ---- Pipeline --------------------------------------------------------------------------------
app.UseForwardedHeaders(new ForwardedHeadersOptions { ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto });
app.UseExceptionHandler();
if (!app.Environment.IsDevelopment()) app.UseHsts();
app.UseHttpsRedirection();
app.Use(async (ctx, next) =>
{
    ctx.Response.Headers.XContentTypeOptions = "nosniff";
    ctx.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    ctx.Response.Headers.XFrameOptions = "DENY";
    await next();
});
app.UseSerilogRequestLogging(o => o.GetLevel = (ctx, _, ex) =>
    ex is Ccs.Application.Common.AppException ? Serilog.Events.LogEventLevel.Information          // business answers (400/403/404/409), not faults
    : ex is not null || ctx.Response.StatusCode >= 500 ? Serilog.Events.LogEventLevel.Error : Serilog.Events.LogEventLevel.Information);
if (!string.IsNullOrWhiteSpace(webOrigin)) app.UseCors();
app.UseAuthentication();
app.UseRateLimiter();
app.UseMiddleware<AccountGateMiddleware>();
app.UseAuthorization();

if (app.Environment.IsDevelopment() || app.Configuration.GetValue("Swagger:Enabled", false))
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.MapControllers();
app.MapHealthChecks("/api/health");
if (runJobs)
{
    app.MapHangfireDashboard("/api/jobs", new DashboardOptions { Authorization = [new LocalOnlyDashboardFilter()] });
    CcsJobs.Schedule(app.Services.GetRequiredService<IRecurringJobManager>());
}

app.Run();

/// <summary>The Hangfire dashboard is reachable only from the server itself (RDP to the box to look at jobs).</summary>
sealed class LocalOnlyDashboardFilter : IDashboardAuthorizationFilter
{
    public bool Authorize(DashboardContext context) => context.GetHttpContext().Connection.RemoteIpAddress is { } ip && System.Net.IPAddress.IsLoopback(ip);
}

public partial class Program;
