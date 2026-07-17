# External AppOS capcut-mate Usage

capcut-mate is used only as a video draft production tool.

Current state: capcut-mate is reachable locally, but draft generation for CPS is blocked until an approved `ContentPost` has usable source material.

## Base URL

```text
http://127.0.0.1:30000
```

## Minimal Flow

1. `POST /openapi/capcut-mate/v1/create_draft`
2. `POST /openapi/capcut-mate/v1/easy_create_material`
3. `POST /openapi/capcut-mate/v1/save_draft`

Required material inputs:

- `audio_url`
- one of `video_url` or `image_url`
- approved post script/caption
- editing template, defaulting to 1080x1920 short video

If these are missing, n8n `video.draft.create` reports a failed workflow instead of fabricating a draft.

## AppOS Artifact Mapping

| capcut-mate Output | AppOS Artifact Field |
| --- | --- |
| `draft_url` | `Artifacts.draft_url` |
| generated preview URL | `Artifacts.preview_url` |
| draft title | `Artifacts.title` |
| source workflow run | `Artifacts.source_run_id` |

No automatic publishing happens after draft creation.
