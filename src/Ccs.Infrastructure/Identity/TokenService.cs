using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Ccs.Application.Abstractions;
using Ccs.Domain.Entities;
using Ccs.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Ccs.Infrastructure.Identity;

public sealed class JwtOptions
{
    public const string Section = "Jwt";
    public string Issuer { get; set; } = "ccs-api";
    public string Audience { get; set; } = "ccs-web";
    /// <summary>At least 32 random bytes, base64. Set in environment / protected config, never in appsettings.json.</summary>
    public string SigningKey { get; set; } = "";
    public int AccessMinutes { get; set; } = 15;
    public int RefreshDays { get; set; } = 14;
}

public static class CcsClaims
{
    public const string Mfa = "aal";            // "1" or "2", same idea as the Supabase JWT claim
    public const string Purpose = "purpose";    // "mfa" for the short-lived second-step token
    public const string Session = "sid";        // the sign-in (refresh_tokens.session_id); ends at once when it is signed out
}

/// <summary>One sign-in: a device that holds a live refresh token. Id is the session id.</summary>
public sealed record SessionRow(Guid Id, Guid UserId, string? UserAgent, string? IpAddress, DateTimeOffset StartedAt, DateTimeOffset LastUsed, DateTimeOffset ExpiresAt);

public sealed record TokenPair(string AccessToken, DateTimeOffset AccessExpires, string RefreshToken, DateTimeOffset RefreshExpires, Guid SessionId = default);

/// <summary>Short-lived JWT access tokens plus rotating refresh tokens kept hashed in ccs.refresh_tokens.</summary>
public sealed class TokenService(IOptions<JwtOptions> options, CcsDbContext db, IClock clock)
{
    private readonly JwtOptions _o = options.Value;

    public SymmetricSecurityKey Key => new(Convert.FromBase64String(_o.SigningKey));

    public string CreateAccessToken(Guid userId, string email, IEnumerable<string> roles, int mfaLevel, out DateTimeOffset expires,
        string? purpose = null, int? minutes = null, Guid? sessionId = null)
    {
        expires = clock.UtcNow.AddMinutes(minutes ?? _o.AccessMinutes);
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(JwtRegisteredClaimNames.Email, email),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N")),
            new(CcsClaims.Mfa, mfaLevel.ToString()),
        };
        if (sessionId is Guid sid) claims.Add(new Claim(CcsClaims.Session, sid.ToString()));
        if (purpose is not null) claims.Add(new Claim(CcsClaims.Purpose, purpose));
        else claims.AddRange(roles.Select(r => new Claim(ClaimTypes.Role, r)));

