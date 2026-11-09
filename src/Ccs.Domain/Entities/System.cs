namespace Ccs.Domain.Entities;

public class Notification
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string EventType { get; set; } = "";
    public Guid? TicketId { get; set; }
    public string Channel { get; set; } = "in_app";   // in_app | email
    public string Payload { get; set; } = "{}";
    public string DedupeKey { get; set; } = "";
    public string Status { get; set; } = "pending";   // pending | sent | failed
    public int Attempts { get; set; }
    public string? LastError { get; set; }
    public DateTimeOffset? LockedUntil { get; set; }
    public DateTimeOffset? ReadAt { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class EmailTemplate
{
    public string Event { get; set; } = "";
    public string Locale { get; set; } = "en";
    public string Subject { get; set; } = "";
    public string Body { get; set; } = "";
    public string Button { get; set; } = "";
    public string Link { get; set; } = "";
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}

public class EmailSettings
{
    public int Id { get; set; } = 1;
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    public string Security { get; set; } = "starttls";
    public string Username { get; set; } = "";
    public string? PasswordEnc { get; set; }
    public bool? HasPassword { get; set; }
    public string FromName { get; set; } = "";
    public string FromEmail { get; set; } = "";
    public string ReplyTo { get; set; } = "";
    public bool UseSmtp { get; set; }
    public string Design { get; set; } = "{}";
    public DateTimeOffset? LastTestAt { get; set; }
    public bool? LastTestOk { get; set; }
    public string? LastTestError { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}

public class SystemMessage
{
    public string Key { get; set; } = "";
    public string Locale { get; set; } = "en";
    public string Body { get; set; } = "";
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}

public class AppSetting
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "null";   // JSON scalar or document
    public string? Description { get; set; }
}

public class SiteSettings
{
    public int Id { get; set; } = 1;
    public string SiteNameEn { get; set; } = "";
    public string SiteNameAr { get; set; } = "";
    public string HeaderNameEn { get; set; } = "";
    public string HeaderNameAr { get; set; } = "";
    public string HeaderSubEn { get; set; } = "";
    public string HeaderSubAr { get; set; } = "";
    public string? LogoPath { get; set; }
    public string? FaviconPath { get; set; }
    public string FooterTextEn { get; set; } = "";
    public string FooterTextAr { get; set; } = "";
    public string? ContactEmail { get; set; }
    public string? ContactPhone { get; set; }
    public string ContactHoursEn { get; set; } = "";
    public string ContactHoursAr { get; set; } = "";
    public string? BrandColor { get; set; }
    public string HomeTitleEn { get; set; } = "";
    public string HomeTitleAr { get; set; } = "";
    public string HomeIntroEn { get; set; } = "";
    public string HomeIntroAr { get; set; } = "";
    public string LoginNoticeEn { get; set; } = "";
    public string LoginNoticeAr { get; set; } = "";
    public string HomeContent { get; set; } = "{}";
    public int UploadMaxMb { get; set; } = 10;
    public int UploadMaxFiles { get; set; } = 5;
    public string UploadExtensions { get; set; } = "[]";
    public string RegistrationMode { get; set; } = "approval";
    public string PriorityMode { get; set; } = "system";
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}

public class MenuItem
{
    public Guid Id { get; set; }
    public string Area { get; set; } = "header";
    public Guid? ParentId { get; set; }
    public string Kind { get; set; } = "link";
    public string LabelEn { get; set; } = "";
    public string LabelAr { get; set; } = "";
    public string? Href { get; set; }
    public string Audience { get; set; } = "all";
    public bool NewTab { get; set; }
    public bool IsVisible { get; set; } = true;
    public int SortOrder { get; set; }
    public string? SystemKey { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class CaptchaSettings
{
    public int Id { get; set; } = 1;
    public bool Enabled { get; set; }
    public string Provider { get; set; } = "turnstile";
    public string SiteKey { get; set; } = "";
    public string? SecretEnc { get; set; }
}

public class SigninCodeSettings
{
    public int Id { get; set; } = 1;
    public bool Enabled { get; set; }
    public string Audience { get; set; } = "customers";
    public int CodeLength { get; set; } = 6;
    public int ValidMinutes { get; set; } = 10;
    public int MaxAttempts { get; set; } = 5;
    public int CooldownSeconds { get; set; } = 60;
    public int DailyLimit { get; set; } = 10;
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}

public class AuditLog
{
    public long Id { get; set; }
    public Guid? ActorId { get; set; }
    public string Action { get; set; } = "";
    public string EntityType { get; set; } = "";
    public Guid? EntityId { get; set; }
    public string? Before { get; set; }
    public string? After { get; set; }
    public string? IpAddress { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class RateCounter
{
    public string Bucket { get; set; } = "";
    public DateTimeOffset WindowStart { get; set; }
    public int Hits { get; set; }
}
