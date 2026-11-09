#!/usr/bin/env node
/**
 * CCS v2 data migration: Supabase (PostgreSQL) -> SQL Server. Spec section 9.
 *
 * Repeatable: every run empties the target tables first, then copies everything again,
 * so it can be rehearsed in a test database as many times as needed before cutover.
 * Every id (uuid) is kept, so links between tables survive without remapping.
 *
 *   PG_URL="postgresql://postgres.<ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
 *   MSSQL="Server=SQL01;Database=CCS_Test;Trusted_Connection=yes;Encrypt=true;TrustServerCertificate=true"
 *   node migrate.mjs [--real-only] [--dry-run]
 *
 *   --real-only   skip demo data (users ending in @demo.cts.test and everything they own) - open decision #1
 *   --dry-run     read and count only, write nothing
 */
import pg from 'pg';
import sql from 'mssql/msnodesqlv8.js';

const args = new Set(process.argv.slice(2));
const REAL_ONLY = args.has('--real-only');
const DRY = args.has('--dry-run');
const DEMO = '%@demo.cts.test';

if (!process.env.PG_URL || !process.env.MSSQL) {
  console.error('Set PG_URL and MSSQL (see the header of this file).');
  process.exit(1);
}

// Load order from spec 9, step 3 (parents before children). Deletion runs in reverse.
const ORDER = [
  'roles', 'account_types', 'account_type_permissions', 'priorities', 'closure_reasons', 'ticket_types',
  'business_hours', 'holidays', 'teams', 'ticket_categories', 'ticket_subcategories', 'ticket_type_categories',
  'custom_field_definitions', 'sla_policies', 'ticket_status_transitions',
  'organizations', 'branches', 'account_type_access',
  // users: AspNetUsers + profiles are handled by migrateUsers() at this point
  'user_roles', 'admin_scopes', 'staff_placement', 'team_members', 'canned_responses',
  'ticket_counters', 'tickets', 'ticket_custom_field_values', 'ticket_messages', 'ticket_attachments',
  'ticket_assignments', 'ticket_status_history', 'ticket_sla_records', 'ticket_sla_cycles', 'ticket_sla_events',
  'customer_feedback', 'ticket_links', 'ticket_cancellation_requests', 'notifications',
  'kb_categories', 'kb_articles', 'kb_feedback',
  'app_settings', 'site_settings', 'menu_items', 'system_messages', 'email_templates', 'email_settings',
  'captcha_settings', 'signin_code_settings', 'audit_logs',
];
const USERS_AFTER = 'account_type_access';

// Columns that exist only on one side, or need a value of their own.
const SKIP_TARGET = new Set(['seq', 'row_version', 'branch_key', 'category_key', 'locked_until', 'secret_enc', 'password_enc', 'design', 'scan_status', 'ip_address', 'is_default', 'provider']);
const SELF_REF = { organizations: 'parent_id', menu_items: 'parent_id' };   // two passes: rows first, then the self links
const DEFERRED_FK = { organizations: ['team_leader_id'], branches: ['team_leader_id'] };   // point at profiles, loaded later

const pgc = new pg.Client({ connectionString: process.env.PG_URL, ssl: { rejectUnauthorized: false } });
let ms;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function targetColumns(table) {
  const r = await ms.request().input('t', table).query(`
    SELECT c.name, t.name AS type, c.is_identity, c.is_computed
      FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
     WHERE c.object_id = OBJECT_ID('ccs.' + @t) ORDER BY c.column_id`);
  return r.recordset.filter((c) => !c.is_computed && !SKIP_TARGET.has(c.name) && c.type !== 'timestamp');
}

async function sourceColumns(table) {
  const r = await pgc.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table]);
  return new Set(r.rows.map((x) => x.column_name));
}

