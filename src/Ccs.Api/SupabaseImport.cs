using System.Data;
using System.Globalization;
using Microsoft.Data.SqlClient;
using Npgsql;

namespace Ccs.Api;

/// <summary>
/// Copies everything from the old Supabase database into SQL Server (spec section 9), keeping every id.
/// The installer runs it; it can also run by hand:
///   dotnet Ccs.Api.dll import-supabase "postgresql://postgres.&lt;ref&gt;:&lt;password&gt;@&lt;host&gt;:5432/postgres" [--real-only] [--service-key &lt;key&gt;]
/// Repeatable: the CCS tables are emptied first, so it can be run as often as needed before cutover.
/// Passwords move as bcrypt hashes; the API accepts them and re-hashes at each person's first sign-in.
/// With --service-key the ticket attachments are downloaded from Supabase Storage into the file store.
/// </summary>
public static class SupabaseImport
{
    // Parents before children; users (AspNetUsers + profiles) are inserted after account_type_access.
    private static readonly string[] Order =
    [
        "roles", "account_types", "account_type_permissions", "priorities", "closure_reasons", "ticket_types",
        "business_hours", "holidays", "teams", "ticket_categories", "ticket_subcategories", "ticket_type_categories",
        "custom_field_definitions", "sla_policies", "ticket_status_transitions",
        "organizations", "branches", "account_type_access",
        "user_roles", "admin_scopes", "staff_placement", "team_members", "canned_responses",
        "ticket_counters", "tickets", "ticket_custom_field_values", "ticket_messages", "ticket_attachments",
        "ticket_assignments", "ticket_status_history", "ticket_sla_records", "ticket_sla_cycles", "ticket_sla_events",
        "customer_feedback", "ticket_links", "ticket_cancellation_requests", "notifications",
        "kb_categories", "kb_articles", "kb_feedback",
        "app_settings", "site_settings", "menu_items", "system_messages", "email_templates", "email_settings",
        "captcha_settings", "signin_code_settings", "audit_logs",
    ];
    private const string UsersAfter = "account_type_access";

    private static readonly HashSet<string> SkipTarget =
        ["seq", "row_version", "branch_key", "category_key", "locked_until", "secret_enc", "password_enc", "design", "scan_status", "ip_address", "is_default", "provider"];
    private static readonly Dictionary<string, string[]> Deferred = new()
    {
        ["organizations"] = ["team_leader_id", "parent_id"], ["branches"] = ["team_leader_id"], ["menu_items"] = ["parent_id"],
    };

    private const string Demo = "%@demo.cts.test";
    private const string DemoUsers = $"(SELECT id FROM public.profiles WHERE email ILIKE '{Demo}')";
    private const string DemoTickets = $"(SELECT id FROM public.tickets WHERE requester_id IN {DemoUsers})";
    private static readonly Dictionary<string, string> RealFilter = new()
    {
        ["user_roles"] = $"user_id NOT IN {DemoUsers}", ["admin_scopes"] = $"user_id NOT IN {DemoUsers}",
        ["staff_placement"] = $"user_id NOT IN {DemoUsers}", ["team_members"] = $"user_id NOT IN {DemoUsers}",
        ["canned_responses"] = $"owner_id NOT IN {DemoUsers}", ["notifications"] = $"user_id NOT IN {DemoUsers}",
        ["kb_feedback"] = $"user_id NOT IN {DemoUsers}", ["tickets"] = $"requester_id NOT IN {DemoUsers}",
        ["profiles"] = $"email NOT ILIKE '{Demo}'",
        ["ticket_custom_field_values"] = $"ticket_id NOT IN {DemoTickets}", ["ticket_messages"] = $"ticket_id NOT IN {DemoTickets}",
        ["ticket_attachments"] = $"ticket_id NOT IN {DemoTickets}", ["ticket_assignments"] = $"ticket_id NOT IN {DemoTickets}",
        ["ticket_status_history"] = $"ticket_id NOT IN {DemoTickets}", ["ticket_sla_records"] = $"ticket_id NOT IN {DemoTickets}",
        ["ticket_sla_cycles"] = $"ticket_id NOT IN {DemoTickets}", ["ticket_sla_events"] = $"ticket_id NOT IN {DemoTickets}",
        ["customer_feedback"] = $"ticket_id NOT IN {DemoTickets}", ["ticket_cancellation_requests"] = $"ticket_id NOT IN {DemoTickets}",
        ["ticket_links"] = $"ticket_id NOT IN {DemoTickets} AND linked_ticket_id NOT IN {DemoTickets}",
    };

