using System.Text;
using Ccs.Application.Abstractions;
using Ccs.Application.Settings;
using Ccs.Application.Sla;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Ccs.Infrastructure;
using Ccs.Infrastructure.Identity;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api;

/// <summary>
/// Server command: fills an EMPTY system with demo data for a final clean test.
///   dotnet Ccs.Api.dll seed-demo
/// Reads ConnectionStrings__Ccs from the environment / appsettings, like the API itself. It refuses to run when the
/// database already has tickets or active organizations. The person running it types one password for every demo
/// account (hidden, never stored) and chooses the e-mail addresses. No notifications or e-mails are sent while seeding.
///
/// Creates: 3 separate organizations (Main with 3 branches, B and C), their admins, team leaders, agents and customers,
/// one team per place, a management viewer, and 200 tickets over the last 60 days in every status and SLA state, with
/// replies, notes, ratings, cancellation requests, duplicate / spam / follow-up links, escalations and reassignments.
/// </summary>
public static class DemoSeed
{
    // ------------------------------------------------------------------ the people (key = e-mail name)

    private sealed record Person(string Key, string Name, string Kind, string Place, bool Leader = false);
    // Kind: orgadmin | branchadmin | leader | agent | customer | viewer. Place: main | cairo | giza | alex | orgb | orgc.
    private static readonly Person[] People =
    [
        new("main.admin", "Hany Mostafa", "orgadmin", "main"),
        new("main.leader", "Tamer Adel", "leader", "main", true),
        new("main.agent1", "Sara Fathy", "agent", "main"),
        new("main.agent2", "Mahmoud Saeed", "agent", "main"),
        new("main.customer1", "Mona Ibrahim", "customer", "main"),
        new("main.customer2", "Khaled Nabil", "customer", "main"),
        new("cairo.admin", "Rania Samir", "branchadmin", "cairo"),
        new("cairo.leader", "Omar Hassan", "leader", "cairo", true),
        new("cairo.agent1", "Nour Ahmed", "agent", "cairo"),
        new("cairo.agent2", "Youssef Kamal", "agent", "cairo"),
        new("cairo.customer1", "Dina Farouk", "customer", "cairo"),
        new("cairo.customer2", "Ahmed Lotfy", "customer", "cairo"),
        new("giza.admin", "Hossam Gamal", "branchadmin", "giza"),
        new("giza.leader", "Amira Salah", "leader", "giza", true),
        new("giza.agent1", "Karim Wael", "agent", "giza"),
        new("giza.agent2", "Heba Tarek", "agent", "giza"),
        new("giza.customer1", "Mostafa Reda", "customer", "giza"),
        new("giza.customer2", "Yasmin Adel", "customer", "giza"),
        new("alex.admin", "Sherif Magdy", "branchadmin", "alex"),
        new("alex.leader", "Laila Hamdy", "leader", "alex", true),
        new("alex.agent1", "Ali Sobhy", "agent", "alex"),
        new("alex.agent2", "Mai Essam", "agent", "alex"),
        new("alex.customer1", "Tarek Zaki", "customer", "alex"),
        new("alex.customer2", "Nada Fouad", "customer", "alex"),
        new("orgb.admin", "Walid Shawky", "orgadmin", "orgb"),
        new("orgb.leader", "Ramy Fawzy", "leader", "orgb", true),
        new("orgb.customer1", "Salma Nasser", "customer", "orgb"),
        new("orgc.admin", "Eman Helmy", "orgadmin", "orgc"),
        new("orgc.leader", "Bassem Anwar", "leader", "orgc", true),
        new("orgc.customer1", "Ghada Ramzy", "customer", "orgc"),
        new("viewer", "Fatma Ezzat", "viewer", ""),
    ];

    private static readonly (string Key, string Org, string? Branch, string TeamEn, string TeamAr)[] Places =
    [
        ("main", "Demo Water Company", null, "Main Office Support", "دعم المكتب الرئيسي"),
        ("cairo", "Demo Water Company", "Cairo Branch", "Cairo Branch Support", "دعم فرع القاهرة"),
        ("giza", "Demo Water Company", "Giza Branch", "Giza Branch Support", "دعم فرع الجيزة"),
        ("alex", "Demo Water Company", "Alexandria Branch", "Alexandria Branch Support", "دعم فرع الإسكندرية"),
        ("orgb", "Demo Logistics", null, "Demo Logistics Support", "دعم شركة الخدمات اللوجستية"),
        ("orgc", "Demo Medical Center", null, "Demo Medical Center Support", "دعم المركز الطبي"),
    ];

