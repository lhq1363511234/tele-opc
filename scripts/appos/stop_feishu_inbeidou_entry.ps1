param(
  [string]$RuntimeDir = "runtime/feishu-entry"
)

$ErrorActionPreference = "Stop"

foreach ($name in @("feishu-inbeidou-listener.pid", "tele-opc-backend.pid")) {
  $pidFile = Join-Path $RuntimeDir $name
  if (-not (Test-Path -LiteralPath $pidFile)) { continue }
  $pidValue = Get-Content -LiteralPath $pidFile -Raw
  if ($pidValue -match '^\d+$') {
    $process = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
    if ($process) {
      Stop-Process -Id $process.Id -Force
      Write-Output "stopped $name pid=$($process.Id)"
    }
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/appos/stop_feishu_card_callback_tunnel.ps1
