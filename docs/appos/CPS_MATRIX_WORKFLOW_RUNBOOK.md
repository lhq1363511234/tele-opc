# CPS Matrix Workflow Runbook

Status: workflow templates prepared, not yet live-imported into n8n.

This runbook defines what must be known before AppOS can run a CPS matrix job. It prevents the system from pretending it can publish or cut video when product,素材,平台, and剪辑规则 are missing.

## Required Owner Inputs

| Input | Required | Why |
| --- | --- | --- |
| CPS product/category | Yes | Defines offer, selling points, price, commission, and claim risks. |
| CPS link or product page | Yes | Source of product facts and attribution. |
| Target platforms | Yes | Each platform needs different title, script, caption, tags, and format. |
| Platform accounts | Required before publishing | Account persona and daily limits affect output and cadence. |
| Video material source | Yes for video | Determines download path and license gate. |
| Material license status | Yes for reuse | Blocks unauthorized remixing or redistribution. |
| Editing style | Yes for video | Selects shot plan and capcut template. |
| Publish policy | Yes | Default is draft/review only, never auto-publish. |

## Source Material Policy

Supported sources:

- `manual_upload`: owner provides local/Feishu/cloud files.
- `product_page`: product images/video from CPS page, only if platform terms allow reuse.
- `cloud_drive`: Feishu Drive, Aliyun Drive, Baidu Netdisk, or other owner-controlled storage.
- `video_platform`: platform URL, must have explicit permission or only be used as reference.
- `image_url`: direct image URLs with known usage rights.
- `local_storage`: already downloaded and tracked by AppOS.

Rules:

- Unknown license status creates `SourceMaterials.status=needs_review`.
- Video generation is blocked if no usable `audio_url` plus `video_url` or `image_url` exists.
- Large media bytes are not sent through Telegram or Feishu chat.
- AppOS stores source references, evidence, and preview links; publishing waits for approval.

## Minimal CPS Flow

1. Owner sends command from Feishu/opctoai, Telegram, or Web.
2. AppOS creates `BusinessContract`.
3. n8n workflow `content.matrix.plan` validates product, platforms, material source, and editing style.
4. n8n calls Dify `content_matrix_planner`.
5. Dify returns strict JSON with campaign, platform posts, captions, tags, and shot plans.
6. AppOS writes `ContentCampaigns`, `ContentPosts`, `SourceMaterials`, and `Approvals`.
7. Owner reviews post cards.
8. Approved posts can call `video.draft.create`.
9. n8n calls capcut-mate to create and save a draft.
10. AppOS writes `Artifacts(type=capcut_draft)` and sends preview/status cards.
11. Publishing is manual or future browser workflow, always gated by approval.

## Draft Payload Example

```json
{
  "runId": "run_cps_001",
  "traceId": "trace_cps_001",
  "input": {
    "product": {
      "name": "Example CPS product",
      "cps_url": "https://example.com/product",
      "price": 99,
      "commission_rate": 0.2,
      "core_selling_points": ["卖点1", "卖点2"],
      "forbidden_claims": ["不要承诺疗效", "不要承诺收益"]
    },
    "platforms": ["douyin", "xiaohongshu"],
    "platform_accounts": [],
    "material_source": {
      "source_type": "cloud_drive",
      "source_url": "https://example.com/material-folder",
      "license_status": "authorized",
      "usage_notes": "Owner provided authorized素材"
    },
    "editing_style": "图文快切",
    "batch_size": 3,
    "publish_policy": "draft_only"
  }
}
```

## n8n Workflows

Import from `docs/appos/n8n-import/`:

- `content.matrix.plan.json`
- `video.draft.create.json`
- `approval.request.json`
- `workflow.failure.normalize.json`

Required n8n environment variables:

```dotenv
APPOS_API_BASE_URL=http://127.0.0.1:3100
APPOS_DIFY_API_URL=https://api.dify.ai
APPOS_DIFY_API_KEY=replace_me
CAPCUT_MATE_BASE_URL=http://127.0.0.1:30000
FEISHU_BASE_TOKEN=OIbnbkS2sa9jBrsQtqzcMj8pnep
```

## Dify Workflow

Create a Dify workflow using `docs/appos/dify-prompts/content_matrix_planner.md`.

Required behavior:

- Returns JSON only.
- Includes `campaign`, `posts`, `shot_plan`, `material_requirements`, and `blocking_questions`.
- Marks `needs_material_review=true` when source license is unknown.
- Does not create claims or platform actions that were not provided.

## Platform Decisions Still Needed

These must come from the owner before an end-to-end CPS job can be called complete:

- Target platforms: 抖音 / 小红书 / 快手 / 视频号 / 公众号 / B站 / other.
- Account names and persona for each platform.
- CPS product link/category and allowed claims.
- 素材来源 and license status.
- 剪辑风格: 口播带货 / 图文快切 / 测评对比 / 清单种草 / 混剪.
- Whether this batch is `draft_only`, `approval_then_draft`, or `approval_then_publish`.

Current safe default: `draft_only`.
