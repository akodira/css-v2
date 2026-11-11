<#
  CCS v2 installer: double-click Install-Ccs.cmd (it asks for administrator rights and opens a small window).
  Needs on the server: IIS, ASP.NET Core 10 Hosting Bundle, URL Rewrite, SQL Server. Nothing else.

  One IIS site "ccs-web": the Angular files at / and the API as the IIS application /api (own app pool).
  Run it again for every new release: it updates the files and keeps the database data and the secrets.

  Moving to another server: on the old server run Export-KeyCertificate.cmd, then on the new server restore the
  database, copy C:\CcsData\attachments, put ccs-key-certificate.pfx in C:\CcsData (or next to this script) and
  run the installer; it asks for the certificate password.

  Unattended use (same result, no window):
    .\Install-Ccs.ps1 -HostName ccs.example.com -CertThumbprint 3F2A...C9 -Quiet
#>
[CmdletBinding()]
param(
    [string] $HostName = 'localhost',                # site address; localhost = test on this machine
    [string] $ApiHostName,                           # optional: run the API as its own IIS site (e.g. api.example.com); empty = under /api
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
    [string] $KeyCertPassword,                       # moving from another server: password of ccs-key-certificate.pfx
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

#---------------------------------------------------------------- saved settings from the last install (C:\CcsData\installer-settings.json)
# Only values not typed on the command line are taken; nothing secret is stored (no passwords, no keys).
$SettingsFile = Join-Path $DataRoot 'installer-settings.json'
$Remembered = @{}
if (Test-Path $SettingsFile) {
    try {
        $saved = Get-Content $SettingsFile -Raw | ConvertFrom-Json
        foreach ($k in 'HostName', 'ApiHostName', 'CertThumbprint', 'SqlInstance', 'Database', 'SiteRoot', 'Port') {
            if ($k -eq 'ApiHostName' -and $PSBoundParameters.ContainsKey('HostName')) { continue }   # a typed address means "exactly this layout"
            if (-not $PSBoundParameters.ContainsKey($k) -and $null -ne $saved.$k -and "$($saved.$k)" -ne '') {
                Set-Variable -Name $k -Value ($(if ($k -eq 'Port') { [int]$saved.$k } else { [string]$saved.$k }))
                $Remembered[$k] = $true   # saved values win over what IIS shows
            }
        }
    } catch { }
}

#---------------------------------------------------------------- update: keep the current address, port and certificate
# Without this an update would fall back to "localhost" and a test certificate, and the real address would stop answering.
$appcmd = "$env:windir\system32\inetsrv\appcmd.exe"
if (Test-Path $appcmd) {
    $cur = (& $appcmd list site ccs-web /text:bindings 2>$null) -split ',' | Where-Object { $_ -like 'https/*' } | Select-Object -First 1
    if ($cur -match '^https/[^:]*:(\d+):(.*)$') {
        $curPort = [int]$Matches[1]; $curHost = $Matches[2]
        if (-not $PSBoundParameters.ContainsKey('HostName') -and -not $Remembered.HostName -and $curHost) { $HostName = $curHost }
        if (-not $PSBoundParameters.ContainsKey('Port') -and -not $Remembered.Port) { $Port = $curPort }
        if (-not $PSBoundParameters.ContainsKey('CertThumbprint') -and -not $Remembered.CertThumbprint) {
            $ssl = (netsh http show sslcert hostnameport="${HostName}:$Port" 2>$null) | Select-String 'Certificate Hash\s*:\s*([0-9a-fA-F]+)'
            if ($ssl) { $CertThumbprint = $ssl.Matches[0].Groups[1].Value; $Remembered.CertThumbprint = $true }
        }
    }
    if (-not $PSBoundParameters.ContainsKey('ApiHostName') -and -not $PSBoundParameters.ContainsKey('HostName') -and -not $Remembered.ApiHostName) {
        $api = (& $appcmd list site ccs-api /text:bindings 2>$null) -split ',' | Where-Object { $_ -like 'https/*' } | Select-Object -First 1
        if ($api -match '^https/[^:]*:\d+:(.+)$') { $ApiHostName = $Matches[1] }
    }
}

#---------------------------------------------------------------- window
if (-not $Quiet) {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $f = New-Object Windows.Forms.Form -Property @{ Text = 'Install CCS v2'; Width = 520; Height = 540; StartPosition = 'CenterScreen'; FormBorderStyle = 'FixedDialog'; MaximizeBox = $false; Font = New-Object Drawing.Font('Segoe UI', 10) }
    $script:y = 20
    function Row($label, $value) {
        $l = New-Object Windows.Forms.Label -Property @{ Text = $label; Left = 20; Top = $script:y + 3; Width = 170 }
        $t = New-Object Windows.Forms.TextBox -Property @{ Text = $value; Left = 195; Top = $script:y; Width = 290 }
        $f.Controls.AddRange(@($l, $t)); $script:y += 38; return $t
    }
    $tHost = Row 'Site address' $HostName
    $tApi  = Row 'API address (optional)' $ApiHostName
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
    $certs = @(Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date) -and $_.FriendlyName -notlike 'CCS test*' -and $_.Subject -ne 'CN=CCS Data Protection' })
    foreach ($c in $certs) { [void]$cCert.Items.Add("$($c.GetNameInfo('SimpleName', $false))  (until $($c.NotAfter.ToString('yyyy-MM-dd')))") }
    $cCert.SelectedIndex = 0
    for ($i = 0; $i -lt $certs.Count; $i++) { if ($CertThumbprint -and $certs[$i].Thumbprint -eq $CertThumbprint) { $cCert.SelectedIndex = $i + 1 } }
    $f.Controls.AddRange(@($l, $cCert)); $script:y += 48
    $b = New-Object Windows.Forms.Button -Property @{ Text = 'Install'; Left = 385; Top = $script:y; Width = 100; Height = 32; DialogResult = 'OK' }
    $f.AcceptButton = $b; $f.Controls.Add($b)
    if ($f.ShowDialog() -ne 'OK') { exit 1 }
    $ApiHostName = $tApi.Text.Trim(); $HostName = $tHost.Text.Trim(); $SqlInstance = $tSql.Text.Trim(); $Database = $tDb.Text.Trim(); $Port = [int]$tPort.Text.Trim()
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
# Password box (window mode), used for the key certificate from an old server
function Read-Secret([string]$prompt) {
    $d = New-Object Windows.Forms.Form -Property @{ Text = 'CCS v2'; Width = 460; Height = 210; StartPosition = 'CenterScreen'; FormBorderStyle = 'FixedDialog'; MaximizeBox = $false; MinimizeBox = $false; Font = New-Object Drawing.Font('Segoe UI', 10) }
    $l = New-Object Windows.Forms.Label -Property @{ Text = $prompt; Left = 15; Top = 12; Width = 415; Height = 60 }
    $t = New-Object Windows.Forms.TextBox -Property @{ Left = 15; Top = 78; Width = 415; UseSystemPasswordChar = $true }
    $b = New-Object Windows.Forms.Button -Property @{ Text = 'OK'; Left = 330; Top = 118; Width = 100; Height = 32; DialogResult = 'OK' }
    $d.Controls.AddRange(@($l, $t, $b)); $d.AcceptButton = $b
    if ($d.ShowDialog() -eq 'OK') { $t.Text } else { '' }
}
# The app pool must be able to read the private key of the key certificate
function Grant-KeyRead($cert) {
    $rsa = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
    if ($rsa -is [Security.Cryptography.RSACng]) { $file = "$env:ProgramData\Microsoft\Crypto\Keys\$($rsa.Key.UniqueName)" }
    else { $file = "$env:ProgramData\Microsoft\Crypto\RSA\MachineKeys\$($rsa.CspKeyContainerInfo.UniqueKeyContainerName)" }
    if (-not (Test-Path $file)) { Fail "The private key file of the key certificate was not found ($file)." }
    icacls $file /grant 'IIS AppPool\CcsApi:R' /Q | Out-Null
    $global:LASTEXITCODE = 0
}

