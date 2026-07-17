# External AppOS n8n Workflows

n8n is the orchestration bus for External AppOS.

Current state: n8n MCP/API authorization is not available in this environment, so workflows are prepared as local import templates rather than created in a running n8n instance.

## Required Webhooks

| Workflow | Direction | Purpose |
| --- | --- | --- |
| `inbound.feishu.command` | Feishu/opctoai -> AppOS | Normalize owner command and create BusinessContract |
| `inbeidou.cps.ingest` | AppOS -> n8n -> CloakBrowser script -> Feishu/Dify | Collect Beidou CPS tasks, prepare downstream payloads, optionally write Feishu and trigger Dify |
| `content.matrix.plan` | AppOS -> n8n -> Dify | Plan campaign and post variants |
| `video.draft.create` | AppOS -> n8n -> capcut-mate | Create capcut draft from approved content |
| `workflow.failure.normalize` | n8n -> AppOS | Report failed execution |

## Import Templates

Import these files into n8n:

| Workflow | File |
| --- | --- |
| `inbeidou.cps.ingest` | `docs/appos/n8n-import/inbeidou.cps.ingest.json` |
| `content.matrix.plan` | `docs/appos/n8n-import/content.matrix.plan.json` |
| `video.draft.create` | `docs/appos/n8n-import/video.draft.create.json` |
| `approval.request` | `docs/appos/n8n-import/approval.request.json` |
| `workflow.failure.normalize` | `docs/appos/n8n-import/workflow.failure.normalize.json` |

Required n8n environment variables:

```dotenv
APPOS_API_BASE_URL=http://127.0.0.1:3100
APPOS_DIFY_API_URL=https://api.dify.ai
APPOS_DIFY_API_KEY=replace_me
APPOS_DIFY_INBEIDOU_WEBHOOK_URL=replace_me
APPOS_REPO_DIR=B:\Cir\CodexProjects\tele-opc
CAPCUT_MATE_BASE_URL=http://127.0.0.1:30000
CLOAKBROWSER_MANAGER=http://127.0.0.1:8080
CLOAKBROWSER_PROFILE=replace_me
CPS_OUTPUT_DIR=runtime/inbeidou-cps-output
FEISHU_BASE_TOKEN=OIbnbkS2sa9jBrsQtqzcMj8pnep
APPOS_FEISHU_BASE_APP_TOKEN=OIbnbkS2sa9jBrsQtqzcMj8pnep
APPOS_FEISHU_TABLE_MAP_JSON={"CPSProducts":"tbl18D4jhOy76S8d","SourceMaterials":"tblxg3MPIyRSlIgm","PublishRecords":"tblAThebEIdZnWnm"}
```

The Feishu Base display names are Chinese, but n8n/AppOS should pass stable logical names or table IDs. Current display names: `CPS商品`, `源素材`, `发布记录`.

## AppOS -> n8n Payload

```json
{
  "runId": "run_0001",
  "traceId": "trace_0001",
  "input": {
    "topic": "AI tools CPS"
  }
}
```

## n8n -> AppOS Callback

Target endpoint:

```text
POST /api/appos/webhooks/n8n/run-callback
```

Expected payload:

```json
{
  "runId": "run_0001",
  "status": "done",
  "output": {
    "artifactId": "art_001"
  },
  "externalExecutionId": "exec_001"
}
```

Failures should use:

```json
{
  "runId": "run_0001",
  "status": "failed",
  "error": {
    "message": "Dify output did not match schema",
    "stage": "dify"
  },
  "externalExecutionId": "exec_001"
}
```

## Completion Boundary

The files above are templates. The workflow is not live until they are imported into n8n, credentials/env values are set, webhooks are enabled, and a sample run reaches AppOS callback successfully.
