# Tele-OPC OS V2 实施路线图

Telegram-first One-Person Company Operating System

本文档把 [V2_LONG_TERM_PLAN.zh-CN.md](./V2_LONG_TERM_PLAN.zh-CN.md) 转换成可执行工程路线图。长期计划回答“系统应该是什么”，本文档回答“按什么顺序把它做出来”。

## 路线图原则

1. 先做可运行闭环，再做高级智能。
2. 先保证审批和审计，再接入高风险工具。
3. 先内部数据模型，再外部 SaaS 集成。
4. 先单人单 Bot，再多 Agent 深度协作。
5. 每个阶段都必须能在 Telegram 中验证。
6. 每个阶段结束都要有清晰退出标准。

## 目标版本分层

```text
V2.0 Foundation   能接 Telegram、建任务、审批、简报
V2.1 Memory       能记住公司目标、偏好、项目和复盘
V2.2 CRM + Mail   能管理客户、读邮件、起草跟进
V2.3 Finance + Calendar  能看现金流、订阅、日程和会议准备
V2.4 Browser      能执行可审计浏览器自动化
V2.5 Governance   能稳定运行、备份、审计、评估
```

## 推荐仓库结构

第一版实现建议使用以下结构：

```text
tele-opc/
  README.md
  README.zh-CN.md
  DEPLOYMENT.zh-CN.md
  RELEASE_CHECKLIST.zh-CN.md
  CONTRIBUTING.md
  SECURITY.md
  V2_LONG_TERM_PLAN.md
  V2_LONG_TERM_PLAN.zh-CN.md
  V2_IMPLEMENTATION_ROADMAP.zh-CN.md
  .env.example
  .gitignore
  config/
    tele-opc.example.yaml
  migrations/
  src/
    app.ts
    config/
    telegram/
    auth/
    brain/
    intake/
    planner/
    policy/
    queue/
    agents/
    tools/
    memory/
    crm/
    finance/
    email/
    calendar/
    browser/
    briefings/
    audit/
    db/
  tests/
  Dockerfile
  docker-compose.yml
```

## Phase 0：项目骨架和工程契约

### 目标

建立一个可以开源或私有部署的工程基础，让后续每个阶段都能在同一套规范下推进。

### 交付物

- `package.json`
- TypeScript 或等价工程配置
- `src/` 目录骨架
- `docker-compose.yml`
- PostgreSQL 服务
- Redis 服务
- 数据库 migration 工具
- 基础日志模块
- 基础配置加载模块
- CI 最小检查

### 推荐技术选择

- Node.js 20+
- TypeScript
- Fastify 或 Express
- PostgreSQL
- Redis
- BullMQ 或等价队列
- Drizzle / Prisma / Kysely 任选其一
- Playwright 预留，不在本阶段启用

### 关键任务

1. 初始化 Node/TypeScript 工程。
2. 建立统一配置加载：`.env` + `config/tele-opc.yaml`。
3. 建立数据库连接和迁移机制。
4. 建立 Redis 连接。
5. 建立结构化日志。
6. 添加健康检查接口：

```text
GET /health
GET /ready
```

7. 添加 Docker Compose：

```text
api
worker
postgres
redis
```

8. 添加最小测试命令：

```bash
npm test
npm run typecheck
```

### 验收标准

- `docker compose up -d` 可以启动基础依赖。
- API 服务可以启动。
- `/health` 返回正常。
- 可以连接 PostgreSQL。
- 可以连接 Redis。
- `.env` 不会被 Git 跟踪。
- 配置样例足够让新用户知道要填什么。

### 退出条件

仓库已经具备工程启动能力，后续业务代码可以直接落地。

## Phase 1：Telegram Gateway + 审批 + 任务闭环

### 目标

做出第一个可用闭环：你在 Telegram 发消息，系统识别身份、创建任务、请求审批、返回结果。

### 模块范围

- Telegram Gateway
- Owner allowlist
- Message ingestion
- Intent Intake v0
- Task Queue v0
- Approval Gate v0
- Chief of Staff Agent v0
- Audit Log v0

### 数据表

必须建立：

```text
users
telegram_chats
messages
tasks
task_events
approvals
audit_logs
```

### 最小 Telegram 命令

