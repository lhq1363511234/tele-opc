$ErrorActionPreference = "Stop"

$token = [Environment]::GetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", "Process")
if (-not $token) {
  $token = [Environment]::GetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", "User")
}
if (-not $token) {
  $token = [Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "Process")
}
if (-not $token) {
  $token = [Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "User")
}
if (-not $token) {
  Write-Error "Missing ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY. Set it in PowerShell before running this script."
}

$env:ANTHROPIC_AUTH_TOKEN = $token
$env:ANTHROPIC_API_KEY = $token
$env:ANTHROPIC_BASE_URL = "https://anyrouter.top"
$env:HTTPS_PROXY = "http://127.0.0.1:10808"
$env:HTTP_PROXY = "http://127.0.0.1:10808"
$env:NO_PROXY = "localhost,127.0.0.1,::1"

& claude @args --model claude-opus-4-8 --betas context-1m-2025-08-07
exit $LASTEXITCODE
