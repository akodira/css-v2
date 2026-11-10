<#
  CCS v2 installer: double-click Install-Ccs.cmd (it asks for administrator rights and opens a small window).
  Needs on the server: IIS, ASP.NET Core 10 Hosting Bundle, URL Rewrite, SQL Server. Nothing else.

  One IIS site "ccs-web": the Angular files at / and the API as the IIS application /api (own app pool).
  Run it again for every new release: it updates the files and keeps the database data and the secrets.

  Unattended use (same result, no window):
    .\Install-Ccs.ps1 -HostName ccs.example.com -CertThumbprint 3F2A...C9 -Quiet
#>
[CmdletBinding()]
param(
    [string] $HostName = 'localhost',                # site address; localhost = test on this machine
    [string] $CertThumbprint,                        # empty = make a self-signed test certificate
    [string] $SqlInstance = 'localhost',
    [string] $Database = 'CCS',
    [string] $DataRoot = 'C:\CcsData',
    [string] $SiteRoot = 'C:\inetpub\ccs',
    [int]    $Port = 443,
    [string] $AdminEmail,                            # optional: create (or reset) this administrator
    [string] $AdminPassword,
    [string] $SupabaseUrl,                           # optional: copy all data from the old system (empties the CCS tables first)
    [string] $SupabaseServiceKey,                    # optional: also copy the ticket attachments
    [switch] $RealOnly,                              # with -SupabaseUrl: skip the demo users (@demo.cts.test) and their tickets
    [switch] $Quiet                                  # no window
)
$ErrorActionPreference = 'Stop'

# IIS management works fully only in Windows PowerShell 5.1: restart there if started from PowerShell 7.
if ($PSVersionTable.PSEdition -eq 'Core') {
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath)
    foreach ($k in $PSBoundParameters.Keys) { $v = $PSBoundParameters[$k]; if ($v -is [switch]) { if ($v) { $a += "-$k" } } else { $a += "-$k", "$v" } }
    & "$env:windir\System32\WindowsPowerShell\v1.0\powershell.exe" @a; exit $LASTEXITCODE
}

$Package = $PSScriptRoot
Get-ChildItem $Package -Recurse -File | Unblock-File -ErrorAction SilentlyContinue   # files from a downloaded zip

#---------------------------------------------------------------- window
if (-not $Quiet) {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $f = New-Object Windows.Forms.Form -Property @{ Text = 'Install CCS v2'; Width = 520; Height = 500; StartPosition = 'CenterScreen'; FormBorderStyle = 'FixedDialog'; MaximizeBox = $false; Font = New-Object Drawing.Font('Segoe UI', 10) }
    $script:y = 20
    function Row($label, $value) {
        $l = New-Object Windows.Forms.Label -Property @{ Text = $label; Left = 20; Top = $script:y + 3; Width = 170 }
        $t = New-Object Windows.Forms.TextBox -Property @{ Text = $value; Left = 195; Top = $script:y; Width = 290 }
        $f.Controls.AddRange(@($l, $t)); $script:y += 38; return $t
    }
    $tHost = Row 'Site address' $HostName
    $tSql  = Row 'SQL Server' $SqlInstance
    $tDb   = Row 'Database name' $Database
    $tPort = Row 'HTTPS port' $Port
    $tAdmin = Row 'Admin email (optional)' $AdminEmail
    $tPass = Row 'Admin password' ''
    $tPass.UseSystemPasswordChar = $true
    $tPg = Row 'Supabase DB URL (import)' $SupabaseUrl
    $tPg.UseSystemPasswordChar = $true
    $tKey = Row 'Supabase service key (files)' $SupabaseServiceKey
    $tKey.UseSystemPasswordChar = $true
    $l = New-Object Windows.Forms.Label -Property @{ Text = 'Certificate'; Left = 20; Top = $script:y + 3; Width = 170 }
    $cCert = New-Object Windows.Forms.ComboBox -Property @{ Left = 195; Top = $script:y; Width = 290; DropDownStyle = 'DropDownList' }
    [void]$cCert.Items.Add('Create a test certificate (testing only)')
    $certs = @(Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date) -and $_.FriendlyName -notlike 'CCS test*' })
    foreach ($c in $certs) { [void]$cCert.Items.Add("$($c.GetNameInfo('SimpleName', $false))  (until $($c.NotAfter.ToString('yyyy-MM-dd')))") }
    $cCert.SelectedIndex = 0
    $f.Controls.AddRange(@($l, $cCert)); $script:y += 48
    $b = New-Object Windows.Forms.Button -Property @{ Text = 'Install'; Left = 385; Top = $script:y; Width = 100; Height = 32; DialogResult = 'OK' }
    $f.AcceptButton = $b; $f.Controls.Add($b)
    if ($f.ShowDialog() -ne 'OK') { exit 1 }
    $HostName = $tHost.Text.Trim(); $SqlInstance = $tSql.Text.Trim(); $Database = $tDb.Text.Trim(); $Port = [int]$tPort.Text.Trim()
    $AdminEmail = $tAdmin.Text.Trim(); $AdminPassword = $tPass.Text
    $SupabaseUrl = $tPg.Text.Trim(); $SupabaseServiceKey = $tKey.Text.Trim()
    if ($cCert.SelectedIndex -gt 0) { $CertThumbprint = $certs[$cCert.SelectedIndex - 1].Thumbprint }
}

