$ErrorActionPreference = "Stop"

$difyApiRoot = "B:\Cir\CodexProjects\dify\api"
$setupScript = "B:\Cir\CodexProjects\tele-opc\scripts\appos\setup_dify_short_drama_workflow.py"
$env:LOG_OUTPUT_FORMAT = "text"
$env:LOG_FORMAT = "%(asctime)s,%(msecs)d %(levelname)-2s [%(filename)s:%(lineno)d] %(req_id)s %(message)s"

Push-Location $difyApiRoot
try {
  uv run python $setupScript
  if ($LASTEXITCODE -ne 0) {
    throw "Dify setup script failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}
