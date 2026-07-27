# Tele-OPC 模块架构地图

> 目标：任何页面或业务故障都能先定位到一个主模块，再查该模块的前端、API、领域服务、数据表、后台进程和外部依赖。

## 1. 总体分层

```text
入口层
  Web / Telegram / Feishu
        ↓
身份与通道层
  Owner allowlist / Web auth / channel idempotency
        ↓
数字本人指挥层
  ChiefOfStaff / ContextPack / A- Persona / Agent Runtime
        ↓
业务编排层
  Task / Approval / Queue / Worker / AppOS Workflow
        ↓
业务模块层
  CRM / Mail / Finance / Calendar / Browser / Knowledge / Deliverables
        ↓
数据与集成层
  PostgreSQL / Redis / Feishu / SMTP / Dify / n8n / Paperclip / Browser
```

## 2. 模块编号

### M00 Web Shell 与导航

- **责任**：路由、侧边栏、页面容器、Mini App 入口、全局样式。
- **前端**：`web/src/App.tsx`、`web/src/lib/routing.ts`、`web/src/styles.css`、`web/src/main.tsx`。
- **后端入口**：`src/webConsole.ts` 的静态站点路由。
- **常见故障**：页面空白、菜单错页、移动端溢出、构建后仍显示旧页面。
- **边界**：不得在 `App.tsx` 新增领域业务算法；新页面应拆独立 component/module。

### M01 Web 身份与会话

- **责任**：Web Console 访问模式、Telegram Mini App initData、dev token、session。
- **前端**：`web/src/api.ts`。
- **后端**：`src/web/auth.ts`、`src/web/telegramInitData.ts`、`/api/web/session`、`/api/web/telegram-diagnostics`。
- **配置**：`WEB_CONSOLE_AUTH_MODE`、`WEB_CONSOLE_DEV_TOKEN`、Telegram token/owner IDs。
- **常见故障**：网页要求凭证、Mini App 能打开但 API 401、普通浏览器与 Telegram 表现不同。

### M02 Owner Cockpit 与经营分析

- **责任**：今日优先级、全局经营指标、业务可视化、Ops insight。
- **前端**：`MissionControl`、`TodayCockpit`、`OpsInsightsPage`、App.tsx analytics 区域。
- **后端**：`/api/web/overview`、`/api/web/analytics`、`/api/web/ops-insights`、`src/web/analytics.ts`。
- **数据**：`business_analytics_facts` 加 CRM/Finance/Task/Approval 聚合。
- **常见故障**：图表为零、演示数据与真实数据混合、指标口径不一致、首页建议不合理。

### M03 A- 数字本人

- **责任**：人格、价值排序、决策原则、记忆证据、Decision Log、经营建议和关系建议。
- **前端**：`web/src/components/ASelfConsole.tsx`、`RelationshipDesk.tsx`。
- **后端**：`src/a-self/*`、`/api/web/a-self*`。
- **数据**：`a_self_profiles`、`a_self_memory_items`、`a_self_decision_logs`、`a_self_permission_rules`、`a_self_opc_runs`。
- **常见故障**：人格像助手而不是本人、蒸馏覆盖错误、他人观点写入本人、建议不引用人格证据。

### M04 AI Command Spine

- **责任**：理解当前请求、加载上下文、替本人做取舍、选择 Agent/Skill、生成任务或直接回答。
- **代码**：`src/brain/chiefOfStaff.ts`、`contextPack.ts`、`commandRouter.ts`、`src/intake/*`、`src/work/workStrategy.ts`。
- **AI**：`src/ai/modelProvider.ts`、`agentRunner.ts`、`agentPrompts.ts`、工具文件。
- **数据**：`agent_runs`、`tool_calls`、memories、tasks。
- **常见故障**：听不懂自然语言、把决定退回用户、每个新需求造专用引擎、错误继承上一任务上下文。
- **重构目标**：拆成 CEO Agent、CoS Context、Contract、Tool Registry 四个子模块。

### M05 Task / Queue / Worker / Approval

- **责任**：任务状态、子任务依赖、队列、执行、审批暂停和恢复、失败重试。
- **前端**：Tasks、Mission 审批区。
- **后端**：`src/queue/taskQueue.ts`、`src/worker.ts`、`src/policy/*`、`src/web/actions-routes.ts`、Chief approval commands。
- **数据**：`tasks`、`task_events`、`task_dependencies`、`approvals`、`retry_events`、`audit_logs`。
- **服务**：`tele-opc-worker.service`；日志 `runtime/logs/worker.dev.log`。
- **常见故障**：任务无反应、一直 queued/running、批准后不继续、步骤跳过、重复审批。