    private sealed record Col(string Name, string Type, bool Identity);

    public static async Task<int> RunAsync(string[] args)
    {
        if (args.Length < 2) { Console.Error.WriteLine("Usage: dotnet Ccs.Api.dll import-supabase <postgres url> [--real-only] [--service-key <key>]"); return 2; }
        var realOnly = args.Contains("--real-only");
        var keyIdx = Array.IndexOf(args, "--service-key");
        var serviceKey = keyIdx > 0 && keyIdx + 1 < args.Length ? args[keyIdx + 1] : null;

        var config = new ConfigurationBuilder().AddEnvironmentVariables().Build();
        var msCs = config.GetConnectionString("Ccs") ?? throw new InvalidOperationException("ConnectionStrings__Ccs is not set.");
        var (pgCs, projectRef) = ToNpgsql(args[1]);

        await using var pg = new NpgsqlConnection(pgCs);
        await pg.OpenAsync();
        await using var ms = new SqlConnection(msCs);
        await ms.OpenAsync();
        Log($"Connected. Copying {(realOnly ? "real data only (demo users skipped)" : "all data")}.");

        await EmptyTargetAsync(ms);
        var counts = new List<(string Table, long Pg, long Ms)>();
        foreach (var t in Order)
        {
            await CopyTableAsync(pg, ms, t, realOnly);
            if (t == UsersAfter) { await CopyUsersAsync(pg, ms, realOnly); await CopyTableAsync(pg, ms, "profiles", realOnly); }
        }
        await ExecAsync(ms, """
            UPDATE ccs.business_hours SET is_default = CASE WHEN id = (SELECT TOP 1 business_hours_id FROM ccs.sla_policies
              WHERE business_hours_id IS NOT NULL GROUP BY business_hours_id ORDER BY COUNT(*) DESC) THEN 1 ELSE 0 END;
            UPDATE ccs.ticket_attachments SET scan_status = N'skipped';
            """);

        foreach (var t in Order.Append("profiles"))
        {
            var where = realOnly && RealFilter.TryGetValue(t, out var f) ? $"WHERE {f}" : "";
            var a = Convert.ToInt64(await new NpgsqlCommand($"SELECT count(*) FROM public.\"{t}\" {where}", pg).ExecuteScalarAsync());
            var b = Convert.ToInt64(await new SqlCommand($"SELECT COUNT(*) FROM ccs.[{t}]", ms).ExecuteScalarAsync());
            counts.Add((t, a, b));
        }
        var bad = counts.Where(c => c.Pg != c.Ms).ToList();
        foreach (var c in counts) Console.WriteLine($"  {c.Table,-30} supabase {c.Pg,6}   sql server {c.Ms,6}   {(c.Pg == c.Ms ? "ok" : "DIFFERENT")}");

        if (serviceKey is not null) await CopyFilesAsync(ms, projectRef, serviceKey, config["FileStore:Root"] ?? @"C:\CcsData\attachments");

        Log(bad.Count == 0 ? "All row counts match." : $"{bad.Count} table(s) differ: {string.Join(", ", bad.Select(b => b.Table))}");
        Log("Enter again in Admin, Settings: the SMTP password and the captcha secret (they are not copied).");
        return bad.Count == 0 ? 0 : 1;
    }

