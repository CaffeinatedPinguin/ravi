# Installs ravi into ~/.ravi/bin from a folder that holds ravi.mjs and the launchers
# (a release archive or ./dist after `pnpm build`). Usage: install.ps1 [-Source <folder>]
param(
    [string]$Source = (Join-Path $PSScriptRoot '..\dist')
)

$ErrorActionPreference = 'Stop'
$target = Join-Path $HOME '.ravi\bin'

if (-not (Test-Path (Join-Path $Source 'ravi.mjs'))) {
    throw "ravi.mjs not found in $Source"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 22 or newer is required'
}

New-Item -ItemType Directory -Force $target | Out-Null
Copy-Item (Join-Path $Source 'ravi.mjs'), (Join-Path $Source 'ravi.cmd') $target -Force

Write-Host "Installed to $target"
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $target) {
    Write-Host "Add it to your PATH:"
    Write-Host "  [Environment]::SetEnvironmentVariable('Path', `"$target;`$env:Path`", 'User')"
}