### M06 Agent / Skill / Trace

- **责任**：数字员工名册、Skill 选择、Agent run、Tool call 和执行轨迹。
- **前端**：Agents、Agent Network、任务详情 Trace。
- **后端**：`src/agents/registry.ts`、`src/skills/registry.ts`、`src/ai/*`。
- **数据**：`skill_registry`、`skill_versions`、`skill_runs`、`agent_runs`、`tool_calls`。
- **常见故障**：Agent 未被调用、Tool call 空、模型输出有但任务无结果、Trace 找不到链路。

### M07 CRM / Prospecting / Market

- **责任**：市场扫描、ICP、公开搜索、线索、客户、机会、跟进、Campaign。
- **前端**：CRM、`LeadBrowser.tsx`、`CrmImportStudio.tsx`。
- **后端**：`src/crm/*`、`src/prospecting/*`、`/api/web/crm*`、Studio CRM routes。
- **数据**：organizations、contacts、opportunities、interactions、follow_ups、prospecting_runs、leads、lead_scores、campaigns、campaign_events。
- **常见故障**：搜不到线索、100 条未落库、重复公司、飞书看不到、来源不可信、邮件历史未关联客户。

### M08 Mail / Outreach

- **责任**：邮件导入、分类、草稿、SMTP 发送、Campaign 发送与事件。
- **前端**：Mail 页面、`MailStudio.tsx`。
- **后端**：`src/email/*`、`/api/web/mail*`、Campaign sender。
- **数据**：email_accounts、email_threads、email_messages、email_drafts、campaign_events。
- **外部依赖**：SMTP；真实 IMAP/Gmail/Outlook 尚未形成生产同步。
- **常见故障**：声称发送但无历史、SMTP 配置失败、草稿和真实发送混淆、Campaign 状态不更新。

### M09 Finance

- **责任**：表格解析、收支/发票/订阅、财务动作计划、Finance Gate、风险和现金流分析。
- **前端**：Finance 页面、`FinanceImportStudio.tsx`、`FinanceActionStudio.tsx`。
- **后端**：`src/finance/*`、Studio finance routes、approval policy、external actions。
- **数据**：transactions、invoices、subscriptions、approvals、artifacts、business analytics facts。
- **常见故障**：表格读错列、金额编造、重复导入、提交财务动作未审批、财务图表口径错误。

### M10 Calendar

- **责任**：内部日程、冲突、空闲时间、会议准备。
- **前端**：Calendar 页面与 quick entry。
- **后端**：`src/calendar/*`、`/api/web/calendar*`。
- **数据**：calendar_accounts、calendar_events、meeting_notes、availability_windows。
- **常见故障**：时区错误、结束时间早于开始、内部台账与真实飞书/Google 日历不一致。

### M11 Browser / Research

- **责任**：网页读取、允许域名、截图、提取、公开搜索和证据。
- **前端**：Browser 页面、截图 Mini App。
- **后端**：`src/browser/*`、`src/prospecting/webSearch.ts`、AI capability tools。
- **数据**：browser_runs、browser_steps、browser_screenshots、browser_extractions、browser_blocked_actions。
- **常见故障**：抓取为空、域名被拦、浏览器动作等待审批、网页结构变化、搜索有结果但没证据。

### M12 Deliverables / PPT / Artifact

- **责任**：PPT、HTML、文档、代码和报告等交付物生成、下载和预览。
- **前端**：`DeckStudio.tsx`、DeliverablePage。
- **后端**：`src/deliverables/*`、delivery strategy、Studio deck routes、artifact API。
- **数据**：artifacts。
- **常见故障**：PPT 丑、下载失败、预览空白、Artifact 找不到、内容生成完成但页面无入口。
- **缺口**：版本、模板、来源引用和跨任务资产库。

### M13 Knowledge / Memory OS

- **责任**：公司资料、价格规则、SOP、知识导入、普通 memories。
- **前端**：`KnowledgeStudio.tsx`、Agent Settings 中的知识/偏好。
- **后端**：`src/memory/*`、Knowledge Studio routes、飞书 attachment disposition。
- **数据**：memories、memory_sources、playbooks、a_self_memory_items、artifacts。
- **常见故障**：上传后不知道放哪、知识未被 Agent 使用、来源丢失、错误内容污染人格。
- **缺口**：LibraryItem、语义检索、MemoryCandidate/Conflict 生命周期。

### M14 Telegram Channel