/** Rows owned by demo users are filtered with these predicates when --real-only is set. */
const demoUsers = `(SELECT id FROM public.profiles WHERE email ILIKE '${DEMO}')`;
const demoTickets = `(SELECT id FROM public.tickets WHERE requester_id IN ${demoUsers})`;
const REAL_FILTER = {
  user_roles: `user_id NOT IN ${demoUsers}`, admin_scopes: `user_id NOT IN ${demoUsers}`, staff_placement: `user_id NOT IN ${demoUsers}`,
  team_members: `user_id NOT IN ${demoUsers}`, canned_responses: `owner_id NOT IN ${demoUsers}`, notifications: `user_id NOT IN ${demoUsers}`,
  kb_feedback: `user_id NOT IN ${demoUsers}`, tickets: `requester_id NOT IN ${demoUsers}`,
  ticket_custom_field_values: `ticket_id NOT IN ${demoTickets}`, ticket_messages: `ticket_id NOT IN ${demoTickets}`,
  ticket_attachments: `ticket_id NOT IN ${demoTickets}`, ticket_assignments: `ticket_id NOT IN ${demoTickets}`,
  ticket_status_history: `ticket_id NOT IN ${demoTickets}`, ticket_sla_records: `ticket_id NOT IN ${demoTickets}`,
  ticket_sla_cycles: `ticket_id NOT IN ${demoTickets}`, ticket_sla_events: `ticket_id NOT IN ${demoTickets}`,
  customer_feedback: `ticket_id NOT IN ${demoTickets}`, ticket_cancellation_requests: `ticket_id NOT IN ${demoTickets}`,
  ticket_links: `ticket_id NOT IN ${demoTickets} AND linked_ticket_id NOT IN ${demoTickets}`,
};

function convert(value, type) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return JSON.stringify(value);                       // text[] -> JSON array
  if (typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) return JSON.stringify(value);  // jsonb
  if (type === 'nvarchar' && typeof value === 'boolean') return value ? 'true' : 'false';
  if (type === 'nvarchar' && typeof value === 'number') return String(value);
  return value;
}

function sqlType(type) {
  switch (type) {
    case 'uniqueidentifier': return sql.UniqueIdentifier;
    case 'datetimeoffset': return sql.DateTimeOffset(7);
    case 'bit': return sql.Bit;
    case 'int': return sql.Int;
    case 'smallint': return sql.SmallInt;
    case 'tinyint': return sql.TinyInt;
    case 'bigint': return sql.BigInt;
    case 'date': return sql.Date;
    default: return sql.NVarChar(sql.MAX);
  }
}

async function copyTable(table) {
  const cols = await targetColumns(table);
  const src = await sourceColumns(table);
  const deferred = new Set([...(DEFERRED_FK[table] ?? []), ...(SELF_REF[table] ? [SELF_REF[table]] : [])]);
  const use = cols.filter((c) => src.has(c.name));
  const where = REAL_ONLY && REAL_FILTER[table] ? `WHERE ${REAL_FILTER[table]}` : '';
  const order = table === 'tickets' ? 'ORDER BY created_at, reference' : table === 'audit_logs' ? 'ORDER BY id' : '';
  const { rows } = await pgc.query(`SELECT ${use.map((c) => `"${c.name}"`).join(', ')} FROM public."${table}" ${where} ${order}`);
  if (DRY || rows.length === 0) { log(`${table}: ${rows.length} rows${DRY ? ' (dry run)' : ''}`); return rows.length; }

  const identity = use.some((c) => c.is_identity);
  const insertCols = use.filter((c) => !deferred.has(c.name));
  // Row-by-row parameterised inserts keep NVARCHAR(MAX)/datetimeoffset exact; the data set is small (spec 1).
  const tx = new sql.Transaction(ms);
  await tx.begin();
  try {
    if (identity) await new sql.Request(tx).query(`SET IDENTITY_INSERT ccs.[${table}] ON`);
    for (const row of rows) {
      const r = new sql.Request(tx);
      insertCols.forEach((c, i) => r.input(`p${i}`, sqlType(c.type), convert(row[c.name], c.type)));
      await r.query(`INSERT INTO ccs.[${table}] (${insertCols.map((c) => `[${c.name}]`).join(', ')}) VALUES (${insertCols.map((_, i) => `@p${i}`).join(', ')})`);
    }
    if (identity) await new sql.Request(tx).query(`SET IDENTITY_INSERT ccs.[${table}] OFF`);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw new Error(`${table}: ${e.message}`);
  }
  // Second pass for self references and links to profiles.
  for (const col of deferred) {
    if (!src.has(col)) continue;
    for (const row of rows.filter((x) => x[col])) {
      await ms.request().input('v', sql.UniqueIdentifier, row[col]).input('id', sql.UniqueIdentifier, row.id)
        .query(`UPDATE ccs.[${table}] SET [${col}] = @v WHERE id = @id AND EXISTS (SELECT 1 FROM ccs.profiles WHERE id = @v UNION ALL SELECT 1 FROM ccs.[${table}] WHERE id = @v)`);
    }
  }
  log(`${table}: ${rows.length} rows`);
  return rows.length;
}

