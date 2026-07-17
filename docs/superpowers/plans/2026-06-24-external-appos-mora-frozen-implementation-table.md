# External AppOS Mora-Frozen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Mora-compatible external AppOS layer for a one-person company system while keeping Mora unchanged.

**Architecture:** Feishu/opctoai and Telegram act as owner-facing surfaces. Tele-OPC External AppOS owns business objects, workflow runs, approvals, artifacts, events, and audit. n8n is the workflow orchestration bus, Dify is the AI workflow provider, and capcut-mate is a media/video production tool.

**Tech Stack:** Tele-OPC TypeScript backend, Feishu CLI/OpenAPI, Feishu Base, Telegram Bot/Web App, n8n, Dify, capcut-mate FastAPI, local media worker tools, structured JSON contracts.

---

## Non-Negotiable Scope

| Rule | Decision |
| --- | --- |
| Mora code | Do not modify Mora in this phase. |
| Mora memory | Do not write Mora memory. Store only AppOS memory candidates. |
| Mora identity | Do not describe, rewrite, or simulate Mora SelfCore. |
| Main host | Tele-OPC External AppOS is the temporary application host. |
| Future Mora bridge | All contracts must stay compatible with the Mora integration design. |
| Workflow engine | n8n is the main orchestration layer. |
| AI workflow | Dify is called by n8n/AppOS as an AI capability provider. |
| Business database | Feishu Base is the first operational database and user-visible workspace. |
| Large media | Store/stream through media storage. Do not push large binaries through Feishu chat or Telegram chat. |
| External publishing | No automatic external publishing before explicit approval. |

## Target Architecture

```text
Owner
  -> Feishu opctoai / Telegram / Web Console
  -> AppOS Gateway
  -> Contract Normalizer
  -> BusinessContract
  -> Workflow Router
  -> n8n
      -> Dify
      -> capcut-mate
      -> Feishu Base
      -> Telegram Cards
      -> Browser/Media/Email tools
  -> Result Normalizer
  -> ApplicationEvent Ledger
  -> Approval / Artifact / WorkflowRun / FailureEvent
  -> Feishu cards + Telegram cards + Web status
```

## Implementation Table

