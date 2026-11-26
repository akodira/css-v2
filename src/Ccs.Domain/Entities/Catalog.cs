namespace Ccs.Domain.Entities;

public class Priority
{
    public string Code { get; set; } = "";
    public string NameEn { get; set; } = "";
    public string NameAr { get; set; } = "";
    public string Color { get; set; } = "grey";
    public string Icon { get; set; } = "flag";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
}

public class ClosureReason
{
    public string Code { get; set; } = "";
    public string NameEn { get; set; } = "";
    public string NameAr { get; set; } = "";
    public bool CustomerMayReopen { get; set; } = true;
    public bool IsSystem { get; set; }
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; } = 100;
    public DateTimeOffset UpdatedAt { get; set; }
}

public class TicketType
{
    public Guid Id { get; set; }
    /// <summary>2–4 letters used in the ticket number (INC-26-0073); null = the prefix is used.</summary>
    public string? Code { get; set; }
    public string NameEn { get; set; } = "";
    public string NameAr { get; set; } = "";
    public string DescriptionEn { get; set; } = "";
    public string DescriptionAr { get; set; } = "";
    public string ExamplesEn { get; set; } = "";
    public string ExamplesAr { get; set; } = "";
    public int SortOrder { get; set; }
    /// <summary>Flow for new tickets of this type when flows are chosen by ticket type; null = the default flow.</summary>
    public Guid? FlowId { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    /// <summary>The place that made it (organization, and branch for a branch); both empty = the system's.</summary>
    public Guid? OrganizationId { get; set; }
    public Guid? BranchId { get; set; }
}

public class TicketTypeCategory
{
    public Guid TypeId { get; set; }
    public Guid CategoryId { get; set; }
}

public class TicketCategory
{
    public Guid Id { get; set; }
    public string NameEn { get; set; } = "";
    public string NameAr { get; set; } = "";
    /// <summary>Old fixed team; used only when no kind is set.</summary>
    public Guid? DefaultTeamId { get; set; }
    /// <summary>The kind of team that handles it; the ticket goes to that kind in the customer's place.</summary>
    public Guid? TeamKindId { get; set; }
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }
    public string? PriorityCode { get; set; }
    public bool IsPrivate { get; set; }
    public bool AutoAssign { get; set; } = true;
    /// <summary>Flow for new tickets of this category when flows are chosen by category; null = the default flow.</summary>
    public Guid? FlowId { get; set; }
    /// <summary>The place that made it (organization, and branch for a branch); both empty = the system's.</summary>
    public Guid? OrganizationId { get; set; }
    public Guid? BranchId { get; set; }
}

public class TicketSubcategory
{
    public Guid Id { get; set; }
    public Guid CategoryId { get; set; }
    public string NameEn { get; set; } = "";
    public string NameAr { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }
    public string? PriorityCode { get; set; }
    /// <summary>The place that made it (organization, and branch for a branch); both empty = the system's.</summary>
    public Guid? OrganizationId { get; set; }
    public Guid? BranchId { get; set; }
}

/// <summary>An item a place uses (its own, or chosen from the system or its organization). Kind: kind, type, cat, sub.</summary>
public class PlaceCatalogItem
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid? BranchId { get; set; }
    public string ItemKind { get; set; } = "";
    public Guid ItemId { get; set; }
}

/// <summary>Which categories a ticket type shows in one place (that place's own "which categories each type shows").</summary>
public class PlaceTypeCategory
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid? BranchId { get; set; }
    public Guid TypeId { get; set; }
    public Guid CategoryId { get; set; }
}

/// <summary>What a place's customers see on the new ticket form; no row = all three.</summary>
public class PlaceCustomerView
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid? BranchId { get; set; }
    public bool ShowOrganization { get; set; } = true;
    public bool ShowBranch { get; set; } = true;
    public bool ShowSystem { get; set; } = true;
}

public class CustomFieldDefinition
{
    public Guid Id { get; set; }
    public string Key { get; set; } = "";
    public string LabelEn { get; set; } = "";
    public string LabelAr { get; set; } = "";
    public string Type { get; set; } = "text";
    public string Options { get; set; } = "[]";      // JSON array
    public bool IsRequired { get; set; }
    public string Validation { get; set; } = "{}";   // JSON object
    public bool VisibleToCustomer { get; set; } = true;
    public Guid? CategoryId { get; set; }
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }
}

public class CannedResponse
{
    public Guid Id { get; set; }
    public Guid OwnerId { get; set; }
    public bool IsShared { get; set; }
    /// <summary>Shared with this team only (IsShared stays false): its members can use it, the owner changes it.</summary>
    public Guid? TeamId { get; set; }
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public string Language { get; set; } = "any";
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class SlaPolicy
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string Priority { get; set; } = "";
    public int FirstResponseMinutes { get; set; }
    public int ResolutionMinutes { get; set; }
    public int WarningThresholdPct { get; set; } = 80;
    /// <summary>"Getting close" level: % of the time used; must be below <see cref="WarningThresholdPct"/>.</summary>
    public int CloseThresholdPct { get; set; } = 50;
    public bool PauseOnPendingCustomer { get; set; } = true;
    public bool PauseOnPendingInternal { get; set; }
    public Guid? BusinessHoursId { get; set; }
    public string EscalationRules { get; set; } = "[]";
    public bool IsActive { get; set; } = true;
}

public class BusinessHours
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string Timezone { get; set; } = "Africa/Cairo";
    public string WeeklySchedule { get; set; } = "{}";
    public bool IsDefault { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class Holiday
{
    public Guid Id { get; set; }
    public Guid BusinessHoursId { get; set; }
    public DateOnly HolidayDate { get; set; }
    public string Name { get; set; } = "";
}

public class KbCategory
{
    public Guid Id { get; set; }
    public string Slug { get; set; } = "";
    public string NameEn { get; set; } = "";
    public string NameAr { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

public class KbArticle
{
    public Guid Id { get; set; }
    public Guid? CategoryId { get; set; }
    public string Slug { get; set; } = "";
    public string TitleEn { get; set; } = "";
    public string? TitleAr { get; set; }
    public string BodyEn { get; set; } = "";
    public string? BodyAr { get; set; }
    public string Status { get; set; } = "draft";
    public string Visibility { get; set; } = "customers";
    public int HelpfulCount { get; set; }
    public int NotHelpfulCount { get; set; }
    public DateTimeOffset? PublishedAt { get; set; }
    public Guid? CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class KbFeedback
{
    public Guid ArticleId { get; set; }
    public Guid UserId { get; set; }
    public bool Helpful { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
