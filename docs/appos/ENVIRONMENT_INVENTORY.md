# External AppOS Environment Inventory

Date: 2026-06-24

Scope: Mora stays frozen. This inventory covers only Tele-OPC External AppOS, Feishu/opctoai, Telegram, n8n, Dify, and capcut-mate integration points.

## Repository

| Item | Value |
| --- | --- |
| Tele-OPC path | `B:\Cir\CodexProjects\tele-opc` |
| Git status | Not a git repository in this checkout |
| Runtime | Node.js TypeScript project |
| Package manager | npm, package-lock present |
| Test runner | Vitest |
| Server framework | Fastify |
| Runtime validators | zod |
| Mora code | Out of scope; no Mora files are modified |

## Local Services

| Service | Expected URL | Observed Status | Notes |
| --- | --- | --- | --- |
| Tele-OPC API | `http://127.0.0.1:3000` | Not observed on common port scan | Existing project supports `npm run dev` |
| Tele-OPC Web | `http://127.0.0.1:5173` or app API host | Not observed on common port scan | Existing Vite scripts are present |
| capcut-mate | `http://127.0.0.1:30000` | Running, PID observed on port 30000 | `/health` and `create_draft` verified earlier |
| VectCutAPI | `http://127.0.0.1:9001` | Not selected as primary | Superseded by capcut-mate-main |
| n8n | Common local port `5678` | Not observed on common port scan | Treat as external/configured provider until URL is set |
| Dify | Common local/cloud endpoint | Not observed locally | Treat as external/configured provider until URL/API key are set |
| Feishu/Lark CLI | `lark-cli` | Installed at `C:\Users\Cir\AppData\Roaming\npm\lark-cli.ps1` | Profile/app config exists outside this repo |
| Proxy | `http://127.0.0.1:10808` | Present in process environment | Use for network installs/API calls when needed |

## Environment Variables

Secrets are not recorded here. The local `.env` contains values for these integration groups:

| Group | Variables Present |
| --- | --- |
| App | `APP_ENV`, `APP_NAME`, `HOST`, `PORT`, `PUBLIC_BASE_URL`, `APP_ENCRYPTION_KEY`, `LOG_LEVEL` |
| Database | `DATABASE_URL`, `REDIS_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_IDS`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_PROXY_URL` |
| AI | `AI_PROVIDER`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_TIMEOUT_MS` |
| Browser | `BROWSER_HEADLESS`, `BROWSER_STORAGE_DIR`, `BROWSER_SCREENSHOT_DIR`, `BROWSER_ALLOWED_DOMAINS`, `BROWSER_REQUIRE_APPROVAL_FOR_SUBMIT` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` |
| Email | `IMAP_*`, `SMTP_*` |
| Finance | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Codex bridge | `CODEX_BRIDGE_*` |
| Web console | `WEB_CONSOLE_OWNER_TOKEN` |

## Missing External AppOS Configuration

These values need to be added before live provider calls are enabled:

| Variable | Purpose |
| --- | --- |
| `APPOS_N8N_BASE_URL` | n8n API/webhook host |
| `APPOS_N8N_WEBHOOK_SECRET` | Shared secret for n8n callbacks |
| `APPOS_DIFY_BASE_URL` | Dify API host |
| `APPOS_DIFY_API_KEY` | Dify workflow API key |
| `APPOS_CAPCUT_MATE_BASE_URL` | capcut-mate API host, default `http://127.0.0.1:30000` |
| `APPOS_FEISHU_BASE_APP_TOKEN` | Feishu Base app token for AppOS tables |
| `APPOS_FEISHU_TABLE_MAP_JSON` | Table-id mapping after Feishu Base creation |
| `APPOS_TELEGRAM_WEBAPP_URL` | Web App URL used in Telegram cards |

## Verified capcut-mate Commands

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:30000/health'

$body = @{ width = 1080; height = 1920 } | ConvertTo-Json
Invoke-RestMethod `
  -Method Post `
  -Uri 'http://127.0.0.1:30000/openapi/capcut-mate/v1/create_draft' `
  -ContentType 'application/json' `
  -Body $body
```

Expected result: response `code` equals `0`, and `create_draft` returns a `draft_url`.

## Freeze Line

Mora is explicitly frozen for this phase:

- No Mora service code changes.
- No Mora database/schema changes.
- No Mora SelfCore or memory writes.
- No inbound Feishu/Telegram message is claimed to be a Mora `UtteranceNode` yet.
- The AppOS contract names remain Mora-compatible so future Mora integration can replace the temporary AppOS Gateway.