| Phase | Name | Objective | Main Outputs | Tools | Acceptance |
| --- | --- | --- | --- | --- | --- |
| P0 | Inventory and freeze line | Confirm what exists and mark Mora as out of scope. | Integration inventory, env map, service ports, credential list without secrets. | PowerShell, repo inspection, Feishu CLI, n8n UI, Dify UI. | A written inventory exists; no Mora files are changed. |
| P1 | Feishu Base schema | Create the operational database for AppOS. | Base tables: BusinessContracts, WorkflowDefinitions, WorkflowRuns, ContentCampaigns, ContentPosts, Artifacts, Approvals, ApplicationEvents, ExternalResources, MediaJobs, FailureEvents. | Feishu CLI/Base. | New records can be created and linked across tables. |
| P2 | AppOS contract layer | Define stable JSON contracts independent of channels. | JSON schemas for ChannelMessage, BusinessContract, WorkflowRun, ApplicationEvent, ExternalObjectRef, MemoryCandidate, FailureEvent. | Tele-OPC backend. | Invalid payloads are rejected; valid sample payloads produce stored records. |
| P3 | Feishu opctoai inbound | Turn Feishu commands into AppOS contracts. | Feishu message/event receiver, command parser, contract creation, status reply card. | Feishu CLI/OpenAPI, Tele-OPC. | A Feishu command creates BusinessContract + ApplicationEvent + reply card. |
| P4 | Telegram inbound and approval cards | Use Telegram for quick command, approval, and notification. | Telegram card renderer, approve/reject callbacks, task/result cards. | Telegram Bot API, Tele-OPC. | Telegram approval creates Approval event and updates Feishu/Base state. |
| P5 | Workflow registry | Register n8n, Dify, builtin, and http_tool capabilities. | WorkflowDefinitions table, provider config records, schema mapping, risk policy. | Tele-OPC, Feishu Base. | AppOS can select a workflow by domain/capability tag and create WorkflowRun. |
| P6 | n8n orchestration MVP | Make n8n the main execution bus. | n8n webhook workflow, run status callbacks, error callback, retry hook. | n8n, Tele-OPC webhook endpoints. | WorkflowRun moves planned -> running -> done/failed with trace id. |
| P7 | Dify connector MVP | Use Dify for AI planning/generation. | Dify workflow call, output validator, normalized output mapper. | Dify API, n8n or Tele-OPC connector. | Dify output becomes Artifact or ContentPost without raw prompt leakage. |
| P8 | Content matrix MVP | Implement the first real business workflow. | ContentCampaign, ContentPosts, scripts, titles, platform variants, approval queue. | Feishu Base, n8n, Dify. | One command creates a campaign with reviewable posts for multiple platforms. |
| P9 | capcut-mate video draft MVP | Generate short-video drafts from approved content. | Draft URL, material mapping, media artifact record, preview/status card. | capcut-mate, n8n, Feishu Base. | Approved post can produce a capcut-mate draft_url and save it in Artifacts. |
| P10 | Asset and media gateway | Track media resources and generated outputs safely. | ExternalResource, ResourceJob, MediaJob, MediaArtifact, preview links. | Media worker, ffmpeg/ffprobe, storage, n8n. | Media jobs never expose local paths or secrets in cards. |
| P11 | Approval and risk gates | Block risky writes until owner approves. | Approval policy engine, approval cards, audit log. | Tele-OPC, Feishu, Telegram. | External publish/payment/delete/high-risk repair cannot run without approval. |
| P12 | Failure and repair MVP | Normalize failures and propose safe repairs. | FailureEvent, Diagnosis, RepairPlan, RepairVerification, RepairPolicy candidate. | Tele-OPC, n8n test runs, Dify sample runs. | Low-risk retry can run after verification; high-risk repair asks approval. |
| P13 | Web console status | Provide operator dashboard without replacing Feishu. | Cockpit views for runs, approvals, artifacts, failures, content campaigns. | Tele-OPC web console. | Owner can inspect active runs and approve/reject from Web. |
| P14 | Mora bridge readiness | Prepare future Mora integration without touching Mora. | `/api/appos/intents`, `/api/appos/events`, `/api/appos/runs/:id`, sample Mora-compatible fixtures. | Tele-OPC API. | A simulated Mora BusinessContract can drive the same workflow path. |

## Feishu Base Tables

| Table | Purpose | Required Fields |
| --- | --- | --- |
| BusinessContracts | Stores normalized owner intent. | id, source_channel, source_message_id, goal, domain, inputs_json, success_criteria, risk_level, approval_required, status, created_at |
| WorkflowDefinitions | Registry of callable capabilities. | id, provider, name, domain, capability_tags, input_schema_json, output_schema_json, risk_level, approval_policy, enabled |
| WorkflowRuns | Tracks every execution. | id, workflow_definition_id, business_contract_id, provider, status, input_json, output_json, error_json, trace_id, external_execution_id, created_at, updated_at |
| ContentCampaigns | Groups matrix content work. | id, contract_id, name, objective, platforms, target_audience, status, owner_notes |
| ContentPosts | One platform-specific content item. | id, campaign_id, platform, account, title, script, caption, tags, status, approval_id, artifact_id, publish_url, metrics_json |
| Artifacts | Stores generated assets and delivery outputs. | id, type, title, source_run_id, customer_or_project_ref, storage_ref, preview_url, draft_url, version, status |
| Approvals | Tracks owner decisions. | id, object_type, object_id, action, risk_level, status, reason, requested_at, decided_at, decided_by_channel |
| ApplicationEvents | Append-only event ledger. | id, event_type, local_object_type, local_object_id, summary, evidence_refs_json, external_refs_json, timestamp |
| ExternalResources | Tracks source resources. | id, source_url, source_type, provider, license, probe_status, duration_seconds, size_bytes, checksum, storage_ref, risk_level |
| MediaJobs | Tracks media processing. | id, resource_id, operation, status, input_json, output_json, evidence_refs_json, created_at, updated_at |
| FailureEvents | Stores normalized failures. | id, source, object_type, object_id, symptom, severity, evidence_refs_json, first_seen_at, status |

## n8n Workflow Table

