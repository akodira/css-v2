using Ccs.Application.Settings;
using Ccs.Domain.Rules;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>
/// Settings → Reassign tickets: whether agents may hand over the tickets assigned to them, and to whom.
/// One default for everyone, and an own rule for any organization or branch (null = use the level above).
/// </summary>
public sealed partial class SettingsController
{
    public sealed record ReassignRuleBody(bool On, string[]? To, string? Reason, bool Once);
    /// <summary>Default = true saves the default; otherwise the ticked places. Rule null removes their own rule (not for the default).</summary>
    public sealed record ReassignSaveBody(bool Default, Guid[]? OrganizationIds, Guid[]? BranchIds, ReassignRuleBody? Rule);

    private static object? View(ReassignRule? r) => r is null ? null : new { on = r.On, to = r.To, reason = r.ReasonRequired ? "req" : "opt", once = r.Once };

    [HttpGet("reassign")]
    public async Task<object> Reassign(CancellationToken ct)
    {
        await Need(ct);
        var def = await db.AppSettings.AsNoTracking().Where(s => s.Key == SettingsService.ReassignDefaultKey).Select(s => s.Value).FirstOrDefaultAsync(ct);
        var orgs = await db.Organizations.AsNoTracking().OrderBy(o => o.Name).Select(o => new { o.Id, o.Name, o.ParentId, o.IsActive, o.ReassignRule }).ToListAsync(ct);
        var branches = await db.Branches.AsNoTracking().OrderBy(b => b.Name).Select(b => new { b.Id, b.OrganizationId, b.Name, b.IsActive, b.ReassignRule }).ToListAsync(ct);
        return new
        {
            @default = View(ReassignRule.Parse(def) ?? ReassignRule.Off),
            orgs = orgs.Select(o => new { o.Id, o.Name, o.ParentId, o.IsActive, rule = View(ReassignRule.Parse(o.ReassignRule)) }),
            branches = branches.Select(b => new { b.Id, b.OrganizationId, b.Name, b.IsActive, rule = View(ReassignRule.Parse(b.ReassignRule)) }),
        };
    }

    [HttpPut("reassign")]
    public async Task<IActionResult> SaveReassign(ReassignSaveBody b, CancellationToken ct)
    {
        await Need(ct);
        string? json = null;
        if (b.Rule is { } r)
        {
            if (ReassignRule.Problem(r.On, r.To) is string field) throw Err("reassignTargets", field);
            json = new ReassignRule(r.On, r.To ?? [], r.Reason != "opt", r.Once).ToJson();
        }
        if (b.Default)
        {
            if (json is null) throw Err("required", "rule");
            var before = await db.AppSettings.AsNoTracking().Where(s => s.Key == SettingsService.ReassignDefaultKey).Select(s => s.Value).FirstOrDefaultAsync(ct);
            var row = await db.AppSettings.FirstOrDefaultAsync(s => s.Key == SettingsService.ReassignDefaultKey, ct);
            if (row is null) db.AppSettings.Add(new() { Key = SettingsService.ReassignDefaultKey, Value = json });
            else row.Value = json;
            audit.Write("reassign.update", "setting", null, new { rule = before }, new { scope = "default", rule = json });
            await db.SaveChangesAsync(ct);
            return NoContent();
        }

        var orgIds = b.OrganizationIds ?? []; var branchIds = b.BranchIds ?? [];
        if (orgIds.Length == 0 && branchIds.Length == 0) throw Err("required", "organizationIds");
        var now = clock.UtcNow;
        if (orgIds.Length > 0)
            await db.Organizations.Where(o => orgIds.Contains(o.Id)).ExecuteUpdateAsync(s => s.SetProperty(o => o.ReassignRule, json).SetProperty(o => o.UpdatedAt, now), ct);
        if (branchIds.Length > 0)
            await db.Branches.Where(x => branchIds.Contains(x.Id)).ExecuteUpdateAsync(s => s.SetProperty(x => x.ReassignRule, json).SetProperty(x => x.UpdatedAt, now), ct);
        audit.Write("reassign.update", "organization", null, null, new { scope = "places", rule = json, orgIds, branchIds });
        await db.SaveChangesAsync(ct);
        return NoContent();
    }
}
