# Paperclip + Tele-OPC 集成

## 架构定位

Paperclip 与 Tele-OPC 不是互相替代，而是控制面和执行面的组合：

```text
Paperclip（公司治理 / 控制面）
  Company → Goal → Project → Agent → Issue → Approval / Budget / Audit
                              │ HTTP heartbeat
                              ▼
Tele-OPC（执行 / 数据面）
  PostgreSQL Task → Redis DB15 / BullMQ → Worker / 业务 Agent
                              │
                              ├─ 回写 Paperclip done / blocked
                              ├─ business_analytics_facts
                              └─ 飞书 Base → 飞书图表 → 网站经营可视化
```

Paperclip 负责“公司应该做什么、谁负责、预算多少、进展如何”；Tele-OPC 负责“真正执行、接业务系统、沉淀经营事实并可视化”。

## 已实现能力

- Paperclip HTTP Heartbeat 转换为 Tele-OPC Task。
- 使用 `planning_metadata.paperclip.issueId` 幂等去重。
- Paperclip Agent 角色自动映射到 Tele-OPC Agent。
- BullMQ Worker 完成或失败后回写 Paperclip `done` / `blocked`。
- 经营事实：
  - `paperclip_issue_received`
  - `paperclip_issue_done`
  - `paperclip_issue_failed`
- Webhook 采用独立共享密钥和 timing-safe 校验。
- Paperclip API 使用专用 Board Integration Key，支持异步 Worker 回写。
- Heartbeat 路由会等待短任务完成后再响应，避免 Paperclip 将立即 `202` 判定为“没有具体动作”并重复唤醒。
- 状态同步不写桥接评论，避免 Paperclip 的评论唤醒机制形成 Heartbeat 回环。

## Web Console 治理中心

Tele-OPC Web Console 已内置 Paperclip 治理中心：

```text
/app/paperclip
```

页面提供：

- 公司、目标、项目和 AI Agent 组织视图。
- Issue 四列看板：待执行、执行中、受阻、已完成。
- Paperclip Issue 与 Tele-OPC Task、Heartbeat Run、经营事实的关联详情。
- 创建公司任务；默认不分配 Agent，只有用户明确选择 HTTP Agent 时才会进入 Tele-OPC 执行队列。
- Issue 状态更新与执行成功率、Agent 完成率、最近控制面事件。
- 桌面、平板和手机响应式布局；弹窗与详情抽屉支持 Esc 关闭和背景滚动锁。

服务端 API：

```text
GET    /api/web/paperclip
GET    /api/web/paperclip/issues/:id
POST   /api/web/paperclip/issues
PATCH  /api/web/paperclip/issues/:id
```

这些 API 继承 Web Console 现有认证策略。浏览器响应只返回治理展示所需字段，不返回 Agent `adapterConfig`、HTTP headers、runtimeConfig、Board API Key 或 webhook secret。

## Tele-OPC 配置

```env
PAPERCLIP_ENABLED=true
PAPERCLIP_API_URL=http://127.0.0.1:3101
PAPERCLIP_API_KEY=<Paperclip board integration key>
PAPERCLIP_WEBHOOK_SECRET=<high-entropy shared secret>
PAPERCLIP_HEARTBEAT_WAIT_MS=12000
```

说明：

- `PAPERCLIP_API_KEY` 推荐使用专用 **Board API Key**。Agent Key 会受 Heartbeat Run 所有权约束，不适合任务完成后的异步回写。
- `PAPERCLIP_HEARTBEAT_WAIT_MS` 必须小于 HTTP Agent 的 `timeoutMs`，当前推荐 `12000 < 15000`。
- 密钥只放服务端 `.env`，不得进入前端、日志、飞书事实表或 Git。

## Paperclip HTTP Agent

同机部署时优先走 loopback，不经过公网和 Cloudflare：

```json
{
  "adapterType": "http",
  "adapterConfig": {
    "url": "http://127.0.0.1:3100/api/integrations/paperclip/heartbeat",
    "method": "POST",
    "timeoutMs": 15000,
    "headers": {
      "Authorization": "Bearer <same PAPERCLIP_WEBHOOK_SECRET>"
    }
  }
}
```

