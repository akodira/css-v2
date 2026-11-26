using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api;

/// <summary>
/// Makes sure every default account type exists (see <see cref="DefaultAccountTypes"/>). Runs at start-up and before the demo seed.
/// A type that already has the same English name and the same kind is adopted as the default: it keeps its people and permissions.
/// A different type holding the default's name is renamed "... (old)" so the default can be made.
/// </summary>
public static class DefaultTypesStartup
{
    public static async Task RunAsync(IServiceProvider services, ILogger log)
    {
        try
        {
            await using var scope = services.CreateAsyncScope();
            await EnsureAsync(scope.ServiceProvider.GetRequiredService<CcsDbContext>(), log);
        }
        catch (Exception e) { log.LogError(e, "Default account types could not be checked."); }
    }

    public static async Task EnsureAsync(CcsDbContext db, ILogger? log = null)
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var def in DefaultAccountTypes.All)
        {
            if (await db.AccountTypes.AnyAsync(t => t.DefaultKey == def.Key)) continue;
            var candidates = await db.AccountTypes.Where(t => t.DefaultKey == null && (t.NameEn == def.NameEn || t.NameAr == def.NameAr)).ToListAsync();
            AccountType? adopt = null;
            if (def.Key == DefaultAccountTypes.Administrator)
                adopt = await db.AccountTypes.FirstOrDefaultAsync(t => t.IsBuiltin && t.DefaultKey == null);
            else
                foreach (var c in candidates.Where(c => !c.IsBuiltin && c.NameEn.Trim().Equals(def.NameEn, StringComparison.OrdinalIgnoreCase)))
                {
                    var perms = await db.AccountTypePermissions.Where(p => p.AccountTypeId == c.Id).Select(p => p.Permission).ToListAsync();
                    if (AccountKinds.Of(false, c.ScopeLevel, perms) == def.Kind) { adopt = c; break; }
                }

            // Whatever else holds the default's names steps aside.
            foreach (var c in candidates.Where(c => c != adopt && !c.IsBuiltin))
            {
                if (c.NameEn.Trim().Equals(def.NameEn, StringComparison.OrdinalIgnoreCase)) c.NameEn = await FreeNameAsync(db, c.NameEn, true);
                if (c.NameAr.Trim() == def.NameAr) c.NameAr = await FreeNameAsync(db, c.NameAr, false);
                c.UpdatedAt = now;
                log?.LogWarning("Account type renamed to {Name} to make room for the default type {Key}.", c.NameEn, def.Key);
            }
            await db.SaveChangesAsync();

            if (adopt is not null)
            {
                adopt.DefaultKey = def.Key; adopt.NameEn = def.NameEn; adopt.NameAr = def.NameAr; adopt.UpdatedAt = now;
                await db.SaveChangesAsync();
                continue;
            }
            var scopeLevel = AccountKinds.ScopeLevelOf(def.Kind);
            var builtin = def.Key == DefaultAccountTypes.Administrator;
            var t = new AccountType
            {
                Id = Guid.NewGuid(), NameEn = def.NameEn, NameAr = def.NameAr, DefaultKey = def.Key, IsBuiltin = builtin,
                ScopeLevel = scopeLevel, AllAccess = scopeLevel is null, CreatedAt = now, UpdatedAt = now,
            };
            db.AccountTypes.Add(t);
            await db.SaveChangesAsync();   // the type first, then its permissions
            if (!builtin)
                foreach (var p in def.Permissions) db.AccountTypePermissions.Add(new AccountTypePermission { AccountTypeId = t.Id, Permission = p });
            await db.SaveChangesAsync();
        }
    }

    private static async Task<string> FreeNameAsync(CcsDbContext db, string name, bool en)
    {
        var baseName = name.Length > 70 ? name[..70] : name;
        for (var i = 1; ; i++)
        {
            var next = i == 1 ? (en ? $"{baseName} (old)" : $"{baseName} (قديم)") : (en ? $"{baseName} (old {i})" : $"{baseName} (قديم {i})");
            if (!await db.AccountTypes.AnyAsync(t => en ? t.NameEn == next : t.NameAr == next)) return next;
        }
    }
}
