<#
.SYNOPSIS
  Installs or updates CCS v2 on one Windows Server: SQL Server database, IIS API site, IIS web site.

.DESCRIPTION
  Run from the unzipped release package (the folder that holds ccs-api, ccs-web and database), in an elevated
  PowerShell. Safe to run again: the first run installs, later runs update files and keep existing secrets.

  What it does, in order (the Deployment Guide explains each step):
    1. Checks prerequisites: IIS, ASP.NET Core Hosting Bundle, URL Rewrite, ARR, sqlcmd
    2. Enables the ARR proxy and the X-Forwarded-Proto server variable
    3. Creates D:\CcsData\{attachments,keys,logs} and the app pools CcsApi and CcsWeb
    4. Database: creates it on first run, runs 01_schema (first run only), 02_seed, 03_fulltext, 04_logins
    5. Copies the API and web files (app_offline.htm while the API is updated)
    6. Loopback certificate for the API, HTTPS bindings, preload, permissions
    7. App pool environment variables (keeps an existing Jwt signing key)
    8. Starts everything and checks /api/health through the public address

.EXAMPLE
  .\Install-Ccs.ps1 -HostName ccs.example.com -CertThumbprint 3F2A...C9
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $HostName,                   # public name, e.g. ccs.example.com
    [string] $CertThumbprint,                                     # public certificate in LocalMachine\My
    [switch] $SelfSignedForTest,                                  # test servers only: make a self-signed public certificate
    [string] $SqlInstance = 'localhost',
    [string] $Database = 'CCS',
    [string] $DataRoot = 'D:\CcsData',
    [string] $ApiRoot = 'C:\inetpub\ccs-api',
    [string] $WebRoot = 'C:\inetpub\ccs-web',
    [int]    $ApiPort = 8443,
    [string] $PublicUrl,                                          # default https://<HostName>
    [switch] $SkipDatabase
)

$ErrorActionPreference = 'Stop'

