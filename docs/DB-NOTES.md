# Database notes: PostgreSQL to SQL Server

## Delete rules moved into services

SQL Server refuses a foreign key with ON DELETE CASCADE or SET NULL when it creates a second path or a cycle.
The table lists every rule PostgreSQL had that is now `NO ACTION` in SQL Server, and which service must do it.

| PostgreSQL rule | Now enforced by |
|---|---|
| organizations.parent_id ON DELETE SET NULL | UserAdminService.DeleteOrganization: clear children's parent_id first |
| organizations.team_leader_id / branches.team_leader_id SET NULL | UserAdminService.DeleteUser: clear leader columns first |
| organizations.business_hours_id / branches / teams SET NULL | SlaAdminService.DeleteCalendar: clear references first |
| profiles.organization_id / branch_id SET NULL | UserAdminService.DeleteOrganization / DeleteBranch |
| admin_scopes / staff_placement / account_type_access -> org, branch CASCADE | UserAdminService.DeleteOrganization / DeleteBranch: delete rows first |
| tickets.created_by / closed_by SET NULL | UserAdminService.DeleteUser (staff with tickets are suspended, not deleted) |
| ticket_attachments.message_id SET NULL | TicketService.DeleteMessage (soft delete keeps the row, so nothing to do) |
| ticket_links.linked_ticket_id CASCADE | TicketService: remove both link directions |
| ticket_cancellation_requests.requested_by CASCADE / decided_by SET NULL | UserAdminService.DeleteUser |
| notifications.ticket_id CASCADE | Ticket deletion (none today: tickets are never deleted) |
| menu_items.parent_id CASCADE | SettingsService.DeleteMenuItem: delete children first |
| kb_articles.category_id SET NULL | KbService.DeleteCategory |
| ticket_categories.default_team_id SET NULL | TeamService.DeleteTeam |
| email_templates / system_messages / site_settings.updated_by SET NULL | UserAdminService.DeleteUser |

Every one of these gets a unit test when its service is built (spec 8: "each rule enforced by a trigger needs a test").

## Triggers moved into services

| PostgreSQL trigger | Now in |
|---|---|
| trg_notify_ticket_created / assignment / message / status / priority | NotificationService.On* (called by TicketService, LifecycleService) |
| sla_set_due | SlaService.StartAsync |
| trg_ticket_fixed_priority / ticket_fixed_priority | TicketService.CreateAsync / SetPriorityAsync |
| trg_ticket_types_guard, trg_category_link_types | TicketService.CreateAsync (type must offer the category) |
| custom_value_check | CustomFieldValidator |
| limit_ticket_rate / limit_message_rate / limit_attachment_rate | TicketService (DB counts) + ASP.NET rate limiter |
| trg_password_changed | AuthService.PasswordChangedAsync |
| audit_config_change, write_audit | AuditService.Write |
| handle_new_user, handle_user_confirmed | AuthService.RegisterAsync / ConfirmEmailAsync |
| status_flow_problems | StatusFlow.Problems |
| set_updated_at | Each service sets UpdatedAt |
| still to port: trg_check_team_leader, organizations_parent_check, menu_items_protect, kb_articles_before_write, custom_field_def_check | Stages 3 and 8 |

## Types

* `timestamptz` is `datetimeoffset(7)`, always written in UTC.
* `jsonb` is `nvarchar(max)` with an `ISJSON` check. `text[]` (upload_extensions) is a JSON array.
* Enums are `nvarchar` with CHECK constraints, using the same strings as PostgreSQL.
* The tickets table is clustered on an identity `seq` column, so random GUIDs do not cause page splits. `row_version` gives optimistic concurrency where PostgreSQL used `SELECT ... FOR UPDATE`.
* Knowledge-base search uses a full-text index (`03_fulltext.sql`, languages 1033 and 1025) instead of tsvector.
