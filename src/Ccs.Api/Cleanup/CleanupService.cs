using System.Data;
using System.Data.Common;
using System.Text.Json;
using Ccs.Application.Abstractions;
using Ccs.Application.Common;
using Ccs.Domain;
using Ccs.Infrastructure.Identity;
using Ccs.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Ccs.Api.Cleanup;

/// <summary>What the administrator picked on Settings → Clean up data. Empty or null parts are skipped.</summary>
public sealed record CleanupRequest(
    CleanupTickets? Tickets = null,
    CleanupCustomers? Customers = null,
    Guid[]? StaffIds = null,
    CleanupTeams? Teams = null,
    CleanupPlaces? Places = null,
    CleanupCatalog? Catalog = null,
    Guid[]? KbArticleIds = null,
    Guid[]? KbCategoryIds = null,
    Guid[]? CannedIds = null,
    CleanupCalendars? Calendars = null,
    int? NotificationsOlderThanDays = null,
    bool Sessions = false);

/// <summary>Mode "filter" uses Status / CreatedBefore / OrganizationId; mode "pick" uses Ids.</summary>
public sealed record CleanupTickets(string Mode, string? Status = null, DateOnly? CreatedBefore = null, Guid? OrganizationId = null, Guid[]? Ids = null);
/// <summary>All customers matching Status when AllMatching, otherwise the picked Ids. DeleteTickets also removes their tickets.</summary>
public sealed record CleanupCustomers(bool AllMatching, string? Status = null, Guid[]? Ids = null, bool DeleteTickets = false);
public sealed record CleanupTeams(Guid[] Ids, Guid? MoveTicketsTo = null, Guid? MoveCategoriesTo = null);
/// <summary>Organizations (with all their branches) and single branches. RemovePeople removes the people placed there too.</summary>
public sealed record CleanupPlaces(Guid[]? OrganizationIds = null, Guid[]? BranchIds = null, bool RemovePeople = false);
public sealed record CleanupCatalog(Guid[]? TypeIds = null, Guid[]? CategoryIds = null, Guid[]? SubcategoryIds = null, Guid[]? FieldIds = null);
public sealed record CleanupCalendars(Guid[]? Ids = null, bool PastHolidays = false);

/// <summary>
/// Removes what the administrator selected, in one transaction. The preview runs the very same statements
/// and rolls back, so its numbers are exact. Rules that keep history intact:
/// - a person still named in a kept ticket (customer, reply, assignment, status change, file...) is
///   anonymized and suspended instead of deleted;
/// - a team, place or catalog item still used by kept tickets is switched off instead of deleted.
/// The audit log, roles, priorities, settings, the ticket counter and the default calendar are never touched.
/// </summary>
public sealed class CleanupService(CcsDbContext db, IClock clock)
{
    private static readonly string OpenStatuses = string.Join(",", new[] { TicketStatus.New, TicketStatus.Open, TicketStatus.InProgress,
        TicketStatus.PendingCustomer, TicketStatus.PendingInternal, TicketStatus.Reopened }.Select(s => $"'{s}'"));

    /// <summary>Every column that ties a person to ticket history (kept tickets keep these names).</summary>
    private static readonly (string Table, string Column)[] HistoryColumns =
    [
        ("tickets", "requester_id"), ("tickets", "created_by"), ("tickets", "assigned_agent_id"), ("tickets", "resolved_by"), ("tickets", "closed_by"),
        ("ticket_messages", "author_id"), ("ticket_status_history", "changed_by"), ("ticket_assignments", "to_agent"),
        ("ticket_assignments", "from_agent"), ("ticket_assignments", "assigned_by"), ("ticket_attachments", "uploaded_by"),
        ("ticket_cancellation_requests", "requested_by"), ("ticket_cancellation_requests", "decided_by"), ("ticket_links", "created_by"),
        ("customer_feedback", "submitted_by"),
    ];

    public sealed record Result(Dictionary<string, long> Counts, List<string> FilesToDelete);