try {
#---------------------------------------------------------------- 1 prerequisites
$Base = if ($Port -eq 443) { "https://$HostName" } else { "https://${HostName}:$Port" }
if ($ApiHostName -eq $HostName) { $ApiHostName = '' }
$Separate = [bool]$ApiHostName
$ApiBase = if (-not $Separate) { $Base } elseif ($Port -eq 443) { "https://$ApiHostName" } else { "https://${ApiHostName}:$Port" }
$Names = @($HostName) + @($ApiHostName | Where-Object { $_ })
# A remembered certificate is reused only if it still exists, is valid and covers every address (else a new one is chosen/made).
if ($CertThumbprint -and $Remembered.CertThumbprint) {
    $c = Get-Item "Cert:\LocalMachine\My\$CertThumbprint" -ErrorAction SilentlyContinue
    $dns = if ($c) { @($c.DnsNameList | ForEach-Object { "$_" }) } else { @() }
    $covers = { param($n) $dns | Where-Object { $_ -eq $n -or ($_ -like '`*.*' -and $n -like ('*' + $_.Substring(1)) -and ($n.Split('.').Count -eq $_.Split('.').Count)) } }
    if (-not $c -or $c.NotAfter -lt (Get-Date) -or @($Names | Where-Object { -not (& $covers $_) }).Count) { $CertThumbprint = '' }
}
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
if (Test-Path "$Package\database\05_upgrades.sql") { Sql -db $Database -file "$Package\database\05_upgrades.sql" | Out-Null; Ok 'schema up to date' }
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
# A separate API accepts calls from the website only; under /api no cross-site rule is needed.
if ($Separate) { SetVar 'Cors__WebOrigin' $Base }
elseif ($null -ne (Var 'Cors__WebOrigin')) { Remove-WebConfigurationProperty -PSPath $apphost -Filter $ef -Name '.' -AtElement @{ name = 'Cors__WebOrigin' } }
SetVar 'FileStore__Root' "$DataRoot\attachments"
function RemoveVar($n) { if ($null -ne (Var $n)) { Remove-WebConfigurationProperty -PSPath $apphost -Filter $ef -Name '.' -AtElement @{ name = $n } } }

# Key certificate: encrypts the Data Protection keys kept in the database (they open the saved SMTP password and
# captcha secret). Moving to another server = restore the database + import this certificate.
$KeyCertSubject = 'CN=CCS Data Protection'
$pfx = @("$DataRoot\ccs-key-certificate.pfx", "$Package\ccs-key-certificate.pfx") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($pfx) {
    if (-not $KeyCertPassword -and -not $Quiet) { $KeyCertPassword = Read-Secret "Key certificate from the old server found:`n$pfx`nEnter its password (the one used in Export-KeyCertificate)." }
    if (-not $KeyCertPassword) { Fail "Found $pfx but no password. Run the installer again and enter the certificate password (or use -KeyCertPassword)." }
    try { $imported = @(Import-PfxCertificate -FilePath $pfx -CertStoreLocation Cert:\LocalMachine\My -Exportable -Password (ConvertTo-SecureString $KeyCertPassword -AsPlainText -Force)) }
    catch { Fail "Could not import $pfx (wrong password?). $($_.Exception.Message)" }
    if (-not ($imported | Where-Object { $_.Subject -eq $KeyCertSubject })) { Fail "$pfx is not a CCS key certificate (subject must be $KeyCertSubject)." }
    Move-Item $pfx "$pfx.imported-$(Get-Date -Format yyyyMMdd-HHmmss)" -Force
    Ok "key certificate from the old server imported ($($imported[0].Thumbprint))"
}
$keyCerts = @(Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.Subject -eq $KeyCertSubject -and $_.HasPrivateKey } | Sort-Object NotAfter -Descending)
$NewKeyCert = $false
if (-not $keyCerts) {
    $keyCerts = @(New-SelfSignedCertificate -Type Custom -Subject $KeyCertSubject -FriendlyName 'CCS Data Protection (opens saved secrets - back it up)' `
        -CertStoreLocation Cert:\LocalMachine\My -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy Exportable `
        -KeyUsage KeyEncipherment, DataEncipherment -NotAfter (Get-Date).AddYears(30))
    $NewKeyCert = $true
    Ok 'key certificate created (CCS Data Protection)'
}
foreach ($kc in $keyCerts) { Grant-KeyRead $kc }
SetVar 'DataProtection__CertificateThumbprint' $keyCerts[0].Thumbprint
RemoveVar 'DataProtection__KeysFolder'
# Releases before Nov 2026 kept the keys in C:\CcsData\keys: the API moves the saved secrets from there once.
if (Test-Path "$DataRoot\keys\key-*.xml") { SetVar 'DataProtection__LegacyKeysFolder' "$DataRoot\keys" } else { RemoveVar 'DataProtection__LegacyKeysFolder' }
SetVar 'Serilog__WriteTo__0__Args__path' "$DataRoot\logs\api-.log"
foreach ($n in 'ConnectionStrings__Ccs', 'Jwt__SigningKey', 'App__PublicUrl') { if (-not (Var $n)) { Fail "App pool setting $n was not saved." } }
Ok 'settings stored on the CcsApi app pool (not in files)'

