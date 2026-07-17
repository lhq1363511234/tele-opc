param(
  [string]$LocalBaseUrl = "http://127.0.0.1:3000",
  [string]$RuntimeDir = "runtime/feishu-entry"
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
$backendPidFile = Join-Path $RuntimeDir "tele-opc-backend.pid"
$listenerPidFile = Join-Path $RuntimeDir "feishu-inbeidou-listener.pid"
$backendOut = Join-Path $RuntimeDir "backend.out.log"
$backendErr = Join-Path $RuntimeDir "backend.err.log"
$listenerOut = Join-Path $RuntimeDir "listener.out.log"
$listenerErr = Join-Path $RuntimeDir "listener.err.log"

function Test-Backend {
  try {
    $response = Invoke-RestMethod `
      -Uri "$LocalBaseUrl/api/appos/cps/inbeidou/feishu/card-action" `
      -Method Post `
      -ContentType "application/json; charset=utf-8" `
      -Body '{"challenge":"health"}' `
      -TimeoutSec 5
    return $response.challenge -eq "health"
  } catch {
    return $false
  }
}

function Test-PublicCallback {
  param([string]$Url)
  if (-not $Url) { return $false }
  try {
    $response = Invoke-RestMethod `
      -Uri $Url `
      -Method Post `
      -ContentType "application/json; charset=utf-8" `
      -Body '{"challenge":"public-health"}' `
      -TimeoutSec 10
    return $response.challenge -eq "public-health"
  } catch {
    return $false
  }
}

if (-not (Test-Backend)) {
  Remove-Item -LiteralPath $backendOut,$backendErr -Force -ErrorAction SilentlyContinue
  $backend = Start-Process `
    -FilePath "npm" `
    -ArgumentList @("run", "dev") `
    -WorkingDirectory (Get-Location) `
    -WindowStyle Hidden `
    -RedirectStandardOutput $backendOut `
    -RedirectStandardError $backendErr `
    -PassThru
  Set-Content -LiteralPath $backendPidFile -Value $backend.Id -Encoding ASCII

  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline -and -not (Test-Backend)) {
    Start-Sleep -Seconds 1
  }
  if (-not (Test-Backend)) {
    throw "Tele-OPC backend did not become healthy. Check $backendErr"
  }
} else {
  Write-Output "backend=already-online"
}

$callbackUrl = if (Test-Path "runtime/cloudflared/feishu-card-callback-url.txt") {
  (Get-Content -LiteralPath "runtime/cloudflared/feishu-card-callback-url.txt" -Raw).Trim()
} else {
  ""
}
if (Test-PublicCallback -Url $callbackUrl) {
  $tunnelOutput = "tunnel=already-online"
} else {
  $tunnelOutput = & (Join-Path $PSScriptRoot "start_feishu_card_callback_tunnel.ps1") -LocalUrl $LocalBaseUrl
  $callbackUrl = if (Test-Path "runtime/cloudflared/feishu-card-callback-url.txt") {
    (Get-Content -LiteralPath "runtime/cloudflared/feishu-card-callback-url.txt" -Raw).Trim()
  } else {
    ""
  }
}

if (Test-Path -LiteralPath $listenerPidFile) {
  $oldPid = Get-Content -LiteralPath $listenerPidFile -Raw
  if ($oldPid -match '^\d+$' -and (Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue)) {
    Write-Output "listener=already-running pid=$oldPid"
    Write-Output "callback_url=$callbackUrl"
    exit 0
  }
}

Remove-Item -LiteralPath $listenerOut,$listenerErr -Force -ErrorAction SilentlyContinue
$env:APPOS_LOCAL_BASE_URL = $LocalBaseUrl
$listener = Start-Process `
  -FilePath "node" `
  -ArgumentList @("scripts/appos/feishu_inbeidou_command_listener.mjs") `
  -WorkingDirectory (Get-Location) `
  -WindowStyle Hidden `
  -RedirectStandardOutput $listenerOut `
  -RedirectStandardError $listenerErr `
  -PassThru
Set-Content -LiteralPath $listenerPidFile -Value $listener.Id -Encoding ASCII

Write-Output $tunnelOutput
Write-Output "listener=started pid=$($listener.Id)"
Write-Output "callback_url=$callbackUrl"
Write-Output "feishu_command=在目标飞书群发送：选剧"
