namespace Ccs.Application.Common;

/// <summary>
/// Business errors. The API maps them to RFC 7807 problem responses.
/// Codes mirror the PostgreSQL errcodes used today (28000, 42501, 22023, P0429).
/// </summary>
public class AppException(string message, int status, string code) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}

/// <summary>401 - not signed in (errcode 28000).</summary>
public sealed class NotAuthenticatedException() : AppException("not authenticated", 401, "not_authenticated");

/// <summary>403 - signed in but not allowed (errcode 42501).</summary>
public sealed class ForbiddenException(string message = "not allowed") : AppException(message, 403, "forbidden");

/// <summary>404 - also used when a ticket exists but the caller may not see it, so nothing leaks.</summary>
public sealed class NotFoundException(string message = "not found") : AppException(message, 404, "not_found");

/// <summary>400 - invalid input (errcode 22023).</summary>
public sealed class ValidationFailedException(string message, string? field = null) : AppException(message, 400, "invalid")
{
    public string? Field { get; } = field;
}

/// <summary>409 - concurrent edit or duplicate.</summary>
public sealed class ConflictException(string message) : AppException(message, 409, "conflict");

/// <summary>429 - rate limit (errcode P0429).</summary>
public sealed class RateLimitedException(string message) : AppException(message, 429, "rate_limited");

public sealed record PageRequest(int Page = 1, int PageSize = 25, string? Sort = null, bool Desc = true)
{
    public int SafePage => Math.Max(1, Page);
    public int SafeSize => Math.Clamp(PageSize, 1, 200);
}

public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);