    /// <summary>postgresql://user:pass@host:port/db  ->  Npgsql keywords. Also returns the Supabase project ref.</summary>
    private static (string Cs, string? Ref) ToNpgsql(string url)
    {
        if (!url.StartsWith("postgres", StringComparison.OrdinalIgnoreCase)) return (url, null);
        var u = new Uri(url);
        var parts = u.UserInfo.Split(':', 2);
        var user = Uri.UnescapeDataString(parts[0]);
        var b = new NpgsqlConnectionStringBuilder
        {
            Host = u.Host, Port = u.Port > 0 ? u.Port : 5432, Database = u.AbsolutePath.Trim('/') is { Length: > 0 } d ? d : "postgres",
            Username = user, Password = parts.Length > 1 ? Uri.UnescapeDataString(parts[1]) : "",
            SslMode = SslMode.Require, CommandTimeout = 300,
        };
        var projectRef = user.Contains('.') ? user[(user.IndexOf('.') + 1)..] : u.Host.Split('.').Skip(1).FirstOrDefault();
        return (b.ConnectionString, projectRef);
    }

    private static async Task EmptyTargetAsync(SqlConnection ms)
    {
        Log("Emptying the CCS tables in SQL Server");
        var deletes = string.Join("\n", Order.Append("profiles").Reverse().Select(t => $"DELETE FROM ccs.[{t}];"));
        await ExecAsync(ms, $"""
            EXEC sp_MSforeachtable 'ALTER TABLE ? NOCHECK CONSTRAINT ALL', @whereand = ' AND SCHEMA_NAME(schema_id) IN (''ccs'',''dbo'')';
            {deletes}
            DELETE FROM dbo.AspNetUserTokens; DELETE FROM dbo.AspNetUserRoles; DELETE FROM dbo.AspNetUserLogins; DELETE FROM dbo.AspNetUserClaims;
            DELETE FROM ccs.refresh_tokens; DELETE FROM ccs.auth_codes; DELETE FROM dbo.AspNetUsers;
            EXEC sp_MSforeachtable 'ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL', @whereand = ' AND SCHEMA_NAME(schema_id) IN (''ccs'',''dbo'')';
            """);
    }