function Step($t) { Write-Host "`n=== $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "    $t" -ForegroundColor Green }
function Fail($t) {
    Write-Host "`nFAILED: $t" -ForegroundColor Red
    if (-not $Quiet) { [Windows.Forms.MessageBox]::Show("Installation failed:`n`n$t", 'CCS v2', 'OK', 'Error') | Out-Null }
    exit 1
}

try {
#---------------------------------------------------------------- 1 prerequisites
$Base = if ($Port -eq 443) { "https://$HostName" } else { "https://${HostName}:$Port" }
Step '1/6 Checking the server'
$need = [ordered]@{
    'IIS'                         = "$env:windir\system32\inetsrv\w3wp.exe"
    'ASP.NET Core Hosting Bundle' = "$env:ProgramFiles\IIS\Asp.Net Core Module\V2\aspnetcorev2.dll"
    'IIS URL Rewrite'             = "$env:windir\system32\inetsrv\rewrite.dll"
}
$missing = @($need.Keys | Where-Object { -not (Test-Path $need[$_]) })
if ($missing) { Fail "Install first: $($missing -join ', ')" }
$sqlcmd = (Get-Command sqlcmd -ErrorAction SilentlyContinue).Source
if (-not $sqlcmd) { Fail 'sqlcmd not found. Install SQL Server Command Line Utilities (comes with SSMS).' }
foreach ($x in 'ccs-api\Ccs.Api.dll', 'ccs-web\index.html', 'database\01_schema.sql') { if (-not (Test-Path "$Package\$x")) { Fail "Run this from the unzipped release folder ($x missing)." } }
Import-Module WebAdministration
Ok 'IIS, Hosting Bundle, URL Rewrite, sqlcmd found'

#---------------------------------------------------------------- 2 database
Step '2/6 Database'
$help = & $sqlcmd '-?' 2>&1 | Out-String
function Sql([string]$file, [string]$db = 'master', [string]$q) {
    $sa = @('-S', $SqlInstance, '-E', '-b', '-I', '-d', $db)
    if ($help -match '\[-C\]|\s-C\s') { $sa += '-C' }
    if ($file) { $sa += '-i', $file } else { $sa += '-h', '-1', '-W', '-Q', "SET NOCOUNT ON; $q" }
    $o = & $sqlcmd @sa 2>&1
    if ($LASTEXITCODE -ne 0) { Fail "SQL error ($file$q):`n$($o | Out-String)" }
    ($o | Out-String).Trim()
}
if ((Sql -q "SELECT COUNT(*) FROM sys.databases WHERE name = N'$Database'") -eq '0') {
    Sql -q "CREATE DATABASE [$Database] COLLATE Latin1_General_100_CI_AS_SC; ALTER DATABASE [$Database] SET READ_COMMITTED_SNAPSHOT ON;" | Out-Null
    Ok "database $Database created"
}
if ((Sql -db $Database -q "SELECT COUNT(*) FROM sys.tables WHERE name = 'tickets' AND schema_id = SCHEMA_ID('ccs')") -eq '0') {
    Sql -db $Database -file "$Package\database\01_schema.sql" | Out-Null; Ok 'tables created'
}
Sql -db $Database -file "$Package\database\02_seed.sql" | Out-Null; Ok 'reference data'
if ((Sql -q "SELECT CONVERT(int, SERVERPROPERTY('IsFullTextInstalled'))") -eq '1') { Sql -db $Database -file "$Package\database\03_fulltext.sql" | Out-Null; Ok 'knowledge base search' }
else { Write-Warning 'Full-Text Search is not installed in SQL Server: knowledge base search stays off until you add it and run the installer again.' }

#---------------------------------------------------------------- 3 app pools and settings
Step '3/6 App pools and settings'
foreach ($pool in 'CcsWeb', 'CcsApi') {
    if (-not (Test-Path "IIS:\AppPools\$pool")) { New-WebAppPool $pool | Out-Null }
    Set-ItemProperty "IIS:\AppPools\$pool" managedRuntimeVersion ''
    if ((Get-WebAppPoolState $pool).Value -eq 'Started') { Stop-WebAppPool $pool }
}
$p = 'IIS:\AppPools\CcsApi'
Set-ItemProperty $p startMode AlwaysRunning                                  # background jobs run every minute
Set-ItemProperty $p processModel.idleTimeout ([TimeSpan]::Zero)
Set-ItemProperty $p recycling.periodicRestart.time ([TimeSpan]::Zero)
$apphost = 'MACHINE/WEBROOT/APPHOST'
$ef = "system.applicationHost/applicationPools/add[@name='CcsApi']/environmentVariables"
function Var($n) { (Get-WebConfiguration -PSPath $apphost -Filter "$ef/add[@name='$n']").value }
function SetVar($n, $v) {
    if ($null -ne (Var $n)) { Remove-WebConfigurationProperty -PSPath $apphost -Filter $ef -Name '.' -AtElement @{ name = $n } }
    Add-WebConfigurationProperty -PSPath $apphost -Filter $ef -Name '.' -Value @{ name = $n; value = $v }
}
$server = if ($SqlInstance -in '.', '(local)') { 'localhost' } else { $SqlInstance }
SetVar 'ConnectionStrings__Ccs' "Server=$server;Database=$Database;Integrated Security=True;Encrypt=True;TrustServerCertificate=True;Application Name=ccs-api"
if (-not (Var 'Jwt__SigningKey')) { $k = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($k); SetVar 'Jwt__SigningKey' ([Convert]::ToBase64String($k)) }
SetVar 'App__PublicUrl' $Base
SetVar 'FileStore__Root' "$DataRoot\attachments"
SetVar 'DataProtection__KeysFolder' "$DataRoot\keys"
SetVar 'Serilog__WriteTo__0__Args__path' "$DataRoot\logs\api-.log"
foreach ($n in 'ConnectionStrings__Ccs', 'Jwt__SigningKey', 'App__PublicUrl') { if (-not (Var $n)) { Fail "App pool setting $n was not saved." } }
Ok 'settings stored on the CcsApi app pool (not in files)'

# Database login for the API's app pool: Windows login, no password
$loginSql = (Get-Content "$Package\database\04_logins.sql" -Raw).Replace('USE CCS;', "USE [$Database];")
$tmp = Join-Path $env:TEMP 'ccs-logins.sql'; Set-Content $tmp $loginSql -Encoding UTF8
Sql -file $tmp | Out-Null; Ok 'SQL login IIS APPPOOL\CcsApi'

#---------------------------------------------------------------- 4 files
Step '4/6 Files'
foreach ($d in "$DataRoot\attachments", "$DataRoot\keys", "$DataRoot\logs", "$SiteRoot\web", "$SiteRoot\api") { New-Item $d -ItemType Directory -Force | Out-Null }
robocopy "$Package\ccs-web" "$SiteRoot\web" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null; if ($LASTEXITCODE -ge 8) { Fail 'copying web files failed' }
robocopy "$Package\ccs-api" "$SiteRoot\api" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null; if ($LASTEXITCODE -ge 8) { Fail 'copying API files failed' }
icacls $DataRoot /grant 'IIS AppPool\CcsApi:(OI)(CI)M' /T /Q | Out-Null
icacls "$SiteRoot\api" /grant 'IIS AppPool\CcsApi:(OI)(CI)RX' /T /Q | Out-Null
icacls "$SiteRoot\web" /grant 'IIS AppPool\CcsWeb:(OI)(CI)RX' /T /Q | Out-Null
$global:LASTEXITCODE = 0
Ok "$SiteRoot\web and $SiteRoot\api"

#---------------------------------------------------------------- 5 site
Step '5/6 IIS site'
if (-not $CertThumbprint) {
    $c = Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.FriendlyName -eq "CCS test $HostName" -and $_.NotAfter -gt (Get-Date).AddDays(30) } | Select-Object -First 1
    if (-not $c) {
        $c = New-SelfSignedCertificate -DnsName $HostName -CertStoreLocation Cert:\LocalMachine\My -NotAfter (Get-Date).AddYears(2) -FriendlyName "CCS test $HostName"
        $r = New-Object Security.Cryptography.X509Certificates.X509Store Root, LocalMachine; $r.Open('ReadWrite'); $r.Add($c); $r.Close()
    }
    $CertThumbprint = $c.Thumbprint; Ok "test certificate for $HostName (trusted on this machine only)"
}
# Is the port free? Another IIS site on the same port without a host name, or another program, blocks the start.
$otherSites = @(Get-Website | Where-Object { $_.Name -ne 'ccs-web' -and $_.State -eq 'Started' } | Where-Object {
    $_.Bindings.Collection | Where-Object { $_.protocol -eq 'https' -and $_.bindingInformation -match ":$Port`:" -and ($_.bindingInformation -split ':')[-1] -in '', $HostName } })
if ($otherSites) { Fail "Port $Port is already used by the IIS site '$($otherSites[0].Name)'. Stop that site in IIS Manager, or run the installer again and choose another HTTPS port (for example 8443)." }
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -ne 4 } | Select-Object -First 1
if ($listener) {
    $proc = (Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    Fail "Port $Port is already used by the program '$proc' (process id $($listener.OwningProcess)). Close it, or run the installer again and choose another HTTPS port (for example 8443)."
}
# A test name such as "ccs" must resolve to this machine
$resolves = $true; try { [void][Net.Dns]::GetHostAddresses($HostName) } catch { $resolves = $false }
if (-not $resolves) {
    Add-Content "$env:windir\System32\drivers\etc\hosts" "`r`n127.0.0.1`t$HostName`t# added by CCS installer"
    Ok "$HostName added to the hosts file (points to this machine)"
}
if (-not (Test-Path 'IIS:\Sites\ccs-web')) {
    New-Website -Name ccs-web -PhysicalPath "$SiteRoot\web" -ApplicationPool CcsWeb -HostHeader $HostName -Port $Port -Ssl -SslFlags 1 | Out-Null
} else {
    # keep the existing site, but move it to the chosen name and port
    Get-WebBinding -Name ccs-web -Protocol https | Remove-WebBinding
    New-WebBinding -Name ccs-web -Protocol https -Port $Port -HostHeader $HostName -SslFlags 1
}
$bind = Get-WebBinding -Name ccs-web -Protocol https
try { $bind.RemoveSslCertificate() } catch { }
$bind.AddSslCertificate($CertThumbprint, 'My')
if (-not (Get-WebApplication -Site ccs-web -Name api)) { New-WebApplication -Site ccs-web -Name api -PhysicalPath "$SiteRoot\api" -ApplicationPool CcsApi | Out-Null }
Set-ItemProperty 'IIS:\Sites\ccs-web\api' preloadEnabled $true
Ok "$Base  (API at $Base/api)"

#---------------------------------------------------------------- 6 start and check
Step '6/6 Starting and checking'
Start-WebAppPool CcsWeb; Start-WebAppPool CcsApi
try { Start-Website ccs-web } catch { Fail "IIS could not start the site on port $Port ($($_.Exception.Message)). Another program may hold the port: run the installer again with another HTTPS port, for example 8443." }
$okHealth = $false
for ($i = 0; $i -lt 45 -and -not $okHealth; $i++) {
    try { $okHealth = (Invoke-WebRequest "$Base/api/health" -UseBasicParsing -TimeoutSec 10).Content -match 'Healthy' } catch { Start-Sleep 2 }
}
if (-not $okHealth) {
    $log = Get-ChildItem "$DataRoot\logs\api-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
    $tail = if ($log) { (Get-Content $log.FullName -Tail 15) -join "`n" } else { 'See Windows Event Viewer, Application log.' }
    Fail "The site was installed but $Base/api/health is not healthy.`n$tail"
}
Ok 'healthy'

if ($SupabaseUrl) {
    Step 'Copying all data from Supabase'
    $env:ConnectionStrings__Ccs = (Var 'ConnectionStrings__Ccs')
    $env:FileStore__Root = "$DataRoot\attachments"
    $imp = @('import-supabase', $SupabaseUrl)
    if ($RealOnly) { $imp += '--real-only' }
    if ($SupabaseServiceKey) { $imp += '--service-key', $SupabaseServiceKey }
    & dotnet "$SiteRoot\api\Ccs.Api.dll" @imp 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) { Fail 'The import did not finish cleanly. The lines above name the table; nothing else was changed in IIS.' }
    icacls "$DataRoot\attachments" /grant 'IIS AppPool\CcsApi:(OI)(CI)M' /T /Q | Out-Null
    Restart-WebAppPool CcsApi
    Ok 'all users, tickets and settings copied; users keep their passwords'
}

if ($AdminEmail -and $AdminPassword) {
    Step 'Administrator account'
    # Same settings as the API's app pool; this window's Windows account must be allowed into SQL Server.
    $env:ConnectionStrings__Ccs = (Var 'ConnectionStrings__Ccs')
    $env:Jwt__SigningKey = (Var 'Jwt__SigningKey')
    $env:DataProtection__KeysFolder = "$DataRoot\keys"
    $out = & dotnet "$SiteRoot\api\Ccs.Api.dll" create-admin $AdminEmail $AdminPassword 2>&1
    if ($LASTEXITCODE -ne 0) { Fail "Could not create the administrator:`n$($out | Out-String)" }
    Ok "administrator $AdminEmail can sign in"
}
Write-Host "`nDone: $Base/en" -ForegroundColor Green
if (-not $Quiet) {
    [Windows.Forms.MessageBox]::Show("CCS v2 is installed and healthy.`n`nOpen $Base/en", 'CCS v2', 'OK', 'Information') | Out-Null
    Start-Process "$Base/en"
}
} catch { Fail $_.Exception.Message }
