using System.Text;
using Ccs.Application.Abstractions;
using Ccs.Domain.Entities;
using Ccs.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Infrastructure.Persistence;

/// <summary>
/// EF Core over the schema in database/01_schema.sql. The SQL script is the source of truth
/// (DBA-reviewed, run once); EF maps to it and never creates or migrates tables.
/// </summary>
public sealed class CcsDbContext(DbContextOptions<CcsDbContext> options)
    : IdentityDbContext<AppUser, IdentityRole<Guid>, Guid>(options), ICcsDbContext
{
    public DbSet<Profile> Profiles => Set<Profile>();
    // Identity already owns "Roles"/"UserRoles" (dbo.AspNet*); the CCS role tables are reached through the interface.
    DbSet<Role> ICcsDbContext.Roles => Set<Role>();
    DbSet<UserRole> ICcsDbContext.UserRoles => Set<UserRole>();
    /// <summary>ccs.roles / ccs.user_roles for Infrastructure code that holds the concrete context.</summary>
    public DbSet<Role> CcsRoles => Set<Role>();
    public DbSet<UserRole> CcsUserRoles => Set<UserRole>();
    public DbSet<AccountType> AccountTypes => Set<AccountType>();
    public DbSet<AccountTypePermission> AccountTypePermissions => Set<AccountTypePermission>();
    public DbSet<AccountTypeAccess> AccountTypeAccess => Set<AccountTypeAccess>();
    public DbSet<AdminScope> AdminScopes => Set<AdminScope>();
    public DbSet<StaffPlacement> StaffPlacements => Set<StaffPlacement>();
    public DbSet<Organization> Organizations => Set<Organization>();
    public DbSet<Branch> Branches => Set<Branch>();
    public DbSet<Team> Teams => Set<Team>();
    public DbSet<TeamMember> TeamMembers => Set<TeamMember>();
    public DbSet<SigninCode> SigninCodes => Set<SigninCode>();
    public DbSet<AuthCode> AuthCodes => Set<AuthCode>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<Ticket> Tickets => Set<Ticket>();
    public DbSet<TicketCounter> TicketCounters => Set<TicketCounter>();
    public DbSet<TicketMessage> TicketMessages => Set<TicketMessage>();
    public DbSet<TicketAttachment> TicketAttachments => Set<TicketAttachment>();
    public DbSet<TicketStatusHistory> TicketStatusHistory => Set<TicketStatusHistory>();
    public DbSet<TicketStatusTransition> TicketStatusTransitions => Set<TicketStatusTransition>();
    public DbSet<TicketAssignment> TicketAssignments => Set<TicketAssignment>();
    public DbSet<TicketLink> TicketLinks => Set<TicketLink>();
    public DbSet<TicketCancellationRequest> TicketCancellationRequests => Set<TicketCancellationRequest>();
    public DbSet<CustomerFeedback> CustomerFeedback => Set<CustomerFeedback>();
    public DbSet<TicketCustomFieldValue> TicketCustomFieldValues => Set<TicketCustomFieldValue>();
    public DbSet<TicketSlaRecord> TicketSlaRecords => Set<TicketSlaRecord>();
    public DbSet<TicketSlaCycle> TicketSlaCycles => Set<TicketSlaCycle>();
    public DbSet<TicketSlaEvent> TicketSlaEvents => Set<TicketSlaEvent>();
    public DbSet<Priority> Priorities => Set<Priority>();
    public DbSet<ClosureReason> ClosureReasons => Set<ClosureReason>();
    public DbSet<TicketType> TicketTypes => Set<TicketType>();
    public DbSet<TicketTypeCategory> TicketTypeCategories => Set<TicketTypeCategory>();
    public DbSet<TicketCategory> TicketCategories => Set<TicketCategory>();
    public DbSet<TicketSubcategory> TicketSubcategories => Set<TicketSubcategory>();
    public DbSet<CustomFieldDefinition> CustomFieldDefinitions => Set<CustomFieldDefinition>();
    public DbSet<CannedResponse> CannedResponses => Set<CannedResponse>();
    public DbSet<SlaPolicy> SlaPolicies => Set<SlaPolicy>();
    public DbSet<BusinessHours> BusinessHours => Set<BusinessHours>();
    public DbSet<Holiday> Holidays => Set<Holiday>();
    public DbSet<KbCategory> KbCategories => Set<KbCategory>();
    public DbSet<KbArticle> KbArticles => Set<KbArticle>();
    public DbSet<KbFeedback> KbFeedback => Set<KbFeedback>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<EmailTemplate> EmailTemplates => Set<EmailTemplate>();
    public DbSet<EmailSettings> EmailSettings => Set<EmailSettings>();
    public DbSet<SystemMessage> SystemMessages => Set<SystemMessage>();
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();
    public DbSet<SiteSettings> SiteSettings => Set<SiteSettings>();
    public DbSet<MenuItem> MenuItems => Set<MenuItem>();
    public DbSet<CaptchaSettings> CaptchaSettings => Set<CaptchaSettings>();
    public DbSet<SigninCodeSettings> SigninCodeSettings => Set<SigninCodeSettings>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<RateCounter> RateCounters => Set<RateCounter>();

    /// <summary>Table name per entity (schema "ccs"). Columns are the snake_case of the property name.</summary>
    private static readonly Dictionary<Type, string> TableNames = new()
    {
        [typeof(Profile)] = "profiles", [typeof(Role)] = "roles", [typeof(UserRole)] = "user_roles",
        [typeof(AccountType)] = "account_types", [typeof(AccountTypePermission)] = "account_type_permissions",
        [typeof(AccountTypeAccess)] = "account_type_access", [typeof(AdminScope)] = "admin_scopes",
        [typeof(StaffPlacement)] = "staff_placement", [typeof(Organization)] = "organizations", [typeof(Branch)] = "branches",
        [typeof(Team)] = "teams", [typeof(TeamMember)] = "team_members", [typeof(SigninCode)] = "signin_codes",
        [typeof(AuthCode)] = "auth_codes", [typeof(RefreshToken)] = "refresh_tokens",
        [typeof(Ticket)] = "tickets", [typeof(TicketCounter)] = "ticket_counters", [typeof(TicketMessage)] = "ticket_messages",
        [typeof(TicketAttachment)] = "ticket_attachments", [typeof(TicketStatusHistory)] = "ticket_status_history",
        [typeof(TicketStatusTransition)] = "ticket_status_transitions", [typeof(TicketAssignment)] = "ticket_assignments",
        [typeof(TicketLink)] = "ticket_links", [typeof(TicketCancellationRequest)] = "ticket_cancellation_requests",
        [typeof(CustomerFeedback)] = "customer_feedback", [typeof(TicketCustomFieldValue)] = "ticket_custom_field_values",
        [typeof(TicketSlaRecord)] = "ticket_sla_records", [typeof(TicketSlaCycle)] = "ticket_sla_cycles",
        [typeof(TicketSlaEvent)] = "ticket_sla_events", [typeof(Priority)] = "priorities", [typeof(ClosureReason)] = "closure_reasons",
        [typeof(TicketType)] = "ticket_types", [typeof(TicketTypeCategory)] = "ticket_type_categories",
        [typeof(TicketCategory)] = "ticket_categories", [typeof(TicketSubcategory)] = "ticket_subcategories",
        [typeof(CustomFieldDefinition)] = "custom_field_definitions", [typeof(CannedResponse)] = "canned_responses",
        [typeof(SlaPolicy)] = "sla_policies", [typeof(BusinessHours)] = "business_hours", [typeof(Holiday)] = "holidays",
        [typeof(KbCategory)] = "kb_categories", [typeof(KbArticle)] = "kb_articles", [typeof(KbFeedback)] = "kb_feedback",
        [typeof(Notification)] = "notifications", [typeof(EmailTemplate)] = "email_templates", [typeof(EmailSettings)] = "email_settings",
        [typeof(SystemMessage)] = "system_messages", [typeof(AppSetting)] = "app_settings", [typeof(SiteSettings)] = "site_settings",
        [typeof(MenuItem)] = "menu_items", [typeof(CaptchaSettings)] = "captcha_settings",
        [typeof(SigninCodeSettings)] = "signin_code_settings", [typeof(AuditLog)] = "audit_logs", [typeof(RateCounter)] = "rate_counters",
    };

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);   // Identity tables keep their default dbo.AspNet* names

        foreach (var (type, table) in TableNames)
        {
            var e = b.Entity(type);
            e.ToTable(table, "ccs");
            foreach (var p in e.Metadata.GetProperties())
                p.SetColumnName(Snake(p.Name));
        }

        // Keys that are not a single "Id"
        b.Entity<UserRole>().HasKey(x => new { x.UserId, x.RoleId });
        b.Entity<AccountTypePermission>().HasKey(x => new { x.AccountTypeId, x.Permission });
        b.Entity<TeamMember>().HasKey(x => new { x.TeamId, x.UserId });
        b.Entity<TicketCounter>().HasKey(x => x.Year);
        b.Entity<TicketStatusTransition>().HasKey(x => new { x.FromStatus, x.ToStatus, x.Actor });
        b.Entity<CustomerFeedback>().HasKey(x => x.TicketId);
        b.Entity<TicketCustomFieldValue>().HasKey(x => new { x.TicketId, x.FieldId });
        b.Entity<TicketSlaRecord>().HasKey(x => x.TicketId);
        b.Entity<Priority>().HasKey(x => x.Code);
        b.Entity<ClosureReason>().HasKey(x => x.Code);
        b.Entity<TicketTypeCategory>().HasKey(x => new { x.TypeId, x.CategoryId });
        b.Entity<KbFeedback>().HasKey(x => new { x.ArticleId, x.UserId });
        b.Entity<EmailTemplate>().HasKey(x => new { x.Event, x.Locale });
        b.Entity<SystemMessage>().HasKey(x => new { x.Key, x.Locale });
        b.Entity<AppSetting>().HasKey(x => x.Key);
        b.Entity<RateCounter>().HasKey(x => new { x.Bucket, x.WindowStart });

        // Database-generated columns
        b.Entity<Role>().Property(x => x.Id).ValueGeneratedNever();
        b.Entity<Ticket>().Property(x => x.Seq).ValueGeneratedOnAdd().Metadata.SetAfterSaveBehavior(Microsoft.EntityFrameworkCore.Metadata.PropertySaveBehavior.Ignore);
        b.Entity<Ticket>().Property(x => x.RowVersion).IsRowVersion();
        b.Entity<AuditLog>().Property(x => x.Id).ValueGeneratedOnAdd();
        foreach (var single in new[] { typeof(EmailSettings), typeof(SiteSettings), typeof(CaptchaSettings), typeof(SigninCodeSettings) })
            b.Entity(single).Property("Id").ValueGeneratedNever();

        // Computed key columns exist only in SQL (branch_key, category_key) and are not mapped.
        b.Entity<Holiday>().Property(x => x.HolidayDate).HasColumnType("date");
    }

    public async Task<int> NextTicketNumberAsync(int year, CancellationToken ct = default)
    {
        // MERGE with HOLDLOCK = one atomic upsert, like INSERT .. ON CONFLICT .. RETURNING.
        var rows = await Database.SqlQuery<int>($"""
            MERGE ccs.ticket_counters WITH (HOLDLOCK) AS t
            USING (SELECT {year} AS [year]) AS s ON t.[year] = s.[year]
            WHEN MATCHED THEN UPDATE SET last_value = t.last_value + 1
            WHEN NOT MATCHED THEN INSERT ([year], last_value) VALUES (s.[year], 1)
            OUTPUT inserted.last_value AS [Value];
            """).ToListAsync(ct);
        return rows.Single();
    }

    public static string Snake(string name)
    {
        var sb = new StringBuilder(name.Length + 8);
        for (var i = 0; i < name.Length; i++)
        {
            var ch = name[i];
            if (char.IsUpper(ch))
            {
                if (i > 0 && (char.IsLower(name[i - 1]) || (i + 1 < name.Length && char.IsLower(name[i + 1])))) sb.Append('_');
                sb.Append(char.ToLowerInvariant(ch));
            }
            else sb.Append(ch);
        }
        return sb.ToString();
    }
}