    private static async Task<List<Col>> TargetColumnsAsync(SqlConnection ms, string table)
    {
        var cmd = new SqlCommand("""
            SELECT c.name, t.name, c.is_identity FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
             WHERE c.object_id = OBJECT_ID('ccs.' + @t) AND c.is_computed = 0 AND t.name <> 'timestamp' ORDER BY c.column_id
            """, ms);
        cmd.Parameters.AddWithValue("@t", table);
        var list = new List<Col>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync()) if (!SkipTarget.Contains(r.GetString(0))) list.Add(new Col(r.GetString(0), r.GetString(1), r.GetBoolean(2)));
        return list;
    }

    private static async Task<Dictionary<string, string>> SourceColumnsAsync(NpgsqlConnection pg, string table)
    {
        var cmd = new NpgsqlCommand("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = @t", pg);
        cmd.Parameters.AddWithValue("t", table);
        var map = new Dictionary<string, string>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync()) map[r.GetString(0)] = r.GetString(1);
        return map;
    }

    private static async Task CopyTableAsync(NpgsqlConnection pg, SqlConnection ms, string table, bool realOnly)
    {
        var src = await SourceColumnsAsync(pg, table);
        var cols = (await TargetColumnsAsync(ms, table)).Where(c => src.ContainsKey(c.Name)).ToList();
        if (cols.Count == 0) { Log($"{table}: not in Supabase, skipped"); return; }
        var deferred = Deferred.GetValueOrDefault(table) ?? [];
        var where = realOnly && RealFilter.TryGetValue(table, out var f) ? $"WHERE {f}" : "";
        var order = table switch { "tickets" => "ORDER BY created_at, reference", "audit_logs" => "ORDER BY id", _ => "" };
        // Every value is read as text: jsonb keeps its JSON text; everything else goes through to_jsonb(...) #>> '{}',
        // which gives ISO dates, JSON arrays for text[] and plain text for enums.
        var select = string.Join(", ", cols.Select(c => src[c.Name] is "jsonb" or "json"
            ? $"\"{c.Name}\"::text" : $"to_jsonb(\"{c.Name}\") #>> '{{}}'"));
        var rows = new List<string?[]>();
        await using (var r = await new NpgsqlCommand($"SELECT {select} FROM public.\"{table}\" {where} {order}", pg).ExecuteReaderAsync())
            while (await r.ReadAsync())
            {
                var row = new string?[cols.Count];
                for (var i = 0; i < cols.Count; i++) row[i] = r.IsDBNull(i) ? null : r.GetString(i);
                rows.Add(row);
            }

        var insertIdx = Enumerable.Range(0, cols.Count).Where(i => !deferred.Contains(cols[i].Name)).ToList();
        var identity = cols.Any(c => c.Identity);
        await using var tx = (SqlTransaction)await ms.BeginTransactionAsync();
        try
        {
            if (identity) await ExecAsync(ms, $"SET IDENTITY_INSERT ccs.[{table}] ON", tx);
            var sql = $"INSERT INTO ccs.[{table}] ({string.Join(", ", insertIdx.Select(i => $"[{cols[i].Name}]"))}) VALUES ({string.Join(", ", insertIdx.Select(i => $"@p{i}"))})";
            foreach (var row in rows)
            {
                var cmd = new SqlCommand(sql, ms, tx);
                foreach (var i in insertIdx) cmd.Parameters.Add(Param($"@p{i}", cols[i].Type, row[i]));
                await cmd.ExecuteNonQueryAsync();
            }
            if (identity) await ExecAsync(ms, $"SET IDENTITY_INSERT ccs.[{table}] OFF", tx);
            await tx.CommitAsync();
        }
        catch (Exception e)
        {
            await tx.RollbackAsync();
            throw new InvalidOperationException($"{table}: {e.Message}", e);
        }

        // Second pass: links that point at rows loaded later (team leaders) or at the same table (parents).
        var idIdx = cols.FindIndex(c => c.Name == "id");
        foreach (var col in deferred)
        {
            var ci = cols.FindIndex(c => c.Name == col);
            if (ci < 0 || idIdx < 0) continue;
            foreach (var row in rows.Where(x => x[ci] is not null))
            {
                var cmd = new SqlCommand($"""
                    UPDATE ccs.[{table}] SET [{col}] = @v WHERE id = @id
                      AND EXISTS (SELECT 1 FROM ccs.profiles WHERE id = @v UNION ALL SELECT 1 FROM ccs.[{table}] WHERE id = @v)
                    """, ms);
                cmd.Parameters.Add(new SqlParameter("@v", SqlDbType.UniqueIdentifier) { Value = Guid.Parse(row[ci]!) });
                cmd.Parameters.Add(new SqlParameter("@id", SqlDbType.UniqueIdentifier) { Value = Guid.Parse(row[idIdx]!) });
                await cmd.ExecuteNonQueryAsync();
            }
        }
        Log($"{table}: {rows.Count} rows");
    }

    private static SqlParameter Param(string name, string type, string? v)
    {
        object value = v is null ? DBNull.Value : type switch
        {
            "uniqueidentifier" => Guid.Parse(v),
            "datetimeoffset" => DateTimeOffset.Parse(v, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal),
            "datetime2" or "datetime" => DateTime.Parse(v, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal),
            "date" => DateTime.Parse(v, CultureInfo.InvariantCulture),
            "bit" => bool.Parse(v),
            "int" => int.Parse(v, CultureInfo.InvariantCulture),
            "smallint" => short.Parse(v, CultureInfo.InvariantCulture),
            "tinyint" => byte.Parse(v, CultureInfo.InvariantCulture),
            "bigint" => long.Parse(v, CultureInfo.InvariantCulture),
            "decimal" or "numeric" => decimal.Parse(v, CultureInfo.InvariantCulture),
            _ => v,
        };
        var dbType = type switch
        {
            "uniqueidentifier" => SqlDbType.UniqueIdentifier, "datetimeoffset" => SqlDbType.DateTimeOffset,
            "datetime2" or "datetime" => SqlDbType.DateTime2, "date" => SqlDbType.Date, "bit" => SqlDbType.Bit,
            "int" => SqlDbType.Int, "smallint" => SqlDbType.SmallInt, "tinyint" => SqlDbType.TinyInt, "bigint" => SqlDbType.BigInt,
            "decimal" or "numeric" => SqlDbType.Decimal, _ => SqlDbType.NVarChar,
        };
        var p = new SqlParameter(name, dbType) { Value = value };
        if (dbType == SqlDbType.NVarChar) p.Size = -1;
        return p;
    }

    /// <summary>auth.users -> dbo.AspNetUsers. The bcrypt hash moves as is; authenticator secrets move when present.</summary>
    private static async Task CopyUsersAsync(NpgsqlConnection pg, SqlConnection ms, bool realOnly)
    {
        var where = realOnly ? $"WHERE p.email NOT ILIKE '{Demo}'" : "";
        var users = new List<(Guid Id, string Email, string? Phone, string? Hash, bool Ec, bool Pc, DateTimeOffset? Ban, string? Totp)>();
        await using (var r = await new NpgsqlCommand($"""
            SELECT u.id, lower(coalesce(u.email, p.email)), u.phone, u.encrypted_password, u.email_confirmed_at IS NOT NULL,
                   u.phone_confirmed_at IS NOT NULL, u.banned_until,
                   (SELECT f.secret FROM auth.mfa_factors f WHERE f.user_id = u.id AND f.status = 'verified' AND f.factor_type = 'totp' LIMIT 1)
              FROM auth.users u JOIN public.profiles p ON p.id = u.id {where}
            """, pg).ExecuteReaderAsync())
            while (await r.ReadAsync())
                users.Add((r.GetGuid(0), r.GetString(1), r.IsDBNull(2) ? null : r.GetString(2), r.IsDBNull(3) ? null : r.GetString(3),
                    r.GetBoolean(4), r.GetBoolean(5), r.IsDBNull(6) ? null : r.GetFieldValue<DateTimeOffset>(6), r.IsDBNull(7) ? null : r.GetString(7)));

        var roles = new List<(Guid User, string Code)>();
        await using (var r = await new NpgsqlCommand("SELECT ur.user_id, r.code FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id", pg).ExecuteReaderAsync())
            while (await r.ReadAsync()) roles.Add((r.GetGuid(0), r.GetString(1)));
        var idRoles = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        await using (var r = await new SqlCommand("SELECT Id, Name FROM dbo.AspNetRoles", ms).ExecuteReaderAsync())
            while (await r.ReadAsync()) idRoles[r.GetString(1)] = r.GetGuid(0);

        foreach (var u in users)
        {
            var cmd = new SqlCommand("""
                INSERT INTO dbo.AspNetUsers (Id, UserName, NormalizedUserName, Email, NormalizedEmail, EmailConfirmed, PasswordHash,
                  SecurityStamp, ConcurrencyStamp, PhoneNumber, PhoneNumberConfirmed, TwoFactorEnabled, LockoutEnd, LockoutEnabled, AccessFailedCount)
                VALUES (@id, @e, @n, @e, @n, @ec, @h, CONVERT(nvarchar(36), NEWID()), CONVERT(nvarchar(36), NEWID()), @ph, @pc, @tfa, @ban, 1, 0)
                """, ms);
            cmd.Parameters.AddWithValue("@id", u.Id);
            cmd.Parameters.AddWithValue("@e", u.Email);
            cmd.Parameters.AddWithValue("@n", u.Email.ToUpperInvariant());
            cmd.Parameters.AddWithValue("@ec", u.Ec);
            cmd.Parameters.AddWithValue("@h", (object?)(string.IsNullOrEmpty(u.Hash) ? null : u.Hash) ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@ph", u.Phone is null ? DBNull.Value : "+" + u.Phone.TrimStart('+'));
            cmd.Parameters.AddWithValue("@pc", u.Pc);
            cmd.Parameters.AddWithValue("@tfa", u.Totp is not null);
            cmd.Parameters.Add(new SqlParameter("@ban", SqlDbType.DateTimeOffset) { Value = (object?)u.Ban ?? DBNull.Value });
            await cmd.ExecuteNonQueryAsync();
            if (u.Totp is not null)
            {
                var t = new SqlCommand("INSERT INTO dbo.AspNetUserTokens (UserId, LoginProvider, Name, Value) VALUES (@id, N'[AspNetUserStore]', N'AuthenticatorKey', @v)", ms);
                t.Parameters.AddWithValue("@id", u.Id); t.Parameters.AddWithValue("@v", u.Totp);
                await t.ExecuteNonQueryAsync();
            }
            foreach (var (_, code) in roles.Where(x => x.User == u.Id))
                if (idRoles.TryGetValue(code, out var roleId))
                {
                    var c = new SqlCommand("INSERT INTO dbo.AspNetUserRoles (UserId, RoleId) VALUES (@u, @r)", ms);
                    c.Parameters.AddWithValue("@u", u.Id); c.Parameters.AddWithValue("@r", roleId);
                    await c.ExecuteNonQueryAsync();
                }
        }
        Log($"users (sign-in accounts): {users.Count}, keeping their current passwords");
    }

    /// <summary>Downloads each attachment from Supabase Storage (bucket ticket-attachments) into the file store, same paths.</summary>
    private static async Task CopyFilesAsync(SqlConnection ms, string? projectRef, string serviceKey, string root)
    {
        if (projectRef is null) { Log("Attachments skipped: project ref not found in the connection string."); return; }
        using var http = new HttpClient { BaseAddress = new Uri($"https://{projectRef}.supabase.co/storage/v1/object/ticket-attachments/"), Timeout = TimeSpan.FromMinutes(2) };
        http.DefaultRequestHeaders.Add("apikey", serviceKey);
        http.DefaultRequestHeaders.Authorization = new("Bearer", serviceKey);
        var files = new List<(string Path, long Size)>();
        await using (var r = await new SqlCommand("SELECT storage_path, size_bytes FROM ccs.ticket_attachments", ms).ExecuteReaderAsync())
            while (await r.ReadAsync()) files.Add((r.GetString(0), r.GetInt64(1)));
        int ok = 0, bad = 0;
        foreach (var (path, size) in files)
        {
            try
            {
                var bytes = await http.GetByteArrayAsync(string.Join('/', path.Split('/').Select(Uri.EscapeDataString)));
                var target = Path.Combine(root, path.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                await File.WriteAllBytesAsync(target, bytes);
                if (bytes.LongLength == size) ok++; else { bad++; Log($"  size differs: {path}"); }
            }
            catch (Exception e) { bad++; Log($"  could not copy {path}: {e.Message}"); }
        }
        Log($"attachments: {ok} of {files.Count} copied{(bad > 0 ? $", {bad} problem(s)" : "")}");
    }

    private static async Task ExecAsync(SqlConnection ms, string sql, SqlTransaction? tx = null)
    {
        var cmd = new SqlCommand(sql, ms, tx) { CommandTimeout = 300 };
        await cmd.ExecuteNonQueryAsync();
    }

    private static void Log(string s) => Console.WriteLine($"{DateTime.Now:HH:mm:ss} {s}");
}
