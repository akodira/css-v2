<#
  Saves the CCS key certificate ("CCS Data Protection") to a password-protected file, for backups and for
  moving CCS to another server. Double-click Export-KeyCertificate.cmd (it asks for administrator rights).

  The certificate opens the encryption keys kept in the database (SMTP password, captcha secret).
  Keep the file and its password with your database backups, but NOT in the same place as the backup itself.

  Moving to a new server:
    1. Old server: run this, copy C:\CcsData\backup\ccs-key-certificate.pfx
    2. Restore the CCS database on the new SQL Server and copy C:\CcsData\attachments
    3. New server: put ccs-key-certificate.pfx in C:\CcsData (or next to Install-Ccs.cmd), run Install-Ccs.cmd
       and enter the certificate password when asked.

  Unattended: .\Export-KeyCertificate.ps1 -Password '...' -Quiet
#>
[CmdletBinding()]
param(
    [string] $Password,
    [string] $DataRoot = 'C:\CcsData',
    [string] $OutFile,
    [switch] $Quiet
)
$ErrorActionPreference = 'Stop'
if (-not $OutFile) { $OutFile = Join-Path $DataRoot 'backup\ccs-key-certificate.pfx' }

function Say($t, $c = 'Green') { Write-Host "    $t" -ForegroundColor $c }
function Fail($t) {
    Write-Host "`nFAILED: $t" -ForegroundColor Red
    if (-not $Quiet) { [Windows.Forms.MessageBox]::Show($t, 'CCS v2', 'OK', 'Error') | Out-Null }
    exit 1
}
if (-not $Quiet) { Add-Type -AssemblyName System.Windows.Forms, System.Drawing }

$certs = @(Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.Subject -eq 'CN=CCS Data Protection' -and $_.HasPrivateKey } | Sort-Object NotAfter -Descending)
if (-not $certs) { Fail 'No CCS key certificate on this server. Run Install-Ccs.cmd first (it creates one).' }

if (-not $Password -and -not $Quiet) {
    $d = New-Object Windows.Forms.Form -Property @{ Text = 'Export CCS key certificate'; Width = 460; Height = 250; StartPosition = 'CenterScreen'; FormBorderStyle = 'FixedDialog'; MaximizeBox = $false; MinimizeBox = $false; Font = New-Object Drawing.Font('Segoe UI', 10) }
    $l = New-Object Windows.Forms.Label -Property @{ Text = "Choose a password for the file (at least 8 characters).`nYou need it on the new server."; Left = 15; Top = 12; Width = 415; Height = 44 }
    $t1 = New-Object Windows.Forms.TextBox -Property @{ Left = 15; Top = 62; Width = 415; UseSystemPasswordChar = $true }
    $t2 = New-Object Windows.Forms.TextBox -Property @{ Left = 15; Top = 100; Width = 415; UseSystemPasswordChar = $true }
    $b = New-Object Windows.Forms.Button -Property @{ Text = 'Export'; Left = 330; Top = 145; Width = 100; Height = 32; DialogResult = 'OK' }
    $d.Controls.AddRange(@($l, $t1, $t2, $b)); $d.AcceptButton = $b
    if ($d.ShowDialog() -ne 'OK') { exit 1 }
    if ($t1.Text -ne $t2.Text) { Fail 'The two passwords are not the same.' }
    $Password = $t1.Text
}
if (-not $Password -or $Password.Length -lt 8) { Fail 'A password of at least 8 characters is needed.' }

New-Item (Split-Path $OutFile) -ItemType Directory -Force | Out-Null
# All CCS key certificates go into one file: older ones still open older keys.
$coll = New-Object Security.Cryptography.X509Certificates.X509Certificate2Collection
foreach ($c in $certs) { [void]$coll.Add($c) }
try { $bytes = $coll.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pkcs12, $Password) }
catch { Fail "Windows refused to export the private key ($($_.Exception.Message)). The certificate was imported without -Exportable." }
[IO.File]::WriteAllBytes($OutFile, $bytes)
icacls $OutFile /inheritance:r /grant:r 'BUILTIN\Administrators:F' 'NT AUTHORITY\SYSTEM:F' /Q | Out-Null
Say "saved $OutFile ($($certs.Count) certificate(s), thumbprint $($certs[0].Thumbprint))"
Say 'Keep this file and its password with your database backups, in a different place from the backup itself.' 'Yellow'
if (-not $Quiet) { [Windows.Forms.MessageBox]::Show("Saved:`n$OutFile`n`nKeep this file and its password safe. On a new server put it in C:\CcsData and run Install-Ccs.cmd.", 'CCS v2', 'OK', 'Information') | Out-Null }