```text
/start
/today
/tasks
/task <id>
/approve <id>
/reject <id>
```

### 关键任务

1. 接收 Telegram webhook。
2. 校验 webhook secret。
3. 校验发送者是否在 `TELEGRAM_OWNER_IDS` 中。
4. 保存 Telegram 原始消息。
5. 实现 `/start` 身份确认。
6. 实现 `/tasks` 查看任务列表。
7. 实现 `/task <id>` 查看任务详情。
8. 实现任务状态机：

```text
new -> intake -> planned -> queued -> running -> review -> done
new -> waiting_approval -> queued
new -> blocked
```

9. 实现审批记录：

```text
pending -> approved
pending -> rejected
pending -> expired
```

10. 实现一个最小 Chief of Staff：

- 能区分普通问答和任务
- 能创建任务
- 能为高风险动作创建审批
- 能总结任务状态

### 第一条端到端验收用例

输入：

```text
帮我准备一封给 Alice 的跟进邮件，但不要直接发送。
```

期望：

1. 系统创建任务。
2. 系统识别“给客户发邮件”属于高风险外部动作。
3. 系统只生成草稿。
4. 系统不发送邮件。
5. 系统返回草稿和审批提示。

### 验收标准

- 未授权 Telegram 用户无法使用系统。
- 授权用户可以创建任务。
- `/tasks` 可以看到任务。
- 高风险动作会进入审批。
- `/approve` 和 `/reject` 可以改变审批状态。
- 所有重要操作写入 `audit_logs`。

### 退出条件

Tele-OPC OS 已经可以作为 Telegram 中的任务和审批系统使用。

## Phase 2：Company Memory + Planner + Review Loop

### 目标

让系统不再只是任务机器人，而是开始拥有公司上下文、个人偏好和复盘学习能力。

### 模块范围

- Company Memory
- Memory Retrieval
- Planner v1
- Task Decomposer
- Review Log
- Playbook Store
- Daily Briefing v2

### 数据表

新增：

```text
memories
memory_sources
playbooks
briefings
reviews
task_dependencies
artifacts
```

### 记忆类型

必须支持：

```text
strategic
operational
relationship
financial
preference
playbook
```

### 关键任务

1. 实现记忆写入：

```text
记住，我们的语气要简洁、直接，不要太销售。
```

2. 实现记忆查询：

```text
/memory
```

3. 为每条记忆保存来源：

- Telegram message id
- task id
- artifact id
- manual import

4. 实现 Planner v1：

- 识别任务目标
- 拆子任务
- 判断依赖关系
- 判断优先级
- 判断是否需要审批

5. 实现 Daily Briefing v2：

```text
/today
```

包含：

- 今日任务
- 待审批
- 阻塞事项
- CRM 客户跟进
- 财务提醒
- 日程与会议准备
- 邮件处理
- 浏览器自动化风险
- 建议下一步
- 写入 `briefings`

6. 实现任务复盘：

- 任务是否完成
- 结果是否达标
- 下次如何改进
- 是否更新记忆
- 是否沉淀 playbook

### 端到端验收用例

输入：

```text
记住，客户跟进邮件要短一点，最多 120 字。
```

然后输入：

```text
给 Alice 起草一封跟进邮件。
```

期望：

1. 系统检索到偏好记忆。
2. 草稿不超过 120 字。
3. 任务记录显示使用了哪条记忆。

### 验收标准

- 系统可以保存结构化记忆。
- 系统可以在任务中引用记忆。
- `/today` 不只是任务列表，而是简报。
- 复杂任务可以拆出子任务。
- 完成任务后可以生成 review。

### 退出条件

系统具备长期上下文，能把重复工作沉淀为流程。

## Phase 3：CRM + Email

### 目标

让 Tele-OPC OS 能管理客户关系，并先通过手工导入处理业务邮件，后续再接入 Gmail / Outlook / IMAP 真实收件箱；所有外发动作仍受审批控制。

### 模块范围

- Internal CRM
- CRM Agent
- Manual Email Intake v0
- Email Connector
- Email Agent
- Follow-up Detector
- Customer Message Drafting

### 当前落地状态

