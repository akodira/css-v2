using Ccs.Application.Access;
using Ccs.Application.Common;
using Ccs.Domain;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>
/// Port of creatable_directory(): active customers the caller may open a ticket for (permission create_for_customer),
/// limited to the caller's scope, with organization and branch for the pickers on "New ticket for a customer".
/// </summary>
[ApiController]
[Authorize]
[Route("api/tickets/customers")]
public sealed class CreatableCustomersController(CcsDbContext db, AccessService access) : ControllerBase
{
    [HttpGet]
    public async Task<object> List(CancellationToken ct)
    {
        var c = await access.RequireSignedInAsync(ct);
        if (!c.Staff || !c.Has(Permission.CreateForCustomer)) throw new ForbiddenException();
        var rows = await (from p in db.Profiles.AsNoTracking()
                          join ur in db.CcsUserRoles on p.Id equals ur.UserId
                          join r in db.CcsRoles on ur.RoleId equals r.Id
                          join o in db.Organizations on p.OrganizationId equals (Guid?)o.Id into oj
                          from o in oj.DefaultIfEmpty()
                          join b in db.Branches on p.BranchId equals (Guid?)b.Id into bj
                          from b in bj.DefaultIfEmpty()
                          where r.Code == RoleCode.Customer && p.AccountStatus == AccountStatus.Active
                          select new
                          {
                              p.Id, p.FullName, p.Email, p.OrganizationId, OrganizationName = o == null ? null : o.Name,
                              p.BranchId, BranchName = b == null ? null : b.Name,
                          }).ToListAsync(ct);
        return rows.Where(x => c.Admin || AccessRules.InScope(c, x.OrganizationId, x.BranchId))
            .OrderBy(x => x.OrganizationName == null).ThenBy(x => x.OrganizationName).ThenBy(x => x.BranchName == null).ThenBy(x => x.BranchName).ThenBy(x => x.FullName)
            .Take(5000).ToList();
    }
}
