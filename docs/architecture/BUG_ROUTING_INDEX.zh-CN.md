# Tele-OPC Bug 路由手册

> 使用方法：先按症状找到模块编号，再执行该行的最小检查。不要一上来重启全部服务或扫描全仓库。

## 1. 症状 → 模块

| 症状 | 主模块 | 第一检查点 | 日志/接口 | 常见根因 |
| --- | --- | --- | --- | --- |
| 整个网站打不开 | M19 | API 与 Cloudflare、静态文件 | `/health`、`/ready`、api.dev.log | API 停止、DNS/代理、构建目录不存在 |
| 网站打开但 API 全 401 | M01 | auth mode/initData/dev token | `/api/web/session`、telegram diagnostics | Telegram initData 失效、auth mode 配错 |
| 只有某个菜单空白 | M00 + 对应业务模块 | 浏览器 console/network、route | web-build.log、对应 `/api/web/*` | RouteView 未挂载、API schema 变化 |
| 首页指标不对 | M02 | analytics facts 与 dashboard 聚合 | `/api/web/overview`、`/api/web/analytics` | 演示 facts、指标重复写入、口径不一致 |
| 人格不像本人/不替本人决定 | M03/M04 | A- profile、Context Pack、system prompt | `/api/web/a-self`、agent_runs | 人格证据不足、当前请求未优先、提示词回退 |
| 发任务一点反应没有 | M14/M15 → M04 → M05 | 通道是否收件、是否建 message/task | channel log、messages、tasks | webhook/event 未收到、owner 不匹配、模型超时 |
| 任务一直 queued | M05/M19 | BullMQ/Redis/worker | worker.dev.log、Redis DB15、task_events | worker 停止、Redis 连接、job 去重 ID |
| 任务一直 running | M05 | worker 当前 handler | worker.dev.log、task result | handler 卡住、外部 API 无 timeout、异常未落状态 |
| 批准后不继续 | M05 + 通道模块 | approval status 与 approval job | approvals、task_events、worker log | 决策只改状态未 enqueue、重复批准、task_id 缺失 |
| Telegram Bot 无响应 | M14 | webhook/getUpdates 与 owner | set-webhook.log、api.dev.log | webhook secret、token、owner allowlist |
| 飞书 Bot 无响应 | M15 | event consumer 与 owner Open ID | `lark-cli event status`、feishu.dev.log | consumer 停止、scope、allowlist、bot visibility |
| 飞书文件收到但没处理 | M15/M13 | channel_messages、下载目录、Artifact | feishu.dev.log、runtime/feishu-inbox | `im:message:readonly`、大小限制、格式不可读 |
| 资料被放错位置 | M15/M03/M13 | attachment disposition artifact | task planning_metadata、attachment_disposition | 最近对话误导、人格证据错误、模型判断置信度低 |
| CRM 没看到线索 | M07 | leads/contacts 是否写入 | `/api/web/crm/leads`、prospecting runs | 只生成候选未 commit、去重、搜索失败 |
| 抓到 100 条但飞书没有 | M07/M15 | ledger sync count/table map | `/api/web/feishu/status`、sync route | table map、Base token、同步过滤/limit |
| 邮件说发了但历史没有 | M08 | SMTP response 与 campaign event | smtp status、campaign_events | 只生成草稿、发送失败未落事件、message-id 未保存 |
| 财务表格解析错误 | M09 | sheet headers/tablesToText/AI artifact | finance upload response、artifact | 表头识别、合计行、日期/金额列混淆 |
| 财务重复入账 | M09/M13 | hash/source id/commit 操作 | transactions、artifacts metadata | 同文件重复 commit、缺 source-object dedupe |
| PPT 能生成但不好看 | M12 | deck spec 与 pptx builder | deck API、artifact preview | 内容结构、主题 token、布局选择，不是下载问题 |
| PPT 下载失败 | M12/M19 | artifact 与 pptx endpoint | `/api/web/studio/deck/:id.pptx` | artifact 缺失、生成异常、文件权限 |
| 浏览器抓取为空 | M11 | allowed domain、页面响应、selector | browser dashboard、screenshots | 反爬、登录墙、页面结构变化、域名限制 |
| Agent 看起来没用模型 | M06/M04 | agent_runs/tool_calls | `/api/web/agent-runs` | provider 未配置、fallback workflow、模型未返回 tool call |
| Dify/n8n Contract 建了但没跑 | M16 | workflow registry/run/provider config | appos runs/failures | definition 未注册、webhook/API key、output mapping |
| Paperclip 页面空 | M17 | integration health/company id | paperclip health route | API key/company ID、远端不可达 |
| CPU 100% | M19，再查 M05/M11/M20 | `top/ps`、服务日志频率 | systemd status、各日志 | watch 重启循环、worker retry 风暴、浏览器/抓取进程 |

## 2. 标准排查顺序

### Web 页面问题

```text
M00 route
→ M01 auth
→ 对应 /api/web/*
→ 对应领域模块
→ 数据表
```

### 消息入口问题

```text
Telegram(M14) 或 Feishu(M15)
→ message/channel_messages 是否落库
→ M04 是否理解
→ M05 是否建 task/enqueue
→ worker 是否执行
```

### 业务数据问题

```text
前端 query
→ API response
→ repository query
→ 数据表真实记录
→ analytics/飞书镜像是否二次同步
```

### 外部动作问题

```text
Agent tool call
→ approval
→ connector
→ 外部响应 ID
→ audit/campaign event/external object mapping
```

## 3. 最小诊断命令

```bash
# 三个核心服务
systemctl is-active tele-opc-api tele-opc-worker tele-opc-feishu

# API/数据库/Redis
curl -fsS http://127.0.0.1:3100/ready

# 飞书事件
lark-cli event status --json

# 最近日志
tail -100 runtime/logs/api.dev.log
tail -100 runtime/logs/worker.dev.log
tail -100 runtime/logs/feishu.dev.log

# 类型与测试
npm run typecheck
npm run web:typecheck
npm run web:build
npm test
```

## 4. Bug 报告模板

```text
模块：M09 Finance
入口：飞书文件上传
症状：上传 XLSX 后收入被识别成支出
对象 ID：task/artifact/message ID
发生时间：绝对时间
期望：按“收入”列写入 income
实际：全部写成 expense
是否可复现：是/否
是否涉及真实外部动作：是/否
```

## 5. 修复纪律

1. 先修主模块，不顺手改无关模块。
2. 每个 Bug 至少补一个模块级测试或可重复诊断步骤。
3. 数据修复与代码修复分开；不得删除其他业务数据。
4. 涉及审批、付款、发送、发布时必须验证真实外部动作和审计记录。
5. 修改大文件时优先把触碰区域迁出到对应模块目录。