- Internal CRM v0 已完成：可以创建公司、联系人、机会、互动记录和跟进事项，并通过 `/crm` 查看看板。
- Manual Email Intake v0 已完成：可以从 Telegram 手工记录邮件，分拣分类，关联联系人，创建跟进任务、回复草稿和 `send_email` 审批，并通过 `/mail` 查看邮件看板。
- Gmail / Outlook / IMAP 真实连接器仍在后续阶段。

### 数据表

新增：

```text
contacts
organizations
opportunities
interactions
follow_ups
customer_segments
email_accounts
email_threads
email_messages
email_drafts
```

### 关键任务：CRM

1. 创建联系人。
2. 创建公司。
3. 记录客户互动。
4. 创建销售机会。
5. 管理机会阶段：

```text
new
qualified
proposal
negotiation
won
lost
```

6. 自动识别跟进时间。
7. `/crm` 返回：

- 热线索
- 逾期跟进
- 本周应推进机会
- 风险客户

### 关键任务：Email

1. 支持 Telegram 手工记录邮件。
2. 保存邮件线程元数据。
3. 保存邮件正文和来源消息。
4. 邮件分类：

```text
urgent
customer
finance
calendar
newsletter
ignored
```

5. 关联或创建 CRM 联系人。
6. 起草回复。
7. 外发邮件创建审批。
8. 审批通过后才允许进入真实发送流程。
9. 后续接入 Gmail / Outlook / IMAP 自动读取。

### 端到端验收用例

输入：

```text
帮我看看最近哪些客户邮件需要跟进。
```

期望：

1. Email Agent 读取已记录或已同步的近期邮件。
2. 识别客户邮件。
3. CRM Agent 关联联系人。
4. 创建 follow-up。
5. 起草回复。
6. 不发送邮件，等待审批。

### 验收标准

- `/crm` 可以展示客户状态。
- `/mail` 可以展示邮件分拣。
- 邮件可以关联到联系人。
- 客户跟进可以变成任务。
- 发送邮件必须审批。
- 删除邮件必须审批。

### 退出条件

系统可以承担一人公司的客户跟进和邮件助理工作。

## Phase 4：Finance + Calendar

### 目标

让系统可以理解钱和时间：知道现金流、订阅、发票、会议、准备事项和冲突。

### 模块范围

- Finance Ledger
- Finance Agent
- Subscription Tracker
- Invoice Tracker
- Cashflow Forecast
- Calendar Connector
- Calendar Agent
- Meeting Prep

### 当前落地状态

- Finance Ledger v0 已完成：可以从 Telegram 手工记录收入、支出、订阅和发票，并通过 `/finance` 查看本月收入、本月支出、净现金流、未收发票、即将扣费订阅、风险提醒和建议动作。
- Finance v0 目前是内部台账，不连接银行、Stripe 或真实付款渠道。
- Calendar v0 已完成：可以从 Telegram 手工记录会议，生成会议准备 note，并通过 `/calendar` 查看今日/明日日程、冲突、空闲时间和会议准备。
- Calendar v0 目前是内部日程台账，不连接 Google Calendar、Outlook Calendar，也不发送真实外部邀请。
- 更完整的 Calendar Connector、Calendar Agent、找时间和跨 CRM/Email 的会议背景检索仍在后续阶段。

### 数据表

新增：

```text
transactions
invoices
subscriptions
budgets
vendors
cashflow_snapshots
calendar_accounts
calendar_events
meeting_notes
availability_windows
```

### 关键任务：Finance

1. 支持手动录入收入和支出。
2. 支持 CSV 导入交易。
3. 支持订阅记录。
4. 支持发票状态：

```text
draft
sent
paid
overdue
cancelled
```

5. 生成现金流预测。
6. `/finance` 返回：

- 本月收入
- 本月支出
- 未收发票
- 即将扣费订阅
- 风险提醒
- 建议动作

### 关键任务：Calendar

1. 读取日程。
2. 查找空闲时间。
3. 生成会议准备材料。
4. 创建日程草稿。
5. 外部会议邀请必须审批。
6. `/calendar` 返回：

- 今日/明日日程
- 冲突
- 空闲时间
- 会议准备

### 端到端验收用例

输入：

```text
这个月现金流怎么样？明天哪些会议需要准备？
```

期望：

1. Finance Agent 输出现金流摘要。
2. Calendar Agent 输出明日会议。
3. CRM/Email 参与会议背景检索。
4. Chief of Staff 合并成一份简报。

