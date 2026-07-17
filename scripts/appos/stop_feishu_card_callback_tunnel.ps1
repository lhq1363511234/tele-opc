param(
  [string]$RuntimeDir = "runtime/cloudflared"
)

$ErrorActionPreference = "Stop"

$pidFile = Join-Path $RuntimeDir "feishu-card-callback-tunnel.pid"
if (-not (Test-Path -LiteralPath $pidFile)) {
  Write-Output "No tunnel pid file found."
  exit 0
}

$pidValue = Get-Content -LiteralPath $pidFile -Raw
if ($pidValue -notmatch '^\d+$') {
  Remove-Item -LiteralPath $pidFile -Force
  Write-Output "Invalid pid file removed."
  exit 0
}

$process = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
if ($process) {
  Stop-Process -Id $process.Id -Force
  Write-Output "Stopped tunnel pid=$($process.Id)"
} else {
  Write-Output "Tunnel process not running."
}

Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
