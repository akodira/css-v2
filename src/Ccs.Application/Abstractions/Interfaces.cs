using Ccs.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace Ccs.Application.Abstractions;

/// <summary>The data store, as the application services see it. Implemented by CcsDbContext.</summary>
public interface ICcsDbContext
{
    DbSet<Profile> Profiles { get; }
    DbSet<Role> Roles { get; }
    DbSet<UserRole> UserRoles { get; }
    DbSet<AccountType> AccountTypes { get; }
    DbSet<AccountTypePermission> AccountTypePermissions { get; }
    DbSet<AccountTypeAccess> AccountTypeAccess { get; }
    DbSet<AdminScope> AdminScopes { get; }
    DbSet<StaffPlacement> StaffPlacements { get; }
    DbSet<Organization> Organizations { get; }
    DbSet<Branch> Branches { get; }
    DbSet<Team> Teams { get; }
    DbSet<TeamMember> TeamMembers { get; }
    DbSet<SigninCode> SigninCodes { get; }
    DbSet<AuthCode> AuthCodes { get; }
    DbSet<RefreshToken> RefreshTokens { get; }

    DbSet<Ticket> Tickets { get; }
    DbSet<TicketCounter> TicketCounters { get; }
    DbSet<TicketMessage> TicketMessages { get; }
    DbSet<TicketAttachment> TicketAttachments { get; }
    DbSet<TicketStatusHistory> TicketStatusHistory { get; }
    DbSet<TicketStatusTransition> TicketStatusTransitions { get; }
    DbSet<TicketAssignment> TicketAssignments { get; }
    DbSet<TicketLink> TicketLinks { get; }
    DbSet<TicketCancellationRequest> TicketCancellationRequests { get; }
    DbSet<CustomerFeedback> CustomerFeedback { get; }
    DbSet<TicketCustomFieldValue> TicketCustomFieldValues { get; }
    DbSet<TicketSlaRecord> TicketSlaRecords { get; }
    DbSet<TicketSlaCycle> TicketSlaCycles { get; }
    DbSet<TicketSlaEvent> TicketSlaEvents { get; }

    DbSet<Priority> Priorities { get; }
    DbSet<ClosureReason> ClosureReasons { get; }
    DbSet<TicketType> TicketTypes { get; }
    DbSet<TicketTypeCategory> TicketTypeCategories { get; }
    DbSet<TicketCategory> TicketCategories { get; }
    DbSet<TicketSubcategory> TicketSubcategories { get; }
    DbSet<CustomFieldDefinition> CustomFieldDefinitions { get; }
    DbSet<CannedResponse> CannedResponses { get; }
    DbSet<SlaPolicy> SlaPolicies { get; }
    DbSet<BusinessHours> BusinessHours { get; }
    DbSet<Holiday> Holidays { get; }
    DbSet<KbCategory> KbCategories { get; }
    DbSet<KbArticle> KbArticles { get; }
    DbSet<KbFeedback> KbFeedback { get; }

    DbSet<Notification> Notifications { get; }
    DbSet<EmailTemplate> EmailTemplates { get; }
    DbSet<EmailSettings> EmailSettings { get; }
    DbSet<SystemMessage> SystemMessages { get; }
    DbSet<AppSetting> AppSettings { get; }
    DbSet<SiteSettings> SiteSettings { get; }
    DbSet<MenuItem> MenuItems { get; }
    DbSet<CaptchaSettings> CaptchaSettings { get; }
    DbSet<SigninCodeSettings> SigninCodeSettings { get; }
    DbSet<AuditLog> AuditLogs { get; }
    DbSet<RateCounter> RateCounters { get; }

    DatabaseFacade Database { get; }
    Task<int> SaveChangesAsync(CancellationToken ct = default);

    /// <summary>Atomically increments ccs.ticket_counters for the year and returns the new value.</summary>
    Task<int> NextTicketNumberAsync(int year, CancellationToken ct = default);
}

/// <summary>The signed-in caller of the current request (null user = anonymous or background job).</summary>
public interface ICurrentUser
{
    Guid? UserId { get; }
    /// <summary>1 = password only, 2 = password + authenticator (Supabase aal1 / aal2).</summary>
    int MfaLevel { get; }
    string? IpAddress { get; }
}

public interface IClock
{
    DateTimeOffset UtcNow { get; }
}

public sealed class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}

/// <summary>Attachment storage. Paths are "{ticketId}/{fileId}-{name}", same as the Supabase bucket.</summary>
public interface IFileStore
{
    Task SaveAsync(string storagePath, Stream content, CancellationToken ct = default);
    Task<Stream?> OpenReadAsync(string storagePath, CancellationToken ct = default);
    Task DeleteAsync(string storagePath, CancellationToken ct = default);
}

/// <summary>Optional virus scan (spec 5: v2 should add scanning). Default implementation uses Windows Defender.</summary>
public interface IFileScanner
{
    /// <returns>"clean", "infected" or "skipped".</returns>
    Task<string> ScanAsync(string storagePath, CancellationToken ct = default);
}

public sealed record OutgoingEmail(string To, string Subject, string Html, string Text);

public interface IEmailSender
{
    Task SendAsync(OutgoingEmail email, CancellationToken ct = default);
}

/// <summary>Whether the caller's account has an authenticator enrolled (Identity TwoFactorEnabled).</summary>
public interface IMfaStatus
{
    Task<bool> HasVerifiedFactorAsync(Guid userId, CancellationToken ct = default);
}