# Database login for the API's app pool: Windows login, no password
$loginSql = (Get-Content "$Package\database\04_logins.sql" -Raw).Replace('USE CCS;', "USE [$Database];")
$tmp = Join-Path $env:TEMP 'ccs-logins.sql'; Set-Content $tmp $loginSql -Encoding UTF8
Sql -file $tmp | Out-Null; Ok 'SQL login IIS APPPOOL\CcsApi'

#---------------------------------------------------------------- 4 files
Step '4/6 Files'
foreach ($d in "$DataRoot\attachments", "$DataRoot\logs", "$SiteRoot\web", "$SiteRoot\api") { New-Item $d -ItemType Directory -Force | Out-Null }
robocopy "$Package\ccs-web" "$SiteRoot\web" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null; if ($LASTEXITCODE -ge 8) { Fail 'copying web files failed' }
robocopy "$Package\ccs-api" "$SiteRoot\api" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null; if ($LASTEXITCODE -ge 8) { Fail 'copying API files failed' }
icacls $DataRoot /grant 'IIS AppPool\CcsApi:(OI)(CI)M' /T /Q | Out-Null
icacls "$SiteRoot\api" /grant 'IIS AppPool\CcsApi:(OI)(CI)RX' /T /Q | Out-Null
icacls "$SiteRoot\web" /grant 'IIS AppPool\CcsWeb:(OI)(CI)RX' /T /Q | Out-Null
$global:LASTEXITCODE = 0
# Where the website finds the API, and the browser rule (CSP) that lets it call there
Set-Content "$SiteRoot\web\config.json" ('{ "apiBase": "' + $(if ($Separate) { $ApiBase } else { '' }) + '" }') -Encoding ASCII
if ($Separate) {
    $wc = "$SiteRoot\web\web.config"
    (Get-Content $wc -Raw).Replace("connect-src 'self'", "connect-src 'self' $ApiBase") | Set-Content $wc -Encoding UTF8
}
Ok "$SiteRoot\web and $SiteRoot\api"