    private static readonly string[] Subjects =
    [
        "Water meter reading looks wrong", "No water supply since this morning", "Low water pressure on upper floors",
        "Request to install a new water connection", "Bill amount is higher than usual", "Leak in the street near my building",
        "Change the name on my account", "Request a payment plan for an old bill", "Sewage overflow in the area",
        "Water colour is brown", "Online payment failed but money was taken", "Request a meter inspection visit",
        "Wrong address on the bill", "Cannot sign in to the customer portal", "Transfer the account to a new owner",
        "Broken manhole cover", "Request a copy of last year's bills", "Complaint about a field technician visit",
        "Request to stop the service temporarily", "Smell from the water", "انقطاع المياه منذ يومين", "طلب تركيب عداد جديد",
        "فاتورة غير صحيحة", "تسريب مياه أمام المنزل", "ضعف ضغط المياه", "طلب تغيير اسم صاحب الحساب",
    ];
    private const string Desc = "Hello, please help with this request. The details are in the subject; I can be reached at the phone number on my account. Thank you.";

    /// <summary>The command runs with nobody signed in.</summary>
    private sealed class NoUser : ICurrentUser { public Guid? UserId => null; public int MfaLevel => 1; public string? IpAddress => null; }

    private sealed class Seeded
    {
        public Dictionary<string, Guid> Person = [];
        public Dictionary<string, (Guid Org, Guid? Branch, Guid Team)> Place = [];
    }

    public static async Task<int> RunAsync(string[] args)
    {
        var builder = Host.CreateApplicationBuilder();
        builder.Services.AddCcsInfrastructure(builder.Configuration, runJobs: false);
        builder.Services.AddScoped<ICurrentUser, NoUser>();
        builder.Logging.SetMinimumLevel(LogLevel.Warning);
        builder.Logging.AddFilter("Microsoft.EntityFrameworkCore", LogLevel.Error);
        using var host = builder.Build();
        using var scope = host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CcsDbContext>();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();

        // ---- safety: only an empty system, and a typed confirmation
        var dbName = db.Database.GetDbConnection().Database;
        var tickets = await db.Tickets.CountAsync();
        var orgs = await db.Organizations.CountAsync(o => o.IsActive);
        if (tickets > 0 || orgs > 0)
        {
            Console.Error.WriteLine($"Database {dbName} still has {tickets} tickets and {orgs} active organizations.");
            Console.Error.WriteLine("Remove them first (Settings > Clean up data), then run seed-demo again. Nothing was changed.");
            return 3;
        }
        if (await db.Organizations.AnyAsync(o => Places.Select(p => p.Org).Contains(o.Name)))
        {
            Console.Error.WriteLine("An organization with a demo name already exists (switched off). Remove it first. Nothing was changed.");
            return 3;
        }
        Console.WriteLine($"This adds demo data to database \"{dbName}\": 3 organizations, 31 accounts and 200 tickets.");
        Console.Write("Type SEED to continue: ");
        if ((Console.ReadLine() ?? "").Trim() != "SEED") { Console.WriteLine("Stopped. Nothing was changed."); return 1; }

        Console.Write("E-mail for the demo accounts: type your mailbox (for example name@gmail.com) to get every demo e-mail there,\n" +
                      "or press Enter for made-up addresses (name@demo.test): ");
        var mailbox = (Console.ReadLine() ?? "").Trim().ToLowerInvariant();
        Func<string, string> emailOf = mailbox.Contains('@')
            ? k => mailbox[..mailbox.IndexOf('@')] + "+demo." + k + mailbox[mailbox.IndexOf('@')..]
            : k => k + "@demo.test";
        foreach (var p in People)
            if (await users.FindByEmailAsync(emailOf(p.Key)) is not null)
            { Console.Error.WriteLine($"{emailOf(p.Key)} already exists. Nothing was changed."); return 3; }

        var password = ReadHidden("Password for every demo account: ");
        if (ReadHidden("Type it again: ") != password) { Console.Error.WriteLine("The two passwords differ. Nothing was changed."); return 1; }
        foreach (var v in users.PasswordValidators)
        {
            var r = await v.ValidateAsync(users, new AppUser { UserName = "check@demo.test", Email = "check@demo.test" }, password);
            if (!r.Succeeded) { Console.Error.WriteLine("Password not accepted: " + string.Join("; ", r.Errors.Select(e => e.Description))); return 1; }
        }

        var now = DateTimeOffset.UtcNow;
        var s = new Seeded();
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            var created = new List<AppUser>();
            try
            {
                await SeedPlacesAndPeopleAsync(db, users, s, emailOf, password, created, now);
                await SeedTicketsAsync(db, s, now);
                await db.SaveChangesAsync();
                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                foreach (var u in created) { try { await users.DeleteAsync(u); } catch { /* already rolled back */ } }
                throw;
            }
        }

