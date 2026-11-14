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
    /// <summary>A scan that takes longer is stopped and the file refused.</summary>
    public int ScanTimeoutSeconds { get; set; } = 120;
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
        if (string.IsNullOrWhiteSpace(exe)) return "skipped";   // scanning switched off on purpose (development)
        // Security audit M-05: from here on the scanner is expected to work, so any problem refuses the file ("failed").
        if (!File.Exists(exe))
        {
            log.LogError("Virus scanner not found at {Path}: uploads are refused until it is installed or FileStore:DefenderPath is fixed", exe);
            return "failed";
        }
        var psi = new ProcessStartInfo(exe)
        {
            ArgumentList = { "-Scan", "-ScanType", "3", "-File", store.FullPath(storagePath), "-DisableRemediation" },
            RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true,
        };
        using var p = Process.Start(psi);
        if (p is null) { log.LogError("Virus scanner could not start"); return "failed"; }
        _ = p.StandardOutput.ReadToEndAsync(ct);   // drain the output so the scanner never blocks on a full pipe
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(options.Value.ScanTimeoutSeconds, 5, 600)));
        try { await p.WaitForExitAsync(timeout.Token); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            try { p.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            log.LogError("Virus scan timed out for {Path}", storagePath);
            return "failed";
        }
        var result = p.ExitCode switch { 0 => "clean", 2 => "infected", _ => "failed" };
        if (result == "failed") log.LogError("Virus scanner returned exit code {Code} for {Path}", p.ExitCode, storagePath);
        if (result == "infected")
        {
            log.LogWarning("Infected upload removed: {Path}", storagePath);
            await store.DeleteAsync(storagePath, ct);
        }
        return result;
    }
}