# The IIS module (WebAdministration, IIS: drive) works fully only in Windows PowerShell 5.1.
# Started from PowerShell 7? Run the same script again in Windows PowerShell with the same arguments.
if ($PSVersionTable.PSEdition -eq 'Core') {
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath)
    foreach ($k in $PSBoundParameters.Keys) {
        $v = $PSBoundParameters[$k]
        if ($v -is [System.Management.Automation.SwitchParameter]) { if ($v.IsPresent) { $argList += "-$k" } }
        else { $argList += "-$k"; $argList += "$v" }
    }
    & "$env:windir\System32\WindowsPowerShell\v1.0\powershell.exe" @argList
    exit $LASTEXITCODE
}
$Package = $PSScriptRoot
if (-not $PublicUrl) { $PublicUrl = "https://$HostName" }
function Step($t) { Write-Host "`n=== $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "    $t" -ForegroundColor Green }

#--------------------------------------------------------------------------------------------- 1
Step '1. Prerequisites'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this script in an elevated PowerShell.' }
foreach ($f in 'ccs-api\Ccs.Api.dll', 'ccs-web\index.html', 'database\01_schema.sql') {
    if (-not (Test-Path (Join-Path $Package $f))) { throw "Package incomplete: $f not found next to this script." }
}
$checks = [ordered]@{
    'IIS'                          = "$env:windir\system32\inetsrv\w3wp.exe"
    'ASP.NET Core Hosting Bundle'  = "$env:ProgramFiles\IIS\Asp.Net Core Module\V2\aspnetcorev2.dll"
    'IIS URL Rewrite'              = "$env:windir\system32\inetsrv\rewrite.dll"
    'Application Request Routing'  = "$env:ProgramFiles\IIS\Application Request Routing\requestRouter.dll"
}
$missing = @($checks.Keys | Where-Object { -not (Test-Path $checks[$_]) })
if ($missing) { throw "Install first (Deployment Guide, section 2): $($missing -join ', ')" }
$sqlcmd = (Get-Command sqlcmd -ErrorAction SilentlyContinue).Source
if (-not $SkipDatabase -and -not $sqlcmd) { throw 'sqlcmd not found. Install SQL Server command-line tools.' }
Import-Module WebAdministration
Ok 'all present'

#--------------------------------------------------------------------------------------------- 2
Step '2. ARR proxy'
$apphost = 'MACHINE/WEBROOT/APPHOST'
Set-WebConfigurationProperty -PSPath $apphost -Filter 'system.webServer/proxy' -Name enabled -Value $true
Set-WebConfigurationProperty -PSPath $apphost -Filter 'system.webServer/proxy' -Name preserveHostHeader -Value $true
Set-WebConfigurationProperty -PSPath $apphost -Filter 'system.webServer/proxy' -Name reverseRewriteHostInResponseHeaders -Value $false
$sv = Get-WebConfiguration -PSPath $apphost -Filter "system.webServer/rewrite/allowedServerVariables/add[@name='HTTP_X_FORWARDED_PROTO']"
if (-not $sv) { Add-WebConfigurationProperty -PSPath $apphost -Filter 'system.webServer/rewrite/allowedServerVariables' -Name '.' -Value @{ name = 'HTTP_X_FORWARDED_PROTO' } }
Ok 'proxy on, HTTP_X_FORWARDED_PROTO allowed'

#--------------------------------------------------------------------------------------------- 3
Step '3. Folders and app pools'
foreach ($d in "$DataRoot\attachments", "$DataRoot\keys", "$DataRoot\logs", $ApiRoot, $WebRoot) { New-Item $d -ItemType Directory -Force | Out-Null }
foreach ($pool in 'CcsApi', 'CcsWeb') {
    if (-not (Test-Path "IIS:\AppPools\$pool")) { New-WebAppPool -Name $pool | Out-Null }
    Set-ItemProperty "IIS:\AppPools\$pool" -Name managedRuntimeVersion -Value ''
}
$p = 'IIS:\AppPools\CcsApi'
Set-ItemProperty $p -Name startMode -Value AlwaysRunning
Set-ItemProperty $p -Name processModel.idleTimeout -Value ([TimeSpan]::Zero)
Set-ItemProperty $p -Name recycling.periodicRestart.time -Value ([TimeSpan]::Zero)
Clear-WebConfiguration -PSPath $apphost -Filter "system.applicationHost/applicationPools/add[@name='CcsApi']/recycling/periodicRestart/schedule"
Add-WebConfigurationProperty -PSPath $apphost -Filter "system.applicationHost/applicationPools/add[@name='CcsApi']/recycling/periodicRestart/schedule" -Name '.' -Value @{ value = '03:30:00' }
Ok "pools ready, data in $DataRoot"

#--------------------------------------------------------------------------------------------- 4
function Invoke-Sql([string] $file, [string] $db = 'master', [string] $query) {
    $help = & $sqlcmd '-?' 2>&1 | Out-String
    $sqlArgs = @('-S', $SqlInstance, '-E', '-b', '-I', '-d', $db)
    if ($help -match '(?m)^\s*-C\b|\[-C\]') { $sqlArgs += '-C' }     # newer sqlcmd encrypts by default
    if ($file) { $sqlArgs += @('-i', $file) } else { $sqlArgs += @('-h', '-1', '-W', '-Q', "SET NOCOUNT ON; $query") }
    $out = & $sqlcmd @sqlArgs 2>&1
    if ($LASTEXITCODE -ne 0) { throw "sqlcmd failed ($file$query):`n$($out | Out-String)" }
    return ($out | Out-String).Trim()
}
if (-not $SkipDatabase) {
    Step '4. Database'
    $exists = Invoke-Sql -query "SELECT COUNT(*) FROM sys.databases WHERE name = N'$Database'"
    if ($exists -eq '0') {
        Invoke-Sql -query "CREATE DATABASE [$Database] COLLATE Latin1_General_100_CI_AS_SC; ALTER DATABASE [$Database] SET READ_COMMITTED_SNAPSHOT ON; ALTER DATABASE [$Database] SET RECOVERY FULL;" | Out-Null
        Ok "created $Database"
    }
    $hasSchema = Invoke-Sql -db $Database -query "SELECT COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'ccs' AND t.name = 'tickets'"
    if ($hasSchema -eq '0') { Invoke-Sql -db $Database -file "$Package\database\01_schema.sql" | Out-Null; Ok '01_schema.sql' }
    else { Ok '01_schema.sql skipped (schema exists; later releases ship numbered change scripts)' }
    Invoke-Sql -db $Database -file "$Package\database\02_seed.sql" | Out-Null; Ok '02_seed.sql'
    $fts = Invoke-Sql -query "SELECT CONVERT(int, SERVERPROPERTY('IsFullTextInstalled'))"
    if ($fts -eq '1') { Invoke-Sql -db $Database -file "$Package\database\03_fulltext.sql" | Out-Null; Ok '03_fulltext.sql' }
    else { Write-Warning 'Full-Text Search is not installed on SQL Server: knowledge base search will not work until it is added and 03_fulltext.sql is run.' }
    $logins = Get-Content "$Package\database\04_logins.sql" -Raw
    if ($SqlInstance -notin 'localhost', '.', '(local)', $env:COMPUTERNAME) {
        Write-Warning "SQL Server is remote: edit 04_logins.sql for a gMSA or SQL login and run it yourself (Deployment Guide, section 3)."
    } else {
        $tmp = Join-Path $env:TEMP 'ccs-04_logins.sql'
        $logins.Replace('USE CCS;', "USE [$Database];") | Set-Content $tmp -Encoding UTF8
        Invoke-Sql -file $tmp | Out-Null; Ok '04_logins.sql (IIS APPPOOL\CcsApi)'
    }
}

#--------------------------------------------------------------------------------------------- 5
Step '5. Files'
$offline = Join-Path $ApiRoot 'app_offline.htm'
$firstApi = -not (Test-Path (Join-Path $ApiRoot 'Ccs.Api.dll'))
if (-not $firstApi) { Set-Content $offline 'Updating, back in a minute.'; Start-Sleep 5 }
robocopy "$Package\ccs-api" $ApiRoot /MIR /XF app_offline.htm /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy ccs-api failed ($LASTEXITCODE)" }
robocopy "$Package\ccs-web" $WebRoot /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy ccs-web failed ($LASTEXITCODE)" }
if ($ApiPort -ne 8443) {
    $wc = Join-Path $WebRoot 'web.config'
    (Get-Content $wc -Raw).Replace('https://localhost:8443/', "https://localhost:$ApiPort/") | Set-Content $wc -Encoding UTF8
}
& icacls $DataRoot /grant 'IIS AppPool\CcsApi:(OI)(CI)M' /T /Q | Out-Null
& icacls $ApiRoot /grant 'IIS AppPool\CcsApi:(OI)(CI)RX' /T /Q | Out-Null
& icacls $WebRoot /grant 'IIS AppPool\CcsWeb:(OI)(CI)RX' /T /Q | Out-Null
$global:LASTEXITCODE = 0
Ok "API -> $ApiRoot, web -> $WebRoot"

#--------------------------------------------------------------------------------------------- 6
Step '6. Certificates and sites'
function Add-ToRoot($cert) {
    $root = New-Object System.Security.Cryptography.X509Certificates.X509Store Root, LocalMachine
    $root.Open('ReadWrite'); $root.Add($cert); $root.Close()
}
$loop = Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.FriendlyName -eq 'CCS API loopback' -and $_.NotAfter -gt (Get-Date).AddDays(30) } | Select-Object -First 1
if (-not $loop) {
    $loop = New-SelfSignedCertificate -DnsName localhost -CertStoreLocation Cert:\LocalMachine\My -NotAfter (Get-Date).AddYears(5) -FriendlyName 'CCS API loopback'
    Add-ToRoot $loop
}
if ($SelfSignedForTest -and -not $CertThumbprint) {
    $pub = New-SelfSignedCertificate -DnsName $HostName -CertStoreLocation Cert:\LocalMachine\My -NotAfter (Get-Date).AddYears(1) -FriendlyName "CCS TEST $HostName"
    Add-ToRoot $pub
    $CertThumbprint = $pub.Thumbprint
}
if (-not $CertThumbprint) { throw 'Pass -CertThumbprint of the public certificate (LocalMachine\My), or -SelfSignedForTest on a test server.' }
if (-not (Test-Path "Cert:\LocalMachine\My\$CertThumbprint")) { throw "Certificate $CertThumbprint not found in LocalMachine\My." }