#---------------------------------------------------------------- 5 site
Step '5/6 IIS site'
if (-not $CertThumbprint) {
    $fn = "CCS test $($Names -join ' ')"
    $c = Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.FriendlyName -eq $fn -and $_.NotAfter -gt (Get-Date).AddDays(30) } | Select-Object -First 1
    if (-not $c) {
        $c = New-SelfSignedCertificate -DnsName $Names -CertStoreLocation Cert:\LocalMachine\My -NotAfter (Get-Date).AddYears(2) -FriendlyName $fn
        $r = New-Object Security.Cryptography.X509Certificates.X509Store Root, LocalMachine; $r.Open('ReadWrite'); $r.Add($c); $r.Close()
    }
    $CertThumbprint = $c.Thumbprint; Ok "test certificate for $($Names -join ', ') (trusted on this machine only)"
}
# Is the port free? Another IIS site on the same port without a host name, or another program, blocks the start.
$otherSites = @(Get-Website | Where-Object { $_.Name -notin 'ccs-web', 'ccs-api' -and $_.State -eq 'Started' } | Where-Object {
    $_.Bindings.Collection | Where-Object { $_.protocol -eq 'https' -and $_.bindingInformation -match ":$Port`:" -and ($_.bindingInformation -split ':')[-1] -in @('') + $Names } })
