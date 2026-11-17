<#
.SYNOPSIS
    Installs ravi (a local code review tool) for the current Windows user.

.DESCRIPTION
    What this script does, in order:
      1. Checks that Node.js 22.20+ and git are installed.
      2. Looks for an existing ravi installation and reads its version.
      3. Asks GitHub which ravi release is the latest one.
      4. Downloads ravi.mjs from that release and puts it in the install folder.
      5. Writes a small launcher, ravi.cmd, next to it. The launcher makes ravi keep its data
         (reviews, tokens, settings) in the same folder, so everything is in one place.
      6. Adds the install folder to your user PATH so that `ravi` works in a terminal.
      7. Prints how to start, update and uninstall ravi.

    What this script does NOT do:
      - It does not need administrator rights and never touches anything machine-wide.
      - It writes only two files (ravi.mjs and ravi.cmd) into the install folder, plus one
        entry in your user PATH. Running it again to update never touches your data.

    Network access (nothing else is contacted, nothing about you is sent):
      - https://api.github.com/repos/CaffeinatedPinguin/ravi/releases/latest   (step 3)
      - https://github.com/CaffeinatedPinguin/ravi/releases/download/<tag>/ravi.mjs   (step 4)
    Pass -LocalFile to install an already downloaded ravi.mjs without any network access.

    Run it from a PowerShell window. Windows blocks downloaded scripts by default, so use:
      powershell -ExecutionPolicy Bypass -File .\install-windows.ps1

.PARAMETER InstallDir
    Where to install ravi. Default: %LOCALAPPDATA%\Programs\ravi
    (the standard per-user folder for programs, no administrator rights needed).

.PARAMETER LocalFile
    Path to a ravi.mjs you already have. When given, the script skips steps 3 and 4 and
    installs that file instead of downloading one (offline install, or `pnpm build` output).
#>
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\ravi'),
    [string]$LocalFile = ''
)

# Stop at the first error instead of carrying on with a half-finished installation.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Windows PowerShell 5.1 draws a progress bar that makes downloads many times slower. Turn it off.
$ProgressPreference = 'SilentlyContinue'

# --- Settings ---------------------------------------------------------------------------------

$Repo = 'CaffeinatedPinguin/ravi'
$LatestReleaseUrl = "https://api.github.com/repos/$Repo/releases/latest"
$MinimumNode = [version]'22.20.0'   # must match "engines" in package.json
$TotalSteps = 7

$AppFile = Join-Path $InstallDir 'ravi.mjs'     # the program itself
$Launcher = Join-Path $InstallDir 'ravi.cmd'    # lets you type `ravi` in a terminal

# --- Helpers ----------------------------------------------------------------------------------

# Prints a numbered heading so the user can follow what the script is doing.
function Write-Step {
    param([int]$Number, [string]$Text)
    Write-Host ''
    Write-Host "[$Number/$TotalSteps] $Text" -ForegroundColor Cyan
}

# Runs `node <file> --version` and returns the version text, for example "0.1.0".
# Returns $null when the file cannot be run, which means it is not a working ravi.
function Get-RaviVersion {
    param([string]$File)
    try {
        $output = & node $File --version 2>$null
        if ($LASTEXITCODE -eq 0 -and $output) { return "$output".Trim() }
    } catch { }
    return $null
}

# --- The installation -------------------------------------------------------------------------

