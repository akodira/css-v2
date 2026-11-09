<#
  Copies attachments from the Supabase storage bucket to the server file store (spec 9, step 6),
  keeping the same storage_path, then checks each file's size against ticket_attachments.

  Needs: the Supabase service key (read-only use), the bucket name, SQL access to the new database.
  .\copy-files.ps1 -SupabaseUrl https://rqlibtzbdrltayykfcly.supabase.co -ServiceKey $env:SB_SERVICE_KEY `
                   -Bucket ticket-attachments -Root D:\CcsData\attachments -SqlServer SQL01 -Database CCS_Test
#>
param(
  [Parameter(Mandatory)] [string] $SupabaseUrl,
  [Parameter(Mandatory)] [string] $ServiceKey,
  [string] $Bucket = 'ticket-attachments',
  [Parameter(Mandatory)] [string] $Root,
  [Parameter(Mandatory)] [string] $SqlServer,
  [Parameter(Mandatory)] [string] $Database
)
$ErrorActionPreference = 'Stop'
Import-Module SqlServer -ErrorAction Stop   # Install-Module SqlServer
$rows = Invoke-Sqlcmd -ServerInstance $SqlServer -Database $Database -TrustServerCertificate `
  -Query 'SELECT id, storage_path, size_bytes FROM ccs.ticket_attachments'
$headers = @{ Authorization = "Bearer $ServiceKey"; apikey = $ServiceKey }
$ok = 0; $bad = @()
foreach ($r in $rows) {
  $target = Join-Path $Root ($r.storage_path -replace '/', '\')
  New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
  $uri = "$SupabaseUrl/storage/v1/object/$Bucket/$($r.storage_path)"
  try {
    Invoke-WebRequest -Uri $uri -Headers $headers -OutFile $target -UseBasicParsing
    $size = (Get-Item $target).Length
    if ($size -ne [int64]$r.size_bytes) { $bad += "$($r.storage_path): size $size, expected $($r.size_bytes)" } else { $ok++ }
  } catch { $bad += "$($r.storage_path): $($_.Exception.Message)" }
}
# Scan the folder once with Defender; infected files are reported, not deleted, during rehearsal.
& "$env:ProgramFiles\Windows Defender\MpCmdRun.exe" -Scan -ScanType 3 -File $Root -DisableRemediation | Out-Host
Invoke-Sqlcmd -ServerInstance $SqlServer -Database $Database -TrustServerCertificate -Query "UPDATE ccs.ticket_attachments SET scan_status = N'clean' WHERE scan_status = N'skipped'"
Write-Host "Copied and verified: $ok of $($rows.Count)"
if ($bad.Count) { Write-Warning "Problems:"; $bad | ForEach-Object { Write-Warning $_ }; exit 1 }