- **责任**：Webhook、owner allowlist、消息幂等、命令、卡片、审批按钮、Mini App。
- **代码**：`src/telegram/*`、`src/auth/ownerAllowlist.ts`、`src/app.ts` webhook routes。
- **数据**：users、telegram_chats、messages。
- **配置**：Telegram token、owner IDs、webhook secret。
- **常见故障**：Bot 无反应、按钮失效、Mini App 认证失败、消息进入但 Chief 未处理。

### M15 Feishu Channel 与经营台账

- **责任**：飞书私聊、事件监听、资料上传、审批回复、Base 台账同步。
- **代码**：`src/feishu/*`、`src/appos/feishu/*`、`src/appos/channels/feishu.ts`。
- **数据**：channel_messages、channel_notifications、artifacts、tasks、AppOS 映射。
- **服务**：`tele-opc-feishu.service`；日志 `runtime/logs/feishu.dev.log`。
- **常见故障**：机器人收不到消息、文件无法下载、批准未关联、台账同步失败、Open ID 不在 allowlist。

### M16 AppOS Workflow / Dify / n8n

- **责任**：Business Contract、Workflow Run、外部工作流选择、Dify/n8n 调用与失败事件。
- **代码**：`src/appos/contracts/*`、`gateway/*`、`workflows/*`、`connectors/dify.ts`、`connectors/n8n.ts`、`repair/*`。
- **数据**：appos_business_contracts、appos_workflow_runs、appos_application_events、appos_failure_events。
- **常见故障**：Contract 创建但 Workflow 不跑、provider 输出无法映射、callback 丢失、失败反复重试。

### M17 Paperclip Governance

- **责任**：公司治理、项目/目标/Issue/Agent 同步和 heartbeat。
- **前端**：`PaperclipGovernance.tsx`。
- **后端**：`src/integrations/paperclip/*`。
- **配置**：PAPERCLIP_*。
- **常见故障**：项目/Issue 看不到、heartbeat 超时、远端 ID 映射错误。

### M18 Dependencies / Settings / Integrations

- **责任**：依赖清单、启停/重启、模型设置、权限策略、飞书状态。
- **前端**：Dependencies、Settings、`AgentSettingsStudio.tsx`。
- **后端**：`src/appos/dependencies/registry.ts`、settings/feishu status routes、config。
- **常见故障**：页面显示已配置但服务不可用、凭证存在但权限不足、依赖测试误报。

### M19 Data / Infra / Deployment

- **责任**：PostgreSQL、Redis DB15、migration、API 服务、静态构建、systemd、Cloudflare。
- **代码**：`src/db/*`、`src/config/index.ts`、`src/server.ts`、deployment files。
- **服务**：tele-opc-api、tele-opc-worker、tele-opc-feishu。
- **日志**：api.dev.log、worker.dev.log、feishu.dev.log、web-build.log。
- **常见故障**：网站打不开、CPU 100%、数据库未迁移、Redis 队列异常、构建版本未发布。

### M20 CPS / Short Drama Domain Extension

- **责任**：Inbeidou、MoboBoost、短剧下载/预处理/剪辑工作流及飞书卡片。
- **代码**：`src/appos/domains/cps/*`、scripts/appos、相关 docs/tests。
- **常见故障**：平台页面变化、下载按钮失效、Windows 路径问题、字幕/视频类型识别错误。
- **边界**：这是领域插件，不应把平台特例写入核心 M04/M05。

## 3. 四个高风险“大文件”重构边界

| 当前文件 | 风险 | 目标拆分 |
| --- | --- | --- |
| `web/src/App.tsx` | 页面、路由和大量业务 UI 混在一起 | `web/src/modules/<module>/`，每个导航模块独立页面、queries、types |
| `src/webConsole.ts` | 聚合路由与业务 API 混在一起 | `src/modules/<module>/web-routes.ts`，webConsole 只注册模块 |
| `src/brain/chiefOfStaff.ts` | 意图、业务流程、Agent、审批、呈现混在一起 | command-spine、contracts、handoff、domain adapters |
| `src/worker.ts` | 队列消费、业务执行、通知、父任务推进混在一起 | worker runtime + execution handlers + lifecycle notifier |

## 4. 推荐的新目录形态

```text
src/modules/
  cockpit/
  digital-self/
  tasks/
  approvals/
  agents/
  crm/
  mail/
  finance/
  calendar/
  browser/
  deliverables/
  knowledge/
  channels/
    telegram/
    feishu/
  workflows/
  integrations/

web/src/modules/
  cockpit/
  digital-self/
  tasks/
  agents/
  crm/
  mail/
  finance/
  calendar/
  browser/
  deliverables/
  knowledge/
  dependencies/
  settings/
```

迁移采用“触碰即拆分”：修某模块 Bug 时，把该模块相关逻辑从大文件移入对应目录，不进行一次性全站重写。
