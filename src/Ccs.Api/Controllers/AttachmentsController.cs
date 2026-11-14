using System.Text.Json;
using System.Text.RegularExpressions;
using Ccs.Application.Abstractions;
using Ccs.Application.Access;
using Ccs.Application.Common;
using Ccs.Domain;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Identity;
using Ccs.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace Ccs.Api.Controllers;

/// <summary>
/// Ticket attachments, same rules as v1 (attachments_insert / attachments_read policies and lib/uploads/rules):
/// the requester or staff who may reply can add files; a file linked to an internal note is only shown to those who see notes.
/// Type and size follow Settings → Uploads. Files are stored as "{ticketId}/{fileId}-{safe name}" (the Supabase layout),
/// virus-scanned with Microsoft Defender when available, and always downloaded as attachments (never shown inline).
/// </summary>
[ApiController]
[Authorize]
[Route("api/tickets/{ticketId:guid}/attachments")]
public sealed class AttachmentsController(CcsDbContext db, AccessService access, IFileStore files, IFileScanner scanner, AuditService audit, IClock clock) : ControllerBase
{
    /// <summary>Same catalog as v1: executables and scripts are never offered.</summary>
    private static readonly Dictionary<string, string> Mime = new()
    {
        ["png"] = "image/png", ["jpg"] = "image/jpeg", ["jpeg"] = "image/jpeg", ["gif"] = "image/gif", ["webp"] = "image/webp",
        ["pdf"] = "application/pdf", ["txt"] = "text/plain", ["doc"] = "application/msword",
        ["docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ["csv"] = "text/csv", ["xls"] = "application/vnd.ms-excel", ["xlsx"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ["ppt"] = "application/vnd.ms-powerpoint", ["pptx"] = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ["zip"] = "application/zip",
    };
    private static readonly string[] DefaultExts = ["pdf", "png", "jpg", "jpeg", "docx", "xlsx", "txt"];
    private const int MaxFilesPerTicket = 100;
    private const long MaxBytesPerTicket = 500L * 1024 * 1024, MaxBytesPerUserPerDay = 500L * 1024 * 1024;
    private static AuthError Err(string code, int status = 400) => new(code, status, "file");

    private static string SafeName(string name)
    {
        var s = Regex.Replace(name, "[^A-Za-z0-9._-]+", "_");
        s = Regex.Replace(s, @"\.{2,}", ".").TrimStart('.');
        if (s.Length > 100) s = s[^100..];
        return s.Length == 0 ? "file" : s;
    }

    /// <summary>One file per request, so the page can report each failed file by name.</summary>
    [HttpPost]
    [EnableRateLimiting("uploads")]
    [RequestSizeLimit(55 * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = 55 * 1024 * 1024)]
    public async Task<object> Upload(Guid ticketId, [FromForm] IFormFile? file, [FromForm] Guid? messageId, CancellationToken ct)
    {
        var (c, facts) = await access.RequireTicketAsync(ticketId, ct);
        // Security audit L-04: seeing a ticket is not enough. Same rule as posting a reply: the requester, or staff
        // with the reply permission, or the staff member who opened it for the customer (read-only viewers and
        // organisation colleagues cannot add files).
        var mayAdd = facts.RequesterId == c.UserId || (c.Staff && (c.Has(Permission.Reply) || facts.CreatedBy == c.UserId));
        if (!mayAdd) throw new ForbiddenException();
        if (file is null || file.Length == 0) throw Err("fileMissing");
        if (messageId is Guid mid)
        {
            var m = await db.TicketMessages.AsNoTracking().FirstOrDefaultAsync(x => x.Id == mid && x.TicketId == ticketId, ct) ?? throw Err("fileMissing");
            if (m.AuthorId != c.UserId || (m.Kind == MessageKind.InternalNote && !AccessRules.CanSeeInternalNotes(c, facts))) throw new ForbiddenException();
        }

        var site = await db.SiteSettings.AsNoTracking().FirstAsync(ct);
        string[] exts;
        try { exts = JsonSerializer.Deserialize<string[]>(site.UploadExtensions ?? "[]") ?? []; } catch { exts = []; }
        exts = exts.Select(e => e.ToLowerInvariant()).Where(Mime.ContainsKey).ToArray();
        if (exts.Length == 0) exts = DefaultExts;
        var maxMb = site.UploadMaxMb is > 0 and <= 50 ? site.UploadMaxMb : 10;
        var maxFiles = site.UploadMaxFiles is > 0 and <= 20 ? site.UploadMaxFiles : 5;

        var name = Path.GetFileName(file.FileName ?? "").Trim();
        var ext = name.Contains('.') ? name[(name.LastIndexOf('.') + 1)..].ToLowerInvariant() : "";
        if (!exts.Contains(ext)) throw Err("fileType");
        if (file.Length > maxMb * 1024L * 1024L) throw Err("fileSize");
        var already = await db.TicketAttachments.CountAsync(a => a.TicketId == ticketId && a.MessageId == messageId && a.UploadedBy == c.UserId, ct);
        if (already >= maxFiles) throw Err("fileCount");

        // Security audit M-05: storage limits per ticket and per person, so one account cannot fill the disk.
        var onTicket = await db.TicketAttachments.Where(a => a.TicketId == ticketId)
            .GroupBy(_ => 1).Select(g => new { Files = g.Count(), Bytes = g.Sum(a => a.SizeBytes) }).FirstOrDefaultAsync(ct);
        if (onTicket is not null && (onTicket.Files >= MaxFilesPerTicket || onTicket.Bytes + file.Length > MaxBytesPerTicket)) throw Err("fileQuota");
        var dayAgo = clock.UtcNow.AddHours(-24);
        var mine = await db.TicketAttachments.Where(a => a.UploadedBy == c.UserId && a.CreatedAt > dayAgo).SumAsync(a => (long?)a.SizeBytes, ct) ?? 0;
        if (mine + file.Length > MaxBytesPerUserPerDay) throw Err("fileQuota");

        // Security audit M-05: the content must match the extension (a program renamed to .pdf is refused).
        var head = new byte[FileSignature.HeadLength];
        int read;
        await using (var s = file.OpenReadStream()) read = await s.ReadAtLeastAsync(head, head.Length, throwOnEndOfStream: false, ct);
        if (!FileSignature.Matches(ext, head.AsSpan(0, read))) throw Err("fileType");

        var id = Guid.NewGuid();
        var path = $"{ticketId}/{id}-{SafeName(name)}";
        await using (var s = file.OpenReadStream()) await files.SaveAsync(path, s, ct);
        var scan = await scanner.ScanAsync(path, ct);
        if (scan == "infected") throw Err("fileInfected");
        if (scan == "failed")   // M-05: the scanner is set up but did not give an answer: never offer an unscanned file to staff
        {
            await files.DeleteAsync(path, ct);
            throw Err("fileScanFailed", 503);
        }

        var row = new TicketAttachment
        {
            Id = id, TicketId = ticketId, MessageId = messageId, StoragePath = path, FileName = name.Length > 255 ? name[..255] : name,
            MimeType = Mime[ext], SizeBytes = file.Length, UploadedBy = c.UserId, ScanStatus = scan, CreatedAt = clock.UtcNow,
        };
        db.TicketAttachments.Add(row);
        audit.Write("attachment.added", "ticket", ticketId, null, new { row.Id, row.FileName, row.SizeBytes, messageId });
        try { await db.SaveChangesAsync(ct); }
        catch { await files.DeleteAsync(path, ct); throw; }   // never leave an unreachable file behind
        return new { row.Id, row.FileName, row.MimeType, row.SizeBytes, row.CreatedAt };
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Download(Guid ticketId, Guid id, CancellationToken ct)
    {
        var (c, facts) = await access.RequireTicketAsync(ticketId, ct);
        var a = await db.TicketAttachments.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.TicketId == ticketId && x.ScanStatus != "infected", ct)
            ?? throw new NotFoundException();
        if (a.MessageId is Guid mid)
        {
            var kind = await db.TicketMessages.Where(m => m.Id == mid && m.DeletedAt == null).Select(m => m.Kind).FirstOrDefaultAsync(ct) ?? throw new NotFoundException();
            if (kind == MessageKind.InternalNote && !AccessRules.CanSeeInternalNotes(c, facts)) throw new NotFoundException();
        }
        var stream = await files.OpenReadAsync(a.StoragePath, ct) ?? throw new NotFoundException();
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers["Cache-Control"] = "private, no-store";
        return File(stream, "application/octet-stream", a.FileName);
    }
}