try {
    Write-Host 'ravi installer for Windows'
    Write-Host "Install folder: $InstallDir"

    # --- Step 1: requirements ---
    # ravi runs on Node.js and uses the git program to read your repositories.
    # This script does not install either of them; it only tells you what is missing.
    Write-Step 1 'Checking requirements (Node.js and git)'
    $problems = @()

    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        $problems += 'Node.js is not installed. Get the LTS version from https://nodejs.org or run: winget install OpenJS.NodeJS.LTS'
    } else {
        # `node --version` prints something like "v22.20.0".
        $nodeText = (& node --version).Trim()
        if ($nodeText -match '^v(\d+\.\d+\.\d+)' -and [version]$Matches[1] -ge $MinimumNode) {
            Write-Host "  Node.js $nodeText - ok"
        } else {
            $problems += "Node.js $nodeText is too old. ravi needs $MinimumNode or newer: https://nodejs.org"
        }
    }

    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        $problems += 'git is not installed. Get it from https://git-scm.com or run: winget install Git.Git'
    } else {
        Write-Host "  $((& git --version).Trim()) - ok"
    }

    if ($problems.Count -gt 0) {
        throw ("Cannot install yet:`n  - " + ($problems -join "`n  - "))
    }

    # --- Step 2: is ravi already installed? ---
    Write-Step 2 'Looking for an existing installation'
    $installedVersion = $null
    if (Test-Path -LiteralPath $AppFile) {
        $installedVersion = Get-RaviVersion $AppFile
    }
    if ($installedVersion) {
        Write-Host "  Found ravi $installedVersion in $InstallDir"
    } else {
        Write-Host '  ravi is not installed yet'
    }

    # --- Steps 3 and 4: get ravi.mjs ---
    # The new program is first saved as ravi.new.mjs and only then moved over ravi.mjs, so an
    # interrupted download can never leave you with a broken installation.
    $newFile = Join-Path $InstallDir 'ravi.new.mjs'
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

    $needsDownload = $false
    if ($LocalFile) {
        # Offline mode: nothing is downloaded, the file you gave is used as it is.
        Write-Step 3 'Skipped: using a local file, so GitHub is not contacted'
        if (-not (Test-Path -LiteralPath $LocalFile)) {
            throw "File not found: $LocalFile"
        }
        Write-Step 4 "Installing $LocalFile"
        Copy-Item -LiteralPath $LocalFile -Destination $newFile -Force
    } else {
        Write-Step 3 'Checking GitHub for the latest release'
        Write-Host "  Asking: $LatestReleaseUrl"
        try {
            # GitHub requires a User-Agent header; any name works.
            $release = Invoke-RestMethod -Uri $LatestReleaseUrl -Headers @{ 'User-Agent' = 'ravi-installer' }
        } catch {
            throw ("Could not reach GitHub: $($_.Exception.Message)`n" +
                   "  You can download ravi.mjs by hand from https://github.com/$Repo/releases/latest`n" +
                   "  and install it without a network connection with:`n" +
                   "  powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -LocalFile .\ravi.mjs")
        }
        $tag = $release.tag_name                    # for example "v0.1.0"
        $latestVersion = $tag.TrimStart('v')        # for example "0.1.0"
        Write-Host "  Latest release: $latestVersion"

        if ($installedVersion -eq $latestVersion) {
            Write-Host "  You already have the latest version ($installedVersion)." -ForegroundColor Green
            Write-Step 4 'Skipped: nothing to download'
        } else {
            $downloadUrl = "https://github.com/$Repo/releases/download/$tag/ravi.mjs"
            Write-Step 4 "Downloading ravi $latestVersion"
            Write-Host "  From: $downloadUrl"
            Invoke-WebRequest -Uri $downloadUrl -OutFile $newFile -UseBasicParsing
            $needsDownload = $true
        }
    }

    # Install the new file, if there is one: first prove that it runs, then replace the old one.
    if ($LocalFile -or $needsDownload) {
        $newVersion = Get-RaviVersion $newFile
        if (-not $newVersion) {
            Remove-Item -LiteralPath $newFile -Force
            throw 'The file did not run with Node.js, so it was not installed. The old installation (if any) is untouched.'
        }
        Move-Item -LiteralPath $newFile -Destination $AppFile -Force
        Write-Host "  Installed ravi $newVersion to $AppFile" -ForegroundColor Green
    }

    # --- Step 5: the launcher ---
    # ravi.cmd runs ravi.mjs with Node.js. "%~dp0" means "the folder this file is in".
    # It also sets RAVI_HOME to that folder, which is how ravi learns where to keep its data
    # (reviews, tokens, settings); without it ravi would use ~\.ravi. If RAVI_HOME is already
    # set in your environment, that value wins. "setlocal" keeps the variable out of your
    # terminal session.
    Write-Step 5 'Writing the launcher'
    Set-Content -LiteralPath $Launcher -Encoding Ascii -Value @(
        '@echo off',
        'setlocal',
        'if not defined RAVI_HOME set "RAVI_HOME=%~dp0"',
        'node "%~dp0ravi.mjs" %*'
    )
    Write-Host "  Wrote $Launcher"

    # --- Step 6: PATH ---
    # Windows finds commands through the folders listed in PATH. Adding the install folder to
    # your *user* PATH (not the machine PATH, so no administrator rights) lets you type `ravi`.
    # Note: this API saves the PATH as plain text, with any %VARIABLES% in it already replaced
    # by their current values. That is harmless, and it also tells Windows to refresh the PATH
    # that newly opened terminals receive.
    Write-Step 6 'Adding the install folder to your user PATH'
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $folders = @($userPath -split ';' | Where-Object { $_ -ne '' })
    if ($folders -contains $InstallDir) {
        Write-Host '  Already in PATH - nothing to change'
    } else {
        $newPath = ($folders + $InstallDir) -join ';'
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
        Write-Host "  Added $InstallDir to your user PATH"
    }

    # --- Step 7: summary ---
    # Run the launcher by its full path (PATH is not refreshed in this window yet) to prove
    # that the whole chain works: launcher -> Node.js -> ravi.mjs.
    Write-Step 7 'Checking the installation'
    $check = & $Launcher --version
    Write-Host "  ravi $check is installed" -ForegroundColor Green

    # Earlier releases kept their data in ~\.ravi. We never move your data for you (it holds your
    # tokens); if there is something to bring along, we show the command to do it.
    $oldHome = Join-Path $HOME '.ravi'
    $hasNewData = Test-Path -LiteralPath (Join-Path $InstallDir 'data')
    if ((Test-Path -LiteralPath $oldHome) -and -not $hasNewData) {
        Write-Host ''
        Write-Host "  Found data from an earlier setup in $oldHome" -ForegroundColor Yellow
        Write-Host '  ravi now keeps its data in the install folder. To bring your reviews and tokens'
        Write-Host '  along, run this once (the old folder is left as it is):'
        Write-Host "    Copy-Item -Recurse -Force -Path '$oldHome\*' -Destination '$InstallDir'"
    }

    Write-Host @"

----------------------------------------------------------------------
How to start ravi
  1. Open a NEW terminal (PowerShell, cmd or Windows Terminal).
     Windows that were already open do not see the PATH change.
  2. Go to a folder with a git repository and run:
       ravi
     It opens the review in your browser. Press Ctrl+C in the terminal to stop it.
  3. Other options:  ravi --help

How to update
  Run this installer again. It tells you whether a newer version exists.

How to uninstall
  1. Delete the folder $InstallDir
     It also holds your reviews and tokens, so copy them out first if you want to keep them.
  2. Remove that folder from your PATH (Win+R, then run: rundll32 sysdm.cpl,EditEnvironmentVariables)
----------------------------------------------------------------------
"@
} catch {
    Write-Host ''
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
