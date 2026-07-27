<#
    Cockpit launcher.

    Starts the production server if it isn't already up, waits for it to answer,
    then opens the board in a chromeless browser window. Safe to run repeatedly:
    a second launch reuses the running server instead of fighting it for the port.

        .\cockpit.ps1            start if needed, then open the window
        .\cockpit.ps1 -Status    report whether it's up, and on which pid
        .\cockpit.ps1 -Stop      shut the server down (kills every live session)
        .\cockpit.ps1 -NoBrowser start it headless, don't open a window

    The server runs hidden, so its console output goes to data/cockpit.log —
    that file is the only place a startup failure will show up.
#>
[CmdletBinding()]
param(
    [switch]$Stop,
    [switch]$Status,
    [switch]$NoBrowser,
    [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'

$Root    = Split-Path -Parent $PSScriptRoot
$DataDir = Join-Path $Root 'data'
$LogFile = Join-Path $DataDir 'cockpit.log'
$ErrFile = Join-Path $DataDir 'cockpit.err.log'
$PidFile = Join-Path $DataDir 'cockpit.pid'
# 127.0.0.1, not localhost: the server binds the IPv4 loopback only, and
# localhost resolves to ::1 first on Windows, so a `localhost` health check
# fails against a perfectly healthy server.
$Url     = "http://127.0.0.1:$Port"

function Test-Up {
    # /api/projects rather than / because it's cheap and proves the app booted,
    # not merely that something grabbed the port.
    try {
        $null = Invoke-WebRequest -Uri "$Url/api/projects" -UseBasicParsing -TimeoutSec 2
        return $true
    } catch {
        return $false
    }
}

function Get-ServerPid {
    if (-not (Test-Path $PidFile)) { return $null }
    $recorded = (Get-Content $PidFile -Raw).Trim()
    if (-not $recorded) { return $null }
    # A recycled pid belonging to some unrelated process must not be killable
    # by -Stop, so confirm it's still a node process before trusting it.
    try {
        $proc = Get-Process -Id ([int]$recorded) -ErrorAction Stop
        if ($proc.ProcessName -ne 'node') { return $null }
        return $proc.Id
    } catch {
        return $null
    }
}

function Open-Window {
    # App mode gives a standalone window with no address bar or tabs. Falling
    # back to the default browser is fine, just an ordinary tab.
    $browsers = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($b in $browsers) {
        if (Test-Path $b) {
            Start-Process -FilePath $b -ArgumentList "--app=$Url"
            return
        }
    }
    Start-Process $Url
}

if ($Status) {
    $up = Test-Up
    $serverPid = Get-ServerPid
    if ($up) {
        Write-Output "Cockpit is up on $Url$(if ($serverPid) { " (pid $serverPid)" })"
    } else {
        Write-Output "Cockpit is not running on port $Port"
    }
    return
}

if ($Stop) {
    $serverPid = Get-ServerPid
    if (-not $serverPid) {
        Write-Output 'No Cockpit server recorded as running.'
        if (Test-Path $PidFile) { Remove-Item $PidFile -Force }
        return
    }
    # Every PTY is a child of this process and dies with it, which is the point:
    # stopping Cockpit ends its Claude sessions.
    Stop-Process -Id $serverPid -Force
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    Write-Output "Stopped Cockpit (pid $serverPid). Any live sessions ended with it."
    return
}

if (Test-Up) {
    if (-not $NoBrowser) { Open-Window }
    return
}

if (-not (Test-Path (Join-Path $Root '.next'))) {
    throw "No production build found. Run 'npm run build' in $Root first."
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

# Inherited by the child. Cockpit must run as the logged-in user: it reads
# ~/.claude for skills and MCP config, and needs claude.exe on this PATH.
$env:NODE_ENV = 'production'
$env:PORT     = "$Port"

$proc = Start-Process -FilePath 'node.exe' `
    -ArgumentList 'server.js' `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $LogFile `
    -RedirectStandardError $ErrFile `
    -PassThru

Set-Content -Path $PidFile -Value $proc.Id -Encoding utf8

$deadline = 30
for ($i = 0; $i -lt $deadline; $i++) {
    if (Test-Up) {
        if (-not $NoBrowser) { Open-Window }
        return
    }
    if ($proc.HasExited) {
        throw "Cockpit exited immediately (code $($proc.ExitCode)). See $ErrFile"
    }
    Start-Sleep -Seconds 1
}

throw "Cockpit did not answer within ${deadline}s. See $LogFile and $ErrFile"