### 验收标准

- `/finance` 能输出财务看板。
- 系统能识别订阅风险。
- 系统能识别逾期发票。
- `/calendar` 能输出日程和准备事项。
- 创建外部会议必须审批。

### 退出条件

系统能辅助管理一人公司的钱和时间。

## Phase 5：Browser Automation

### 目标

让系统可以在受控浏览器中检查后台、提取信息、准备表单，但提交动作必须审批。

### 模块范围

- Browser Runner
- Browser Automation Agent
- Screenshot Artifacts
- Browser Run Audit
- Submit Approval Gate
- Domain Allowlist

### 当前落地状态

- Browser Automation v0 已完成：可以从 Telegram 创建受控浏览器运行记录，保存目标 URL、运行步骤、截图证据占位、提取结果占位和被拦截动作，并通过 `/browser` 查看看板。
- Domain Allowlist v0 已完成：不在 allowlist 的域名默认拦截。
- Submit Approval Gate v0 已完成：提交表单、发布、删除、购买、退款、账单修改等高风险网页动作会创建审批。
- 真实 Playwright runner、浏览器 session 管理、截图文件落盘和页面内容提取仍在后续阶段。

### 数据表

新增：

```text
browser_sessions
browser_runs
browser_steps
browser_screenshots
browser_extractions
browser_blocked_actions
```

### 关键任务

1. 集成 Playwright。
2. 创建 browser runner 服务。
3. 支持打开 URL。
4. 支持读取页面文本。
5. 支持截图。
6. 支持结构化提取。
7. 支持受控点击和输入。
8. 提交表单前进入审批。
9. 支持域名 allowlist。
10. 保存完整运行日志。

### 浏览器安全规则

默认允许：

- 打开页面
- 读取页面
- 截图
- 提取数据
- 填写但不提交表单

必须审批：

- 点击 Submit / Save / Publish
- 删除远程数据
- 修改账单
- 付款或购买
- 发布内容
- 修改账户设置

### 端到端验收用例

输入：

```text
去 Stripe 看看最近失败付款，整理原因。
```

期望：

1. Browser Agent 打开 Stripe。
2. 如果需要登录，提示你手动完成或使用已有 session。
3. 提取失败付款列表。
4. 保存截图。
5. Finance Agent 更新财务风险。
6. CRM Agent 标记受影响客户。
7. 不重试扣款、不退款、不发邮件，除非审批。

### 验收标准

- 浏览器任务有完整审计日志。
- 截图作为 artifact 保存。
- 不在 allowlist 的域名默认拦截。
- 表单提交前必须审批。
- Browser Agent 的结果可以写入 Finance/CRM。

### 退出条件

系统可以安全执行常见网页后台巡检。

## Phase 6：可靠性、治理和开源准备

### 目标

让系统从“能跑”变成“能长期跑、能恢复、能审计、能开源”。

### 模块范围

- Retry Policy
- Failure Recovery
- Rate Limit
- Integration Health Check
- Audit Export
- Permission Profiles
- Evaluation Suite
- Backup Guide
- Open Source Hygiene

### 当前落地状态

- 已新增 `010_ops_governance.sql`，为重试事件、集成健康检查、审计导出、备份运行、评估用例和权限配置建立数据库基础。
- 已新增 `011_evaluation_runs.sql`，为评估运行和逐用例结果建立持久化表。
- 已新增 [DEPLOYMENT.zh-CN.md](./DEPLOYMENT.zh-CN.md)，覆盖本地开发、Docker Compose、生产反向代理、Telegram webhook、升级、备份和故障排查。
- 已新增 [RELEASE_CHECKLIST.zh-CN.md](./RELEASE_CHECKLIST.zh-CN.md)，覆盖公开 GitHub 和私有 Git 仓库发布前检查。
- 已新增 [SECURITY.md](./SECURITY.md) 和 [CONTRIBUTING.md](./CONTRIBUTING.md)，用于开源仓库基础治理。
- 已接入 `/ops` 看板，展示可重试任务、最近重试、集成健康、审计导出、备份运行、评估用例、评估运行和权限配置。
- 已接入 `/healthcheck`，可以手动检查 PostgreSQL、Redis 和关键外部集成配置，并写入 `integration_health_checks`。
- 已接入手动 `/retry <task_id>`，允许重试 `failed`、`blocked`、`waiting_external` 和 `planned` 状态任务，并写入 `retry_events` 与审计日志。
- 已接入 `/audit_export [limit]`，可以把最近审计日志导出到本地 JSONL artifact，并写入 `audit_exports` 状态记录。
- 已接入 `/backup [row_limit]`，可以把关键业务表导出到本地 JSONL 备份目录，并写入 `backup_runs` 状态记录。
- 已接入 `/eval` 治理评估套件，覆盖外部邮件审批、浏览器表单审批、retry 不绕过审批和低风险任务不误审，并写入 `evaluation_runs` 与 `evaluation_results`。
- 已接入 `/settings` 设置看板 v0，可以查看运行配置、审批边界、集成状态和偏好记忆，并通过 `/settings preference ...` 写入偏好记忆。
- 健康检查后台调度和更深层 E2E 评估仍在后续阶段。

