# 北斗智影 CPS MVP 落地运行手册

状态：已接入采集结果归一化、飞书 Base payload 生成、Dify Webhook payload 生成；真实采集依赖 CloakBrowser 已登录 Profile。

## 当前闭环

```text
飞书/Telegram 指令
-> 顶层 Dify/后续 Mora 生成 BusinessContract
-> n8n 调用北斗智影采集步骤
-> CloakBrowser 已登录 Profile 打开 creator.inbeidou.cn/task
-> inbeidou-cps 采集任务、素材、推广链接
-> Tele-OPC 归一化 cps_results.json
-> 生成飞书 Base 写入 payload
-> 生成 Dify 短剧剪辑策划 payload
```

本阶段不自动剪辑、不自动发布。剪辑从 Dify 返回结构化剪辑方案后进入 media worker / capcut-mate。

## 关键文件

| 文件 | 用途 |
| --- | --- |
| `runtime/inbeidou-cps-skill/inbeidou-cps/scripts/cps_scrape.py` | zip 内采集脚本，已修复 `--all` 分支 |
| `src/appos/domains/cps/inbeidou.ts` | 北斗智影结果归一化和下游 payload 映射 |
| `src/appos/domains/cps/inbeidou-module.ts` | AppOS 第 4 步正式模块：封装 CloakBrowser 采集、飞书写入、Dify 触发 |
| `scripts/appos/run_inbeidou_cps_pipeline.ts` | 可运行入口：采集、归一化、飞书写入、Dify 触发 |
| `tests/appos/inbeidou-cps.test.ts` | 字段映射测试 |

## 环境变量

`.env` 至少配置：

```dotenv
CLOAKBROWSER_MANAGER=http://127.0.0.1:8080
CLOAKBROWSER_PROFILE=你的已登录北斗智影ProfileID
CPS_OUTPUT_DIR=runtime/inbeidou-cps-output
CPS_EDIT_BRIEF_PATH=D:/360MoveData/Users/Cir/Desktop/剪辑思路.txt
INBEIDOU_CPS_SCRAPER_SCRIPT=runtime/inbeidou-cps-skill/inbeidou-cps/scripts/cps_scrape.py

APPOS_FEISHU_BASE_APP_TOKEN=OIbnbkS2sa9jBrsQtqzcMj8pnep
APPOS_FEISHU_TABLE_MAP_JSON={"CPSProducts":"tbl18D4jhOy76S8d","SourceMaterials":"tblxg3MPIyRSlIgm","PublishRecords":"tblAThebEIdZnWnm"}
APPOS_DIFY_INBEIDOU_WEBHOOK_URL=https://你的Dify或n8n入口
```

`APPOS_FEISHU_TABLE_MAP_JSON` 可以只放本流程需要的三个表。完整表映射见 `docs/appos/FEISHU_BASE_INSTANCE.md`。

## 先用已有结果干跑

如果已经有 `cps_results.json`：

```bash
npm run appos:inbeidou:cps -- --input runtime/inbeidou-cps-output/cps_results.json
```

输出：

```text
runtime/inbeidou-cps-output/normalized_tasks.json
runtime/inbeidou-cps-output/dify_short_drama_cps_payload.json
runtime/inbeidou-cps-output/feishu_CPSProducts.json
runtime/inbeidou-cps-output/feishu_SourceMaterials.json
runtime/inbeidou-cps-output/feishu_PublishRecords.json
```

## 采集第一个任务

前提：

1. CloakBrowser Manager 正在运行：`http://127.0.0.1:8080`
2. 指定 Profile 已启动并登录北斗智影。
3. Profile 能打开 `https://creator.inbeidou.cn/task`。

运行：

```bash
npm run appos:inbeidou:cps -- --scrape --tasks 0
```

只采集元数据和推广链接，不下载素材：

```bash
npm run appos:inbeidou:cps -- --scrape --tasks 0 --no-download
```

批量采集当前页面全部任务：

```bash
npm run appos:inbeidou:cps -- --scrape --all --no-download
```

## 写入飞书 Base

默认不会写飞书，只生成 payload。确认 payload 后再执行：

```bash
npm run appos:inbeidou:cps -- --input runtime/inbeidou-cps-output/cps_results.json --write-feishu
```

写入表：

| 北斗智影数据 | 飞书 Base 表 |
| --- | --- |
| 剧名、平台、分佣、第一推广链接 | `CPSProducts` |
| 封面、下载文件、本地路径、素材来源 | `SourceMaterials` |
| TikTok/Facebook/Instagram/YouTube 推广链接 | `PublishRecords` |

由于当前 `PublishRecords.platform` 选项还没有 TikTok/Facebook/Instagram/YouTube，脚本暂时写 `other`，真实平台保存在 `metrics_json.promoPlatform`。

## 触发 Dify

确认 `APPOS_DIFY_INBEIDOU_WEBHOOK_URL` 后执行：

```bash
npm run appos:inbeidou:cps -- --input runtime/inbeidou-cps-output/cps_results.json --trigger-dify
```

Dify 接收的是 `dify_short_drama_cps_payload.json`，目标工作流是：

```text
short_drama_cps_edit_plan
```

它应返回：

```text
analysis_report
edit_plan
english_voiceover_script
publish_caption
qa_checklist
```

返回结果进入人审，不能直接导出或发布。

## n8n 导入模板

导入文件：

```text
docs/appos/n8n-import/inbeidou.cps.ingest.json
```

Webhook 路径：

```text
POST /webhook/appos/inbeidou-cps-ingest
```

测试 payload：

```json
{
  "runId": "run_inbeidou_001",
  "traceId": "trace_inbeidou_001",
  "input": {
    "tasks": [0],
    "no_download": true,
    "no_links": false,
    "write_feishu": false,
    "trigger_dify": false,
    "output_dir": "runtime/inbeidou-cps-output"
  }
}
```

启用真实下游时，把 `write_feishu` 和 `trigger_dify` 改成 `true`。最终发布仍然不在这个 workflow 内执行。

## AppOS 模块 API

主服务启动后，n8n/飞书/Telegram 统一调用：

```text
POST /api/appos/cps/inbeidou/ingest
```

请求：

```json
{
  "tasks": [0],
  "outputDir": "runtime/inbeidou-cps-output",
  "noDownload": true,
  "noLinks": false,
  "writeFeishu": false,
  "triggerDify": false
}
```

返回：

```json
{
  "ok": true,
  "status": "done",
  "outputDir": "runtime/inbeidou-cps-output",
  "resultPath": "runtime/inbeidou-cps-output/cps_results.json",
  "tasks": [],
  "feishuPayloads": {},
  "difyPayload": {},
  "downstream": {
    "writeFeishuRequested": false,
    "triggerDifyRequested": false,
    "feishuWrites": [],
    "difyTriggered": false
  }
}
```

`writeFeishu=true` 会写入 `CPSProducts`、`SourceMaterials`、`PublishRecords`。`triggerDify=true` 会把短剧剪辑策划 payload 发到 `APPOS_DIFY_INBEIDOU_WEBHOOK_URL`。

## 下一步接剪辑

Dify 返回结构化剪辑方案后，下一段 n8n 流程应继续：

```text
Dify edit_plan
-> Media Worker: ffprobe / ASR / screenshot sampling / QA
-> capcut-mate: create_draft / add_videos / add_audios / add_captions / save_draft
-> 飞书/Telegram 人审卡
-> CloakBrowser 发布草稿
```

capcut-mate 不负责理解剧情，也不负责生成 ASR 字幕；它只执行已经确定的时间线和素材操作。