| Workflow | Trigger | Main Steps | Output |
| --- | --- | --- | --- |
| `inbound.feishu.command` | Feishu/opctoai event or webhook | Normalize message, create BusinessContract, route workflow, reply card. | BusinessContract + ApplicationEvent |
| `inbound.telegram.command` | Telegram bot webhook | Normalize message, create BusinessContract, route workflow, reply card. | BusinessContract + ApplicationEvent |
| `content.matrix.plan` | BusinessContract domain=`social_distribution` | Load product/campaign context, call Dify planner, create ContentCampaign and ContentPosts. | Campaign + post drafts |
| `content.post.generate` | ContentPost status=`planned` | Call Dify writer, validate title/script/tags, update post. | Reviewable post |
| `approval.request` | Object requires approval | Create Approval, send Feishu card, send Telegram card. | Waiting approval |
| `video.draft.create` | Approved ContentPost | Generate/resolve audio and visuals, call capcut-mate create_draft/easy_create_material/save_draft. | Artifact with draft_url |
| `artifact.notify` | Artifact created | Create ApplicationEvent, update Feishu Base, send cards. | Notification cards |
| `workflow.failure.normalize` | Any workflow error | Create FailureEvent, classify cause, propose retry/repair. | FailureEvent + optional RepairPlan |
| `workflow.repair.low_risk` | Verified low-risk repair | Replay sample input, apply retry/config mapping if safe. | Repaired run or failed verification |

## API Endpoint Table

| Endpoint | Method | Purpose | Request | Response |
| --- | --- | --- | --- | --- |
| `/api/appos/contracts` | POST | Create BusinessContract from current non-Mora gateway. | BusinessContract-compatible JSON | BusinessContract + ApplicationEvent |
| `/api/appos/intents` | POST | Future Mora entrypoint. Accepts MoraIntentPacket. | MoraIntentPacket | BusinessContract or clarification-required error |
| `/api/appos/events` | POST | Accept workflow/tool result events. | ApplicationEvent-compatible JSON | Stored event |
| `/api/appos/runs/:id` | GET | Query WorkflowRun status. | run id | WorkflowRun + linked events |
| `/api/appos/approvals/:id/decision` | POST | Approve/reject an action. | decision, channel, actor ref | Approval event + updated object |
| `/api/appos/webhooks/n8n/run-callback` | POST | Receive n8n status and output. | run id, status, output/error | Updated WorkflowRun |
| `/api/appos/webhooks/telegram` | POST | Receive Telegram commands/callbacks. | Telegram update | ChannelMessage result |
| `/api/appos/webhooks/feishu` | POST | Receive Feishu commands/events. | Feishu event | ChannelMessage result |

## CPS Matrix First Use Case

| Step | Action | Data Written | Approval |
| --- | --- | --- | --- |
| 1 | Owner says in Feishu: create CPS matrix for product/category. | BusinessContract | No |
| 2 | n8n calls Dify to produce campaign plan. | ContentCampaign + ContentPosts | No |
| 3 | Dify generates platform-specific scripts. | ContentPosts + Artifacts(type=`script`) | No |
| 4 | AppOS sends review cards to Feishu/Telegram. | Approvals | Yes, before video generation if cost/risk is medium |
| 5 | Approved post triggers capcut-mate draft generation. | Artifact(type=`capcut_draft`) | No external publish yet |
| 6 | Owner checks draft/preview. | ApplicationEvent | Yes, before publishing |
| 7 | Publish manually or through future browser workflow. | Publish record / ContentPost status | Always yes |
| 8 | Metrics are entered/imported. | ContentPost.metrics_json | No |
| 9 | Dify analyzes winners and suggests next batch. | MemoryCandidate + next BusinessContract candidate | Owner confirms |

## Execution Checklist

### Task 1: Inventory and Environment Map

**Files:**
- Create: `docs/appos/ENVIRONMENT_INVENTORY.md`

- [x] Record running services: Tele-OPC, capcut-mate, n8n, Dify, Feishu CLI, Telegram bot.
- [x] Record local URLs and ports without secrets.
- [x] Record credential locations by name only.
- [x] Record current capcut-mate verification command and result.

### Task 2: Feishu Base Schema

**Files:**
- Create: `docs/appos/FEISHU_BASE_SCHEMA.md`
- Optional script: `scripts/appos/create_feishu_base_schema.ts`