/**
 * auth.users -> dbo.AspNetUsers (+ profiles + Identity roles).
 * Passwords: the bcrypt hash moves as is; BcryptCompatiblePasswordHasher accepts it and re-hashes on first sign-in.
 * Email and phone confirmation move as they are. Authenticator secrets move when readable (spec 9, step 5).
 */
async function migrateUsers() {
  const where = REAL_ONLY ? `WHERE p.email NOT ILIKE '${DEMO}'` : '';
  const { rows } = await pgc.query(`
    SELECT u.id, u.email, u.phone, u.encrypted_password, u.email_confirmed_at, u.phone_confirmed_at, u.banned_until,
           (SELECT f.secret FROM auth.mfa_factors f WHERE f.user_id = u.id AND f.status = 'verified' AND f.factor_type = 'totp' LIMIT 1) AS totp_secret,
           EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = u.id AND f.status = 'verified') AS has_mfa
      FROM auth.users u JOIN public.profiles p ON p.id = u.id ${where}`);
  const roles = await pgc.query(`SELECT ur.user_id, r.code FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id`);
  if (DRY) { log(`users: ${rows.length} (dry run)`); return { users: rows.length, mfaReEnrol: 0 }; }

  const idRoles = (await ms.request().query('SELECT Id, Name FROM dbo.AspNetRoles')).recordset;
  let reEnrol = 0;
  for (const u of rows) {
    const email = (u.email ?? '').toLowerCase();
    await ms.request()
      .input('id', sql.UniqueIdentifier, u.id).input('email', sql.NVarChar(256), email).input('norm', sql.NVarChar(256), email.toUpperCase())
      .input('hash', sql.NVarChar(sql.MAX), u.encrypted_password || null).input('ec', sql.Bit, !!u.email_confirmed_at)
      .input('phone', sql.NVarChar(32), u.phone ? `+${String(u.phone).replace(/^\+/, '')}` : null).input('pc', sql.Bit, !!u.phone_confirmed_at)
      .input('lock', sql.DateTimeOffset(7), u.banned_until ?? null).input('tfa', sql.Bit, !!u.totp_secret)
      .query(`INSERT INTO dbo.AspNetUsers (Id, UserName, NormalizedUserName, Email, NormalizedEmail, EmailConfirmed, PasswordHash,
                SecurityStamp, ConcurrencyStamp, PhoneNumber, PhoneNumberConfirmed, TwoFactorEnabled, LockoutEnd, LockoutEnabled, AccessFailedCount)
              VALUES (@id, @email, @norm, @email, @norm, @ec, @hash, CONVERT(nvarchar(36), NEWID()), CONVERT(nvarchar(36), NEWID()),
                @phone, @pc, @tfa, @lock, 1, 0)`);
    if (u.totp_secret) {
      // Identity keeps the authenticator key (base32) as a user token.
      await ms.request().input('id', sql.UniqueIdentifier, u.id).input('v', sql.NVarChar(sql.MAX), u.totp_secret)
        .query(`INSERT INTO dbo.AspNetUserTokens (UserId, LoginProvider, Name, Value) VALUES (@id, N'[AspNetUserStore]', N'AuthenticatorKey', @v)`);
    } else if (u.has_mfa) reEnrol++;
    for (const r of roles.rows.filter((x) => x.user_id === u.id)) {
      const role = idRoles.find((x) => x.Name === r.code);
      if (role) await ms.request().input('u', sql.UniqueIdentifier, u.id).input('r', sql.UniqueIdentifier, role.Id)
        .query('INSERT INTO dbo.AspNetUserRoles (UserId, RoleId) VALUES (@u, @r)');
    }
  }
  log(`AspNetUsers: ${rows.length} rows (${reEnrol} people with two-step on must enrol again)`);
  await copyTable('profiles');
  return { users: rows.length, mfaReEnrol: reEnrol };
}

async function emptyTarget() {
  log('Emptying target tables (test database only!)');
  await ms.request().query(`
    EXEC sp_MSforeachtable 'ALTER TABLE ? NOCHECK CONSTRAINT ALL', @whereand = ' AND SCHEMA_NAME(schema_id) IN (''ccs'',''dbo'')';
    ${[...ORDER, 'profiles'].reverse().map((t) => `DELETE FROM ccs.[${t}];`).join('\n')}
    DELETE FROM dbo.AspNetUserTokens; DELETE FROM dbo.AspNetUserRoles; DELETE FROM dbo.AspNetUserLogins; DELETE FROM dbo.AspNetUserClaims;
    DELETE FROM ccs.refresh_tokens; DELETE FROM ccs.auth_codes; DELETE FROM dbo.AspNetUsers;
    EXEC sp_MSforeachtable 'ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL', @whereand = ' AND SCHEMA_NAME(schema_id) IN (''ccs'',''dbo'')';`);
}

