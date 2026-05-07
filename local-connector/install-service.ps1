# install-service.ps1 — Run as Administrator
# Installs cloudflared tunnel as a Windows auto-start service

$TunnelId = "95e4ba8c-782b-4819-9f80-04af4457ce73"
$ConfigPath = "$PSScriptRoot\cloudflared-config.yml"

Write-Host "Installing cloudflared service..."
& cloudflared service install
& cloudflared tunnel --config $ConfigPath run $TunnelId

Write-Host "Service installed. Starting..."
Start-Service -Name "Cloudflared"
Write-Host "Done. connector.mad4b.com is now live."
