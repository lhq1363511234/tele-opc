# External AppOS Feishu Base Instance

Created: 2026-06-24

| Item | Value |
| --- | --- |
| Base name | `Tele-OPC External AppOS` |
| Base token | `OIbnbkS2sa9jBrsQtqzcMj8pnep` |
| URL | `https://opcto-a1.feishu.cn/base/OIbnbkS2sa9jBrsQtqzcMj8pnep` |
| Identity used | `user` |
| Table count | 16 |

## Table Map

The Base tables have Chinese display names. AppOS code still uses stable English logical names and resolves them to table IDs, so workflows do not depend on the current display name.

| Logical table | Display name | ID |
| --- | --- | --- |
| BusinessContracts | 业务合同 | `tblSefyLkVrcZLJr` |
| WorkflowDefinitions | 工作流定义 | `tblnXyMVwJOr2Nsm` |
| WorkflowRuns | 工作流运行 | `tblb1c0rlMcFB33W` |
| ContentCampaigns | 内容活动 | `tblFRJGMw5s5liaC` |
| ContentPosts | 内容发布 | `tbl30exiTHGpptri` |
| Artifacts | 交付物 | `tblMpVlj76F6gkPR` |
| Approvals | 审批 | `tbl6qIpQg2pxDRwW` |
| ApplicationEvents | 应用事件 | `tblgsQpAUdILf4qF` |
| ExternalResources | 外部资源 | `tbl5Ob6tEXvw9DgO` |
| MediaJobs | 媒体任务 | `tbliaqiHox3knmAG` |
| FailureEvents | 失败事件 | `tblrWGxqK8DE0WEp` |
| CPSProducts | CPS商品 | `tbl18D4jhOy76S8d` |
| SourceMaterials | 源素材 | `tblxg3MPIyRSlIgm` |
| PlatformAccounts | 平台账号 | `tblhLYEyQX5uY2WX` |
| EditingTemplates | 剪辑模板 | `tblqAMIoXKmJnSM4` |
| PublishRecords | 发布记录 | `tblAThebEIdZnWnm` |

## Environment Values

```dotenv
APPOS_FEISHU_BASE_APP_TOKEN=OIbnbkS2sa9jBrsQtqzcMj8pnep
APPOS_FEISHU_TABLE_MAP_JSON={"BusinessContracts":"tblSefyLkVrcZLJr","WorkflowDefinitions":"tblnXyMVwJOr2Nsm","WorkflowRuns":"tblb1c0rlMcFB33W","ContentCampaigns":"tblFRJGMw5s5liaC","ContentPosts":"tbl30exiTHGpptri","Artifacts":"tblMpVlj76F6gkPR","Approvals":"tbl6qIpQg2pxDRwW","ApplicationEvents":"tblgsQpAUdILf4qF","ExternalResources":"tbl5Ob6tEXvw9DgO","MediaJobs":"tbliaqiHox3knmAG","FailureEvents":"tblrWGxqK8DE0WEp","CPSProducts":"tbl18D4jhOy76S8d","SourceMaterials":"tblxg3MPIyRSlIgm","PlatformAccounts":"tblhLYEyQX5uY2WX","EditingTemplates":"tblqAMIoXKmJnSM4","PublishRecords":"tblAThebEIdZnWnm"}
```

`APPOS_FEISHU_TABLE_MAP_JSON` can stay as the legacy flat map above. The runtime also accepts the structured form in `runtime/appos-feishu-table-map.json`, where each table has an `id` and `displayName`.

## Current Completion Boundary

The Base schema and CPS operational tables exist. The real CPS matrix workflow is not complete until:

- n8n imports and enables the workflow templates in `docs/appos/n8n-import/`.
- Dify has a configured workflow that returns the JSON schema in `docs/appos/dify-prompts/content_matrix_planner.md`.
- Real product, material source, platform accounts, and editing style are entered.
- A test run creates campaign rows, post rows, approval rows, and a capcut draft artifact.

## Seed Records

| Table | Record | ID | Purpose |
| --- | --- | --- | --- |
| EditingTemplates | `tpl_cps_short_video_9_16_default` | `recvnr5CoEMxwZ` | Default 9:16 CPS draft template for approved short-video posts. |
