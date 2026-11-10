/* =====================================================================
   CCS v2 - SQL Server schema
   Source: live Supabase project "cts" (PostgreSQL 17), exported 2026-11-09
   Target: SQL Server 2019+ (2022 recommended)

   Rules applied (spec section 8):
   - uuid         -> uniqueidentifier (ids are kept unchanged on migration)
   - timestamptz  -> datetimeoffset(7), always written in UTC
   - text         -> nvarchar(n) / nvarchar(max) (Arabic safe)
   - jsonb        -> nvarchar(max) + ISJSON check
   - enums        -> nvarchar + CHECK constraint
   - boolean      -> bit
   - tsvector     -> SQL Server full-text index (see 03_fulltext.sql)
   - Expression unique indexes (lower(btrim(x))) -> plain unique index;
     the database collation is case-insensitive and the API trims input.
   - COALESCE(branch_id, '0000..') unique keys -> persisted computed column.

   Cascades: SQL Server refuses multiple cascade paths and cycles.
   ON DELETE CASCADE is kept only for pure child rows (ticket children,
   account type children, team members, holidays, KB feedback, catalogue
   children). Every other delete rule from PostgreSQL (SET NULL / CASCADE
   on profiles, organizations, branches, team leaders) is enforced in the
   application services and listed in docs/DB-NOTES.md.
   ===================================================================== */

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF SCHEMA_ID('ccs') IS NULL EXEC('CREATE SCHEMA ccs');
GO

/* ---------------------------------------------------------------------
   1. Identity (ASP.NET Core Identity, Guid keys)
   Id = profiles.id so every existing link survives the migration.
   --------------------------------------------------------------------- */
CREATE TABLE dbo.AspNetUsers (
    Id                    uniqueidentifier NOT NULL CONSTRAINT PK_AspNetUsers PRIMARY KEY,
    UserName              nvarchar(256) NULL,
    NormalizedUserName    nvarchar(256) NULL,
    Email                 nvarchar(256) NULL,
    NormalizedEmail       nvarchar(256) NULL,
    EmailConfirmed        bit NOT NULL CONSTRAINT DF_AspNetUsers_EmailConfirmed DEFAULT 0,
    PasswordHash          nvarchar(max) NULL,
    SecurityStamp         nvarchar(max) NULL,
    ConcurrencyStamp      nvarchar(max) NULL,
    PhoneNumber           nvarchar(32) NULL,
    PhoneNumberConfirmed  bit NOT NULL CONSTRAINT DF_AspNetUsers_PhoneConfirmed DEFAULT 0,
    TwoFactorEnabled      bit NOT NULL CONSTRAINT DF_AspNetUsers_TwoFactor DEFAULT 0,
    LockoutEnd            datetimeoffset(7) NULL,
    LockoutEnabled        bit NOT NULL CONSTRAINT DF_AspNetUsers_LockoutEnabled DEFAULT 1,
    AccessFailedCount     int NOT NULL CONSTRAINT DF_AspNetUsers_AccessFailed DEFAULT 0
);
CREATE UNIQUE INDEX UserNameIndex ON dbo.AspNetUsers (NormalizedUserName) WHERE NormalizedUserName IS NOT NULL;
CREATE INDEX EmailIndex ON dbo.AspNetUsers (NormalizedEmail);
GO

CREATE TABLE dbo.AspNetRoles (
    Id               uniqueidentifier NOT NULL CONSTRAINT PK_AspNetRoles PRIMARY KEY,
    Name             nvarchar(256) NULL,
    NormalizedName   nvarchar(256) NULL,
    ConcurrencyStamp nvarchar(max) NULL
);
CREATE UNIQUE INDEX RoleNameIndex ON dbo.AspNetRoles (NormalizedName) WHERE NormalizedName IS NOT NULL;

CREATE TABLE dbo.AspNetUserClaims (
    Id         int IDENTITY(1,1) NOT NULL CONSTRAINT PK_AspNetUserClaims PRIMARY KEY,
    UserId     uniqueidentifier NOT NULL CONSTRAINT FK_AspNetUserClaims_User REFERENCES dbo.AspNetUsers(Id) ON DELETE CASCADE,
    ClaimType  nvarchar(max) NULL,
    ClaimValue nvarchar(max) NULL
);
CREATE INDEX IX_AspNetUserClaims_UserId ON dbo.AspNetUserClaims (UserId);

CREATE TABLE dbo.AspNetRoleClaims (
    Id         int IDENTITY(1,1) NOT NULL CONSTRAINT PK_AspNetRoleClaims PRIMARY KEY,
    RoleId     uniqueidentifier NOT NULL CONSTRAINT FK_AspNetRoleClaims_Role REFERENCES dbo.AspNetRoles(Id) ON DELETE CASCADE,
    ClaimType  nvarchar(max) NULL,
    ClaimValue nvarchar(max) NULL
);
CREATE INDEX IX_AspNetRoleClaims_RoleId ON dbo.AspNetRoleClaims (RoleId);

CREATE TABLE dbo.AspNetUserLogins (
    LoginProvider       nvarchar(128) NOT NULL,
    ProviderKey         nvarchar(128) NOT NULL,
    ProviderDisplayName nvarchar(max) NULL,
    UserId              uniqueidentifier NOT NULL CONSTRAINT FK_AspNetUserLogins_User REFERENCES dbo.AspNetUsers(Id) ON DELETE CASCADE,
    CONSTRAINT PK_AspNetUserLogins PRIMARY KEY (LoginProvider, ProviderKey)
);
CREATE INDEX IX_AspNetUserLogins_UserId ON dbo.AspNetUserLogins (UserId);

CREATE TABLE dbo.AspNetUserRoles (
    UserId uniqueidentifier NOT NULL CONSTRAINT FK_AspNetUserRoles_User REFERENCES dbo.AspNetUsers(Id) ON DELETE CASCADE,
    RoleId uniqueidentifier NOT NULL CONSTRAINT FK_AspNetUserRoles_Role REFERENCES dbo.AspNetRoles(Id) ON DELETE CASCADE,
    CONSTRAINT PK_AspNetUserRoles PRIMARY KEY (UserId, RoleId)
);
CREATE INDEX IX_AspNetUserRoles_RoleId ON dbo.AspNetUserRoles (RoleId);

CREATE TABLE dbo.AspNetUserTokens (
    UserId        uniqueidentifier NOT NULL CONSTRAINT FK_AspNetUserTokens_User REFERENCES dbo.AspNetUsers(Id) ON DELETE CASCADE,
    LoginProvider nvarchar(128) NOT NULL,
    Name          nvarchar(128) NOT NULL,
    Value         nvarchar(max) NULL,
    CONSTRAINT PK_AspNetUserTokens PRIMARY KEY (UserId, LoginProvider, Name)
);
GO

/* Refresh tokens for the Angular app (JWT access token + rotating refresh cookie) */
CREATE TABLE ccs.refresh_tokens (
    id           uniqueidentifier NOT NULL CONSTRAINT PK_refresh_tokens PRIMARY KEY DEFAULT NEWID(),
    user_id      uniqueidentifier NOT NULL CONSTRAINT FK_refresh_tokens_user REFERENCES dbo.AspNetUsers(Id) ON DELETE CASCADE,
    token_hash   nvarchar(128) NOT NULL,
    mfa_level    tinyint NOT NULL DEFAULT 1,           -- 1 = password, 2 = password + TOTP (Supabase aal1/aal2)
    created_at   datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    expires_at   datetimeoffset(7) NOT NULL,
    revoked_at   datetimeoffset(7) NULL,
    replaced_by  uniqueidentifier NULL,
    user_agent   nvarchar(300) NULL,
    ip_address   nvarchar(64) NULL
);
CREATE UNIQUE INDEX UX_refresh_tokens_hash ON ccs.refresh_tokens (token_hash);
CREATE INDEX IX_refresh_tokens_user ON ccs.refresh_tokens (user_id, expires_at);
GO

