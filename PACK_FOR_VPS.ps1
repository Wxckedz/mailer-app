# Pack mailer-app for Linux VPS (Windows)
# Run: powershell -ExecutionPolicy Bypass -File PACK_FOR_VPS.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath("Desktop")
$stage = Join-Path $env:TEMP "mailer-app-vps"
$zip = Join-Path $desktop "mailer-app-vps.zip"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

robocopy $root $stage /E /NFL /NDL /NJH /NJS /nc /ns /np `
  /XD node_modules .git logs .cursor `
  /XF *.log | Out-Null

if (-not (Test-Path (Join-Path $stage ".env")) -and (Test-Path (Join-Path $stage ".env.example"))) {
  Copy-Item (Join-Path $stage ".env.example") (Join-Path $stage ".env")
}

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -Force
Remove-Item $stage -Recurse -Force

Write-Host "Packed: $zip"
Write-Host ""
Write-Host "Upload:"
Write-Host "  scp `"$zip`" root@YOUR_VPS_IP:~/"
Write-Host ""
Write-Host "On the VPS:"
Write-Host "  apt update && apt install -y unzip"
Write-Host "  mkdir -p /opt/mailer-app && unzip -o ~/mailer-app-vps.zip -d /opt/mailer-app"
Write-Host "  cd /opt/mailer-app && chmod +x deploy.sh && ./deploy.sh"
