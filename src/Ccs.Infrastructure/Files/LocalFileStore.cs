using System.Diagnostics;
using Ccs.Application.Abstractions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Ccs.Infrastructure.Files;

public sealed class FileStoreOptions
{
    public const string Section = "FileStore";
    /// <summary>A folder OUTSIDE the web root, backed up with the database (spec 10), e.g. D:\CcsData\attachments.</summary>
    public string Root { get; set; } = "";
    /// <summary>Path to MpCmdRun.exe; empty disables scanning (scan_status = skipped).</summary>
    public string? DefenderPath { get; set; } = @"C:\Program Files\Windows Defender\MpCmdRun.exe";
}

/// <summary>Attachments on the server's disk. Keeps the Supabase storage_path layout so migrated rows still resolve.</summary>
public sealed class LocalFileStore(IOptions<FileStoreOptions> options) : IFileStore
{
    private string Full(string storagePath)
    {
        var root = Path.GetFullPath(options.Value.Root);
        var full = Path.GetFullPath(Path.Combine(root, storagePath.Replace('/', Path.DirectorySeparatorChar)));
        // Path traversal guard: the resolved file must stay inside the root.
        if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Invalid storage path.");
        return full;
    }

    public async Task SaveAsync(string storagePath, Stream content, CancellationToken ct = default)
    {
        var path = Full(storagePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await using var fs = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true);
        await content.CopyToAsync(fs, ct);
    }

    public Task<Stream?> OpenReadAsync(string storagePath, CancellationToken ct = default)
    {
        var path = Full(storagePath);
        return Task.FromResult<Stream?>(File.Exists(path) ? new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true) : null);
    }

    public Task DeleteAsync(string storagePath, CancellationToken ct = default)
    {
        var path = Full(storagePath);
        if (File.Exists(path)) File.Delete(path);
        return Task.CompletedTask;
    }

    public string FullPath(string storagePath) => Full(storagePath);
}

/// <summary>Virus scan with Microsoft Defender's command line (built into Windows Server). Exit code 2 = threat found.</summary>
public sealed class DefenderFileScanner(IOptions<FileStoreOptions> options, LocalFileStore store, ILogger<DefenderFileScanner> log) : IFileScanner
{
    public async Task<string> ScanAsync(string storagePath, CancellationToken ct = default)
    {
        var exe = options.Value.DefenderPath;
        if (string.IsNullOrWhiteSpace(exe) || !File.Exists(exe)) return "skipped";
        var psi = new ProcessStartInfo(exe)
        {
            ArgumentList = { "-Scan", "-ScanType", "3", "-File", store.FullPath(storagePath), "-DisableRemediation" },
            RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true,
        };
        using var p = Process.Start(psi)!;
        await p.WaitForExitAsync(ct);
        var result = p.ExitCode switch { 0 => "clean", 2 => "infected", _ => "skipped" };
        if (result == "infected")
        {
            log.LogWarning("Infected upload removed: {Path}", storagePath);
            await store.DeleteAsync(storagePath, ct);
        }
        return result;
    }
}