        Console.WriteLine();
        Console.WriteLine("Demo data ready. Accounts (all with the password you typed):");
        foreach (var p in People) Console.WriteLine($"  {Label(p.Kind),-22} {Where(p.Place),-36} {emailOf(p.Key)}");
        Console.WriteLine($"Tickets: {await db.Tickets.CountAsync()}");
        return 0;
    }

    private static string Label(string kind) => kind switch
    {
        "orgadmin" => "Organization admin", "branchadmin" => "Branch admin", "leader" => "Team leader",
        "agent" => "Agent", "customer" => "Customer", _ => "Management viewer",
    };
    private static string Where(string place) => Places.FirstOrDefault(x => x.Key == place) is var pl && pl.Org is not null
        ? pl.Org + (pl.Branch is null ? "" : " / " + pl.Branch) : "All organizations";

    private static string ReadHidden(string prompt)
    {
        Console.Write(prompt);
        if (Console.IsInputRedirected) return Console.ReadLine() ?? "";
        var sb = new StringBuilder();
        while (true)
        {
            var k = Console.ReadKey(intercept: true);
            if (k.Key == ConsoleKey.Enter) break;
            if (k.Key == ConsoleKey.Backspace) { if (sb.Length > 0) sb.Length--; continue; }
            if (!char.IsControl(k.KeyChar)) sb.Append(k.KeyChar);
        }
        Console.WriteLine();
        return sb.ToString();
    }

    // ------------------------------------------------------------------ places, teams, account types, people

    private static async Task SeedPlacesAndPeopleAsync(CcsDbContext db, UserManager<AppUser> users, Seeded s,
        Func<string, string> emailOf, string password, List<AppUser> created, DateTimeOffset now)
    {
        // A team kind the categories already route to, so new tickets from the demo places find these teams.
        var kind = await db.TicketCategories.Where(c => c.IsActive && c.TeamKindId != null)
                       .GroupBy(c => c.TeamKindId).OrderByDescending(g => g.Count()).Select(g => g.Key).FirstOrDefaultAsync()
                   ?? await db.TeamKinds.OrderBy(k => k.SortOrder).Select(k => (Guid?)k.Id).FirstOrDefaultAsync();
        if (kind is null)
        {
            var k = new TeamKind { Id = Guid.NewGuid(), NameEn = "Customer support", NameAr = "خدمة العملاء", CreatedAt = now };
            db.TeamKinds.Add(k); kind = k.Id;
            await db.SaveChangesAsync();
        }

        // Saved level by level: the database checks each link (organization, then branch, then team).
        var orgIds = new Dictionary<string, Guid>();
        foreach (var org in Places.Select(p => p.Org).Distinct())
        {
            orgIds[org] = Guid.NewGuid();
            db.Organizations.Add(new Organization { Id = orgIds[org], Name = org, CreatedAt = now, UpdatedAt = now, EscalationMode = "any" });
        }
        await db.SaveChangesAsync();
        var branchIds = new Dictionary<string, Guid?>();
        foreach (var pl in Places)
        {
            branchIds[pl.Key] = pl.Branch is null ? null : Guid.NewGuid();
            if (pl.Branch is not null) db.Branches.Add(new Branch { Id = branchIds[pl.Key]!.Value, OrganizationId = orgIds[pl.Org], Name = pl.Branch, CreatedAt = now, UpdatedAt = now });
        }
        await db.SaveChangesAsync();
        foreach (var pl in Places)
        {
            var team = new Team { Id = Guid.NewGuid(), NameEn = pl.TeamEn, NameAr = pl.TeamAr, KindId = kind, OrganizationId = orgIds[pl.Org], BranchId = branchIds[pl.Key], CreatedAt = now, UpdatedAt = now };
            db.Teams.Add(team);
            s.Place[pl.Key] = (orgIds[pl.Org], branchIds[pl.Key], team.Id);
        }
        await db.SaveChangesAsync();

        // Account types: the default ones (made here when the API has not started yet).
        await DefaultTypesStartup.EnsureAsync(db);
        var byKey = await db.AccountTypes.Where(t => t.DefaultKey != null).ToDictionaryAsync(t => t.DefaultKey!);
        var types = new Dictionary<string, AccountType>
        {
            ["orgadmin"] = byKey[DefaultAccountTypes.OrganizationAdmin], ["branchadmin"] = byKey[DefaultAccountTypes.BranchAdmin],
            ["leader"] = byKey[DefaultAccountTypes.TeamLeader], ["agent"] = byKey[DefaultAccountTypes.Agent], ["viewer"] = byKey[DefaultAccountTypes.Viewer],
        };
        await db.SaveChangesAsync();
        var roleIds = await db.CcsRoles.ToDictionaryAsync(r => r.Code, r => r.Id);

        foreach (var p in People)
        {
            var email = emailOf(p.Key);
            var user = new AppUser { Id = Guid.NewGuid(), UserName = email, Email = email, EmailConfirmed = true };
            var r = await users.CreateAsync(user, password);
            if (!r.Succeeded) throw new InvalidOperationException($"{email}: " + string.Join("; ", r.Errors.Select(e => e.Description)));
            created.Add(user);
            s.Person[p.Key] = user.Id;
            var place = p.Place == "" ? default : s.Place[p.Place];
            var type = p.Kind == "customer" ? null : types[p.Kind];
            db.Profiles.Add(new Profile
            {
                Id = user.Id, FullName = p.Name, Email = email, CreatedAt = now.AddDays(-75), UpdatedAt = now, PasswordChangedAt = now,
                AccountStatus = AccountStatus.Active, AccountTypeId = type?.Id,
                OrganizationId = p.Kind == "customer" ? place.Org : null, BranchId = p.Kind == "customer" ? place.Branch : null,
                AutoAssign = p.Kind is "agent" or "leader",
            });
            var role = p.Kind switch
            {
                "customer" => RoleCode.Customer, "agent" => RoleCode.Agent, "viewer" => RoleCode.ManagementViewer, _ => RoleCode.TeamLeader,
            };
            db.CcsUserRoles.Add(new UserRole { UserId = user.Id, RoleId = roleIds[role] });
            if (p.Kind is "customer" or "viewer") continue;
            db.StaffPlacements.Add(new StaffPlacement { Id = Guid.NewGuid(), UserId = user.Id, OrganizationId = place.Org, BranchId = place.Branch });
            if (p.Kind is "orgadmin" or "branchadmin")
                db.AdminScopes.Add(new AdminScope { Id = Guid.NewGuid(), UserId = user.Id, OrganizationId = place.Org, BranchId = place.Branch });
            if (p.Kind is "agent" or "leader")
                db.TeamMembers.Add(new TeamMember { TeamId = place.Team, UserId = user.Id, IsLeader = p.Leader });
        }
        await db.SaveChangesAsync();

        // Leaders head their place (the escalation chain), and a few escalation / reassign settings to test.
        foreach (var p in People.Where(x => x.Leader))
        {
            var place = s.Place[p.Place];
            if (place.Branch is Guid b) (await db.Branches.FirstAsync(x => x.Id == b)).TeamLeaderId = s.Person[p.Key];
            else (await db.Organizations.FirstAsync(x => x.Id == place.Org)).TeamLeaderId = s.Person[p.Key];
        }
        var giza = await db.Branches.FirstAsync(x => x.Id == s.Place["giza"].Branch);
        giza.EscalationMode = "next";
        var alex = await db.Branches.FirstAsync(x => x.Id == s.Place["alex"].Branch);
        alex.EscalationMode = "specific"; alex.EscalationPicks = $"[\"org:{s.Place["alex"].Org}\"]";
        (await db.Organizations.FirstAsync(x => x.Id == s.Place["orgc"].Org)).EscalationMode = "next";
        (await db.Branches.FirstAsync(x => x.Id == s.Place["cairo"].Branch)).ReassignRule =
            new ReassignRule(true, [ReassignRule.Agents, ReassignRule.Leader, ReassignRule.Queue, ReassignRule.Auto], true, false).ToJson();
        await db.SaveChangesAsync();
    }

    // ------------------------------------------------------------------ tickets

    private static async Task SeedTicketsAsync(CcsDbContext db, Seeded s, DateTimeOffset now)
    {
        var rnd = new Random(20261126);
        var settings = new SettingsService(db);
        var calendars = new CalendarProvider(db);
        var format = await settings.GetTicketNumberFormatAsync();
        var policies = await db.SlaPolicies.AsNoTracking().Where(p => p.IsActive).ToListAsync();
        var priorities = await db.Priorities.AsNoTracking().Select(p => p.Code).ToListAsync();
        if (priorities.Count == 0) priorities = ["low", "normal", "high", "critical"];
        var (catalog, typeCodes) = await CatalogAsync(db, now);

        // Status plan for 200 tickets: every status, closure reason and SLA state.
        var plan = new List<(string Status, string? Reason, string Sla)>();
        void Add(int n, string st, string? reason = null, string sla = "")
        { for (var i = 0; i < n; i++) plan.Add((st, reason, sla)); }
        string[] live = [SlaState.OnTrack, SlaState.Close, SlaState.DueSoon, SlaState.Breached];
        for (var i = 0; i < 15; i++) plan.Add((TicketStatus.New, null, live[i % 4]));
        for (var i = 0; i < 25; i++) plan.Add((TicketStatus.Open, null, live[i % 4]));
        for (var i = 0; i < 40; i++) plan.Add((TicketStatus.InProgress, null, live[i % 4]));
        Add(15, TicketStatus.PendingCustomer, null, SlaState.Paused);
        for (var i = 0; i < 15; i++) plan.Add((TicketStatus.PendingInternal, null, live[i % 4]));
        for (var i = 0; i < 10; i++) plan.Add((TicketStatus.Reopened, null, live[i % 4]));
        Add(25, TicketStatus.Resolved, null, SlaState.Completed);
        Add(26, TicketStatus.Closed, ClosureReasonCode.ResolvedConfirmed, SlaState.Completed);
        Add(10, TicketStatus.Closed, ClosureReasonCode.AutoClosed, SlaState.Completed);
        Add(5, TicketStatus.Closed, ClosureReasonCode.NoResponse, SlaState.Completed);
        Add(4, TicketStatus.Closed, ClosureReasonCode.Duplicate, SlaState.Completed);
        Add(3, TicketStatus.Closed, ClosureReasonCode.Spam, SlaState.Completed);
        Add(5, TicketStatus.Closed, ClosureReasonCode.Cancelled, SlaState.Completed);
        Add(2, TicketStatus.Closed, "other", SlaState.Completed);
        plan = plan.OrderBy(_ => rnd.Next()).ToList();

        var customers = People.Where(p => p.Kind == "customer").ToList();
        var made = new List<Ticket>();
        var n = 0;
        foreach (var (status, reason, slaTarget) in plan)
        {
            var cust = customers[n++ % customers.Count];
            var place = s.Place[cust.Place];
            var staff = People.Where(p => p.Place == cust.Place && p.Kind is "agent" or "leader").Select(p => s.Person[p.Key]).ToList();
            var leader = People.Where(p => p.Place == cust.Place && p.Leader).Select(p => s.Person[p.Key]).First();
            var priority = priorities[rnd.Next(priorities.Count)];
            var policy = policies.FirstOrDefault(p => p.Priority == priority) ?? policies.FirstOrDefault(p => p.Priority == "normal");
            var cal = policy is null ? null : await calendars.GetAsync(policy.BusinessHoursId);
            var (typeId, catId) = catalog[rnd.Next(catalog.Count)];
            var done = status is TicketStatus.Resolved or TicketStatus.Closed;
            var unassigned = status == TicketStatus.New && rnd.Next(3) > 0;
            var agent = unassigned ? (Guid?)null : staff[rnd.Next(staff.Count)];

            // When it was opened: finished tickets anywhere in the last 60 days; live ones from their SLA target.
            var total = policy is null ? 960 : (status == TicketStatus.New ? policy.FirstResponseMinutes : policy.ResolutionMinutes);
            DateTimeOffset created, due;
            if (done || slaTarget == SlaState.Paused)
            {
                created = now.AddMinutes(-rnd.Next(3 * 1440, 60 * 1440));
                due = WallClock.AddMinutes(cal, created, total);
            }
            else
            {
                double left = slaTarget switch { SlaState.OnTrack => 0.85, SlaState.Close => 0.35, SlaState.DueSoon => 0.08, _ => -1 };
                if (left > 0)
                {
                    due = WallClock.AddMinutes(cal, now, Math.Max(1, (int)(total * left)));
                    created = now.AddMinutes(-Math.Max(5, (int)(total * (1 - left))));
                }
                else
                {
                    created = now.AddMinutes(-rnd.Next(2 * 1440, 20 * 1440));
                    due = now.AddMinutes(-rnd.Next(60, 1440));
                }
            }

            var stamp = format.Render(typeCodes.GetValueOrDefault(typeId), created, await db.NextTicketNumberAsync(format.PeriodKey(created)));
            var t = new Ticket
            {
                Id = Guid.NewGuid(), Reference = stamp, RequesterId = s.Person[cust.Key], OrganizationId = place.Org, BranchId = place.Branch,
                Subject = Subjects[rnd.Next(Subjects.Length)], Description = Desc, TicketTypeId = typeId, CategoryId = catId,
                Priority = priority, Status = status, TeamId = place.Team, AssignedAgentId = agent,
                CreatedBy = s.Person[cust.Key], CreatedAt = created, UpdatedAt = created,
            };
            DateTimeOffset Min(DateTimeOffset a, DateTimeOffset b) => a < b ? a : b;
            var resolvedAt = done ? Min(created.AddMinutes(rnd.Next(120, 2 * 1440)), now.AddHours(-3)) : (DateTimeOffset?)null;
            DateTimeOffset? closedAt = status == TicketStatus.Closed ? Min(resolvedAt!.Value.AddHours(rnd.Next(1, 72)), now.AddHours(-1)) : null;
            // Every step happens between opening and the end (closing, solving, or now), in order.
            var end = closedAt ?? resolvedAt ?? now.AddMinutes(-1);
            DateTimeOffset At(double f) => created + (end - created) * f;
            var firstReply = At(0.1);
            if (done)
            {
                t.ResolvedAt = resolvedAt; t.ResolvedBy = agent ?? leader;
                t.ResolutionSummary = "The issue was checked and fixed. Please tell us if it happens again.";
            }
            if (status == TicketStatus.Closed)
            {
                t.ClosedAt = closedAt; t.ClosedBy = reason == ClosureReasonCode.Cancelled ? t.RequesterId : agent ?? leader;
                t.ClosureReason = reason;
                if (reason is ClosureReasonCode.Duplicate or ClosureReasonCode.Spam or ClosureReasonCode.Cancelled) { t.ResolutionSummary = null; t.ResolvedAt = null; t.ResolvedBy = null; }
            }
            if (status == TicketStatus.Reopened) t.ReopenedCount = 1;
            t.UpdatedAt = t.ClosedAt ?? t.ResolvedAt ?? (status == TicketStatus.New ? created : firstReply);
            db.Tickets.Add(t);
            made.Add(t);
            await db.SaveChangesAsync();   // the ticket first: its history, messages and SLA rows point to it

            // History, assignment, messages
            Hist(db, t.Id, null, TicketStatus.New, t.RequesterId, created);
            if (agent is Guid a)
                db.TicketAssignments.Add(new TicketAssignment { Id = Guid.NewGuid(), TicketId = t.Id, ToAgent = a, FromTeam = place.Team, ToTeam = place.Team, AssignedBy = leader, Reason = "auto:fewest:team", CreatedAt = At(0.02) });
            if (status != TicketStatus.New)
            {
                Hist(db, t.Id, TicketStatus.New, TicketStatus.Open, agent ?? leader, At(0.05));
                Msg(db, t.Id, agent ?? leader, MessageKind.PublicReply, "Thank you for contacting us. We are looking into this now.", firstReply);
                if (rnd.Next(2) == 0) Msg(db, t.Id, agent ?? leader, MessageKind.InternalNote, "Checked the account history; a field visit may be needed.", At(0.12));
                if (status is not TicketStatus.Open) Hist(db, t.Id, TicketStatus.Open, TicketStatus.InProgress, agent ?? leader, At(0.15));
                if (status is TicketStatus.PendingCustomer)
                {
                    Msg(db, t.Id, agent ?? leader, MessageKind.PublicReply, "Could you please send a photo of the meter and your account number?", At(0.29));
                    Hist(db, t.Id, TicketStatus.InProgress, status, agent ?? leader, At(0.3));
                }
                if (status is TicketStatus.PendingInternal) Hist(db, t.Id, TicketStatus.InProgress, status, agent ?? leader, At(0.3), "Waiting for the field team");
                if (status is TicketStatus.Resolved or TicketStatus.Closed or TicketStatus.Reopened)
                {
                    var r = resolvedAt ?? At(0.5);
                    if (reason is not (ClosureReasonCode.Duplicate or ClosureReasonCode.Spam or ClosureReasonCode.Cancelled))
                    {
                        Msg(db, t.Id, agent ?? leader, MessageKind.PublicReply, "We fixed the problem. Please check and tell us.", At(0.45));
                        Hist(db, t.Id, TicketStatus.InProgress, TicketStatus.Resolved, agent ?? leader, r);
                    }
                    if (status == TicketStatus.Reopened)
                    {
                        Msg(db, t.Id, t.RequesterId, MessageKind.PublicReply, "The problem came back, please check again.", At(0.7));
                        Hist(db, t.Id, TicketStatus.Resolved, TicketStatus.Reopened, t.RequesterId, At(0.7), "The problem came back");
                    }
                    if (status == TicketStatus.Closed && reason == ClosureReasonCode.ResolvedConfirmed)
                        Msg(db, t.Id, t.RequesterId, MessageKind.PublicReply, "Thank you, it works now.", At(0.95));
                    if (status == TicketStatus.Closed)
                        Hist(db, t.Id, reason is ClosureReasonCode.Duplicate or ClosureReasonCode.Spam or ClosureReasonCode.Cancelled ? TicketStatus.InProgress : TicketStatus.Resolved,
                            TicketStatus.Closed, t.ClosedBy, t.ClosedAt!.Value, null, reason);
                }
            }

            // SLA clock
            if (policy is not null)
            {
                var responded = status == TicketStatus.New ? (DateTimeOffset?)null : firstReply;
                var rec = new TicketSlaRecord
                {
                    TicketId = t.Id, PolicyId = policy.Id, CycleNo = 1, CycleStartedAt = created, UpdatedAt = now,
                    FirstResponseDue = status == TicketStatus.New ? due : WallClock.AddMinutes(cal, created, policy.FirstResponseMinutes),
                    ResolutionDue = status == TicketStatus.New ? WallClock.AddMinutes(cal, created, policy.ResolutionMinutes) : due,
                    FirstRespondedAt = responded,
                };
                if (done) { rec.ResolvedAt = t.ResolvedAt ?? t.ClosedAt; rec.State = SlaState.Completed; }
                else if (status == TicketStatus.PendingCustomer) { rec.PausedAt = At(0.3); rec.State = SlaState.Paused; }
                else
                {
                    var ev = SlaClock.Evaluate(new SlaSnapshot(rec.FirstRespondedAt, rec.FirstResponseDue, rec.ResolutionDue,
                        policy.FirstResponseMinutes, policy.ResolutionMinutes, policy.WarningThresholdPct, policy.CloseThresholdPct), now, cal);
                    rec.State = ev.State;
                    // Already warned / breached: mark the events as sent so the SLA job does not e-mail about old demo tickets.
                    if (ev.State is SlaState.DueSoon or SlaState.Breached)
                    {
                        rec.WarningSentAt = now;
                        db.TicketSlaEvents.Add(new TicketSlaEvent { Id = Guid.NewGuid(), TicketId = t.Id, Clock = ev.Clock, Event = "warning", CycleNo = 1, CreatedAt = now });
                    }
                    if (ev.State == SlaState.Breached)
                    {
                        rec.BreachedAt = ev.Due; rec.BreachNotifiedAt = now;
                        db.TicketSlaEvents.Add(new TicketSlaEvent { Id = Guid.NewGuid(), TicketId = t.Id, Clock = ev.Clock, Event = "breach", CycleNo = 1, CreatedAt = now });
                    }
                }
                db.TicketSlaRecords.Add(rec);
            }
            await db.SaveChangesAsync();
        }
        await db.SaveChangesAsync();
        await ExtrasAsync(db, s, made, rnd, now);
    }

    /// <summary>Uses the active ticket types and categories; adds a small catalog only when there is none.</summary>
    private static async Task<(List<(Guid Type, Guid Category)>, Dictionary<Guid, string?>)> CatalogAsync(CcsDbContext db, DateTimeOffset now)
    {
        var links = await (from l in db.TicketTypeCategories
                           join ty in db.TicketTypes on l.TypeId equals ty.Id
                           join c in db.TicketCategories on l.CategoryId equals c.Id
                           where ty.IsActive && c.IsActive
                           select new { l.TypeId, l.CategoryId }).ToListAsync();
        if (links.Count == 0)
        {
            var kind = await db.TeamKinds.Select(k => (Guid?)k.Id).FirstOrDefaultAsync();
            var incident = new TicketType { Id = Guid.NewGuid(), Code = "INC", NameEn = "Complaint", NameAr = "شكوى", CreatedAt = now };
            var request = new TicketType { Id = Guid.NewGuid(), Code = "REQ", NameEn = "Service request", NameAr = "طلب خدمة", CreatedAt = now };
            db.TicketTypes.AddRange(incident, request);
            (string En, string Ar, TicketType Ty)[] cats =
            [
                ("Water supply", "إمداد المياه", incident), ("Billing", "الفواتير", incident),
                ("New connection", "توصيل جديد", request), ("Account changes", "تعديل بيانات الحساب", request),
            ];
            var i = 0;
            var made = cats.Select(x => (Cat: new TicketCategory { Id = Guid.NewGuid(), NameEn = x.En, NameAr = x.Ar, TeamKindId = kind, SortOrder = i++ }, x.Ty)).ToList();
            foreach (var (c, _) in made) db.TicketCategories.Add(c);
            await db.SaveChangesAsync();   // types and categories first, then the links between them
            foreach (var (c, ty) in made)
            {
                db.TicketTypeCategories.Add(new TicketTypeCategory { TypeId = ty.Id, CategoryId = c.Id });
                links.Add(new { TypeId = ty.Id, CategoryId = c.Id });
            }
            await db.SaveChangesAsync();
        }
        var codes = await db.TicketTypes.AsNoTracking().ToDictionaryAsync(t => t.Id, t => t.Code);
        return (links.Select(l => (l.TypeId, l.CategoryId)).ToList(), codes);
    }

    /// <summary>Ratings, cancellation requests, duplicate / spam / follow-up links, escalations and reassignments.</summary>
    private static async Task ExtrasAsync(CcsDbContext db, Seeded s, List<Ticket> made, Random rnd, DateTimeOffset now)
    {
        string[] comments = ["Very fast, thank you!", "Good service.", "It took a long time.", "The technician was helpful.", "Not solved well."];
        foreach (var t in made.Where(x => x.ClosureReason == ClosureReasonCode.ResolvedConfirmed).Take(20))
            db.CustomerFeedback.Add(new CustomerFeedback { TicketId = t.Id, Rating = (short)rnd.Next(1, 6), Comment = comments[rnd.Next(comments.Length)], SubmittedBy = t.RequesterId, CreatedAt = t.ClosedAt!.Value });

        foreach (var t in made.Where(x => x.ClosureReason == ClosureReasonCode.Cancelled))
            db.TicketCancellationRequests.Add(new TicketCancellationRequest { Id = Guid.NewGuid(), TicketId = t.Id, RequestedBy = t.RequesterId, Reason = "The problem was solved by itself.", Status = "approved", DecidedBy = t.AssignedAgentId, DecidedAt = t.ClosedAt, CreatedAt = t.ClosedAt!.Value.AddHours(-1) });
        var open = made.Where(x => x.Status is TicketStatus.Open or TicketStatus.InProgress).ToList();
        foreach (var t in open.Take(3))
            db.TicketCancellationRequests.Add(new TicketCancellationRequest { Id = Guid.NewGuid(), TicketId = t.Id, RequestedBy = t.RequesterId, Reason = "I no longer need this.", CreatedAt = now.AddHours(-2) });
        foreach (var t in open.Skip(3).Take(2))
            db.TicketCancellationRequests.Add(new TicketCancellationRequest { Id = Guid.NewGuid(), TicketId = t.Id, RequestedBy = t.RequesterId, Reason = "Please cancel.", Status = "rejected", DecidedBy = t.AssignedAgentId, DecidedAt = now.AddHours(-1), DecisionNote = "The visit is already booked; we will finish it.", CreatedAt = now.AddHours(-3) });

        var closedOk = made.Where(x => x.ClosureReason == ClosureReasonCode.ResolvedConfirmed).ToList();
        foreach (var t in made.Where(x => x.ClosureReason == ClosureReasonCode.Duplicate))
        {
            var original = made.FirstOrDefault(o => o.RequesterId == t.RequesterId && o.Id != t.Id && o.ClosureReason != ClosureReasonCode.Duplicate) ?? closedOk[0];
            db.TicketLinks.Add(new TicketLink { Id = Guid.NewGuid(), TicketId = t.Id, LinkedTicketId = original.Id, Kind = "duplicate_of", CreatedBy = t.ClosedBy, CreatedAt = t.ClosedAt!.Value });
        }
        foreach (var t in made.Where(x => x.Status == TicketStatus.Open).Take(3))
        {
            var before = closedOk.FirstOrDefault(o => o.RequesterId == t.RequesterId) ?? closedOk[0];
            db.TicketLinks.Add(new TicketLink { Id = Guid.NewGuid(), TicketId = t.Id, LinkedTicketId = before.Id, Kind = "follow_up_of", CreatedBy = t.RequesterId, CreatedAt = t.CreatedAt });
        }

        // Escalated: in progress tickets of the Cairo branch now with the main organization's leader.
        var mainLeader = s.Person["main.leader"];
        foreach (var t in made.Where(x => x.Status == TicketStatus.InProgress && x.BranchId == s.Place["cairo"].Branch).Take(3))
        {
            Msg(db, t.Id, t.AssignedAgentId, MessageKind.InternalNote, "Escalated to the organization leader: needs approval for a free meter replacement.", Mid(t, now));
            db.TicketAssignments.Add(new TicketAssignment { Id = Guid.NewGuid(), TicketId = t.Id, FromAgent = t.AssignedAgentId, ToAgent = mainLeader, FromTeam = t.TeamId, ToTeam = t.TeamId, AssignedBy = t.AssignedAgentId ?? mainLeader, Reason = "Escalated: needs approval", CreatedAt = Mid(t, now) });
            t.AssignedAgentId = mainLeader;
        }
        // Reassigned by an agent to a colleague in the same team.
        foreach (var pl in new[] { "giza", "alex" })
        {
            var a1 = s.Person[pl + ".agent1"]; var a2 = s.Person[pl + ".agent2"];
            foreach (var t in made.Where(x => x.Status == TicketStatus.InProgress && x.AssignedAgentId == a1).Take(2))
            {
                db.TicketAssignments.Add(new TicketAssignment { Id = Guid.NewGuid(), TicketId = t.Id, FromAgent = a1, ToAgent = a2, FromTeam = t.TeamId, ToTeam = t.TeamId, AssignedBy = a1, Reason = "My colleague handled this area before.", CreatedAt = Mid(t, now) });
                t.AssignedAgentId = a2;
            }
        }
        await db.SaveChangesAsync();
    }

    /// <summary>A moment between the ticket's opening and now.</summary>
    private static DateTimeOffset Mid(Ticket t, DateTimeOffset now) => t.CreatedAt + (now - t.CreatedAt) * 0.6;

    private static void Hist(CcsDbContext db, Guid ticket, string? from, string to, Guid? by, DateTimeOffset at, string? reason = null, string? closure = null) =>
        db.TicketStatusHistory.Add(new TicketStatusHistory { Id = Guid.NewGuid(), TicketId = ticket, FromStatus = from, ToStatus = to, ChangedBy = by, Reason = reason, ClosureReason = closure, CreatedAt = at });

    private static void Msg(CcsDbContext db, Guid ticket, Guid? author, string kind, string body, DateTimeOffset at) =>
        db.TicketMessages.Add(new TicketMessage { Id = Guid.NewGuid(), TicketId = ticket, AuthorId = author, Kind = kind, Body = body, CreatedAt = at });
}
