param(
  [string]$LocalUrl = "http://127.0.0.1:3000",
  [string]$Hostname = "feishu.opctoai.xyz",
  [string]$ConfigPath = "config/cloudflared/tele-opc-feishu.yml",
  [string]$RuntimeDir = "runtime/cloudflared"
)

$ErrorActionPreference = "Stop"

$cloudflaredCommand = Get-Command cloudflared -ErrorAction SilentlyContinue
$cloudflared = if ($cloudflaredCommand) { $cloudflaredCommand.Source } else { $null }
if (-not $cloudflared) {
  $defaultPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
  if (Test-Path -LiteralPath $defaultPath) {
    $cloudflared = $defaultPath
  }
}
if (-not $cloudflared) {
  throw "cloudflared not found. Install Cloudflare Tunnel first."
}

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
$pidFile = Join-Path $RuntimeDir "feishu-card-callback-tunnel.pid"
$urlFile = Join-Path $RuntimeDir "feishu-card-callback-url.txt"
$outLog = Join-Path $RuntimeDir "feishu-card-callback.out.log"
$errLog = Join-Path $RuntimeDir "feishu-card-callback.err.log"

if (Test-Path -LiteralPath $pidFile) {
  $oldPid = Get-Content -LiteralPath $pidFile -Raw
  if ($oldPid -match '^\d+$') {
    $oldProcess = Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue
    if ($oldProcess) {
      $existingUrl = if (Test-Path -LiteralPath $urlFile) { (Get-Content -LiteralPath $urlFile -Raw).Trim() } else { "" }
      if ($existingUrl -eq "https://$Hostname/api/appos/cps/inbeidou/feishu/card-action") {
        Write-Output "Tunnel already running: pid=$oldPid"
        Write-Output "URL: $existingUrl"
        exit 0
      }
      Stop-Process -Id $oldProcess.Id -Force
    }
  }
}

Remove-Item -LiteralPath $outLog,$errLog,$urlFile -Force -ErrorAction SilentlyContinue
$callbackUrl = "https://$Hostname/api/appos/cps/inbeidou/feishu/card-action"
$args = if (Test-Path -LiteralPath $ConfigPath) {
  @("tunnel", "--config", $ConfigPath, "run")
} else {
  @("tunnel", "--url", $LocalUrl)
}
$process = Start-Process `
  -FilePath $cloudflared `
  -ArgumentList $args `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ASCII

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  if ($process.HasExited) {
    throw "Tunnel exited early. Check $errLog"
  }
  try {
    $response = Invoke-RestMethod `
      -Uri $callbackUrl `
      -Method Post `
      -ContentType "application/json; charset=utf-8" `
      -Body '{"challenge":"tunnel-health"}' `
      -TimeoutSec 5
    if ($response.challenge -eq "tunnel-health") {
      Set-Content -LiteralPath $urlFile -Value $callbackUrl -Encoding ASCII
      Write-Output "pid=$($process.Id)"
      Write-Output "callback_url=$callbackUrl"
      exit 0
    }
  } catch {
    # DNS propagation or tunnel connection may need a few seconds.
  }
}

throw "Tunnel started but callback URL is not healthy yet: $callbackUrl. Check $errLog"
