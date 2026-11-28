namespace Ccs.Domain.Entities;

// One class per table. Property names map to snake_case columns (see CcsDbContext).

public class Profile
{
    public Guid Id { get; set; }
    public string FullName { get; set; } = "";
    public string Email { get; set; } = "";
    public string? Phone { get; set; }
    public string PreferredLocale { get; set; } = "en";
    public Guid? OrganizationId { get; set; }
    public Guid? BranchId { get; set; }
    public string AccountStatus { get; set; } = Domain.AccountStatus.PendingVerification;
    public Guid? AccountTypeId { get; set; }
    public bool AutoAssign { get; set; }
    public bool CanCreateForCustomers { get; set; }
    public DateTimeOffset PasswordChangedAt { get; set; }
    public short PasswordWarnStage { get; set; }
    /// <summary>Set when an account request is rejected (the account is then suspended); cleared when it is approved after all.</summary>
    public DateTimeOffset? RejectedAt { get; set; }
    public Guid? RejectedBy { get; set; }
    public string? RejectionReason { get; set; }
    /// <summary>When the person entered the sign-up code: approval reminders count working days from here.</summary>
    public DateTimeOffset? EmailVerifiedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class Role
{
    public short Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
}

public class UserRole
{
    public Guid UserId { get; set; }
    public short RoleId { get; set; }
}

public class AccountType
{
    public Guid Id { get; set; }
    public string NameEn { get; set; } = "";
    public string NameAr { get; set; } = "";
    public bool AllAccess { get; set; }
    public bool IsBuiltin { get; set; }
    public string? ScopeLevel { get; set; }   // null | branch | organization
    /// <summary>Set on the default types (see Rules.DefaultAccountTypes): cannot be deleted or renamed.</summary>
    public string? DefaultKey { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class AccountTypePermission
{
    public Guid AccountTypeId { get; set; }
    public string Permission { get; set; } = "";
}

public class AccountTypeAccess
{
    public Guid Id { get; set; }
    public Guid AccountTypeId { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid? BranchId { get; set; }
}

public class AdminScope
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid? BranchId { get; set; }
}

public class StaffPlacement
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid? BranchId { get; set; }
}

public class Organization
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string ContactInfo { get; set; } = "{}";
    public bool SharedAccessEnabled { get; set; }
    public string? Location { get; set; }
    public string? Phone { get; set; }
    public Guid? TeamLeaderId { get; set; }
    public bool IsActive { get; set; } = true;
    public Guid? ParentId { get; set; }
    public string EscalationMode { get; set; } = "any";
    public string? EscalationPicks { get; set; }
    public string? ReassignRule { get; set; }
    public Guid? BusinessHoursId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class Branch
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Name { get; set; } = "";
    public string? Location { get; set; }
    public string? Phone { get; set; }
    public Guid? TeamLeaderId { get; set; }
    public bool IsActive { get; set; } = true;
    public string? EscalationMode { get; set; }
    public string? EscalationPicks { get; set; }
    public string? ReassignRule { get; set; }
    public Guid? BusinessHoursId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class Team
{
    public Guid Id { get; set; }
    public string NameEn { get; set; } = "";
    public string NameAr { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public Guid? BusinessHoursId { get; set; }
    /// <summary>The kind of team (Technical support, Billing…); a category sends tickets to a kind.</summary>
    public Guid? KindId { get; set; }
    /// <summary>Where the team works: a branch, a whole organization, or neither = a central team for every place.</summary>
    public Guid? OrganizationId { get; set; }
    public Guid? BranchId { get; set; }
    /// <summary>How it gives out tickets: fewest, turns, shared, leader; null = the default in Settings.</summary>
    public string? AssignMethod { get; set; }
    /// <summary>Who got the last ticket when taking turns.</summary>
    public Guid? LastAutoUserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>A kind of team, defined once (Technical support, Billing…). Each place may have its own team of a kind.</summary>
public class TeamKind
{
    public Guid Id { get; set; }
    public string NameEn { get; set; } = "";
    public string NameAr { get; set; } = "";
    /// <summary>When a place has no team of this kind, a central team of this kind may take its tickets.</summary>
    public bool CentralFallback { get; set; } = true;
    public int SortOrder { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    /// <summary>The place that made it (organization, and branch for a branch); both empty = the system's.</summary>
    public Guid? OrganizationId { get; set; }
    public Guid? BranchId { get; set; }
}

/// <summary>"Only these people": who in a team may get a category's tickets. No rows for a team = all its staff.</summary>
public class CategoryPerson
{
    public Guid CategoryId { get; set; }
    public Guid TeamId { get; set; }
    public Guid UserId { get; set; }
}

public class TeamMember
{
    public Guid TeamId { get; set; }
    public Guid UserId { get; set; }
    public bool IsLeader { get; set; }
}

public class SigninCode
{
    public Guid Id { get; set; }
    public string Email { get; set; } = "";
    public string CodeHash { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
    public int Attempts { get; set; }
    public DateTimeOffset? ConsumedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class AuthCode
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Purpose { get; set; } = "";
    public string CodeHash { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
    public int Attempts { get; set; }
    public DateTimeOffset? ConsumedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class RefreshToken
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string TokenHash { get; set; } = "";
    public byte MfaLevel { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public Guid? ReplacedBy { get; set; }
    public string? UserAgent { get; set; }
    public string? IpAddress { get; set; }
    /// <summary>One sign-in across rotations (the first row's id); null on rows made before it existed.</summary>
    public Guid? SessionId { get; set; }
    public DateTimeOffset? SessionStartedAt { get; set; }
}

/// <summary>Earlier passwords as one-way hashes, so they cannot be used again (Settings → Security → Password policy).</summary>
public class PasswordHistory
{
    public long Id { get; set; }
    public Guid UserId { get; set; }
    public string PasswordHash { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
}