if (-not (Test-Path 'IIS:\Sites\ccs-api')) {
    New-Website -Name ccs-api -PhysicalPath $ApiRoot -ApplicationPool CcsApi -IPAddress 127.0.0.1 -Port $ApiPort -Ssl | Out-Null
}
function Set-BindingCert($binding, $thumb) {
    try { $binding.RemoveSslCertificate() } catch { }                # re-run: replace the certificate
    $binding.AddSslCertificate($thumb, 'My')
}
Set-BindingCert (Get-WebBinding -Name ccs-api -Protocol https) $loop.Thumbprint
Set-ItemProperty IIS:\Sites\ccs-api -Name applicationDefaults.preloadEnabled -Value $true

if (Get-Website -Name 'Default Web Site' -ErrorAction SilentlyContinue) {
    $def = Get-WebBinding -Name 'Default Web Site' | Where-Object { $_.bindingInformation -like '*:443:*' -or $_.bindingInformation -like '*:80:' }
    if ($def) { Stop-Website 'Default Web Site' }
}
if (-not (Test-Path 'IIS:\Sites\ccs-web')) {
    New-Website -Name ccs-web -PhysicalPath $WebRoot -ApplicationPool CcsWeb -HostHeader $HostName -Port 443 -Ssl -SslFlags 1 | Out-Null
}
Set-BindingCert (Get-WebBinding -Name ccs-web -Protocol https -HostHeader $HostName) $CertThumbprint
Ok "ccs-api on https://localhost:$ApiPort, ccs-web on https://$HostName"

