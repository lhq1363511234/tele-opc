# External AppOS Dify Workflows

Dify is the AI workflow provider. It is not the AppOS orchestrator.

Current state: Dify is not configured in `.env` and no live Dify workflow id is registered. The first workflow prompt/spec is stored in `docs/appos/dify-prompts/content_matrix_planner.md`.

## First Required Workflow

| Capability | Purpose |
| --- | --- |
| `content_matrix` | Convert a BusinessContract into campaign/post drafts |

## Required Workflow

Create a Dify workflow from:

```text
docs/appos/dify-prompts/content_matrix_planner.md
```

## Required Output Shape

```json
{
  "campaign": {
    "name": "AI tools CPS matrix",
    "objective": "Generate approved platform-specific content"
  },
  "posts": [
    {
      "platform": "douyin",
      "title": "Title",
      "script": "Script",
      "caption": "Caption",
      "tags": ["AI", "tools"]
    }
  ]
}
```

AppOS must validate this output before writing ContentCampaigns or ContentPosts.

The full CPS version also includes `shot_plan`, `material_requirements`, `needs_material_review`, and `blocking_questions` per post. Freeform Markdown output is invalid.
