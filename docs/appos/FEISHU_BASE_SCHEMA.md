# External AppOS Feishu Base Schema

This schema is the operational workspace for the Mora-frozen External AppOS phase.

## Creation Strategy

1. Create one Feishu Base named `Tele-OPC External AppOS`.
2. Create the first table during base creation: `BusinessContracts`.
3. Create the remaining tables with `lark-cli base +table-create`.
4. Store real table IDs in `APPOS_FEISHU_TABLE_MAP_JSON`.
5. Do not store media bytes, secrets, local filesystem paths, signed storage internals, or raw provider tokens in Base.

## Tables

### BusinessContracts

| Field | Type | Notes |
| --- | --- | --- |
| id | text | Primary field, stable AppOS contract id |
| source_channel | select | `feishu`, `telegram`, `web`, `mora_sim`, `system` |
| source_message_id | text | External channel message/event id |
| goal | text | Human-readable goal |
| domain | select | `content`, `social_distribution`, `crm`, `finance`, `calendar`, `mail`, `browser`, `ops`, `project`, `memory`, `unknown` |
| inputs_json | text | JSON string |
| success_criteria | text | JSON string array |
| risk_level | select | `low`, `medium`, `high` |
| approval_required | checkbox | Whether execution is blocked by approval |
| status | select | `planned`, `running`, `waiting_approval`, `done`, `failed`, `cancelled` |
| created_at | datetime | Contract creation time |

### WorkflowDefinitions

| Field | Type | Notes |
| --- | --- | --- |
| id | text | Stable workflow definition id |
| provider | select | `dify`, `n8n`, `builtin`, `http_tool` |
| name | text | Display name |
| domain | select | Same domain options as BusinessContracts |
| capability_tags | text | JSON string array |
| input_schema_json | text | JSON schema string |
| output_schema_json | text | JSON schema string |
| risk_level | select | `low`, `medium`, `high` |
| approval_policy | select | `never`, `before_run`, `before_external_write`, `always` |
| enabled | checkbox | Router can use this definition |

### WorkflowRuns

| Field | Type | Notes |
| --- | --- | --- |
| id | text | Stable run id |
| workflow_definition_id | text | WorkflowDefinitions.id |
| business_contract_id | text | BusinessContracts.id |
| provider | select | `dify`, `n8n`, `builtin`, `http_tool` |
| status | select | `planned`, `queued`, `running`, `waiting_callback`, `reviewing`, `done`, `failed`, `cancelled` |
| input_json | text | JSON string |
| output_json | text | JSON string |
| error_json | text | JSON string |
| trace_id | text | Trace id |
| external_execution_id | text | n8n/Dify execution id |
| created_at | datetime | Created time |
| updated_at | datetime | Updated time |

### ContentCampaigns

| Field | Type | Notes |
| --- | --- | --- |
| id | text | Stable campaign id |
| contract_id | text | BusinessContracts.id |
| name | text | Campaign name |
| objective | text | Goal/objective |
| platforms | text | JSON string array |
| target_audience | text | Audience description |
| status | select | `planned`, `generating`, `reviewing`, `approved`, `running`, `done`, `failed`, `cancelled` |
| owner_notes | text | Owner notes |

### ContentPosts

| Field | Type | Notes |
| --- | --- | --- |
| id | text | Stable content post id |
| campaign_id | text | ContentCampaigns.id |
| platform | select | `douyin`, `xiaohongshu`, `kuaishou`, `shipinhao`, `wechat_mp`, `bilibili`, `other` |
| account | text | Account/persona |
| title | text | Platform title |
| script | text | Script/body |
| caption | text | Caption/description |
| tags | text | JSON string array |
| status | select | `planned`, `drafted`, `reviewing`, `approved`, `video_ready`, `published`, `failed`, `cancelled` |
| approval_id | text | Approvals.id |
| artifact_id | text | Artifacts.id |
| publish_url | text | External post URL |
| metrics_json | text | JSON string |

### Artifacts

| Field | Type | Notes |
| --- | --- | --- |
| id | text | Stable artifact id |
| type | select | `script`, `caption`, `image`, `audio`, `capcut_draft`, `preview_video`, `final_video`, `document`, `webpage`, `code`, `metadata` |
| title | text | Display title |
| source_run_id | text | WorkflowRuns.id |
| customer_or_project_ref | text | Optional external object ref |
| storage_ref | text | Storage object reference, not raw secret |
| preview_url | text | User-safe preview URL |
| draft_url | text | capcut-mate draft URL |
| version | number | Artifact version |
| status | select | `created`, `reviewing`, `approved`, `archived`, `failed` |

### Approvals

| Field | Type | Notes |
| --- | --- | --- |
| id | text | Stable approval id |
| object_type | select | `business_contract`, `workflow_run`, `content_post`, `artifact`, `repair_plan`, `external_publish` |
| object_id | text | Target object id |
| action | text | Action being approved |
| risk_level | select | `low`, `medium`, `high` |
| status | select | `requested`, `approved`, `rejected`, `expired`, `cancelled` |
| reason | text | Reason shown to owner |
| requested_at | datetime | Request time |
| decided_at | datetime | Decision time |
| decided_by_channel | select | `feishu`, `telegram`, `web`, `system` |

### ApplicationEvents

| Field | Type | Notes |
| --- | --- | --- |
| id | text | Stable event id |
| event_type | select | AppOS event type |
| local_object_type | text | Object type |
| local_object_id | text | Object id |
| summary | text | User-safe summary |
| evidence_refs_json | text | JSON string |
| external_refs_json | text | JSON string |
| timestamp | datetime | Event time |

