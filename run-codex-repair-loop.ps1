param(
  [ValidateSet("quick", "full")]
  [string]$Mode = "full",
  [int]$MaxIterations = 3,
  [switch]$Repair,
  [switch]$CheckUpdates
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot

$argsList = @("run", "codex:repair-loop", "--", "--max-iterations", "$MaxIterations")

if ($Mode -eq "full") {
  $argsList += "--full"
}

if ($Repair) {
  $argsList += "--repair"
}

if ($CheckUpdates) {
  $argsList += "--check-updates"
}

Write-Host "Running: npm $($argsList -join ' ')"
& npm @argsList
exit $LASTEXITCODE