        var token = new JwtSecurityToken(_o.Issuer, _o.Audience, claims, clock.UtcNow.UtcDateTime, expires.UtcDateTime,
            new SigningCredentials(Key, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <param name="previous">The row being rotated: the new row continues the same sign-in (session id and start time).</param>
    /// <param name="maxSession">Longest a sign-in lasts (Settings → Security → Sessions); the refresh token never outlives it.</param>
    public async Task<TokenPair> IssueAsync(Guid userId, string email, IEnumerable<string> roles, int mfaLevel,
        string? userAgent, string? ip, CancellationToken ct = default, RefreshToken? previous = null, TimeSpan? maxSession = null)
    {
        var now = clock.UtcNow;
        var id = Guid.NewGuid();
        var sessionId = previous is null ? id : previous.SessionId ?? previous.Id;
        var started = previous is null ? now : previous.SessionStartedAt ?? previous.CreatedAt;
        var expires = now.AddDays(_o.RefreshDays);
        if (maxSession is TimeSpan max && started + max < expires) expires = started + max;
        if (expires <= now) throw new AuthError("notSignedIn", 401);   // the sign-in reached its longest time: sign in again
        var access = CreateAccessToken(userId, email, roles, mfaLevel, out var accessExp, sessionId: sessionId);
        var raw = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
        var refresh = new RefreshToken
        {
            Id = id, UserId = userId, TokenHash = Hash(raw), MfaLevel = (byte)mfaLevel,
            CreatedAt = now, ExpiresAt = expires, SessionId = sessionId, SessionStartedAt = started,
            UserAgent = userAgent?[..Math.Min(userAgent.Length, 300)], IpAddress = ip,
        };
        if (previous is not null) previous.ReplacedBy = id;   // tracked row from ConsumeAsync
        db.RefreshTokens.Add(refresh);
        await db.SaveChangesAsync(ct);
        return new TokenPair(access, accessExp, raw, refresh.ExpiresAt, sessionId);
    }

    /// <summary>Rotates a refresh token. Reuse of a revoked token revokes the whole family (theft signal).</summary>
    public async Task<(RefreshToken Old, Guid UserId)?> ConsumeAsync(string raw, CancellationToken ct = default)
    {
        var hash = Hash(raw);
        var row = await db.RefreshTokens.FirstOrDefaultAsync(r => r.TokenHash == hash, ct);
        if (row is null) return null;
        if (row.RevokedAt is not null)
        {
            // A rotated token used again: theft signal, end every sign-in. A token whose sign-in was ended on purpose
            // (signed out, signed out by an admin, password change) just stops working.
            if (row.ReplacedBy is not null) await RevokeAllAsync(row.UserId, ct);
            return null;
        }
        if (row.ExpiresAt <= clock.UtcNow) return null;
        row.RevokedAt = clock.UtcNow;
        await db.SaveChangesAsync(ct);
        return (row, row.UserId);
    }

    public async Task RevokeAsync(string raw, CancellationToken ct = default)
    {
        var hash = Hash(raw);
        await db.RefreshTokens.Where(r => r.TokenHash == hash && r.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.RevokedAt, clock.UtcNow), ct);
    }

    /// <summary>Used on password change, suspension and MFA reset: every session ends.</summary>
    public Task RevokeAllAsync(Guid userId, CancellationToken ct = default) =>
        db.RefreshTokens.Where(r => r.UserId == userId && r.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.RevokedAt, clock.UtcNow), ct);

    /// <summary>Live sign-ins (one row per device: the newest, unrevoked, unexpired refresh token of each session).</summary>
    public async Task<List<SessionRow>> SessionsAsync(Guid? userId, CancellationToken ct = default)
    {
        var now = clock.UtcNow;
        var q = db.RefreshTokens.AsNoTracking().Where(r => r.RevokedAt == null && r.ExpiresAt > now);
        if (userId is Guid u) q = q.Where(r => r.UserId == u);
        var rows = await q.OrderByDescending(r => r.CreatedAt).Take(2000)
            .Select(r => new SessionRow(r.SessionId ?? r.Id, r.UserId, r.UserAgent, r.IpAddress, r.SessionStartedAt ?? r.CreatedAt, r.CreatedAt, r.ExpiresAt))
            .ToListAsync(ct);
        return rows.GroupBy(r => r.Id).Select(g => g.First()).ToList();
    }

    /// <summary>Is this sign-in still live? Checked on every request, so signing a device out takes effect at once.</summary>
    public Task<bool> SessionLiveAsync(Guid sessionId, CancellationToken ct = default)
    {
        var now = clock.UtcNow;
        return db.RefreshTokens.AnyAsync(r => (r.SessionId == sessionId || (r.SessionId == null && r.Id == sessionId)) && r.RevokedAt == null && r.ExpiresAt > now, ct);
    }

    /// <summary>Ends one sign-in (of this person when userId is given). False when there was no live one.</summary>
    public async Task<bool> RevokeSessionAsync(Guid sessionId, Guid? userId, CancellationToken ct = default)
    {
        var q = db.RefreshTokens.Where(r => (r.SessionId == sessionId || (r.SessionId == null && r.Id == sessionId)) && r.RevokedAt == null);
        if (userId is Guid u) q = q.Where(r => r.UserId == u);
        return await q.ExecuteUpdateAsync(x => x.SetProperty(r => r.RevokedAt, clock.UtcNow), ct) > 0;
    }

    /// <summary>Ends every sign-in of a person except one (the device asking).</summary>
    public Task<int> RevokeOthersAsync(Guid userId, Guid keepSession, CancellationToken ct = default) =>
        db.RefreshTokens.Where(r => r.UserId == userId && r.RevokedAt == null && (r.SessionId ?? r.Id) != keepSession)
            .ExecuteUpdateAsync(x => x.SetProperty(r => r.RevokedAt, clock.UtcNow), ct);

    public static string Hash(string raw) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));
}