### 关键任务

1. 任务重试策略：

```text
transient failure -> retry
policy blocked -> waiting_approval
external unavailable -> waiting_external
model failure -> failed with reason
```

2. 所有 connector 加 health check。
3. Agent 权限配置可视化或可导出。
4. 审计日志可导出。
5. 数据备份脚本。
6. Prompt / Agent 行为评估用例。
7. GitHub 开源准备：

- license
- issue templates
- security policy
- contribution guide
- example configs
- no secrets

### 验收标准

- 失败任务不会静默消失。
- 任务可以手动重试。
- 审计日志可以导出。
- 权限配置可以检查。
- 备份和恢复流程可运行。
- 开源仓库不包含 secret 或运行数据。

### 退出条件

Tele-OPC OS V2 进入可长期维护状态。

## 里程碑总览

| 里程碑 | 版本 | 结果 |
|---|---|---|
| M0 | V2.0-alpha | 工程骨架可启动 |
| M1 | V2.0 | Telegram 任务和审批闭环 |
| M2 | V2.1 | 公司记忆、规划、日报 |
| M3 | V2.2 | CRM 和邮件跟进 |
| M4 | V2.3 | 财务和日历管理 |
| M5 | V2.4 | 浏览器自动化 |
| M6 | V2.5 | 可靠性、审计和开源准备 |

## 第一优先级 Backlog

建议立即开始的任务：

1. 初始化 Node/TypeScript 工程。
2. 添加 Docker Compose：PostgreSQL + Redis。
3. 实现配置加载：`.env` + YAML。
4. 实现 Telegram webhook。
5. 实现 owner allowlist。
6. 建立任务表和审批表。
7. 实现 `/start`、`/tasks`、`/today`。
8. 实现最小 Chief of Staff。
9. 实现审批状态流转。
10. 写第一条端到端测试。

## 开发顺序建议

不要先做复杂 Agent。建议顺序：

```text
基础服务
  -> Telegram webhook
  -> 数据库
  -> 任务状态机
  -> 审批状态机
  -> 最小 Agent
  -> 简报
  -> 记忆
  -> CRM
  -> Email
  -> Finance
  -> Calendar
  -> Browser
  -> Reliability
```

## 每阶段必须回答的问题

每进入下一个阶段前，先回答：

1. 上一阶段是否能从 Telegram 端到端验证？
2. 是否有数据库证据证明任务和审批状态正确？
3. 是否有审计日志？
4. 是否有测试覆盖关键安全边界？
5. 是否有 README 或配置文档同步更新？
6. 是否引入了新的 secret？如果有，`.env.example` 是否更新？
7. 是否引入了新的高风险动作？如果有，审批规则是否更新？

## 完成定义

Tele-OPC OS V2 完成不是指所有代码写完，而是指：

- 一个授权用户可以通过 Telegram 操作系统。
- 系统能理解任务、拆解任务、追踪任务。
- 系统能保存和使用公司记忆。
- 系统能管理 CRM、财务、邮件、日历。
- 系统能安全执行浏览器自动化。
- 所有高风险外部动作都需要审批。
- 所有关键动作都有审计证据。
- 系统可以部署、备份、恢复。
- 文档足够让另一个人部署和使用。