只有 Paperclip 与 Tele-OPC 不在同一主机时，才使用：

```text
https://tele-opc.opctoai.xyz/api/integrations/paperclip/heartbeat
```

Paperclip 实际发送的主体包含：

```json
{
  "runId": "...",
  "agentId": "...",
  "context": {
    "issueId": "...",
    "wakeReason": "issue_assigned",
    "commentId": "..."
  }
}
```

## Agent 映射

优先级：

1. Heartbeat Context 的 `teleOpcAgent`。
2. Paperclip Agent 的 shortname / urlKey / name / role 关键词。
3. 默认 `chief_of_staff`。

| Paperclip 关键词 | Tele-OPC Agent |
|---|---|
| finance / 财务 | `finance` |
| sales / prospect / 销售 | `prospecting` |
| research / analyst / 研究 | `research` |
| content / marketing / 内容 | `content` |
| email / mail / 邮件 | `email` |
| browser / web | `browser` |
| developer / engineer / CTO | `dev` |
| ops / operations / 运营 | `ops` |
| crm / customer / 客户 | `crm` |

## 当前生产部署

```text
Tele-OPC API     127.0.0.1:3100
Paperclip        127.0.0.1:3101
Paperclip PG     127.0.0.1:54329（独立嵌入式 PostgreSQL）
Paperclip home   /var/lib/paperclip
Paperclip app    /opt/paperclip
```

Paperclip 使用独立 Node.js 22 Runtime，不修改 Tele-OPC 当前系统 Node.js。systemd 模板位于：

```text
ops/systemd/paperclip.service
```

资源保护：

- `CPUQuota=100%`：最多使用一个 CPU 核。
- `MemoryMax=2G`。
- `Nice=10`。
- 仅监听 loopback，不直接暴露公网。
- 自动数据库备份每 60 分钟一次，保留 30 天。

## 服务操作

```bash
systemctl status paperclip.service
systemctl restart paperclip.service
systemctl restart tele-opc-api.service
systemctl restart tele-opc-worker.service
```

健康检查：

```bash
curl -fsS http://127.0.0.1:3101/api/health
curl -fsS http://127.0.0.1:3100/api/integrations/paperclip/health
```

手工备份：

```bash
PAPERCLIP_HOME=/var/lib/paperclip \
  /opt/paperclip/node_modules/.bin/paperclipai db:backup \
  --data-dir /var/lib/paperclip
```

## E2E 验收标准

```text
Paperclip 创建并分配 Issue
→ HTTP Agent 触发一次 Heartbeat
→ Tele-OPC 只创建一个 Task
→ BullMQ Worker 执行
→ Paperclip Issue 变为 done / blocked
→ 写入 received + done/failed 经营事实
→ 后续同步进入飞书 Base 和经营可视化
```

检查幂等任务：

```sql
SELECT id, title, status, planning_metadata->'paperclip'
FROM tasks
WHERE planning_metadata->'paperclip'->>'issueId' = '<issue-id>';
```

检查经营事实：

```sql
SELECT metric_code, status, agent, is_demo, occurred_at
FROM business_analytics_facts
WHERE source_object_type = 'paperclip_issue'
  AND source_object_id = '<issue-id>'
ORDER BY occurred_at;
```

## 安全与回滚

- Paperclip 不使用 Tele-OPC Redis，也不会修改 Redis 其他 DB；Tele-OPC 继续使用自己的 DB15 配置。
- Paperclip 使用独立嵌入式 PostgreSQL，不进入 Tele-OPC 主数据库。
- Paperclip 控制面不可用时，Worker 本地任务仍可完成；回写失败只记录 warning。
- 停用集成只需设置 `PAPERCLIP_ENABLED=false` 并重启 Tele-OPC API/Worker。
- 完全停止 Paperclip：`systemctl disable --now paperclip.service`。
- 不要直接删除 `/var/lib/paperclip`；应先备份。

如需清理测试映射：

```sql
DELETE FROM tasks
WHERE planning_metadata->>'source' = 'paperclip_http_adapter';

DELETE FROM business_analytics_facts
WHERE source_object_type = 'paperclip_issue';
```
