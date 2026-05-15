# install-local-connector.ps1
# Sets up the Cloudflare tunnel connector as a Windows service.
# Run as Administrator.

param(
    [string]$TunnelToken = $env:CLOUDFLARE_TUNNEL_TOKEN,
    [string]$ServiceName = "cloudflared",
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n[install-local-connector] $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  OK: $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "  FAIL: $msg" -ForegroundColor Red }

# ─── Uninstall path ───────────────────────────────────────────────────────────
if ($Uninstall) {
    Write-Step "Stopping and removing cloudflared service..."
    try { Stop-Service $ServiceName -Force -ErrorAction SilentlyContinue } catch {}
    & cloudflared service uninstall 2>$null
    Write-OK "Service removed."
    exit 0
}

# ─── Check cloudflared is on PATH ─────────────────────────────────────────────
Write-Step "Checking cloudflared binary..."
$cfPath = (Get-Command cloudflared -ErrorAction SilentlyContinue)?.Source
if (-not $cfPath) {
    Write-Fail "cloudflared not found on PATH."
    Write-Host "  Download from: https://github.com/cloudflare/cloudflared/releases"
    Write-Host "  Or run: winget install --id Cloudflare.cloudflared"
    exit 1
}
Write-OK "cloudflared at $cfPath"

# ─── Validate token ───────────────────────────────────────────────────────────
Write-Step "Checking tunnel token..."
if (-not $TunnelToken) {
    Write-Fail "CLOUDFLARE_TUNNEL_TOKEN is not set. Pass -TunnelToken or set env var."
    exit 1
}
Write-OK "Token present (first 8 chars: $($TunnelToken.Substring(0,8))...)"

# ─── Check existing service ───────────────────────────────────────────────────
Write-Step "Checking existing cloudflared service..."
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    Write-Host "  Service exists (status: $($svc.Status))"
    if ($svc.Status -eq "Running") {
        Write-OK "Service is already running."
        exit 0
    }
    Write-Step "Starting existing service..."
    Start-Service $ServiceName
    Start-Sleep -Seconds 2
    $svc.Refresh()
    if ($svc.Status -eq "Running") { Write-OK "Service started."; exit 0 }
    Write-Fail "Service did not start. Reinstalling..."
    try { & cloudflared service uninstall 2>$null } catch {}
    Start-Sleep -Seconds 1
}

# ─── Install service ──────────────────────────────────────────────────────────
Write-Step "Installing cloudflared service with tunnel token..."
$env:TUNNEL_TOKEN = $TunnelToken
& cloudflared service install $TunnelToken
if ($LASTEXITCODE -ne 0) {
    Write-Fail "cloudflared service install failed (exit $LASTEXITCODE)."
    exit 1
}
Write-OK "Service installed."

# ─── Start service ────────────────────────────────────────────────────────────
Write-Step "Starting service..."
Start-Service $ServiceName
Start-Sleep -Seconds 3
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-OK "cloudflared service is running."
    Write-Host "`n  connector.mad4b.com tunnel should resolve within ~30 seconds."
} else {
    Write-Fail "Service did not start. Check: Get-EventLog -LogName System -Source cloudflared -Newest 10"
    exit 1
}

Write-Host "`n[install-local-connector] Done." -ForegroundColor Green
