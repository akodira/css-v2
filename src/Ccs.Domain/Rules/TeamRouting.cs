namespace Ccs.Domain.Rules;

/// <summary>Settings → System → Ticket routing (app_settings keys routing_* / assign_method_default / staff_multi_place).</summary>
public sealed record RoutingSettings(bool UseOrganization = true, bool UseCentral = true, string Notify = "org",
    string Method = "fewest", bool MultiPlace = true)
{
    public static readonly RoutingSettings Default = new();
}

/// <summary>
/// Teams per place: a category needs a kind of team; a new ticket goes to that kind in the customer's branch, then their
/// organization (and the organizations above it), then a central team. Inside the team, the team's method picks a person.
/// </summary>
public static class TeamRouting
{
    public const string Fewest = "fewest", Turns = "turns", Shared = "shared", Leader = "leader";
    public static readonly string[] Methods = [Fewest, Turns, Shared, Leader];
    public static bool IsMethod(string? m) => m is not null && Methods.Contains(m);

    /// <summary>Where the team was found, for the ticket history.</summary>
    public const string AtBranch = "branch", AtOrganization = "organization", AtCentral = "central";

    public sealed record TeamAt(Guid Id, Guid? OrganizationId, Guid? BranchId);

    /// <param name="teams">Active teams of the needed kind.</param>
    /// <param name="orgChain">The customer's organization, then the organizations above it (nearest first).</param>
    public static (Guid TeamId, string Step)? Pick(IReadOnlyCollection<TeamAt> teams, IReadOnlyList<Guid> orgChain, Guid? branchId,
        RoutingSettings s, bool kindCentral)
    {
        if (branchId is Guid b && teams.FirstOrDefault(t => t.BranchId == b) is { } atBranch) return (atBranch.Id, AtBranch);
        // The customer's own organization always counts when they have no branch; with a branch, only when allowed.
        var orgs = branchId is null ? orgChain.Take(1).Concat(s.UseOrganization ? orgChain.Skip(1) : []) : s.UseOrganization ? orgChain : [];
        foreach (var o in orgs)
            if (teams.FirstOrDefault(t => t.OrganizationId == o && t.BranchId == null) is { } atOrg) return (atOrg.Id, AtOrganization);
        if (s.UseCentral && kindCentral && teams.FirstOrDefault(t => t.OrganizationId == null && t.BranchId == null) is { } central)
            return (central.Id, AtCentral);
        return null;
    }

    /// <summary>Take turns: the person after the last one (in a stable order); the first when the last is unknown.</summary>
    public static Guid NextInLine(IReadOnlyList<Guid> ordered, Guid? last)
    {
        if (ordered.Count == 0) throw new ArgumentException("nobody to pick", nameof(ordered));
        var i = last is Guid l ? ordered.ToList().IndexOf(l) : -1;
        return ordered[(i + 1) % ordered.Count];
    }

    /// <summary>The fewest open tickets; a tie is broken by the given random pick.</summary>
    public static Guid PickFewest(IReadOnlyList<(Guid UserId, int Load)> pool, Func<int, int> random)
    {
        var min = pool.Min(x => x.Load);
        var tied = pool.Where(x => x.Load == min).ToList();
        return tied[random(tied.Count)].UserId;
    }
}