### ExternalResources

| Field | Type | Notes |
| --- | --- | --- |
| id | text | Stable resource id |
| source_url | text | Original URL |
| source_type | select | `direct_url`, `cloud_drive`, `video_platform`, `rss`, `manual_upload`, `unknown` |
| provider | text | Provider name |
| license | text | License/source evidence summary |
| probe_status | select | `pending`, `probing`, `ready`, `blocked`, `failed` |
| duration_seconds | number | Media duration |
| size_bytes | number | Media size |
| checksum | text | Hash if available |
| storage_ref | text | Storage reference |
| risk_level | select | `low`, `medium`, `high` |

### MediaJobs

| Field | Type | Notes |
| --- | --- | --- |
| id | text | Stable media job id |
| resource_id | text | ExternalResources.id |
| operation | select | `transcribe`, `clip`, `render_preview`, `render_hls`, `publish_ready_asset` |
| status | select | `planned`, `queued`, `running`, `waiting_callback`, `done`, `failed`, `cancelled` |
| input_json | text | JSON string |
| output_json | text | JSON string |
| evidence_refs_json | text | JSON string |
| created_at | datetime | Created time |
| updated_at | datetime | Updated time |

### FailureEvents

| Field | Type | Notes |
| --- | --- | --- |
| id | text | Stable failure id |
| source | select | `mora`, `tele-opc`, `dify`, `n8n`, `feishu`, `telegram`, `web`, `provider` |
| object_type | select | `workflow_run`, `api_call`, `code_test`, `frontend_error`, `user_report`, `provider_error`, `integration_health` |
| object_id | text | Object id |
| symptom | text | User-safe symptom |
| severity | select | `low`, `medium`, `high`, `critical` |
| evidence_refs_json | text | JSON string |
| first_seen_at | datetime | First seen time |
| status | select | `open`, `diagnosed`, `repair_planned`, `verified`, `resolved`, `ignored` |

## CPS Matrix Tables

These tables support the first real CPS matrix workflow. They keep product, material, account, editing, and publishing data outside generic tasks.

### CPSProducts

| Field | Type | Notes |
| --- | --- | --- |
| id | text | Stable product id |
| name | text | Product or offer name |
| cps_url | text | Product/CPS link |
| commission_rate | number | Commission rate as decimal |
| price | number | Product price |
| core_selling_points | text | JSON or newline-separated selling points |
| forbidden_claims | text | Claims the AI/editor must not use |
| status | select | `new`, `ready`, `paused`, `blocked` |
| created_at | datetime | Created time |

### SourceMaterials

| Field | Type | Notes |
| --- | --- | --- |
| id | text | Stable material id |
| product_id | text | CPSProducts.id |
| source_type | select | `manual_upload`, `product_page`, `cloud_drive`, `video_platform`, `image_url`, `local_storage` |
| source_url | text | URL/path reference; not raw bytes |
| license_status | select | `unknown`, `owned`, `authorized`, `platform_allowed`, `blocked` |
| usage_notes | text | Source/evidence notes |
| status | select | `new`, `ready`, `needs_review`, `blocked`, `failed` |
| storage_ref | text | Storage/cache reference |
| created_at | datetime | Created time |

### PlatformAccounts

| Field | Type | Notes |
| --- | --- | --- |
| id | text | Stable account id |
| platform | select | `douyin`, `xiaohongshu`, `kuaishou`, `shipinhao`, `wechat_mp`, `bilibili`, `other` |
| account_name | text | Account display name |
| persona | text | Account persona/positioning |
| content_style | text | Default content style |
| daily_limit | number | Safe daily publish cap |
| publish_window | text | Preferred publish windows |
| status | select | `active`, `paused`, `warming`, `blocked` |

### EditingTemplates

| Field | Type | Notes |
| --- | --- | --- |
| id | text | Stable template id |
| name | text | Template display name |
| format | select | `short_video_9_16`, `xhs_note`, `wechat_article`, `mixed` |
| duration_seconds | number | Target video duration |
| hook_style | text | Hook rule |
| shot_plan_json | text | JSON shot plan |
| caption_style_json | text | JSON caption rules |
| capcut_params_json | text | JSON capcut-mate parameters |
| status | select | `active`, `draft`, `paused` |

### PublishRecords

| Field | Type | Notes |
| --- | --- | --- |
| id | text | Stable publish record id |
| content_post_id | text | ContentPosts.id |
| product_id | text | CPSProducts.id |
| platform | select | Target platform |
| account_id | text | PlatformAccounts.id |
| publish_url | text | Published URL after approval |
| published_at | datetime | Publish time |
| views | number | Metric |
| likes | number | Metric |
| comments | number | Metric |
| clicks | number | CPS clicks |
| orders | number | CPS orders |
| commission_amount | number | Commission amount |
| metrics_json | text | Raw metrics snapshot |

## Sample Records

Use these after table creation to validate cross-table state:

```json
{
  "BusinessContracts": {
    "id": "bc_sample_cps_matrix",
    "source_channel": "feishu",
    "source_message_id": "sample",
    "goal": "Create a CPS content matrix for one product category",
    "domain": "social_distribution",
    "inputs_json": "{\"topic\":\"AI tools CPS\",\"platforms\":[\"douyin\",\"xiaohongshu\",\"wechat_mp\"]}",
    "success_criteria": "[\"Create campaign\",\"Create platform posts\",\"Request approval before publish\"]",
    "risk_level": "medium",
    "approval_required": true,
    "status": "planned",
    "created_at": "2026-06-24 00:00"
  }
}
```
