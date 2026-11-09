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
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
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
}