- [x] Create the Feishu Base tables listed above.
- [x] Create linked-record fields between contracts, runs, campaigns, posts, artifacts, approvals, and events.
- [x] Create status single-select fields with fixed options.
- [x] Add sample records for one content campaign.
- [x] Verify opctoai can read or link to these records.

### Task 3: Contract Schema Package

**Files:**
- Create: `src/appos/contracts/types.ts`
- Create: `src/appos/contracts/schemas.ts`
- Test: `tests/appos/contracts.test.ts`

- [x] Define TypeScript types for BusinessContract, WorkflowRun, ApplicationEvent, ExternalObjectRef, MemoryCandidate, FailureEvent.
- [x] Define runtime validators.
- [x] Add tests for valid and invalid sample contracts.
- [x] Add fixtures that match the Mora integration design.

### Task 4: AppOS Gateway

**Files:**
- Create: `src/appos/gateway/routes.ts`
- Create: `src/appos/gateway/service.ts`
- Test: `tests/appos/gateway.test.ts`

- [x] Implement `POST /api/appos/contracts`.
- [x] Implement `POST /api/appos/events`.
- [x] Implement `GET /api/appos/runs/:id`.
- [x] Store events append-only.
- [x] Reject invalid contracts with explicit missing fields.

### Task 5: Feishu/opctoai Inbound

**Files:**
- Create: `src/appos/channels/feishu.ts`
- Create: `src/appos/channels/channel-message.ts`
- Test: `tests/appos/feishu-channel.test.ts`

- [x] Normalize Feishu events into ChannelMessage.
- [x] Convert allowed owner commands into BusinessContract.
- [x] Store source message refs.
- [x] Reply with a Feishu card containing status and links.

### Task 6: Telegram Cards

**Files:**
- Create: `src/appos/channels/telegram.ts`
- Create: `src/appos/cards/telegram-card-renderer.ts`
- Test: `tests/appos/telegram-card.test.ts`

- [x] Render task status card.
- [x] Render approval card.
- [x] Handle approve/reject callbacks.
- [x] Create ApplicationEvent for every decision.

### Task 7: Workflow Registry and Router

**Files:**
- Create: `src/appos/workflows/registry.ts`
- Create: `src/appos/workflows/router.ts`
- Test: `tests/appos/workflow-router.test.ts`

- [x] Load WorkflowDefinitions from config or Feishu Base.
- [x] Select workflow by domain and capability tags.
- [x] Create WorkflowRun with trace id.
- [x] Enforce approval policy before external write.

### Task 8: n8n Connector

**Files:**
- Create: `src/appos/connectors/n8n.ts`
- Create: `docs/appos/N8N_WORKFLOWS.md`
- Test: `tests/appos/n8n-connector.test.ts`

- [x] Call n8n webhook with run id and input.
- [x] Receive callback through `/api/appos/webhooks/n8n/run-callback`.
- [x] Normalize success output into ApplicationEvent.
- [x] Normalize failure output into FailureEvent.
- [ ] Import real n8n workflows into a running n8n instance.
- [ ] Run `content.matrix.plan` against a real Dify workflow.
- [ ] Run `video.draft.create` against capcut-mate with real approved material.

### Task 9: Dify Connector

**Files:**
- Create: `src/appos/connectors/dify.ts`
- Create: `docs/appos/DIFY_WORKFLOWS.md`
- Test: `tests/appos/dify-connector.test.ts`

- [x] Register Dify workflow ids by capability.
- [x] Call Dify with BusinessContract inputs.
- [x] Validate structured output.
- [x] Reject malformed outputs into FailureEvent.
- [ ] Create or import the actual Dify content matrix workflow.
- [ ] Verify Dify returns platform-specific JSON, not freeform Markdown.

### Task 10: capcut-mate Connector

**Files:**
- Create: `src/appos/connectors/capcut-mate.ts`
- Create: `docs/appos/CAPCUT_MATE_USAGE.md`
- Test: `tests/appos/capcut-mate-connector.test.ts`

- [x] Call `/create_draft`.
- [x] Call `/easy_create_material`.
- [x] Call `/save_draft`.
- [x] Store returned draft_url as Artifact.
- [x] Fail safely if capcut-mate is offline.

