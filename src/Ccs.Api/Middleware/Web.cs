using System.IdentityModel.Tokens.Jwt;
using Ccs.Application.Abstractions;
using Ccs.Application.Common;
using Ccs.Domain;
using Ccs.Infrastructure.Identity;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Middleware;

/// <summary>The signed-in caller, from the validated JWT.</summary>
public sealed class HttpCurrentUser(IHttpContextAccessor http) : ICurrentUser
{
    public Guid? UserId =>
        http.HttpContext?.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value is string s && Guid.TryParse(s, out var id)
        && http.HttpContext.User.FindFirst(CcsClaims.Purpose) is null   // the 5-minute MFA token is not a session
            ? id : null;

    public int MfaLevel => int.TryParse(http.HttpContext?.User.FindFirst(CcsClaims.Mfa)?.Value, out var l) ? l : 1;

    public string? IpAddress => http.HttpContext?.Connection.RemoteIpAddress?.ToString();
}

/// <summary>
/// Spec 5: a suspended account loses all access immediately (checked on every request, not only at sign-in),
/// and once an authenticator is enrolled it is enforced on every request.
/// </summary>
public sealed class AccountGateMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext ctx, ICurrentUser current, CcsDbContext db)
    {
        if (current.UserId is Guid uid && !ctx.Request.Path.StartsWithSegments("/api/auth"))
        {
            var row = await db.Profiles.AsNoTracking().Where(p => p.Id == uid)
                .Select(p => new { p.AccountStatus, Mfa = db.Users.Where(u => u.Id == uid).Select(u => u.TwoFactorEnabled).FirstOrDefault() })
                .FirstOrDefaultAsync(ctx.RequestAborted);
            if (row is null || row.AccountStatus != AccountStatus.Active)
            {
                await Problem(ctx, 403, row?.AccountStatus == AccountStatus.PendingApproval ? "pendingApproval" : "suspended");
                return;
            }
            if (row.Mfa && current.MfaLevel < 2)
            {
                await Problem(ctx, 401, "mfaRequired");
                return;
            }
        }
        await next(ctx);
    }

    private static Task Problem(HttpContext ctx, int status, string code)
    {
        ctx.Response.StatusCode = status;
        return ctx.Response.WriteAsJsonAsync(new ProblemDetails { Status = status, Title = code, Extensions = { ["code"] = code } });
    }
}

/// <summary>Maps business errors to RFC 7807 responses; hides everything else behind a 500.</summary>
public sealed class AppExceptionHandler(ILogger<AppExceptionHandler> log) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext ctx, Exception ex, CancellationToken ct)
    {
        ProblemDetails pd;
        if (ex is AppException app)
        {
            pd = new ProblemDetails { Status = app.Status, Title = app.Message, Extensions = { ["code"] = app.Code } };
            var field = ex switch { ValidationFailedException v => v.Field, AuthError a => a.Field, _ => null };
            if (field is not null) pd.Extensions["field"] = field;
        }
        else if (ex is FluentValidation.ValidationException fv)
        {
            pd = new ProblemDetails { Status = 400, Title = "invalid", Extensions = { ["code"] = "invalid", ["errors"] = fv.Errors.Select(e => new { field = e.PropertyName, code = e.ErrorCode, e.ErrorMessage }) } };
        }
        else
        {
            log.LogError(ex, "Unhandled error on {Path}", ctx.Request.Path);
            pd = new ProblemDetails { Status = 500, Title = "generic", Extensions = { ["code"] = "generic", ["traceId"] = ctx.TraceIdentifier } };
        }
        ctx.Response.StatusCode = pd.Status!.Value;
        await ctx.Response.WriteAsJsonAsync(pd, ct);
        return true;
    }
}
