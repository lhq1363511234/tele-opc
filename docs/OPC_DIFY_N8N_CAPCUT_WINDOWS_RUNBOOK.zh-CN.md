# OPC Dify / n8n / CapCut Windows 本机运行说明

## 目标

在 Windows 本机直跑 Dify、n8n、Redis、PostgreSQL、Qdrant，为 Tele-OPC 的短剧 CPS 剪辑链路提供第 6/7 步能力：

1. Dify 负责剪辑策划：读取字幕、截图、剧情信息、剪辑规则，输出结构化剪辑方案。
2. n8n 负责编排：调 Dify、CapCut Mate、飞书 Base、Telegram/飞书审批卡片。
3. CapCut Mate / 剪映负责执行：创建 9:16 草稿，按时间线组合多版本视频。

## 本地脚本

脚本位置：

- `B:\Cir\CodexProjects\start-dify.ps1`
- `B:\Cir\CodexProjects\stop-dify.ps1`
- `B:\Cir\CodexProjects\restart-dify.ps1`
- `B:\Cir\CodexProjects\start-n8n.ps1`
- `B:\Cir\CodexProjects\stop-n8n.ps1`
- `B:\Cir\CodexProjects\restart-n8n.ps1`

启动：

```powershell
PowerShell -ExecutionPolicy Bypass -File B:\Cir\CodexProjects\start-n8n.ps1
PowerShell -ExecutionPolicy Bypass -File B:\Cir\CodexProjects\start-dify.ps1
```

下载和依赖安装统一使用代理：

```text
http://127.0.0.1:10808
```

## 当前本机服务

- Dify Web: `http://localhost:3000`
- Dify API: `http://localhost:5001`
- n8n: `http://127.0.0.1:5678`
- Redis: `127.0.0.1:6379`
- Dify PostgreSQL: `127.0.0.1:55432`
- Qdrant: `http://127.0.0.1:6333`

说明：Dify Web 当前使用 `vinext dev`，在本机只监听 IPv6 loopback，所以请用 `http://localhost:3000`，不要用 `http://127.0.0.1:3000`。

## 密钥和账号

不要把账号密码和 API Key 写进普通项目文档。

本机配置文件：

```text
B:\Cir\CodexProjects\opc-local.env
```

本机凭据提示文件：

```text
B:\Cir\CodexProjects\opc-local.credentials.txt
```

里面只供本机使用。对外文档只记录变量名：

- `DIFY_SECRET_KEY`
- `DIFY_INIT_PASSWORD`
- `DIFY_DB_PASSWORD`
- `DEEPSEEK_API_KEY`

## Dify Windows 策略

不使用 Docker。

实际选择：

- API: `uv` + Python 3.12
- Web: `corepack pnpm` + `vinext dev`
- DB: 独立 PostgreSQL 实例 `B:\Cir\CodexProjects\postgres-dify`
- Vector Store: Qdrant，不用 pgvector，避免 Windows PostgreSQL 缺扩展
- pnpm shim: `B:\Cir\CodexProjects\tool-shims\pnpm.cmd`

## Dify 剪辑策划契约

输入来自：

- `runtime\...\dify_short_drama_cps_payload.json`
- 飞书 Base 的任务、素材、字幕、分析结果记录

输入必须包含：

- CPS 产品信息：剧名、平台、分佣、推广链接、简介
- 源素材：封面、每集视频、每集字幕附件
- 媒体分析：时长、比例、黑屏比例、对白密度、截图、ASR 状态
- 剪辑指南：黄金 3 秒、剧情亮点、反转、高潮、违规镜头、多平台文案

输出必须是结构化 JSON：

```json
{
  "editPlanId": "plan_xxx",
  "productId": "cps_inbeidou_xxx",
  "styleVariants": [
    {
      "variantId": "high_burn_v1",
      "platform": "douyin",
      "aspectRatio": "9:16",
      "durationSeconds": 90,
      "hook": {
        "text": "前三秒钩子",
        "sourceEpisode": 1,
        "start": 0,
        "end": 3
      },
      "timeline": [
        {
          "episode": 1,
          "start": 0,
          "end": 8,
          "purpose": "golden_3s_hook",
          "caption": "字幕文本"
        }
      ],
      "voiceover": [],
      "captions": [],
      "bgm": {
        "mood": "dramatic",
        "volume": 0.18
      },
      "publishCopy": {
        "title": "",
        "caption": "",
        "hashtags": []
      },
      "riskNotes": [],
      "capcut": {
        "draftName": "",
        "canvas": "vertical_9_16",
        "sourceMaterialIds": [],
        "subtitleMaterialIds": []
      }
    }
  ],
  "ownerApprovalRequired": true
}
```

必须生成多个版本：

- 高燃版：强反转、强冲突、快节奏
- 解说版：旁白串联剧情，适合 YouTube/Facebook
- 悬疑版：打乱时间线，结尾留悬念

每个版本都必须输出风险点，发布前进入人审。

## n8n 编排建议

主工作流：

1. Webhook 接收 Tele-OPC / 飞书 / Telegram 指令。
2. 读取飞书 Base 的产品、素材、字幕和分析记录。
3. 调用 Dify 剪辑策划 workflow。
4. 将 Dify 输出写回飞书 Base。
5. 调用 CapCut Mate 创建草稿。
6. 写入视频、字幕、文字、BGM。
7. 保存草稿或导出预览。
8. 发送飞书 / Telegram 人审卡片。

## CapCut Mate

服务地址：

```text
http://127.0.0.1:30000
```

核心 API：

- `POST /openapi/capcut-mate/v1/create_draft`
- `POST /openapi/capcut-mate/v1/easy_create_material`
- `POST /openapi/capcut-mate/v1/save_draft`

第 7 步只生成草稿或预览，不自动发布。
