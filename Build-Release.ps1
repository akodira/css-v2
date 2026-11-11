<#
  Build-Release.ps1 - builds a CCS v2 release on this Windows server and installs it, without GitHub Actions.

  What it does (same steps as the GitHub build, except the website part, which comes ready-made in prebuilt\ccs-web):
    1. checks the .NET 10 SDK is installed
    2. compiles the server code and runs the unit tests
    3. makes the release folder  C:\CcsData\releases\ccs-v2-release-<commit>
    4. runs Install-Ccs.ps1 from that folder (it remembers your address, certificate and SQL settings)

  Usage: double-click Build-Release.cmd (asks for administrator rights), or in an administrator PowerShell:
      .\Build-Release.ps1               build, test and install
      .\Build-Release.ps1 -SkipTests    faster, no unit tests
      .\Build-Release.ps1 -NoInstall    build the release folder only
#>
param(
    [switch] $SkipTests,
    [switch] $NoInstall,
    [string] $ReleasesRoot = 'C:\CcsData\releases'
)
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
Set-Location $Root

function Step($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ''; Write-Host "STOPPED: $text" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- 1. checks
Step 'Checking the .NET 10 SDK'
$sdks = & dotnet --list-sdks 2>$null
if (-not ($sdks -match '^10\.')) {
    Fail ".NET 10 SDK not found. Install 'SDK 10.x - Windows x64' from https://dotnet.microsoft.com/download/dotnet/10.0, close this window and run again."
}
Write-Host ($sdks -join "`n")

$web = Join-Path $Root 'prebuilt\ccs-web'
if (-not (Test-Path (Join-Path $web 'index.html'))) { Fail "prebuilt\ccs-web is missing. Download the code again (Code > Download ZIP)." }
$stamp = if (Test-Path (Join-Path $Root 'prebuilt\BUILD.txt')) { (Get-Content (Join-Path $Root 'prebuilt\BUILD.txt') -First 1).Trim() } else { Get-Date -Format 'yyyyMMdd-HHmm' }
$name = "ccs-v2-release-$stamp"
$Out = Join-Path $ReleasesRoot $name
Write-Host "Release: $name"

# ---------------------------------------------------------------- 2. compile and test
Step 'Downloading packages (needs internet to nuget.org)'
& dotnet restore Ccs.slnx
if ($LASTEXITCODE) { Fail 'dotnet restore failed (check the internet connection to nuget.org).' }

Step 'Compiling'
& dotnet build Ccs.slnx -c Release --no-restore
if ($LASTEXITCODE) { Fail 'The build failed. Copy the red lines above and send them to Claude.' }

if (-not $SkipTests) {
    Step 'Running the unit tests'
    & dotnet test Ccs.slnx -c Release --no-build
    if ($LASTEXITCODE) { Fail 'Some tests failed. Copy the lines above and send them to Claude. Nothing was installed.' }
}

# ---------------------------------------------------------------- 3. release folder (same layout as the GitHub release)
Step "Making the release folder $Out"
if (Test-Path $Out) { Remove-Item $Out -Recurse -Force }
New-Item -ItemType Directory -Force $Out, "$Out\ccs-web", "$Out\database", "$Out\migration", "$Out\docs" | Out-Null
& dotnet publish src/Ccs.Api/Ccs.Api.csproj -c Release -r win-x64 --self-contained false -o "$Out\ccs-api"
if ($LASTEXITCODE) { Fail 'dotnet publish failed. Copy the lines above and send them to Claude.' }
Copy-Item "$web\*" "$Out\ccs-web\" -Recurse
Copy-Item database\* "$Out\database\" -Recurse
Copy-Item migration\* "$Out\migration\" -Recurse
Copy-Item docs\* "$Out\docs\" -Recurse
Copy-Item deploy\Install-Ccs.ps1, deploy\Install-Ccs.cmd $Out
"commit $stamp built on $env:COMPUTERNAME $(Get-Date -Format o)" | Set-Content "$Out\VERSION.txt"
Write-Host "Release ready: $Out" -ForegroundColor Green

# ---------------------------------------------------------------- 4. install
if ($NoInstall) { Write-Host 'Not installed (-NoInstall). To install later run Install-Ccs.cmd in that folder.'; exit 0 }
Step 'Installing (Install-Ccs.ps1 uses the settings it remembered last time)'
& "$Out\Install-Ccs.ps1"