    public async Task<Result> RunAsync(CleanupRequest r, Guid me, bool commit, CancellationToken ct)
    {
        await using IDbContextTransaction tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var conn = db.Database.GetDbConnection();
        var dbTx = tx.GetDbTransaction();
        var counts = new Dictionary<string, long>();
        var files = new List<string>();

        async Task<int> Exec(string sql, params (string Name, object? Value)[] ps)
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = dbTx; cmd.CommandText = sql; cmd.CommandTimeout = 600;
            foreach (var (n, v) in ps) { var p = cmd.CreateParameter(); p.ParameterName = n; p.Value = v ?? DBNull.Value; cmd.Parameters.Add(p); }
            return await cmd.ExecuteNonQueryAsync(ct);
        }
        async Task<long> Scalar(string sql, params (string Name, object? Value)[] ps)
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = dbTx; cmd.CommandText = sql; cmd.CommandTimeout = 600;
            foreach (var (n, v) in ps) { var p = cmd.CreateParameter(); p.ParameterName = n; p.Value = v ?? DBNull.Value; cmd.Parameters.Add(p); }
            var o = await cmd.ExecuteScalarAsync(ct);
            return o is null or DBNull ? 0 : Convert.ToInt64(o);
        }
        void Add(string key, long n) { if (n != 0) counts[key] = counts.GetValueOrDefault(key) + n; }
        static string Json(IEnumerable<Guid>? ids) => JsonSerializer.Serialize((ids ?? []).Distinct());
        // Fills a temp table from a JSON array of ids.
        Task<int> Fill(string table, IEnumerable<Guid>? ids) => Exec(
            $"INSERT {table} (id) SELECT DISTINCT j.id FROM OPENJSON(@j) WITH (id uniqueidentifier '$') j WHERE j.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM {table} x WHERE x.id = j.id)",
            ("@j", Json(ids)));

        // Any exception leaves the transaction uncommitted; disposing it rolls everything back.
        {
            await Exec("""
                CREATE TABLE #t  (id uniqueidentifier PRIMARY KEY);
                CREATE TABLE #p  (id uniqueidentifier PRIMARY KEY, kind nvarchar(10) NOT NULL DEFAULT N'customer');
                CREATE TABLE #h  (id uniqueidentifier PRIMARY KEY);
                CREATE TABLE #tm (id uniqueidentifier PRIMARY KEY);
                CREATE TABLE #o  (id uniqueidentifier PRIMARY KEY);
                CREATE TABLE #b  (id uniqueidentifier PRIMARY KEY);
                CREATE TABLE #ty (id uniqueidentifier PRIMARY KEY);
                CREATE TABLE #ca (id uniqueidentifier PRIMARY KEY);
                CREATE TABLE #sc (id uniqueidentifier PRIMARY KEY);
                CREATE TABLE #cf (id uniqueidentifier PRIMARY KEY);
                CREATE TABLE #tk (id uniqueidentifier PRIMARY KEY);
                CREATE TABLE #ids (id uniqueidentifier PRIMARY KEY);
                """);

            // ---------- 1. Places: organizations (with their branches and child organizations) and branches
            if (r.Places is { } pl)
            {
                await Fill("#o", pl.OrganizationIds);
                await Exec("""
                    WITH tree AS (SELECT id FROM #o UNION ALL SELECT o.id FROM ccs.organizations o JOIN tree t ON o.parent_id = t.id)
                    INSERT #o (id) SELECT DISTINCT id FROM tree WHERE id NOT IN (SELECT id FROM #o);
                    """);
                await Fill("#b", pl.BranchIds);
                await Exec("INSERT #b (id) SELECT id FROM ccs.branches WHERE organization_id IN (SELECT id FROM #o) AND id NOT IN (SELECT id FROM #b)");
                if (pl.RemovePeople)
                    await Exec("""
                        INSERT #p (id, kind) SELECT p.id, CASE WHEN EXISTS (SELECT 1 FROM ccs.user_roles ur JOIN ccs.roles r ON r.id = ur.role_id WHERE ur.user_id = p.id AND r.code <> 'customer') THEN N'staff' ELSE N'customer' END
                        FROM ccs.profiles p WHERE (p.organization_id IN (SELECT id FROM #o) OR p.branch_id IN (SELECT id FROM #b)) AND p.id <> @me
                          AND p.id NOT IN (SELECT id FROM #p);
                        INSERT #p (id, kind) SELECT DISTINCT s.user_id, N'staff' FROM ccs.staff_placement s
                        WHERE (s.organization_id IN (SELECT id FROM #o) OR s.branch_id IN (SELECT id FROM #b)) AND s.user_id <> @me
                          AND NOT EXISTS (SELECT 1 FROM ccs.staff_placement x WHERE x.user_id = s.user_id AND x.organization_id NOT IN (SELECT id FROM #o) AND (x.branch_id IS NULL OR x.branch_id NOT IN (SELECT id FROM #b)))
                          AND s.user_id NOT IN (SELECT id FROM #p);
                        """, ("@me", me));
                // What the places own goes with them.
                await Exec("INSERT #tm (id) SELECT id FROM ccs.teams WHERE (organization_id IN (SELECT id FROM #o) OR branch_id IN (SELECT id FROM #b)) AND id NOT IN (SELECT id FROM #tm)");
                await Exec("INSERT #ty (id) SELECT id FROM ccs.ticket_types WHERE organization_id IN (SELECT id FROM #o) OR branch_id IN (SELECT id FROM #b)");
                await Exec("INSERT #ca (id) SELECT id FROM ccs.ticket_categories WHERE organization_id IN (SELECT id FROM #o) OR branch_id IN (SELECT id FROM #b)");
                await Exec("INSERT #sc (id) SELECT id FROM ccs.ticket_subcategories WHERE organization_id IN (SELECT id FROM #o) OR branch_id IN (SELECT id FROM #b)");
                await Exec("INSERT #tk (id) SELECT id FROM ccs.team_kinds WHERE organization_id IN (SELECT id FROM #o) OR branch_id IN (SELECT id FROM #b)");
            }

            // ---------- 2. People: customers and staff
            if (r.Customers is { } cu)
            {
                var status = cu.Status switch
                {
                    "never" => "AND NOT EXISTS (SELECT 1 FROM ccs.refresh_tokens rt WHERE rt.user_id = p.id)",
                    "suspended" => $"AND p.account_status = '{AccountStatus.Suspended}'",
                    "pending" => $"AND p.account_status IN ('{AccountStatus.PendingVerification}','{AccountStatus.PendingApproval}')",
                    _ => "",
                };
                if (cu.AllMatching)
                    await Exec($"""
                        INSERT #p (id, kind) SELECT p.id, N'customer' FROM ccs.profiles p
                        WHERE p.id <> @me AND p.id NOT IN (SELECT id FROM #p)
                          AND EXISTS (SELECT 1 FROM ccs.user_roles ur JOIN ccs.roles r ON r.id = ur.role_id WHERE ur.user_id = p.id AND r.code = 'customer')
                          AND NOT EXISTS (SELECT 1 FROM ccs.user_roles ur JOIN ccs.roles r ON r.id = ur.role_id WHERE ur.user_id = p.id AND r.code <> 'customer')
                          {status};
                        """, ("@me", me));
                else
                {
                    await Fill("#ids", cu.Ids);
                    await Exec("""
                        INSERT #p (id, kind) SELECT i.id, N'customer' FROM #ids i JOIN ccs.profiles p ON p.id = i.id
                        WHERE i.id <> @me AND i.id NOT IN (SELECT id FROM #p)
                          AND NOT EXISTS (SELECT 1 FROM ccs.user_roles ur JOIN ccs.roles r ON r.id = ur.role_id WHERE ur.user_id = i.id AND r.code <> 'customer');
                        DELETE #ids;
                        """, ("@me", me));
                }
            }
            if (r.StaffIds is { Length: > 0 })
            {
                await Fill("#ids", r.StaffIds);
                await Exec("""
                    INSERT #p (id, kind) SELECT i.id, N'staff' FROM #ids i JOIN ccs.profiles p ON p.id = i.id
                    WHERE i.id <> @me AND i.id NOT IN (SELECT id FROM #p)
                      AND EXISTS (SELECT 1 FROM ccs.user_roles ur JOIN ccs.roles r ON r.id = ur.role_id WHERE ur.user_id = i.id AND r.code <> 'customer');
                    DELETE #ids;
                    """, ("@me", me));
            }
            if (await Scalar("SELECT COUNT(*) FROM #p") > 0)
            {
                var adminsLeft = await Scalar("""
                    SELECT COUNT(*) FROM ccs.profiles p WHERE p.account_status = 'active' AND p.id NOT IN (SELECT id FROM #p)
                      AND EXISTS (SELECT 1 FROM ccs.user_roles ur JOIN ccs.roles r ON r.id = ur.role_id WHERE ur.user_id = p.id AND r.code = 'admin')
                    """);
                if (adminsLeft == 0) throw new AuthError("lastAdmin", 409);
            }

            // ---------- 3. Tickets
            if (r.Tickets is { } tk)
            {
                if (tk.Mode == "pick") await Fill("#t", tk.Ids);
                else
                {
                    var where = new List<string> { "1 = 1" };
                    where.Add(tk.Status switch
                    {
                        "closed" => $"t.status = '{TicketStatus.Closed}'",
                        "done" => $"t.status IN ('{TicketStatus.Resolved}','{TicketStatus.Closed}')",
                        "dropped" => $"t.status = '{TicketStatus.Closed}' AND t.closure_reason IN ('{ClosureReasonCode.Cancelled}','{ClosureReasonCode.Duplicate}','{ClosureReasonCode.Spam}')",
                        _ => "1 = 1",
                    });
                    if (tk.CreatedBefore is { } before) where.Add("t.created_at < @before");
                    if (tk.OrganizationId is not null) where.Add("t.organization_id = @org");   // the place the ticket was created in
                    await Exec($"INSERT #t (id) SELECT t.id FROM ccs.tickets t WHERE {string.Join(" AND ", where)}",
                        ("@before", tk.CreatedBefore is { } b ? new DateTimeOffset(b.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero) : null),
                        ("@org", tk.OrganizationId));
                }
            }
            if (r.Customers is { DeleteTickets: true })
                await Exec("INSERT #t (id) SELECT t.id FROM ccs.tickets t WHERE t.requester_id IN (SELECT id FROM #p WHERE kind = N'customer') AND t.id NOT IN (SELECT id FROM #t)");

            if (await Scalar("SELECT COUNT(*) FROM #t") > 0)
            {
                Add("messages", await Scalar("SELECT COUNT(*) FROM ccs.ticket_messages WHERE ticket_id IN (SELECT id FROM #t) AND kind <> 'system'"));
                Add("fileBytes", await Scalar("SELECT ISNULL(SUM(size_bytes), 0) FROM ccs.ticket_attachments WHERE ticket_id IN (SELECT id FROM #t)"));
                await using (var cmd = conn.CreateCommand())
                {
                    cmd.Transaction = dbTx; cmd.CommandText = "SELECT storage_path FROM ccs.ticket_attachments WHERE ticket_id IN (SELECT id FROM #t)";
                    await using var rd = await cmd.ExecuteReaderAsync(ct);
                    while (await rd.ReadAsync(ct)) files.Add(rd.GetString(0));
                }
                Add("files", files.Count);
                await Exec("DELETE ccs.notifications WHERE ticket_id IN (SELECT id FROM #t)");
                await Exec("DELETE ccs.ticket_links WHERE linked_ticket_id IN (SELECT id FROM #t) OR ticket_id IN (SELECT id FROM #t)");
                Add("tickets", await Exec("DELETE ccs.tickets WHERE id IN (SELECT id FROM #t)"));
            }

            // ---------- 4. Teams
            if (r.Teams is { } te) await Fill("#tm", te.Ids);
            if (await Scalar("SELECT COUNT(*) FROM #tm") > 0)
            {
                Guid? moveTickets = r.Teams?.MoveTicketsTo, moveCats = r.Teams?.MoveCategoriesTo;
                foreach (var target in new[] { moveTickets, moveCats })
                    if (target is { } g && (await Scalar("SELECT COUNT(*) FROM #tm WHERE id = @g", ("@g", g)) > 0
                                            || await Scalar("SELECT COUNT(*) FROM ccs.teams WHERE id = @g", ("@g", g)) == 0))
                        throw new AuthError("moveTarget", 400, null);
                Add("ticketsMoved", await Exec("UPDATE ccs.tickets SET team_id = @to WHERE team_id IN (SELECT id FROM #tm)", ("@to", moveTickets)));
                Add("categoriesMoved", await Exec("UPDATE ccs.ticket_categories SET default_team_id = @to WHERE default_team_id IN (SELECT id FROM #tm)", ("@to", moveCats)));
                await Exec("DELETE ccs.category_people WHERE team_id IN (SELECT id FROM #tm)");
                // Teams named in assignment history are switched off; the rest are deleted (members and links go with them).
                Add("teamsOff", await Exec("""
                    UPDATE ccs.teams SET is_active = 0 WHERE id IN (SELECT id FROM #tm)
                      AND EXISTS (SELECT 1 FROM ccs.ticket_assignments a WHERE a.from_team = ccs.teams.id OR a.to_team = ccs.teams.id)
                    """));
                await Exec("DELETE ccs.team_members WHERE team_id IN (SELECT id FROM #tm)");
                Add("teams", await Exec("""
                    DELETE ccs.teams WHERE id IN (SELECT id FROM #tm)
                      AND NOT EXISTS (SELECT 1 FROM ccs.ticket_assignments a WHERE a.from_team = ccs.teams.id OR a.to_team = ccs.teams.id)
                    """));
            }

            // ---------- 5. Ticket catalog (in use by kept tickets: switched off)
            if (r.Catalog is { } cat)
            {
                await Fill("#ty", cat.TypeIds); await Fill("#ca", cat.CategoryIds); await Fill("#sc", cat.SubcategoryIds); await Fill("#cf", cat.FieldIds);
            }
            Add("subcategoriesOff", await Exec("UPDATE ccs.ticket_subcategories SET is_active = 0 WHERE id IN (SELECT id FROM #sc) AND EXISTS (SELECT 1 FROM ccs.tickets t WHERE t.subcategory_id = ccs.ticket_subcategories.id)"));
            Add("subcategories", await Exec("DELETE ccs.ticket_subcategories WHERE id IN (SELECT id FROM #sc) AND NOT EXISTS (SELECT 1 FROM ccs.tickets t WHERE t.subcategory_id = ccs.ticket_subcategories.id)"));
            Add("fieldsOff", await Exec("UPDATE ccs.custom_field_definitions SET is_active = 0 WHERE id IN (SELECT id FROM #cf) AND EXISTS (SELECT 1 FROM ccs.ticket_custom_field_values v WHERE v.field_id = ccs.custom_field_definitions.id)"));
            Add("fields", await Exec("DELETE ccs.custom_field_definitions WHERE id IN (SELECT id FROM #cf) AND NOT EXISTS (SELECT 1 FROM ccs.ticket_custom_field_values v WHERE v.field_id = ccs.custom_field_definitions.id)"));
            // A category is in use when a kept ticket points at it or at one of its sub-categories or custom fields.
            const string catInUse = """
                (EXISTS (SELECT 1 FROM ccs.tickets t WHERE t.category_id = c.id)
                 OR EXISTS (SELECT 1 FROM ccs.tickets t JOIN ccs.ticket_subcategories s ON s.id = t.subcategory_id WHERE s.category_id = c.id)
                 OR EXISTS (SELECT 1 FROM ccs.ticket_custom_field_values v JOIN ccs.custom_field_definitions f ON f.id = v.field_id WHERE f.category_id = c.id))
                """;
            Add("categoriesOff", await Exec($"UPDATE c SET is_active = 0 FROM ccs.ticket_categories c WHERE c.id IN (SELECT id FROM #ca) AND {catInUse}"));
            Add("categories", await Exec($"DELETE c FROM ccs.ticket_categories c WHERE c.id IN (SELECT id FROM #ca) AND NOT {catInUse}"));
            Add("typesOff", await Exec("UPDATE ccs.ticket_types SET is_active = 0 WHERE id IN (SELECT id FROM #ty) AND EXISTS (SELECT 1 FROM ccs.tickets t WHERE t.ticket_type_id = ccs.ticket_types.id)"));
            Add("types", await Exec("DELETE ccs.ticket_types WHERE id IN (SELECT id FROM #ty) AND NOT EXISTS (SELECT 1 FROM ccs.tickets t WHERE t.ticket_type_id = ccs.ticket_types.id)"));

            // ---------- 6. People
            if (await Scalar("SELECT COUNT(*) FROM #p") > 0)
            {
                Add("openUnassigned", await Exec($"UPDATE ccs.tickets SET assigned_agent_id = NULL WHERE assigned_agent_id IN (SELECT id FROM #p) AND status IN ({OpenStatuses})"));
                await Exec("""
                    UPDATE ccs.organizations SET team_leader_id = NULL WHERE team_leader_id IN (SELECT id FROM #p);
                    UPDATE ccs.branches SET team_leader_id = NULL WHERE team_leader_id IN (SELECT id FROM #p);
                    UPDATE ccs.teams SET last_auto_user_id = NULL WHERE last_auto_user_id IN (SELECT id FROM #p);
                    UPDATE ccs.kb_articles SET created_by = NULL WHERE created_by IN (SELECT id FROM #p);
                    UPDATE ccs.email_settings SET updated_by = NULL WHERE updated_by IN (SELECT id FROM #p);
                    UPDATE ccs.email_templates SET updated_by = NULL WHERE updated_by IN (SELECT id FROM #p);
                    UPDATE ccs.site_settings SET updated_by = NULL WHERE updated_by IN (SELECT id FROM #p);
                    UPDATE ccs.system_messages SET updated_by = NULL WHERE updated_by IN (SELECT id FROM #p);
                    DELETE ccs.category_people WHERE user_id IN (SELECT id FROM #p);
                    """);
                var hist = string.Join(" OR ", HistoryColumns.Select(h => $"EXISTS (SELECT 1 FROM ccs.{h.Table} x WHERE x.{h.Column} = p.id)"));
                await Exec($"INSERT #h (id) SELECT p.id FROM #p p WHERE {hist}");
                // Kept history: anonymize and suspend, take away everything that gives access.
                Add("peopleAnonymized", await Exec("""
                    UPDATE pr SET full_name = CASE WHEN x.kind = N'staff' THEN N'Former staff · موظف سابق' ELSE N'Removed customer · عميل محذوف' END,
                                  email = N'removed-' + LOWER(CONVERT(nvarchar(36), pr.id)) + N'@removed.invalid', phone = NULL,
                                  account_status = 'suspended', updated_at = SYSUTCDATETIME()
                    FROM ccs.profiles pr JOIN #p x ON x.id = pr.id WHERE pr.id IN (SELECT id FROM #h);
                    """));
                await Exec("""
                    UPDATE u SET Email = N'removed-' + LOWER(CONVERT(nvarchar(36), u.Id)) + N'@removed.invalid',
                                 NormalizedEmail = UPPER(N'removed-' + LOWER(CONVERT(nvarchar(36), u.Id)) + N'@removed.invalid'),
                                 UserName = N'removed-' + LOWER(CONVERT(nvarchar(36), u.Id)) + N'@removed.invalid',
                                 NormalizedUserName = UPPER(N'removed-' + LOWER(CONVERT(nvarchar(36), u.Id)) + N'@removed.invalid'),
                                 PhoneNumber = NULL, PasswordHash = NULL, SecurityStamp = CONVERT(nvarchar(36), NEWID()),
                                 LockoutEnabled = 1, LockoutEnd = '9999-12-31T00:00:00+00:00', TwoFactorEnabled = 0
                    FROM dbo.AspNetUsers u WHERE u.Id IN (SELECT id FROM #h);
                    DELETE ccs.refresh_tokens WHERE user_id IN (SELECT id FROM #h);
                    DELETE ccs.auth_codes WHERE user_id IN (SELECT id FROM #h);
                    DELETE ccs.team_members WHERE user_id IN (SELECT id FROM #h);
                    DELETE ccs.staff_placement WHERE user_id IN (SELECT id FROM #h);
                    DELETE ccs.admin_scopes WHERE user_id IN (SELECT id FROM #h);
                    DELETE ccs.notifications WHERE user_id IN (SELECT id FROM #h);
                    """);
                // No history: delete the sign-in account; the profile and what it owns follow (cascades).
                Add("people", await Exec("DELETE dbo.AspNetUsers WHERE Id IN (SELECT id FROM #p) AND Id NOT IN (SELECT id FROM #h)"));
            }

            // ---------- 7. Places
            if (await Scalar("SELECT COUNT(*) FROM #o") + await Scalar("SELECT COUNT(*) FROM #b") > 0)
            {
                Add("peopleUnplaced", await Exec("UPDATE ccs.profiles SET organization_id = NULL, branch_id = NULL WHERE organization_id IN (SELECT id FROM #o) OR branch_id IN (SELECT id FROM #b)"));
                await Exec("""
                    DELETE ccs.account_type_access WHERE organization_id IN (SELECT id FROM #o) OR branch_id IN (SELECT id FROM #b);
                    DELETE ccs.admin_scopes WHERE organization_id IN (SELECT id FROM #o) OR branch_id IN (SELECT id FROM #b);
                    DELETE ccs.staff_placement WHERE organization_id IN (SELECT id FROM #o) OR branch_id IN (SELECT id FROM #b);
                    DELETE ccs.place_type_categories WHERE organization_id IN (SELECT id FROM #o) OR branch_id IN (SELECT id FROM #b);
                    DELETE ccs.place_customer_view WHERE organization_id IN (SELECT id FROM #o) OR branch_id IN (SELECT id FROM #b);
                    DELETE ccs.place_catalog WHERE organization_id IN (SELECT id FROM #o) OR branch_id IN (SELECT id FROM #b);
                    UPDATE ccs.organizations SET parent_id = NULL WHERE parent_id IN (SELECT id FROM #o) AND id NOT IN (SELECT id FROM #o);
                    UPDATE ccs.teams SET kind_id = NULL WHERE kind_id IN (SELECT id FROM #tk);
                    UPDATE ccs.ticket_categories SET team_kind_id = NULL WHERE team_kind_id IN (SELECT id FROM #tk);
                    DELETE ccs.team_kinds WHERE id IN (SELECT id FROM #tk);
                    """);
                // A place that kept tickets were created in, or that still owns a switched-off team or catalog item,
                // is switched off; the rest is deleted.
                const string branchUsed = """
                    (EXISTS (SELECT 1 FROM ccs.tickets x WHERE x.branch_id = b.id)
                     OR EXISTS (SELECT 1 FROM ccs.teams x WHERE x.branch_id = b.id) OR EXISTS (SELECT 1 FROM ccs.ticket_types x WHERE x.branch_id = b.id)
                     OR EXISTS (SELECT 1 FROM ccs.ticket_categories x WHERE x.branch_id = b.id) OR EXISTS (SELECT 1 FROM ccs.ticket_subcategories x WHERE x.branch_id = b.id))
                    """;
                Add("branchesOff", await Exec($"UPDATE b SET is_active = 0 FROM ccs.branches b WHERE b.id IN (SELECT id FROM #b) AND {branchUsed}"));
                Add("branches", await Exec($"DELETE b FROM ccs.branches b WHERE b.id IN (SELECT id FROM #b) AND NOT {branchUsed}"));
                const string orgUsed = """
                    (EXISTS (SELECT 1 FROM ccs.tickets x WHERE x.organization_id = o.id)
                     OR EXISTS (SELECT 1 FROM ccs.branches x WHERE x.organization_id = o.id) OR EXISTS (SELECT 1 FROM ccs.teams x WHERE x.organization_id = o.id)
                     OR EXISTS (SELECT 1 FROM ccs.ticket_types x WHERE x.organization_id = o.id) OR EXISTS (SELECT 1 FROM ccs.ticket_categories x WHERE x.organization_id = o.id)
                     OR EXISTS (SELECT 1 FROM ccs.ticket_subcategories x WHERE x.organization_id = o.id) OR EXISTS (SELECT 1 FROM ccs.organizations x WHERE x.parent_id = o.id))
                    """;
                // Children first, so a parent is free once its children are gone.
                for (var round = 0; round < 10; round++)
                {
                    var n = await Exec($"DELETE o FROM ccs.organizations o WHERE o.id IN (SELECT id FROM #o) AND NOT {orgUsed}");
                    Add("organizations", n);
                    if (n == 0) break;
                }
                Add("organizationsOff", await Exec("UPDATE ccs.organizations SET is_active = 0 WHERE id IN (SELECT id FROM #o) AND is_active = 1"));
            }

            // ---------- 8. Knowledge base and canned responses
            if (r.KbArticleIds is { Length: > 0 } || r.KbCategoryIds is { Length: > 0 })
            {
                await Exec("DELETE #ids"); await Fill("#ids", r.KbArticleIds);
                Add("kbArticles", await Exec("DELETE ccs.kb_articles WHERE id IN (SELECT id FROM #ids)"));
                await Exec("DELETE #ids"); await Fill("#ids", r.KbCategoryIds);
                Add("kbMoved", await Exec("UPDATE ccs.kb_articles SET category_id = NULL WHERE category_id IN (SELECT id FROM #ids)"));
                Add("kbCategories", await Exec("DELETE ccs.kb_categories WHERE id IN (SELECT id FROM #ids)"));
            }
            if (r.CannedIds is { Length: > 0 })
            {
                await Exec("DELETE #ids"); await Fill("#ids", r.CannedIds);
                Add("canned", await Exec("DELETE ccs.canned_responses WHERE id IN (SELECT id FROM #ids)"));
            }

            // ---------- 9. Calendars (never the default one) and past holidays
            if (r.Calendars is { } cal)
            {
                await Exec("DELETE #ids"); await Fill("#ids", cal.Ids);
                await Exec("DELETE #ids WHERE id IN (SELECT id FROM ccs.business_hours WHERE is_default = 1)");
                Add("calendarUsersMoved", await Exec("""
                    UPDATE ccs.branches SET business_hours_id = NULL WHERE business_hours_id IN (SELECT id FROM #ids);
                    UPDATE ccs.organizations SET business_hours_id = NULL WHERE business_hours_id IN (SELECT id FROM #ids);
                    UPDATE ccs.teams SET business_hours_id = NULL WHERE business_hours_id IN (SELECT id FROM #ids);
                    UPDATE ccs.sla_policies SET business_hours_id = NULL WHERE business_hours_id IN (SELECT id FROM #ids);
                    """));
                Add("holidays", await Scalar("SELECT COUNT(*) FROM ccs.holidays WHERE business_hours_id IN (SELECT id FROM #ids)"));
                Add("calendars", await Exec("DELETE ccs.business_hours WHERE id IN (SELECT id FROM #ids)"));
                if (cal.PastHolidays)
                    Add("holidays", await Exec("DELETE ccs.holidays WHERE holiday_date < CAST(@today AS date)", ("@today", clock.UtcNow.UtcDateTime.Date)));
            }

            // ---------- 10. Old notifications and emails (emails still waiting to be sent are kept)
            if (r.NotificationsOlderThanDays is int days and >= 0)
                Add("notifications", await Exec("DELETE ccs.notifications WHERE created_at < @cut AND NOT (channel = 'email' AND status = 'pending')",
                    ("@cut", clock.UtcNow.AddDays(-days))));

            // ---------- 11. Sign-in sessions of everyone else
            if (r.Sessions)
                Add("sessions", await Exec("DELETE ccs.refresh_tokens WHERE user_id <> @me", ("@me", me)));

            if (commit) await tx.CommitAsync(ct);
            else await tx.RollbackAsync(ct);
        }
        return new Result(counts, commit ? files : []);
    }
}