/** Spec 9, step 8: row counts per table and totals per status / organization / priority, side by side. */
async function verify() {
  const out = [];
  for (const t of [...ORDER, 'profiles']) {
    const where = REAL_ONLY && REAL_FILTER[t] ? `WHERE ${REAL_FILTER[t]}` : t === 'profiles' && REAL_ONLY ? `WHERE email NOT ILIKE '${DEMO}'` : '';
    const a = Number((await pgc.query(`SELECT count(*) n FROM public."${t}" ${where}`)).rows[0].n);
    const b = (await ms.request().query(`SELECT COUNT(*) n FROM ccs.[${t}]`)).recordset[0].n;
    out.push({ table: t, postgres: a, sqlserver: b, ok: a === b ? 'yes' : 'NO' });
  }
  console.table(out);
  const tw = REAL_ONLY ? `WHERE ${REAL_FILTER.tickets}` : '';
  const pgStatus = (await pgc.query(`SELECT status::text k, count(*)::int n FROM public.tickets ${tw} GROUP BY 1 ORDER BY 1`)).rows;
  const msStatus = (await ms.request().query('SELECT status k, COUNT(*) n FROM ccs.tickets GROUP BY status ORDER BY status')).recordset;
  console.log('Tickets per status  PG:', JSON.stringify(pgStatus), '\n                    SQL:', JSON.stringify(msStatus));
  const pgPrio = (await pgc.query(`SELECT priority k, count(*)::int n FROM public.tickets ${tw} GROUP BY 1 ORDER BY 1`)).rows;
  const msPrio = (await ms.request().query('SELECT priority k, COUNT(*) n FROM ccs.tickets GROUP BY priority ORDER BY priority')).recordset;
  console.log('Tickets per priority PG:', JSON.stringify(pgPrio), '\n                    SQL:', JSON.stringify(msPrio));
  const pgOrg = (await pgc.query(`SELECT p.organization_id::text k, count(*)::int n FROM public.tickets t JOIN public.profiles p ON p.id = t.requester_id ${tw.replace('requester_id', 't.requester_id')} GROUP BY 1 ORDER BY 1`)).rows;
  const msOrg = (await ms.request().query('SELECT LOWER(CONVERT(nvarchar(36), p.organization_id)) k, COUNT(*) n FROM ccs.tickets t JOIN ccs.profiles p ON p.id = t.requester_id GROUP BY p.organization_id ORDER BY 1')).recordset;
  console.log('Tickets per org     PG:', pgOrg.length, 'orgs; SQL:', msOrg.length, 'orgs; equal:', JSON.stringify(pgOrg) === JSON.stringify(msOrg.map((x) => ({ k: x.k, n: x.n }))));
  return out.every((x) => x.ok === 'yes');
}

async function main() {
  await pgc.connect();
  ms = await sql.connect({ connectionString: process.env.MSSQL, driver: 'msnodesqlv8' });
  log(`Connected. Mode: ${REAL_ONLY ? 'real data only' : 'all data'}${DRY ? ', dry run' : ''}`);
  if (!DRY) await emptyTarget();
  for (const t of ORDER) {
    await copyTable(t);
    if (t === USERS_AFTER) await migrateUsers();
  }
  if (!DRY) {
    // The calendar the SLA policies use becomes the system default (v2 keeps it as a flag).
    await ms.request().query(`UPDATE ccs.business_hours SET is_default = CASE WHEN id = (SELECT TOP 1 business_hours_id FROM ccs.sla_policies WHERE business_hours_id IS NOT NULL GROUP BY business_hours_id ORDER BY COUNT(*) DESC) THEN 1 ELSE 0 END`);
    await ms.request().query(`UPDATE ccs.ticket_attachments SET scan_status = N'skipped'`);   // files are re-scanned by copy-files.ps1
    const ok = await verify();
    log(ok ? 'All row counts match.' : 'ROW COUNTS DIFFER - see the table above.');
    log('Re-enter secrets in Admin, Settings: SMTP password and Turnstile secret (spec 9, step 7).');
  }
  await pgc.end();
  await ms.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
