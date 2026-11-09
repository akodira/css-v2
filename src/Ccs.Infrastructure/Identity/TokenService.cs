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
}

public sealed record TokenPair(string AccessToken, DateTimeOffset AccessExpires, string RefreshToken, DateTimeOffset RefreshExpires);

/// <summary>Short-lived JWT access tokens plus rotating refresh tokens kept hashed in ccs.refresh_tokens.</summary>
public sealed class TokenService(IOptions<JwtOptions> options, CcsDbContext db, IClock clock)
{
    private readonly JwtOptions _o = options.Value;

    public SymmetricSecurityKey Key => new(Convert.FromBase64String(_o.SigningKey));

    public string CreateAccessToken(Guid userId, string email, IEnumerable<string> roles, int mfaLevel, out DateTimeOffset expires,
        string? purpose = null, int? minutes = null)
    {
        expires = clock.UtcNow.AddMinutes(minutes ?? _o.AccessMinutes);
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(JwtRegisteredClaimNames.Email, email),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N")),
            new(CcsClaims.Mfa, mfaLevel.ToString()),
        };
        if (purpose is not null) claims.Add(new Claim(CcsClaims.Purpose, purpose));
        else claims.AddRange(roles.Select(r => new Claim(ClaimTypes.Role, r)));

        var token = new JwtSecurityToken(_o.Issuer, _o.Audience, claims, clock.UtcNow.UtcDateTime, expires.UtcDateTime,
            new SigningCredentials(Key, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public async Task<TokenPair> IssueAsync(Guid userId, string email, IEnumerable<string> roles, int mfaLevel,
        string? userAgent, string? ip, CancellationToken ct = default)
    {
        var access = CreateAccessToken(userId, email, roles, mfaLevel, out var accessExp);
        var raw = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
        var refresh = new RefreshToken
        {
            Id = Guid.NewGuid(), UserId = userId, TokenHash = Hash(raw), MfaLevel = (byte)mfaLevel,
            CreatedAt = clock.UtcNow, ExpiresAt = clock.UtcNow.AddDays(_o.RefreshDays),
            UserAgent = userAgent?[..Math.Min(userAgent.Length, 300)], IpAddress = ip,
        };
        db.RefreshTokens.Add(refresh);
        await db.SaveChangesAsync(ct);
        return new TokenPair(access, accessExp, raw, refresh.ExpiresAt);
    }

    /// <summary>Rotates a refresh token. Reuse of a revoked token revokes the whole family (theft signal).</summary>
    public async Task<(RefreshToken Old, Guid UserId)?> ConsumeAsync(string raw, CancellationToken ct = default)
    {
        var hash = Hash(raw);
        var row = await db.RefreshTokens.FirstOrDefaultAsync(r => r.TokenHash == hash, ct);
        if (row is null) return null;
        if (row.RevokedAt is not null)
        {
            await RevokeAllAsync(row.UserId, ct);
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

    public static string Hash(string raw) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));
}
