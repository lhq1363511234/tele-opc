# 短剧 CPS 第 6/7 步落地说明

## 当前目标

把第 5 步媒体预处理后的北斗智影任务，交给剪辑策划工作流生成多个剪辑版本，并调用 CapCut Mate 创建剪映 9:16 草稿。

当前链路：

1. 读取 `dify_short_drama_cps_payload.json`
2. DeepSeek 生成结构化剪辑方案
3. 输出高燃版、解说版、悬疑版
4. 按 timeline 用 ffmpeg 切片
5. 起本地临时 HTTP 文件服务给 CapCut Mate 下载片段
6. 调用 CapCut Mate 创建草稿、添加视频、添加字幕、保存草稿
7. 输出人审卡片 JSON

## 服务脚本

```powershell
PowerShell -ExecutionPolicy Bypass -File B:\Cir\CodexProjects\start-dify.ps1
PowerShell -ExecutionPolicy Bypass -File B:\Cir\CodexProjects\start-n8n.ps1
PowerShell -ExecutionPolicy Bypass -File B:\Cir\CodexProjects\start-capcut-mate.ps1
```

停止/重启：

```powershell
PowerShell -ExecutionPolicy Bypass -File B:\Cir\CodexProjects\stop-capcut-mate.ps1
PowerShell -ExecutionPolicy Bypass -File B:\Cir\CodexProjects\restart-capcut-mate.ps1
```

## 本地地址

- Dify Web: `http://localhost:3000`
- Dify API: `http://localhost:5001`
- n8n: `http://127.0.0.1:5678`
- CapCut Mate: `http://127.0.0.1:30000`

密钥和本地账号只放在：

- `B:\Cir\CodexProjects\opc-local.env`
- `B:\Cir\CodexProjects\opc-local.credentials.txt`

不要把密钥写入普通项目文档。

## 直接运行第 6/7 步

```powershell
cd B:\Cir\CodexProjects\tele-opc
npm run appos:short-drama:edit-pipeline -- `
  --payload B:\Cir\CodexProjects\tele-opc\runtime\inbeidou-cps-live-download-all-feishu-write-final2\dify_short_drama_cps_payload.json `
  --output-dir B:\Cir\CodexProjects\tele-opc\runtime\short-drama-cps-edit-live-deepseek `
  --max-variants 3
```

输出：

- `edit_plan.json`: 剪辑方案，包含 timeline、旁白、字幕、文案、风险点
- `capcut_drafts.json`: CapCut Mate 草稿创建结果
- `review_card.json`: 给飞书/Telegram 人审卡片使用的摘要
- `clips/`: 按 timeline 切出的临时片段

## 已验证输出

真实北斗 payload 已跑通：

- 输出目录：`B:\Cir\CodexProjects\tele-opc\runtime\short-drama-cps-edit-live-deepseek`
- plannerProvider: `deepseek-direct`
- 生成版本数：3
- CapCut 草稿数：3
- 人审开关：`ownerApprovalRequired: true`

草稿：

- 高燃版：`http://127.0.0.1:30000/openapi/capcut-mate/v1/get_draft?draft_id=2026062519592428fca189`
- 解说版：`http://127.0.0.1:30000/openapi/capcut-mate/v1/get_draft?draft_id=20260625195926c169f118`
- 悬疑版：`http://127.0.0.1:30000/openapi/capcut-mate/v1/get_draft?draft_id=202606251959288c91024b`

## n8n 工作流

工作流文件：

```text
B:\Cir\CodexProjects\tele-opc\runtime\n8n-workflows\short-drama-cps-edit-to-capcut.json
```

已导入本地 n8n，工作流名：

```text
OPC 短剧CPS剪辑策划到剪映草稿
```

Webhook 路径：

```text
/webhook/opc/short-drama-cps/edit-to-capcut
```

请求体示例：

```json
{
  "payloadPath": "B:\\Cir\\CodexProjects\\tele-opc\\runtime\\inbeidou-cps-live-download-all-feishu-write-final2\\dify_short_drama_cps_payload.json",
  "outputDir": "B:\\Cir\\CodexProjects\\tele-opc\\runtime\\short-drama-cps-edit-from-n8n",
  "maxVariants": 3,
  "skipCapcut": false
}
```

当前工作流是导入状态，后续接飞书/Telegram 时再激活生产 webhook。

## 重要限制

- 当前 Dify 本地服务和账号已初始化，但本次实测的策划执行路径是 `deepseek-direct`，不是 Dify 内部已发布 workflow。
- n8n 已作为编排工作流落地，后续可以把 DeepSeek direct 节点替换为 Dify workflow API。
- CapCut Mate 当前创建的是草稿，不自动导出和发布。
- 发布前必须走飞书/Telegram 人审。