/* Reset codes (password reset by code, email confirmation code) */
CREATE TABLE ccs.auth_codes (
    id          uniqueidentifier NOT NULL CONSTRAINT PK_auth_codes PRIMARY KEY DEFAULT NEWID(),
    user_id     uniqueidentifier NOT NULL CONSTRAINT FK_auth_codes_user REFERENCES dbo.AspNetUsers(Id) ON DELETE CASCADE,
    purpose     nvarchar(30) NOT NULL CONSTRAINT CK_auth_codes_purpose CHECK (purpose IN ('recovery','signup','email_change','reauth')),
    code_hash   nvarchar(128) NOT NULL,
    expires_at  datetimeoffset(7) NOT NULL,
    attempts    int NOT NULL DEFAULT 0,
    consumed_at datetimeoffset(7) NULL,
    created_at  datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_auth_codes_user ON ccs.auth_codes (user_id, purpose, created_at DESC);
GO

/* ---------------------------------------------------------------------
   2. Calendars
   --------------------------------------------------------------------- */
CREATE TABLE ccs.business_hours (
    id              uniqueidentifier NOT NULL CONSTRAINT PK_business_hours PRIMARY KEY DEFAULT NEWID(),
    name            nvarchar(120) NOT NULL,
    timezone        nvarchar(64)  NOT NULL DEFAULT N'Africa/Cairo',   -- IANA id; .NET 6+ on Windows resolves IANA ids via ICU
    weekly_schedule nvarchar(max) NOT NULL CONSTRAINT CK_business_hours_schedule CHECK (ISJSON(weekly_schedule) = 1),
    is_default      bit NOT NULL DEFAULT 0,                            -- replaces the "system" calendar assignment
    created_at      datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_business_hours_default ON ccs.business_hours (is_default) WHERE is_default = 1;

CREATE TABLE ccs.holidays (
    id                uniqueidentifier NOT NULL CONSTRAINT PK_holidays PRIMARY KEY DEFAULT NEWID(),
    business_hours_id uniqueidentifier NOT NULL CONSTRAINT FK_holidays_bh REFERENCES ccs.business_hours(id) ON DELETE CASCADE,
    holiday_date      date NOT NULL,
    name              nvarchar(120) NOT NULL,
    CONSTRAINT UQ_holidays_bh_date UNIQUE (business_hours_id, holiday_date)
);
GO

/* ---------------------------------------------------------------------
   3. People and access
   --------------------------------------------------------------------- */
CREATE TABLE ccs.roles (
    id   smallint NOT NULL CONSTRAINT PK_roles PRIMARY KEY,
    code nvarchar(40) NOT NULL CONSTRAINT UQ_roles_code UNIQUE,
    name nvarchar(80) NOT NULL
);

CREATE TABLE ccs.account_types (
    id          uniqueidentifier NOT NULL CONSTRAINT PK_account_types PRIMARY KEY DEFAULT NEWID(),
    name_en     nvarchar(80) NOT NULL CONSTRAINT CK_account_types_name_en CHECK (LEN(LTRIM(RTRIM(name_en))) BETWEEN 1 AND 80),
    name_ar     nvarchar(80) NOT NULL CONSTRAINT CK_account_types_name_ar CHECK (LEN(LTRIM(RTRIM(name_ar))) BETWEEN 1 AND 80),
    all_access  bit NOT NULL DEFAULT 0,
    is_builtin  bit NOT NULL DEFAULT 0,
    scope_level nvarchar(20) NULL CONSTRAINT CK_account_types_scope CHECK (scope_level IN ('branch','organization')),
    created_at  datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at  datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_account_types_name_en ON ccs.account_types (name_en);
CREATE UNIQUE INDEX UX_account_types_name_ar ON ccs.account_types (name_ar);

CREATE TABLE ccs.account_type_permissions (
    account_type_id uniqueidentifier NOT NULL CONSTRAINT FK_atp_type REFERENCES ccs.account_types(id) ON DELETE CASCADE,
    permission      nvarchar(40) NOT NULL CONSTRAINT CK_atp_permission CHECK (permission IN (
        'reply','resolve','close','change_category','assign_self','assign_others','view_unassigned','view_others',
        'all_teams','reports_own','reports_all','export','customers_view','customers_manage','manage_kb',
        'manage_catalog','manage_settings','manage_canned','approve_customers')),
    CONSTRAINT PK_account_type_permissions PRIMARY KEY (account_type_id, permission)
);

CREATE TABLE ccs.organizations (
    id                    uniqueidentifier NOT NULL CONSTRAINT PK_organizations PRIMARY KEY DEFAULT NEWID(),
    name                  nvarchar(120) NOT NULL,
    contact_info          nvarchar(max) NOT NULL DEFAULT N'{}' CONSTRAINT CK_org_contact_json CHECK (ISJSON(contact_info) = 1),
    shared_access_enabled bit NOT NULL DEFAULT 0,
    location              nvarchar(300) NULL,
    phone                 nvarchar(16) NULL CONSTRAINT CK_org_phone CHECK (phone IS NULL OR (phone LIKE '+%' AND LEN(phone) BETWEEN 9 AND 16 AND SUBSTRING(phone,2,15) NOT LIKE '%[^0-9]%')),
    team_leader_id        uniqueidentifier NULL,      -- FK added after profiles
    is_active             bit NOT NULL DEFAULT 1,
    parent_id             uniqueidentifier NULL CONSTRAINT FK_org_parent REFERENCES ccs.organizations(id),
    escalation_mode       nvarchar(10) NOT NULL DEFAULT N'any' CONSTRAINT CK_org_escalation CHECK (escalation_mode IN ('off','next','any')),
    business_hours_id     uniqueidentifier NULL CONSTRAINT FK_org_bh REFERENCES ccs.business_hours(id),
    created_at            datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at            datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_org_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX UX_organizations_name ON ccs.organizations (name);
CREATE INDEX IX_organizations_parent ON ccs.organizations (parent_id);

CREATE TABLE ccs.branches (
    id                uniqueidentifier NOT NULL CONSTRAINT PK_branches PRIMARY KEY DEFAULT NEWID(),
    organization_id   uniqueidentifier NOT NULL CONSTRAINT FK_branches_org REFERENCES ccs.organizations(id),
    name              nvarchar(120) NOT NULL CONSTRAINT CK_branches_name CHECK (LEN(LTRIM(RTRIM(name))) BETWEEN 1 AND 120),
    location          nvarchar(300) NULL,
    phone             nvarchar(16) NULL CONSTRAINT CK_branches_phone CHECK (phone IS NULL OR (phone LIKE '+%' AND LEN(phone) BETWEEN 9 AND 16 AND SUBSTRING(phone,2,15) NOT LIKE '%[^0-9]%')),
    team_leader_id    uniqueidentifier NULL,
    is_active         bit NOT NULL DEFAULT 1,
    escalation_mode   nvarchar(10) NULL CONSTRAINT CK_branches_escalation CHECK (escalation_mode IN ('off','next','any')),
    business_hours_id uniqueidentifier NULL CONSTRAINT FK_branches_bh REFERENCES ccs.business_hours(id),
    created_at        datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at        datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_branches_org ON ccs.branches (organization_id);
CREATE UNIQUE INDEX UX_branches_org_name ON ccs.branches (organization_id, name);
GO

CREATE TABLE ccs.profiles (
    id                       uniqueidentifier NOT NULL CONSTRAINT PK_profiles PRIMARY KEY
                             CONSTRAINT FK_profiles_user REFERENCES dbo.AspNetUsers(Id) ON DELETE CASCADE,
    full_name                nvarchar(200) NOT NULL DEFAULT N'',
    email                    nvarchar(256) NOT NULL,
    phone                    nvarchar(16) NULL,
    preferred_locale         nvarchar(2) NOT NULL DEFAULT N'en' CONSTRAINT CK_profiles_locale CHECK (preferred_locale IN ('en','ar')),
    organization_id          uniqueidentifier NULL CONSTRAINT FK_profiles_org REFERENCES ccs.organizations(id),
    branch_id                uniqueidentifier NULL CONSTRAINT FK_profiles_branch REFERENCES ccs.branches(id),
    account_status           nvarchar(30) NOT NULL DEFAULT N'pending_verification'
                             CONSTRAINT CK_profiles_status CHECK (account_status IN ('active','suspended','pending_verification','pending_approval')),
    account_type_id          uniqueidentifier NULL CONSTRAINT FK_profiles_account_type REFERENCES ccs.account_types(id),
    auto_assign              bit NOT NULL DEFAULT 0,
    can_create_for_customers bit NOT NULL DEFAULT 0,
    password_changed_at      datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    password_warn_stage      smallint NOT NULL DEFAULT 0,
    created_at               datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at               datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_profiles_account_type ON ccs.profiles (account_type_id);
CREATE INDEX IX_profiles_branch ON ccs.profiles (branch_id);
CREATE INDEX IX_profiles_org ON ccs.profiles (organization_id);
CREATE INDEX IX_profiles_email ON ccs.profiles (email);
CREATE UNIQUE INDEX UX_profiles_phone ON ccs.profiles (phone) WHERE phone IS NOT NULL;
GO

ALTER TABLE ccs.organizations ADD CONSTRAINT FK_org_team_leader FOREIGN KEY (team_leader_id) REFERENCES ccs.profiles(id);
ALTER TABLE ccs.branches      ADD CONSTRAINT FK_branches_team_leader FOREIGN KEY (team_leader_id) REFERENCES ccs.profiles(id);
GO

CREATE TABLE ccs.user_roles (
    user_id uniqueidentifier NOT NULL CONSTRAINT FK_user_roles_user REFERENCES ccs.profiles(id) ON DELETE CASCADE,
    role_id smallint NOT NULL CONSTRAINT FK_user_roles_role REFERENCES ccs.roles(id),
    CONSTRAINT PK_user_roles PRIMARY KEY (user_id, role_id)
);

CREATE TABLE ccs.account_type_access (
    id              uniqueidentifier NOT NULL CONSTRAINT PK_account_type_access PRIMARY KEY DEFAULT NEWID(),
    account_type_id uniqueidentifier NOT NULL CONSTRAINT FK_ata_type REFERENCES ccs.account_types(id) ON DELETE CASCADE,
    organization_id uniqueidentifier NOT NULL CONSTRAINT FK_ata_org REFERENCES ccs.organizations(id),
    branch_id       uniqueidentifier NULL CONSTRAINT FK_ata_branch REFERENCES ccs.branches(id),
    branch_key      AS (ISNULL(branch_id, CAST('00000000-0000-0000-0000-000000000000' AS uniqueidentifier))) PERSISTED
);
CREATE UNIQUE INDEX UX_account_type_access ON ccs.account_type_access (account_type_id, organization_id, branch_key);

CREATE TABLE ccs.admin_scopes (
    id              uniqueidentifier NOT NULL CONSTRAINT PK_admin_scopes PRIMARY KEY DEFAULT NEWID(),
    user_id         uniqueidentifier NOT NULL CONSTRAINT FK_admin_scopes_user REFERENCES ccs.profiles(id) ON DELETE CASCADE,
    organization_id uniqueidentifier NOT NULL CONSTRAINT FK_admin_scopes_org REFERENCES ccs.organizations(id),
    branch_id       uniqueidentifier NULL CONSTRAINT FK_admin_scopes_branch REFERENCES ccs.branches(id),
    branch_key      AS (ISNULL(branch_id, CAST('00000000-0000-0000-0000-000000000000' AS uniqueidentifier))) PERSISTED
);
CREATE UNIQUE INDEX UX_admin_scopes ON ccs.admin_scopes (user_id, organization_id, branch_key);

CREATE TABLE ccs.staff_placement (
    id              uniqueidentifier NOT NULL CONSTRAINT PK_staff_placement PRIMARY KEY DEFAULT NEWID(),
    user_id         uniqueidentifier NOT NULL CONSTRAINT FK_staff_placement_user REFERENCES ccs.profiles(id) ON DELETE CASCADE,
    organization_id uniqueidentifier NOT NULL CONSTRAINT FK_staff_placement_org REFERENCES ccs.organizations(id),
    branch_id       uniqueidentifier NULL CONSTRAINT FK_staff_placement_branch REFERENCES ccs.branches(id),
    branch_key      AS (ISNULL(branch_id, CAST('00000000-0000-0000-0000-000000000000' AS uniqueidentifier))) PERSISTED
);
CREATE UNIQUE INDEX UX_staff_placement ON ccs.staff_placement (user_id, organization_id, branch_key);

CREATE TABLE ccs.teams (
    id                uniqueidentifier NOT NULL CONSTRAINT PK_teams PRIMARY KEY DEFAULT NEWID(),
    name_en           nvarchar(120) NOT NULL,
    name_ar           nvarchar(120) NOT NULL,
    is_active         bit NOT NULL DEFAULT 1,
    business_hours_id uniqueidentifier NULL CONSTRAINT FK_teams_bh REFERENCES ccs.business_hours(id),
    created_at        datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at        datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_teams_name_en ON ccs.teams (name_en);
CREATE UNIQUE INDEX UX_teams_name_ar ON ccs.teams (name_ar);

CREATE TABLE ccs.team_members (
    team_id   uniqueidentifier NOT NULL CONSTRAINT FK_team_members_team REFERENCES ccs.teams(id) ON DELETE CASCADE,
    user_id   uniqueidentifier NOT NULL CONSTRAINT FK_team_members_user REFERENCES ccs.profiles(id) ON DELETE CASCADE,
    is_leader bit NOT NULL DEFAULT 0,
    CONSTRAINT PK_team_members PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IX_team_members_user ON ccs.team_members (user_id);

CREATE TABLE ccs.signin_codes (
    id          uniqueidentifier NOT NULL CONSTRAINT PK_signin_codes PRIMARY KEY DEFAULT NEWID(),
    email       nvarchar(256) NOT NULL,
    code_hash   nvarchar(128) NOT NULL,
    expires_at  datetimeoffset(7) NOT NULL,
    attempts    int NOT NULL DEFAULT 0,
    consumed_at datetimeoffset(7) NULL,
    created_at  datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_signin_codes_email ON ccs.signin_codes (email, created_at DESC);
GO

/* ---------------------------------------------------------------------
   4. Catalogue
   --------------------------------------------------------------------- */
CREATE TABLE ccs.priorities (
    code       nvarchar(40) NOT NULL CONSTRAINT PK_priorities PRIMARY KEY,
    name_en    nvarchar(60) NOT NULL,
    name_ar    nvarchar(60) NOT NULL,
    color      nvarchar(10) NOT NULL DEFAULT N'grey' CONSTRAINT CK_priorities_color CHECK (color IN ('red','amber','blue','green','grey','light')),
    icon       nvarchar(12) NOT NULL DEFAULT N'flag' CONSTRAINT CK_priorities_icon CHECK (icon IN ('alert','arrow_up','minus','arrow_down','bolt','flag','clock','star')),
    sort_order int NOT NULL DEFAULT 0 CONSTRAINT CK_priorities_sort CHECK (sort_order BETWEEN 0 AND 1000),
    is_active  bit NOT NULL DEFAULT 1,
    created_at datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_priorities_name_en ON ccs.priorities (name_en);
CREATE UNIQUE INDEX UX_priorities_name_ar ON ccs.priorities (name_ar);

CREATE TABLE ccs.closure_reasons (
    code                nvarchar(40) NOT NULL CONSTRAINT PK_closure_reasons PRIMARY KEY,
    name_en             nvarchar(80) NOT NULL,
    name_ar             nvarchar(80) NOT NULL,
    customer_may_reopen bit NOT NULL DEFAULT 1,
    is_system           bit NOT NULL DEFAULT 0,
    is_active           bit NOT NULL DEFAULT 1,
    sort_order          int NOT NULL DEFAULT 100,
    updated_at          datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE ccs.ticket_types (
    id             uniqueidentifier NOT NULL CONSTRAINT PK_ticket_types PRIMARY KEY DEFAULT NEWID(),
    name_en        nvarchar(80) NOT NULL,
    name_ar        nvarchar(80) NOT NULL,
    description_en nvarchar(300) NOT NULL DEFAULT N'',
    description_ar nvarchar(300) NOT NULL DEFAULT N'',
    examples_en    nvarchar(300) NOT NULL DEFAULT N'',
    examples_ar    nvarchar(300) NOT NULL DEFAULT N'',
    sort_order     int NOT NULL DEFAULT 0,
    is_active      bit NOT NULL DEFAULT 1,
    created_at     datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_ticket_types_name_en ON ccs.ticket_types (name_en);
CREATE UNIQUE INDEX UX_ticket_types_name_ar ON ccs.ticket_types (name_ar);

CREATE TABLE ccs.ticket_categories (
    id              uniqueidentifier NOT NULL CONSTRAINT PK_ticket_categories PRIMARY KEY DEFAULT NEWID(),
    name_en         nvarchar(120) NOT NULL,
    name_ar         nvarchar(120) NOT NULL,
    default_team_id uniqueidentifier NULL CONSTRAINT FK_categories_team REFERENCES ccs.teams(id),
    is_active       bit NOT NULL DEFAULT 1,
    sort_order      int NOT NULL DEFAULT 0,
    priority_code   nvarchar(40) NULL CONSTRAINT FK_categories_priority REFERENCES ccs.priorities(code) ON UPDATE CASCADE,
    is_private      bit NOT NULL DEFAULT 0,
    auto_assign     bit NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX UX_ticket_categories_name_en ON ccs.ticket_categories (name_en);
CREATE UNIQUE INDEX UX_ticket_categories_name_ar ON ccs.ticket_categories (name_ar);

CREATE TABLE ccs.ticket_subcategories (
    id            uniqueidentifier NOT NULL CONSTRAINT PK_ticket_subcategories PRIMARY KEY DEFAULT NEWID(),
    category_id   uniqueidentifier NOT NULL CONSTRAINT FK_subcategories_category REFERENCES ccs.ticket_categories(id) ON DELETE CASCADE,
    name_en       nvarchar(120) NOT NULL,
    name_ar       nvarchar(120) NOT NULL,
    is_active     bit NOT NULL DEFAULT 1,
    sort_order    int NOT NULL DEFAULT 0,
    priority_code nvarchar(40) NULL CONSTRAINT FK_subcategories_priority REFERENCES ccs.priorities(code)
);
CREATE INDEX IX_subcategories_category ON ccs.ticket_subcategories (category_id);
CREATE UNIQUE INDEX UX_subcategories_name_en ON ccs.ticket_subcategories (category_id, name_en);
CREATE UNIQUE INDEX UX_subcategories_name_ar ON ccs.ticket_subcategories (category_id, name_ar);

CREATE TABLE ccs.ticket_type_categories (
    type_id     uniqueidentifier NOT NULL CONSTRAINT FK_ttc_type REFERENCES ccs.ticket_types(id) ON DELETE CASCADE,
    category_id uniqueidentifier NOT NULL CONSTRAINT FK_ttc_category REFERENCES ccs.ticket_categories(id) ON DELETE CASCADE,
    CONSTRAINT PK_ticket_type_categories PRIMARY KEY (type_id, category_id)
);
CREATE INDEX IX_ttc_category ON ccs.ticket_type_categories (category_id);

CREATE TABLE ccs.custom_field_definitions (
    id                  uniqueidentifier NOT NULL CONSTRAINT PK_custom_field_definitions PRIMARY KEY DEFAULT NEWID(),
    [key]               nvarchar(41) NOT NULL CONSTRAINT UQ_custom_field_key UNIQUE,
    label_en            nvarchar(120) NOT NULL,
    label_ar            nvarchar(120) NOT NULL,
    type                nvarchar(20) NOT NULL CONSTRAINT CK_cfd_type CHECK (type IN ('text','long_text','number','date','dropdown','multi_select','checkbox','radio','file')),
    options             nvarchar(max) NOT NULL DEFAULT N'[]' CONSTRAINT CK_cfd_options CHECK (ISJSON(options) = 1),
    is_required         bit NOT NULL DEFAULT 0,
    validation          nvarchar(max) NOT NULL DEFAULT N'{}' CONSTRAINT CK_cfd_validation CHECK (ISJSON(validation) = 1),
    visible_to_customer bit NOT NULL DEFAULT 1,
    category_id         uniqueidentifier NULL CONSTRAINT FK_cfd_category REFERENCES ccs.ticket_categories(id) ON DELETE CASCADE,
    category_key        AS (ISNULL(category_id, CAST('00000000-0000-0000-0000-000000000000' AS uniqueidentifier))) PERSISTED,
    is_active           bit NOT NULL DEFAULT 1,
    sort_order          int NOT NULL DEFAULT 0,
    CONSTRAINT CK_cfd_key_fmt CHECK ([key] NOT LIKE '%[^a-z0-9_]%' AND LEFT([key],1) LIKE '[a-z]' AND LEN([key]) BETWEEN 2 AND 41)
);
CREATE UNIQUE INDEX UX_cfd_label_en ON ccs.custom_field_definitions (category_key, label_en);
CREATE UNIQUE INDEX UX_cfd_label_ar ON ccs.custom_field_definitions (category_key, label_ar);

CREATE TABLE ccs.canned_responses (
    id         uniqueidentifier NOT NULL CONSTRAINT PK_canned_responses PRIMARY KEY DEFAULT NEWID(),
    owner_id   uniqueidentifier NOT NULL CONSTRAINT FK_canned_owner REFERENCES ccs.profiles(id) ON DELETE CASCADE,
    is_shared  bit NOT NULL DEFAULT 0,
    title      nvarchar(120) NOT NULL CONSTRAINT CK_canned_title CHECK (LEN(LTRIM(RTRIM(title))) BETWEEN 2 AND 120),
    body       nvarchar(max) NOT NULL CONSTRAINT CK_canned_body CHECK (LEN(LTRIM(RTRIM(body))) BETWEEN 2 AND 5000),
    language   nvarchar(3) NOT NULL DEFAULT N'any' CONSTRAINT CK_canned_language CHECK (language IN ('any','en','ar')),
    is_active  bit NOT NULL DEFAULT 1,
    created_at datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_canned_personal_title ON ccs.canned_responses (owner_id, title) WHERE is_shared = 0;
CREATE UNIQUE INDEX UX_canned_shared_title   ON ccs.canned_responses (title) WHERE is_shared = 1;
GO

/* ---------------------------------------------------------------------
   5. SLA policies
   --------------------------------------------------------------------- */
CREATE TABLE ccs.sla_policies (
    id                        uniqueidentifier NOT NULL CONSTRAINT PK_sla_policies PRIMARY KEY DEFAULT NEWID(),
    name                      nvarchar(120) NOT NULL,
    priority                  nvarchar(40) NOT NULL CONSTRAINT FK_sla_priority REFERENCES ccs.priorities(code),
    first_response_minutes    int NOT NULL CONSTRAINT CK_sla_frm CHECK (first_response_minutes > 0),
    resolution_minutes        int NOT NULL CONSTRAINT CK_sla_rm CHECK (resolution_minutes > 0),
    warning_threshold_pct     int NOT NULL DEFAULT 80 CONSTRAINT CK_sla_warn CHECK (warning_threshold_pct BETWEEN 1 AND 99),
    pause_on_pending_customer bit NOT NULL DEFAULT 1,
    pause_on_pending_internal bit NOT NULL DEFAULT 0,
    business_hours_id         uniqueidentifier NULL CONSTRAINT FK_sla_bh REFERENCES ccs.business_hours(id),
    escalation_rules          nvarchar(max) NOT NULL DEFAULT N'[]' CONSTRAINT CK_sla_rules CHECK (ISJSON(escalation_rules) = 1),
    is_active                 bit NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX UX_sla_active_priority ON ccs.sla_policies (priority) WHERE is_active = 1;
GO

/* ---------------------------------------------------------------------
   6. Tickets
   --------------------------------------------------------------------- */
CREATE TABLE ccs.ticket_counters (
    [year]     int NOT NULL CONSTRAINT PK_ticket_counters PRIMARY KEY,
    last_value int NOT NULL DEFAULT 0
);

CREATE TABLE ccs.tickets (
    id                 uniqueidentifier NOT NULL DEFAULT NEWID(),
    seq                bigint IDENTITY(1,1) NOT NULL,                 -- clustering key, avoids random-guid page splits
    reference          nvarchar(30) NOT NULL CONSTRAINT UQ_tickets_reference UNIQUE,
    requester_id       uniqueidentifier NOT NULL CONSTRAINT FK_tickets_requester REFERENCES ccs.profiles(id),
    subject            nvarchar(200) NOT NULL CONSTRAINT CK_tickets_subject CHECK (LEN(subject) BETWEEN 3 AND 200),
    description        nvarchar(max) NOT NULL CONSTRAINT CK_tickets_description CHECK (LEN(description) BETWEEN 10 AND 10000),
    ticket_type_id     uniqueidentifier NULL CONSTRAINT FK_tickets_type REFERENCES ccs.ticket_types(id),
    category_id        uniqueidentifier NOT NULL CONSTRAINT FK_tickets_category REFERENCES ccs.ticket_categories(id),
    subcategory_id     uniqueidentifier NULL CONSTRAINT FK_tickets_subcategory REFERENCES ccs.ticket_subcategories(id),
    priority           nvarchar(40) NOT NULL DEFAULT N'normal' CONSTRAINT FK_tickets_priority REFERENCES ccs.priorities(code),
    status             nvarchar(20) NOT NULL DEFAULT N'new' CONSTRAINT CK_tickets_status CHECK (status IN ('new','open','in_progress','pending_customer','pending_internal','resolved','closed','reopened')),
    team_id            uniqueidentifier NULL CONSTRAINT FK_tickets_team REFERENCES ccs.teams(id),
    assigned_agent_id  uniqueidentifier NULL CONSTRAINT FK_tickets_agent REFERENCES ccs.profiles(id),
    resolution_summary nvarchar(max) NULL,
    resolved_at        datetimeoffset(7) NULL,
    resolved_by        uniqueidentifier NULL CONSTRAINT FK_tickets_resolved_by REFERENCES ccs.profiles(id),
    closed_at          datetimeoffset(7) NULL,
    closed_by          uniqueidentifier NULL CONSTRAINT FK_tickets_closed_by REFERENCES ccs.profiles(id),
    closure_reason     nvarchar(40) NULL CONSTRAINT FK_tickets_closure_reason REFERENCES ccs.closure_reasons(code),
    reopened_count     int NOT NULL DEFAULT 0,
    created_by         uniqueidentifier NULL CONSTRAINT FK_tickets_created_by REFERENCES ccs.profiles(id),
    created_at         datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at         datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    row_version        rowversion NOT NULL,                             -- optimistic concurrency (replaces SELECT ... FOR UPDATE races)
    CONSTRAINT PK_tickets PRIMARY KEY NONCLUSTERED (id)
);
CREATE UNIQUE CLUSTERED INDEX CX_tickets_seq ON ccs.tickets (seq);
CREATE INDEX IX_tickets_agent ON ccs.tickets (assigned_agent_id);
CREATE INDEX IX_tickets_category ON ccs.tickets (category_id);
CREATE INDEX IX_tickets_created_by ON ccs.tickets (created_by);
CREATE INDEX IX_tickets_created ON ccs.tickets (created_at DESC);
CREATE INDEX IX_tickets_requester_created ON ccs.tickets (requester_id, created_at DESC);
CREATE INDEX IX_tickets_status ON ccs.tickets (status) INCLUDE (assigned_agent_id, team_id, updated_at);
CREATE INDEX IX_tickets_team_status ON ccs.tickets (team_id, status);
CREATE INDEX IX_tickets_type ON ccs.tickets (ticket_type_id);
CREATE INDEX IX_tickets_updated ON ccs.tickets (updated_at DESC);
GO

CREATE TABLE ccs.ticket_messages (
    id         uniqueidentifier NOT NULL CONSTRAINT PK_ticket_messages PRIMARY KEY DEFAULT NEWID(),
    ticket_id  uniqueidentifier NOT NULL CONSTRAINT FK_messages_ticket REFERENCES ccs.tickets(id) ON DELETE CASCADE,
    author_id  uniqueidentifier NULL CONSTRAINT FK_messages_author REFERENCES ccs.profiles(id),
    kind       nvarchar(20) NOT NULL CONSTRAINT CK_messages_kind CHECK (kind IN ('public_reply','internal_note','system')),
    body       nvarchar(max) NOT NULL CONSTRAINT CK_messages_body CHECK (LEN(body) BETWEEN 1 AND 10000),
    created_at datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    edited_at  datetimeoffset(7) NULL,
    deleted_at datetimeoffset(7) NULL
);
CREATE INDEX IX_messages_ticket ON ccs.ticket_messages (ticket_id, created_at);
CREATE INDEX IX_messages_author_created ON ccs.ticket_messages (author_id, created_at DESC);

CREATE TABLE ccs.ticket_attachments (
    id           uniqueidentifier NOT NULL CONSTRAINT PK_ticket_attachments PRIMARY KEY DEFAULT NEWID(),
    ticket_id    uniqueidentifier NOT NULL CONSTRAINT FK_attachments_ticket REFERENCES ccs.tickets(id) ON DELETE CASCADE,
    message_id   uniqueidentifier NULL CONSTRAINT FK_attachments_message REFERENCES ccs.ticket_messages(id),  -- app nulls it on message delete
    storage_path nvarchar(400) NOT NULL CONSTRAINT UQ_attachments_path UNIQUE,
    file_name    nvarchar(255) NOT NULL CONSTRAINT CK_attachments_name CHECK (LEN(file_name) BETWEEN 1 AND 255),
    mime_type    nvarchar(120) NOT NULL,
    size_bytes   bigint NOT NULL CONSTRAINT CK_attachments_size CHECK (size_bytes > 0 AND size_bytes <= 52428800),
    uploaded_by  uniqueidentifier NOT NULL CONSTRAINT FK_attachments_uploader REFERENCES ccs.profiles(id),
    scan_status  nvarchar(12) NOT NULL DEFAULT N'pending' CONSTRAINT CK_attachments_scan CHECK (scan_status IN ('pending','clean','infected','skipped')),  -- new in v2
    created_at   datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_attachments_ticket ON ccs.ticket_attachments (ticket_id);
CREATE INDEX IX_attachments_message ON ccs.ticket_attachments (message_id);
CREATE INDEX IX_attachments_uploader_created ON ccs.ticket_attachments (uploaded_by, created_at DESC);

CREATE TABLE ccs.ticket_status_history (
    id             uniqueidentifier NOT NULL CONSTRAINT PK_status_history PRIMARY KEY DEFAULT NEWID(),
    ticket_id      uniqueidentifier NOT NULL CONSTRAINT FK_status_history_ticket REFERENCES ccs.tickets(id) ON DELETE CASCADE,
    from_status    nvarchar(20) NULL,
    to_status      nvarchar(20) NOT NULL,
    changed_by     uniqueidentifier NULL CONSTRAINT FK_status_history_by REFERENCES ccs.profiles(id),
    reason         nvarchar(1000) NULL,
    closure_reason nvarchar(40) NULL,
    created_at     datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_status_history_ticket ON ccs.ticket_status_history (ticket_id, created_at);

CREATE TABLE ccs.ticket_status_transitions (
    from_status     nvarchar(20) NOT NULL,
    to_status       nvarchar(20) NOT NULL,
    actor           nvarchar(10) NOT NULL CONSTRAINT CK_transitions_actor CHECK (actor IN ('staff','customer')),
    requires_reason bit NOT NULL DEFAULT 0,
    CONSTRAINT PK_ticket_status_transitions PRIMARY KEY (from_status, to_status, actor),
    CONSTRAINT CK_transitions_statuses CHECK (
        from_status IN ('new','open','in_progress','pending_customer','pending_internal','resolved','closed','reopened') AND
        to_status   IN ('new','open','in_progress','pending_customer','pending_internal','resolved','closed','reopened') AND
        from_status <> to_status)
);

CREATE TABLE ccs.ticket_assignments (
    id          uniqueidentifier NOT NULL CONSTRAINT PK_ticket_assignments PRIMARY KEY DEFAULT NEWID(),
    ticket_id   uniqueidentifier NOT NULL CONSTRAINT FK_assignments_ticket REFERENCES ccs.tickets(id) ON DELETE CASCADE,
    from_agent  uniqueidentifier NULL CONSTRAINT FK_assignments_from_agent REFERENCES ccs.profiles(id),
    to_agent    uniqueidentifier NULL CONSTRAINT FK_assignments_to_agent REFERENCES ccs.profiles(id),
    from_team   uniqueidentifier NULL CONSTRAINT FK_assignments_from_team REFERENCES ccs.teams(id),
    to_team     uniqueidentifier NULL CONSTRAINT FK_assignments_to_team REFERENCES ccs.teams(id),
    assigned_by uniqueidentifier NOT NULL CONSTRAINT FK_assignments_by REFERENCES ccs.profiles(id),
    reason      nvarchar(1000) NULL,
    created_at  datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_assignments_ticket ON ccs.ticket_assignments (ticket_id, created_at);

CREATE TABLE ccs.ticket_links (
    id               uniqueidentifier NOT NULL CONSTRAINT PK_ticket_links PRIMARY KEY DEFAULT NEWID(),
    ticket_id        uniqueidentifier NOT NULL CONSTRAINT FK_links_ticket REFERENCES ccs.tickets(id) ON DELETE CASCADE,
    linked_ticket_id uniqueidentifier NOT NULL CONSTRAINT FK_links_linked REFERENCES ccs.tickets(id),   -- app removes reverse links
    kind             nvarchar(20) NOT NULL CONSTRAINT CK_links_kind CHECK (kind IN ('duplicate_of','follow_up_of')),
    created_by       uniqueidentifier NULL CONSTRAINT FK_links_created_by REFERENCES ccs.profiles(id),
    created_at       datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_links_not_self CHECK (ticket_id <> linked_ticket_id),
    CONSTRAINT UQ_links_ticket_kind UNIQUE (ticket_id, kind)
);
CREATE INDEX IX_links_linked ON ccs.ticket_links (linked_ticket_id);

CREATE TABLE ccs.ticket_cancellation_requests (
    id            uniqueidentifier NOT NULL CONSTRAINT PK_cancellation_requests PRIMARY KEY DEFAULT NEWID(),
    ticket_id     uniqueidentifier NOT NULL CONSTRAINT FK_cancel_ticket REFERENCES ccs.tickets(id) ON DELETE CASCADE,
    requested_by  uniqueidentifier NOT NULL CONSTRAINT FK_cancel_requested_by REFERENCES ccs.profiles(id),
    reason        nvarchar(1000) NOT NULL CONSTRAINT CK_cancel_reason CHECK (LEN(LTRIM(RTRIM(reason))) BETWEEN 3 AND 1000),
    status        nvarchar(10) NOT NULL DEFAULT N'pending' CONSTRAINT CK_cancel_status CHECK (status IN ('pending','approved','rejected','withdrawn')),
    decided_by    uniqueidentifier NULL CONSTRAINT FK_cancel_decided_by REFERENCES ccs.profiles(id),
    decided_at    datetimeoffset(7) NULL,
    decision_note nvarchar(1000) NULL,
    created_at    datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_cancel_one_pending ON ccs.ticket_cancellation_requests (ticket_id) WHERE status = N'pending';

CREATE TABLE ccs.customer_feedback (
    ticket_id    uniqueidentifier NOT NULL CONSTRAINT PK_customer_feedback PRIMARY KEY
                 CONSTRAINT FK_feedback_ticket REFERENCES ccs.tickets(id) ON DELETE CASCADE,
    rating       smallint NOT NULL CONSTRAINT CK_feedback_rating CHECK (rating BETWEEN 1 AND 5),
    comment      nvarchar(2000) NULL,
    submitted_by uniqueidentifier NOT NULL CONSTRAINT FK_feedback_by REFERENCES ccs.profiles(id),
    created_at   datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE ccs.ticket_custom_field_values (
    ticket_id uniqueidentifier NOT NULL CONSTRAINT FK_cfv_ticket REFERENCES ccs.tickets(id) ON DELETE CASCADE,
    field_id  uniqueidentifier NOT NULL CONSTRAINT FK_cfv_field REFERENCES ccs.custom_field_definitions(id),
    value     nvarchar(max) NOT NULL CONSTRAINT CK_cfv_value CHECK (ISJSON(value) = 1 OR value IN ('true','false','null') OR ISNUMERIC(value) = 1 OR (LEN(value) >= 2 AND LEFT(value, 1) = N'"' AND RIGHT(value, 1) = N'"')),
    CONSTRAINT PK_ticket_custom_field_values PRIMARY KEY (ticket_id, field_id)
);
GO

/* ---------------------------------------------------------------------
   7. SLA runtime
   --------------------------------------------------------------------- */
CREATE TABLE ccs.ticket_sla_records (
    ticket_id            uniqueidentifier NOT NULL CONSTRAINT PK_sla_records PRIMARY KEY
                         CONSTRAINT FK_sla_records_ticket REFERENCES ccs.tickets(id) ON DELETE CASCADE,
    policy_id            uniqueidentifier NULL CONSTRAINT FK_sla_records_policy REFERENCES ccs.sla_policies(id),
    first_response_due   datetimeoffset(7) NULL,
    resolution_due       datetimeoffset(7) NULL,
    first_responded_at   datetimeoffset(7) NULL,
    resolved_at          datetimeoffset(7) NULL,
    paused_at            datetimeoffset(7) NULL,
    paused_total_seconds int NOT NULL DEFAULT 0,
    state                nvarchar(12) NOT NULL DEFAULT N'on_track' CONSTRAINT CK_sla_records_state CHECK (state IN ('on_track','due_soon','breached','paused','completed')),
    warning_sent_at      datetimeoffset(7) NULL,
    breached_at          datetimeoffset(7) NULL,
    breach_notified_at   datetimeoffset(7) NULL,
    cycle_no             int NOT NULL DEFAULT 1,
    cycle_started_at     datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at           datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_sla_records_state ON ccs.ticket_sla_records (state, resolution_due);

CREATE TABLE ccs.ticket_sla_cycles (
    id                   uniqueidentifier NOT NULL CONSTRAINT PK_sla_cycles PRIMARY KEY DEFAULT NEWID(),
    ticket_id            uniqueidentifier NOT NULL CONSTRAINT FK_sla_cycles_ticket REFERENCES ccs.tickets(id) ON DELETE CASCADE,
    cycle_no             int NOT NULL,
    kind                 nvarchar(10) NOT NULL CONSTRAINT CK_sla_cycles_kind CHECK (kind IN ('initial','reopen')),
    started_at           datetimeoffset(7) NOT NULL,
    ended_at             datetimeoffset(7) NOT NULL,
    policy_id            uniqueidentifier NULL CONSTRAINT FK_sla_cycles_policy REFERENCES ccs.sla_policies(id),
    first_response_due   datetimeoffset(7) NULL,
    resolution_due       datetimeoffset(7) NULL,
    first_responded_at   datetimeoffset(7) NULL,
    resolved_at          datetimeoffset(7) NULL,
    breached_at          datetimeoffset(7) NULL,
    state                nvarchar(12) NULL CONSTRAINT CK_sla_cycles_state CHECK (state IN ('on_track','due_soon','breached','paused','completed')),
    paused_total_seconds int NOT NULL DEFAULT 0,
    CONSTRAINT UQ_sla_cycles UNIQUE (ticket_id, cycle_no)
);

CREATE TABLE ccs.ticket_sla_events (
    id         uniqueidentifier NOT NULL CONSTRAINT PK_sla_events PRIMARY KEY DEFAULT NEWID(),
    ticket_id  uniqueidentifier NOT NULL CONSTRAINT FK_sla_events_ticket REFERENCES ccs.tickets(id) ON DELETE CASCADE,
    clock      nvarchar(20) NOT NULL CONSTRAINT CK_sla_events_clock CHECK (clock IN ('first_response','resolution')),
    event      nvarchar(10) NOT NULL CONSTRAINT CK_sla_events_event CHECK (event IN ('warning','breach')),
    cycle_no   int NOT NULL DEFAULT 1,
    created_at datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_sla_events_cycle UNIQUE (ticket_id, cycle_no, clock, event)   -- "fires once per ticket and clock"
);
GO

/* ---------------------------------------------------------------------
   8. Knowledge base
   --------------------------------------------------------------------- */
CREATE TABLE ccs.kb_categories (
    id         uniqueidentifier NOT NULL CONSTRAINT PK_kb_categories PRIMARY KEY DEFAULT NEWID(),
    slug       nvarchar(81) NOT NULL CONSTRAINT UQ_kb_categories_slug UNIQUE,
    name_en    nvarchar(120) NOT NULL,
    name_ar    nvarchar(120) NOT NULL,
    sort_order int NOT NULL DEFAULT 0,
    is_active  bit NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX UX_kb_categories_name_en ON ccs.kb_categories (name_en);
CREATE UNIQUE INDEX UX_kb_categories_name_ar ON ccs.kb_categories (name_ar);

CREATE TABLE ccs.kb_articles (
    id                uniqueidentifier NOT NULL CONSTRAINT PK_kb_articles PRIMARY KEY DEFAULT NEWID(),
    category_id       uniqueidentifier NULL CONSTRAINT FK_kb_articles_category REFERENCES ccs.kb_categories(id),
    slug              nvarchar(81) NOT NULL CONSTRAINT UQ_kb_articles_slug UNIQUE,
    title_en          nvarchar(200) NOT NULL,
    title_ar          nvarchar(200) NULL,
    body_en           nvarchar(max) NOT NULL,
    body_ar           nvarchar(max) NULL,
    status            nvarchar(10) NOT NULL DEFAULT N'draft' CONSTRAINT CK_kb_status CHECK (status IN ('draft','published','archived')),
    visibility        nvarchar(10) NOT NULL DEFAULT N'customers' CONSTRAINT CK_kb_visibility CHECK (visibility IN ('public','customers','internal')),
    helpful_count     int NOT NULL DEFAULT 0,
    not_helpful_count int NOT NULL DEFAULT 0,
    published_at      datetimeoffset(7) NULL,
    created_by        uniqueidentifier NULL CONSTRAINT FK_kb_articles_created_by REFERENCES ccs.profiles(id),
    created_at        datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at        datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE ccs.kb_feedback (
    article_id uniqueidentifier NOT NULL CONSTRAINT FK_kb_feedback_article REFERENCES ccs.kb_articles(id) ON DELETE CASCADE,
    user_id    uniqueidentifier NOT NULL CONSTRAINT FK_kb_feedback_user REFERENCES ccs.profiles(id) ON DELETE CASCADE,
    helpful    bit NOT NULL,
    created_at datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_kb_feedback PRIMARY KEY (article_id, user_id)
);
GO

/* ---------------------------------------------------------------------
   9. Messaging
   --------------------------------------------------------------------- */
CREATE TABLE ccs.notifications (
    id         uniqueidentifier NOT NULL CONSTRAINT PK_notifications PRIMARY KEY DEFAULT NEWID(),
    user_id    uniqueidentifier NOT NULL CONSTRAINT FK_notifications_user REFERENCES ccs.profiles(id) ON DELETE CASCADE,
    event_type nvarchar(40) NOT NULL,
    ticket_id  uniqueidentifier NULL CONSTRAINT FK_notifications_ticket REFERENCES ccs.tickets(id),   -- app deletes with ticket
    channel    nvarchar(10) NOT NULL CONSTRAINT CK_notifications_channel CHECK (channel IN ('in_app','email')),
    payload    nvarchar(max) NOT NULL DEFAULT N'{}' CONSTRAINT CK_notifications_payload CHECK (ISJSON(payload) = 1),
    dedupe_key nvarchar(300) NOT NULL CONSTRAINT UQ_notifications_dedupe UNIQUE,
    status     nvarchar(10) NOT NULL DEFAULT N'pending' CONSTRAINT CK_notifications_status CHECK (status IN ('pending','sent','failed')),
    attempts   int NOT NULL DEFAULT 0,
    last_error nvarchar(2000) NULL,
    locked_until datetimeoffset(7) NULL,          -- new in v2: claim lease for the email worker
    read_at    datetimeoffset(7) NULL,
    sent_at    datetimeoffset(7) NULL,
    created_at datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_notifications_email_pending ON ccs.notifications (created_at) WHERE channel = N'email' AND status = N'pending';
CREATE INDEX IX_notifications_ticket ON ccs.notifications (ticket_id);
CREATE INDEX IX_notifications_unread ON ccs.notifications (user_id) WHERE channel = N'in_app' AND read_at IS NULL;
CREATE INDEX IX_notifications_user ON ccs.notifications (user_id, created_at DESC);

CREATE TABLE ccs.email_templates (
    event      nvarchar(40) NOT NULL,
    locale     nvarchar(2) NOT NULL CONSTRAINT CK_email_templates_locale CHECK (locale IN ('en','ar')),
    subject    nvarchar(200) NOT NULL DEFAULT N'',
    body       nvarchar(2000) NOT NULL DEFAULT N'',
    button     nvarchar(60) NOT NULL DEFAULT N'',
    link       nvarchar(300) NOT NULL DEFAULT N'',
    updated_at datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by uniqueidentifier NULL CONSTRAINT FK_email_templates_by REFERENCES ccs.profiles(id),
    CONSTRAINT PK_email_templates PRIMARY KEY (event, locale),
    CONSTRAINT CK_email_templates_event CHECK (event NOT LIKE '%[^a-z_]%' AND LEN(event) BETWEEN 3 AND 40)
);

CREATE TABLE ccs.email_settings (
    id              int NOT NULL CONSTRAINT PK_email_settings PRIMARY KEY CONSTRAINT CK_email_settings_single CHECK (id = 1),
    host            nvarchar(255) NOT NULL DEFAULT N'',
    port            int NOT NULL DEFAULT 587 CONSTRAINT CK_email_settings_port CHECK (port BETWEEN 1 AND 65535),
    security        nvarchar(10) NOT NULL DEFAULT N'starttls' CONSTRAINT CK_email_settings_security CHECK (security IN ('none','starttls','ssl')),
    username        nvarchar(255) NOT NULL DEFAULT N'',
    password_enc    nvarchar(max) NULL,          -- ASP.NET Data Protection ciphertext, re-entered after migration
    has_password    bit NULL,
    from_name       nvarchar(120) NOT NULL DEFAULT N'',
    from_email      nvarchar(256) NOT NULL DEFAULT N'',
    reply_to        nvarchar(256) NOT NULL DEFAULT N'',
    use_smtp        bit NOT NULL DEFAULT 0,
    design          nvarchar(max) NOT NULL DEFAULT N'{}' CONSTRAINT CK_email_settings_design CHECK (ISJSON(design) = 1),
    last_test_at    datetimeoffset(7) NULL,
    last_test_ok    bit NULL,
    last_test_error nvarchar(2000) NULL,
    updated_at      datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by      uniqueidentifier NULL CONSTRAINT FK_email_settings_by REFERENCES ccs.profiles(id)
);

CREATE TABLE ccs.system_messages (
    [key]      nvarchar(80) NOT NULL,
    locale     nvarchar(2) NOT NULL CONSTRAINT CK_system_messages_locale CHECK (locale IN ('en','ar')),
    body       nvarchar(1000) NOT NULL CONSTRAINT CK_system_messages_body CHECK (LEN(body) >= 1),
    updated_at datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by uniqueidentifier NULL CONSTRAINT FK_system_messages_by REFERENCES ccs.profiles(id),
    CONSTRAINT PK_system_messages PRIMARY KEY ([key], locale)
);
GO

/* ---------------------------------------------------------------------
   10. Settings
   --------------------------------------------------------------------- */
CREATE TABLE ccs.app_settings (
    [key]       nvarchar(80) NOT NULL CONSTRAINT PK_app_settings PRIMARY KEY,
    value       nvarchar(max) NOT NULL CONSTRAINT CK_app_settings_value CHECK (ISJSON(value) = 1 OR value IN ('true','false','null') OR ISNUMERIC(value) = 1 OR LEFT(value,1) = '"'),
    description nvarchar(500) NULL
);

CREATE TABLE ccs.site_settings (
    id                 int NOT NULL CONSTRAINT PK_site_settings PRIMARY KEY CONSTRAINT CK_site_settings_single CHECK (id = 1),
    site_name_en       nvarchar(80) NOT NULL DEFAULT N'AZKA Technology',
    site_name_ar       nvarchar(80) NOT NULL DEFAULT N'اذكي تكنولوجي',
    header_name_en     nvarchar(60) NOT NULL DEFAULT N'AZKA Technology',
    header_name_ar     nvarchar(60) NOT NULL DEFAULT N'اذكي تكنولوجي',
    header_sub_en      nvarchar(80) NOT NULL DEFAULT N'Customer Care System',
    header_sub_ar      nvarchar(80) NOT NULL DEFAULT N'نظام خدمة العملاء',
    logo_path          nvarchar(200) NULL,
    favicon_path       nvarchar(200) NULL,
    footer_text_en     nvarchar(300) NOT NULL DEFAULT N'',
    footer_text_ar     nvarchar(300) NOT NULL DEFAULT N'',
    contact_email      nvarchar(256) NULL,
    contact_phone      nvarchar(30) NULL,
    contact_hours_en   nvarchar(120) NOT NULL DEFAULT N'',
    contact_hours_ar   nvarchar(120) NOT NULL DEFAULT N'',
    brand_color        nvarchar(7) NULL CONSTRAINT CK_site_brand_color CHECK (brand_color IS NULL OR brand_color LIKE '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]'),
    home_title_en      nvarchar(120) NOT NULL DEFAULT N'',
    home_title_ar      nvarchar(120) NOT NULL DEFAULT N'',
    home_intro_en      nvarchar(300) NOT NULL DEFAULT N'',
    home_intro_ar      nvarchar(300) NOT NULL DEFAULT N'',
    login_notice_en    nvarchar(300) NOT NULL DEFAULT N'',
    login_notice_ar    nvarchar(300) NOT NULL DEFAULT N'',
    home_content       nvarchar(max) NOT NULL DEFAULT N'{}' CONSTRAINT CK_site_home_content CHECK (ISJSON(home_content) = 1 AND LEN(home_content) < 20000),
    upload_max_mb      int NOT NULL DEFAULT 10 CONSTRAINT CK_site_upload_mb CHECK (upload_max_mb BETWEEN 1 AND 50),
    upload_max_files   int NOT NULL DEFAULT 5 CONSTRAINT CK_site_upload_files CHECK (upload_max_files BETWEEN 1 AND 20),
    upload_extensions  nvarchar(max) NOT NULL DEFAULT N'["pdf","png","jpg","jpeg","txt","docx","xlsx"]' CONSTRAINT CK_site_upload_ext CHECK (ISJSON(upload_extensions) = 1),
    registration_mode  nvarchar(15) NOT NULL DEFAULT N'approval' CONSTRAINT CK_site_registration CHECK (registration_mode IN ('closed','approval','pick_approval','pick_auto')),
    priority_mode      nvarchar(10) NOT NULL DEFAULT N'system' CONSTRAINT CK_site_priority_mode CHECK (priority_mode IN ('system','customer')),
    updated_at         datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by         uniqueidentifier NULL CONSTRAINT FK_site_settings_by REFERENCES ccs.profiles(id)
);

CREATE TABLE ccs.menu_items (
    id         uniqueidentifier NOT NULL CONSTRAINT PK_menu_items PRIMARY KEY DEFAULT NEWID(),
    area       nvarchar(10) NOT NULL CONSTRAINT CK_menu_area CHECK (area IN ('header','footer','console','admin','general')),
    parent_id  uniqueidentifier NULL CONSTRAINT FK_menu_parent REFERENCES ccs.menu_items(id),   -- app deletes children
    kind       nvarchar(5) NOT NULL DEFAULT N'link' CONSTRAINT CK_menu_kind CHECK (kind IN ('link','group')),
    label_en   nvarchar(60) NOT NULL CONSTRAINT CK_menu_label_en CHECK (LEN(label_en) BETWEEN 1 AND 60),
    label_ar   nvarchar(60) NOT NULL CONSTRAINT CK_menu_label_ar CHECK (LEN(label_ar) BETWEEN 1 AND 60),
    href       nvarchar(300) NULL,   -- allowed schemes (site path, http(s), mailto, tel) are validated in SettingsService
    audience   nvarchar(10) NOT NULL DEFAULT N'all' CONSTRAINT CK_menu_audience CHECK (audience IN ('all','guest','signed_in','customer','staff')),
    new_tab    bit NOT NULL DEFAULT 0,
    is_visible bit NOT NULL DEFAULT 1,
    sort_order int NOT NULL DEFAULT 0,
    system_key nvarchar(30) NULL,
    created_at datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_menu_link_href CHECK ((kind = 'link' AND href IS NOT NULL) OR kind = 'group')
);
CREATE UNIQUE INDEX UX_menu_system_key ON ccs.menu_items (system_key) WHERE system_key IS NOT NULL;
CREATE INDEX IX_menu_area ON ccs.menu_items (area, parent_id, sort_order);

CREATE TABLE ccs.captcha_settings (
    id         int NOT NULL CONSTRAINT PK_captcha_settings PRIMARY KEY CONSTRAINT CK_captcha_single CHECK (id = 1),
    enabled    bit NOT NULL DEFAULT 0,
    provider   nvarchar(20) NOT NULL DEFAULT N'turnstile' CONSTRAINT CK_captcha_provider CHECK (provider IN ('turnstile','self_hosted')),  -- open decision #3
    site_key   nvarchar(200) NOT NULL DEFAULT N'',
    secret_enc nvarchar(max) NULL   -- Data Protection ciphertext; re-entered after migration
);

CREATE TABLE ccs.signin_code_settings (
    id               int NOT NULL CONSTRAINT PK_signin_code_settings PRIMARY KEY CONSTRAINT CK_signin_code_single CHECK (id = 1),
    enabled          bit NOT NULL DEFAULT 0,
    audience         nvarchar(10) NOT NULL DEFAULT N'customers' CONSTRAINT CK_signin_code_audience CHECK (audience IN ('customers','all')),
    code_length      int NOT NULL DEFAULT 6  CONSTRAINT CK_signin_code_len CHECK (code_length BETWEEN 4 AND 10),
    valid_minutes    int NOT NULL DEFAULT 10 CONSTRAINT CK_signin_code_valid CHECK (valid_minutes BETWEEN 1 AND 60),
    max_attempts     int NOT NULL DEFAULT 5  CONSTRAINT CK_signin_code_attempts CHECK (max_attempts BETWEEN 1 AND 10),
    cooldown_seconds int NOT NULL DEFAULT 60 CONSTRAINT CK_signin_code_cooldown CHECK (cooldown_seconds BETWEEN 0 AND 600),
    daily_limit      int NOT NULL DEFAULT 10 CONSTRAINT CK_signin_code_daily CHECK (daily_limit BETWEEN 1 AND 100),
    updated_at       datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by       uniqueidentifier NULL
);
GO

/* ---------------------------------------------------------------------
   11. Audit
   --------------------------------------------------------------------- */
CREATE TABLE ccs.audit_logs (
    id          bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_audit_logs PRIMARY KEY,
    actor_id    uniqueidentifier NULL,     -- no FK: audit rows outlive deleted users
    action      nvarchar(80) NOT NULL,
    entity_type nvarchar(60) NOT NULL,
    entity_id   uniqueidentifier NULL,
    [before]    nvarchar(max) NULL CONSTRAINT CK_audit_before CHECK ([before] IS NULL OR ISJSON([before]) = 1),
    [after]     nvarchar(max) NULL CONSTRAINT CK_audit_after  CHECK ([after]  IS NULL OR ISJSON([after]) = 1),
    ip_address  nvarchar(64) NULL,
    created_at  datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_audit_actor ON ccs.audit_logs (actor_id, created_at DESC);
CREATE INDEX IX_audit_entity ON ccs.audit_logs (entity_type, entity_id, created_at DESC);
GO

/* Rate-limit counters (spec: ASP.NET Core rate limiting plus database counters) */
CREATE TABLE ccs.rate_counters (
    bucket       nvarchar(120) NOT NULL,     -- e.g. tickets:{userId}
    window_start datetimeoffset(7) NOT NULL,
    hits         int NOT NULL DEFAULT 0,
    CONSTRAINT PK_rate_counters PRIMARY KEY (bucket, window_start)
);
GO