### Task 11: Content Matrix MVP

**Files:**
- Create: `src/appos/domains/content/content-service.ts`
- Create: `src/appos/domains/content/content-types.ts`
- Test: `tests/appos/content-matrix.test.ts`

- [x] Convert content BusinessContract into ContentCampaign.
- [x] Generate ContentPosts for selected platforms/accounts in local service logic.
- [x] Attach Dify scripts and titles to posts in local service logic.
- [ ] Write real ContentCampaign and ContentPosts rows from a live n8n/Dify run.
- [ ] Send live approval cards through Feishu/Telegram.
- [ ] Generate a capcut draft only after approval, using real material source.

### Task 12: Failure and Repair MVP

**Files:**
- Create: `src/appos/repair/failure-service.ts`
- Create: `src/appos/repair/repair-service.ts`
- Test: `tests/appos/repair.test.ts`

- [x] Convert connector errors into FailureEvent.
- [x] Classify schema/config/permission/network/provider-output failures.
- [x] Generate RepairPlan for low-risk retry and mapping fixes.
- [x] Require approval for workflow/prompt/config changes.
- [x] Store successful fixes as RepairPolicy candidates.

### Task 13: Mora-Compatible Bridge Fixtures

**Files:**
- Create: `docs/appos/MORA_BRIDGE_READINESS.md`
- Create: `tests/fixtures/mora-intent-content-matrix.json`
- Test: `tests/appos/mora-compatibility.test.ts`

- [x] Add sample MoraIntentPacket for content matrix.
- [x] Verify it becomes the same BusinessContract as current Feishu command path.
- [x] Verify ApplicationEvent output matches the integration design.
- [x] Confirm no code imports or modifies Mora.

## Milestones

| Milestone | Done When |
| --- | --- |
| M1: Data foundation | Feishu Base tables exist and can store sample contracts/runs/events. |
| M2: Command to contract | Feishu/opctoai command creates a BusinessContract and status card. |
| M3: Workflow run | BusinessContract triggers n8n and returns WorkflowRun status. |
| M4: AI generation | n8n calls Dify and stores generated ContentPosts/Artifacts. |
| M5: Video draft | Approved ContentPost creates capcut-mate draft_url. |
| M6: Approval gate | Publish/high-risk actions are blocked until approval. |
| M7: Failure loop | Failed workflow creates FailureEvent and retry/repair path. |
| M8: Mora-ready | Simulated MoraIntentPacket uses the same AppOS path. |

## Risk Table

| Risk | Impact | Control |
| --- | --- | --- |
| Tool sprawl | System becomes hard to reason about. | n8n is the only orchestrator; Dify/capcut/Feishu are providers. |
| Dify output malformed | Bad posts or broken workflow runs. | Validate output schema before writing business objects. |
| Feishu field ids drift | Sync failures. | Store field mapping config and create FailureEvent on mismatch. |
| Accidental external publishing | Business risk. | Approval required for external write actions. |
| Large media in chat | Slow/failing chat surfaces. | Store media as ExternalResource/Artifact and send links only. |
| Mora coupling too early | Breaks Mora identity/cognitive boundary. | No Mora imports, no Mora memory writes, only compatible fixtures. |
| Hidden secrets in events/cards | Security issue. | Redact tokens, local paths, signed internals before event/card output. |

## Immediate Next Actions

| Order | Action | Output |
| --- | --- | --- |
| 1 | Confirm Feishu Base app/table target for AppOS. | Base URL/token or project location. |
| 2 | Create Base schema. | Operational tables. |
| 3 | Register first workflows in n8n. | `inbound.feishu.command`, `content.matrix.plan`, `video.draft.create`. |
| 4 | Register first Dify workflow. | Content matrix planner/writer. |
| 5 | Connect capcut-mate endpoint. | Draft generation test. |
| 6 | Run one end-to-end CPS content matrix job. | Campaign, posts, approval, draft_url, events. |

## Reality Check Added 2026-06-24

Previous checklist marks covered code scaffolding and connector tests, not a live CPS matrix operation. The system must not be reported as complete until the unchecked workflow import/run items above pass with real user-provided platform, product, source material, and editing rules.