if ($otherSites) { Fail "Port $Port is already used by the IIS site '$($otherSites[0].Name)'. Stop that site in IIS Manager, or run the installer again and choose another HTTPS port (for example 8443)." }
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -ne 4 } | Select-Object -First 1
if ($listener) {
    $proc = (Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    Fail "Port $Port is already used by the program '$proc' (process id $($listener.OwningProcess)). Close it, or run the installer again and choose another HTTPS port (for example 8443)."
}
# A test name such as "ccs" must resolve to this machine
foreach ($n in $Names) {
    $resolves = $true; try { [void][Net.Dns]::GetHostAddresses($n) } catch { $resolves = $false }
    if (-not $resolves) {
        Add-Content "$env:windir\System32\drivers\etc\hosts" "`r`n127.0.0.1`t$n`t# added by CCS installer"
        Ok "$n added to the hosts file (points to this machine)"
    }
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
if ($Separate) {
    # API as its own site: same files, same app pool, own address
    if (Get-WebApplication -Site ccs-web -Name api) { Remove-WebApplication -Site ccs-web -Name api }
    if (-not (Test-Path 'IIS:\Sites\ccs-api')) {
        New-Website -Name ccs-api -PhysicalPath "$SiteRoot\api" -ApplicationPool CcsApi -HostHeader $ApiHostName -Port $Port -Ssl -SslFlags 1 | Out-Null
    } else {
        Get-WebBinding -Name ccs-api -Protocol https | Remove-WebBinding
        New-WebBinding -Name ccs-api -Protocol https -Port $Port -HostHeader $ApiHostName -SslFlags 1
    }
    $ab = Get-WebBinding -Name ccs-api -Protocol https
    try { $ab.RemoveSslCertificate() } catch { }
    $ab.AddSslCertificate($CertThumbprint, 'My')
    Set-ItemProperty 'IIS:\Sites\ccs-api' applicationDefaults.preloadEnabled $true
    $p1 = ($HostName -split '\.', 2)[-1]; $p2 = ($ApiHostName -split '\.', 2)[-1]
    if ($p1 -ne $p2 -or $HostName -notmatch '\.') { Write-Host "    Note: use two names under one domain (e.g. ccs.example.com and api.example.com), or sign-in will not stay signed in." -ForegroundColor Yellow }
    Ok "$Base  (API at $ApiBase/api, its own site ccs-api)"
} else {
    if (Test-Path 'IIS:\Sites\ccs-api') { Remove-Website ccs-api }
    if (-not (Get-WebApplication -Site ccs-web -Name api)) { New-WebApplication -Site ccs-web -Name api -PhysicalPath "$SiteRoot\api" -ApplicationPool CcsApi | Out-Null }
    Set-ItemProperty 'IIS:\Sites\ccs-web\api' preloadEnabled $true
    Ok "$Base  (API at $Base/api)"
}

#---------------------------------------------------------------- 6 start and check
Step '6/6 Starting and checking'
Start-WebAppPool CcsWeb; Start-WebAppPool CcsApi
try { Start-Website ccs-web; if ($Separate) { Start-Website ccs-api } } catch { Fail "IIS could not start the site on port $Port ($($_.Exception.Message)). Another program may hold the port: run the installer again with another HTTPS port, for example 8443." }
$okHealth = $false
for ($i = 0; $i -lt 45 -and -not $okHealth; $i++) {
    try { $okHealth = (Invoke-WebRequest "$ApiBase/api/health" -UseBasicParsing -TimeoutSec 10).Content -match 'Healthy' } catch { Start-Sleep 2 }
}
if (-not $okHealth) {
    $log = Get-ChildItem "$DataRoot\logs\api-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
    $tail = if ($log) { (Get-Content $log.FullName -Tail 15) -join "`n" } else { 'See Windows Event Viewer, Application log.' }
    Fail "The site was installed but $ApiBase/api/health is not healthy.`n$tail"
}
Ok 'healthy'
# Remember these settings for the next update (the window and -Quiet runs start from them).
@{ HostName = $HostName; ApiHostName = $ApiHostName; CertThumbprint = $CertThumbprint; SqlInstance = $SqlInstance; Database = $Database; SiteRoot = $SiteRoot; Port = $Port } |
    ConvertTo-Json | Set-Content -Path $SettingsFile -Encoding UTF8
Ok "settings saved for the next update ($SettingsFile)"

if ($SupabaseUrl) {
    Step 'Copying all data from Supabase'
    $env:ConnectionStrings__Ccs = (Var 'ConnectionStrings__Ccs')
    $env:FileStore__Root = "$DataRoot\attachments"
    $imp = @('import-supabase', $SupabaseUrl)
    if ($RealOnly) { $imp += '--real-only' }
    if ($SupabaseServiceKey) { $imp += '--service-key', $SupabaseServiceKey }
    # Native tool: its messages on stderr must be shown, not treated as a script error (Windows PowerShell 5.1)
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & dotnet "$SiteRoot\api\Ccs.Api.dll" @imp 2>&1 | ForEach-Object { Write-Host "    $_" }
    $code = $LASTEXITCODE; $ErrorActionPreference = $eap; $global:LASTEXITCODE = $code
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
    $env:DataProtection__CertificateThumbprint = $keyCerts[0].Thumbprint
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = & dotnet "$SiteRoot\api\Ccs.Api.dll" create-admin $AdminEmail $AdminPassword 2>&1
    $code = $LASTEXITCODE; $ErrorActionPreference = $eap; $global:LASTEXITCODE = $code
    if ($LASTEXITCODE -ne 0) { Fail "Could not create the administrator:`n$($out | Out-String)" }
    Ok "administrator $AdminEmail can sign in"
}
$keyNote = "Back up the key certificate (Export-KeyCertificate.cmd) together with the database. A new server needs both."
if ($NewKeyCert) { Write-Host "`n    $keyNote" -ForegroundColor Yellow }
Write-Host "`nDone: $Base/en" -ForegroundColor Green
if (-not $Quiet) {
    [Windows.Forms.MessageBox]::Show("CCS v2 is installed and healthy.`n`nOpen $Base/en$(if ($NewKeyCert) { "`n`n$keyNote" })", 'CCS v2', 'OK', 'Information') | Out-Null
    Start-Process "$Base/en"
}
} catch { Fail $_.Exception.Message }