#--------------------------------------------------------------------------------------------- 7
Step '7. Settings and secrets (app pool environment variables)'
$envFilter = "system.applicationHost/applicationPools/add[@name='CcsApi']/environmentVariables"
function Get-PoolVar($name) {
    (Get-WebConfiguration -PSPath $apphost -Filter "$envFilter/add[@name='$name']" -ErrorAction SilentlyContinue).value
}
function Set-PoolVar($name, $value) {
    if ($null -ne (Get-PoolVar $name)) { Remove-WebConfigurationProperty -PSPath $apphost -Filter $envFilter -Name '.' -AtElement @{ name = $name } }
    Add-WebConfigurationProperty -PSPath $apphost -Filter $envFilter -Name '.' -Value @{ name = $name; value = $value }
}
$sqlServer = if ($SqlInstance -in '.', '(local)') { 'localhost' } else { $SqlInstance }
$trust = if ($sqlServer -eq 'localhost') { 'True' } else { 'False' }
Set-PoolVar 'ConnectionStrings__Ccs' "Server=$sqlServer;Database=$Database;Integrated Security=True;Encrypt=True;TrustServerCertificate=$trust;Application Name=ccs-api"
if (-not (Get-PoolVar 'Jwt__SigningKey')) {
    $bytes = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    Set-PoolVar 'Jwt__SigningKey' ([Convert]::ToBase64String($bytes)); Ok 'new Jwt signing key generated'
} else { Ok 'existing Jwt signing key kept' }
Set-PoolVar 'App__PublicUrl' $PublicUrl
Set-PoolVar 'FileStore__Root' "$DataRoot\attachments"
Set-PoolVar 'DataProtection__KeysFolder' "$DataRoot\keys"
Set-PoolVar 'Serilog__WriteTo__0__Args__path' "$DataRoot\logs\api-.log"

#--------------------------------------------------------------------------------------------- 8
Step '8. Start and check'
if (Test-Path $offline) { Remove-Item $offline }
foreach ($pool in 'CcsApi', 'CcsWeb') { if ((Get-WebAppPoolState $pool).Value -eq 'Started') { Restart-WebAppPool $pool } else { Start-WebAppPool $pool } }
foreach ($site in 'ccs-api', 'ccs-web') { Start-Website $site -ErrorAction SilentlyContinue }

function Wait-Healthy($url) {
    for ($i = 0; $i -lt 45; $i++) {
        try { $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 10; if ($r.Content -match 'Healthy') { return $true } } catch { }
        Start-Sleep 2
    }
    return $false
}
if (-not (Wait-Healthy "https://localhost:$ApiPort/api/health")) {
    Write-Warning "API not healthy. Last log lines:"; Get-ChildItem "$DataRoot\logs\api-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1 | Get-Content -Tail 40
    throw 'API did not become healthy (see the Troubleshooting section of the Deployment Guide).'
}
Ok "API healthy on https://localhost:$ApiPort"
if (Wait-Healthy "https://$HostName/api/health") { Ok "Public address healthy: https://$HostName/api/health" }
else { Write-Warning "https://$HostName/api/health not reachable from this server. Check DNS (or the hosts file), the certificate and the ARR proxy." }

Write-Host "`nDone. Open $PublicUrl/en and run the verification checklist (Deployment Guide, section 9)." -ForegroundColor Green
