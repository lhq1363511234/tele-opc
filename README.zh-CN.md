# Tele-OPC OS 中文使用说明

Telegram-first One-Person Company Operating System

中文：Telegram 优先的一人公司操作系统

> 部署、配置、开源和私有仓库说明见 [README.md](./README.md)、[DEPLOYMENT.zh-CN.md](./DEPLOYMENT.zh-CN.md) 和 [RELEASE_CHECKLIST.zh-CN.md](./RELEASE_CHECKLIST.zh-CN.md)。本文档专注于你在 Telegram 里如何使用 Tele-OPC OS V3.2 Agent OS。

## 这是什么

Tele-OPC OS V3.2 是一个一人公司 Agent OS。它把 Telegram 当作控制台，把 Chief Agent、Agent Registry、Skill Registry、任务队列、公司记忆、CRM、财务、邮件、日历和浏览器自动化组织在一起，帮助你用自然语言经营公司。

它的核心原则：

- 低风险事项可以自动整理、记录、排队。
- 高风险事项必须先起草、展示证据、等待你批准。
- 所有关键动作都应可追踪、可审计、可复盘。

## 当前可用能力

当前仓库处于 V3.2 Agent OS MVP，已经能完成：

- Telegram webhook 接收消息。
- 只允许 owner allowlist 内的 Telegram 用户操作。
- `/agents` 查看 Agent Registry，`/agent <id>` 查看单个 Agent 的职责、能力和确认边界。
- `/industry` 查看行业 Skill，`/industry <skill_id>` 查看触发词、输入、输出和风险边界。
- `/kb` 查看知识库和 Skill Registry 状态。
- `/solve <问题>` 处理多领域、多行业经营问题，生成问题重述、假设、证据计划、方案选项、推荐、风险和 7/30/90 天计划。
- `/prospect <领域/ICP>` 处理客户挖掘和销售开发，生成 ICP、公开来源策略、评分模型、触达草稿、14 天 sequence、候选 lead、lead_scores、enrichment_results 和合规边界。
- `/leads` 查看已写入的候选线索种子；`/campaigns` 查看当前 prospecting campaign 和 planned/sent/replied/opened/unsubscribed `campaign_events`。
- `/send_campaign <campaign_id>` 使用 Nodemailer/SMTP 自动发送 Campaign 邮件，不走审批；`/campaign_event <campaign_id> <event_type> [lead_id] [备注]` 手工记录回复、打开、退订、退信等事件。
- `/import 价格表：...` 可导入文本价格表，解析服务项、价格、币种和计费单位，并写入 `pricing` memory。
- `/quote <需求>` 会读取 pricing memory，生成报价依据、小计、假设、风险提示、邮件草稿和 Markdown/HTML 报价草案，并把 Markdown 报价文档草案写入 `artifacts`；配置模型后也会调用 Quote Agent AI Runtime。
- `/content <需求>` 创建 Content Agent 任务链；配置模型后会调用 Content Agent AI Runtime 生成内容草稿、标题/开头备选、脚本和发布计划。
- `/dev <任务>` 创建 Dev Agent Team 任务链；配置模型后会调用 Dev Agent AI Runtime 生成开发计划、影响范围、测试计划和风险。
- 已接入最小 AI Agent Runtime：OpenAI-compatible `ModelProvider`、`AgentRunner`、per-agent prompt、只读工具调用、`agent_runs` / `tool_calls` 轨迹。
- 当前 AI-first 原则：模型负责 Agent 推理、规划和工具选择；TypeScript 代码负责工具执行、权限闸门、状态、审计和兜底 workflow。
- 咨询类自然语言会先经过 Domain Router 和 Skill Router 预路由，再把 handoff 上下文交给 Chief Agent 汇总。
- `/solve` 和 `/prospect` 会先调用 Research Agent 生成证据计划、公开来源和待验证假设，再把上下文交给 Solution / Prospecting Agent。
- `/ops` 会先展示确定性治理看板；配置模型后，Ops Agent 会读取看板上下文生成健康判断、风险和下一步建议。
- 自然语言咨询、`/solve`、`/prospect`、`/quote`、`/content`、`/dev`，以及 CRM、Email、Finance、Calendar、Browser 的自然语言写入/运行入口，在配置模型后会调用真实 AI Agent；未配置模型时自动降级到本地 MVP workflow。
- `/runs` 优先查看真实 AI Agent run；没有模型运行记录时回退显示最近任务链。
- `/trace <agent_run_id>` 查看 AI Agent run 的模型、状态、输入摘要、输出摘要、metadata、工具调用明细和关联 handoff run。
- `/solve` 会写入 `solution_runs`、`evidence_items`、`assumptions`、`risk_items`。
- `/prospect` 会写入 `prospecting_runs`、`lead_sources`、`leads`、`lead_scores`、`enrichment_results`、`outreach_sequences`、`campaigns` 和 planned `campaign_events`。配置 `PROSPECTING_PUBLIC_SOURCE_URLS` 后，会从公开目录/搜索/招聘/新闻页面提取候选账户并标记为 `public_source_observed`，同时 upsert `organizations`，有公开邮箱/电话时创建 `contacts` 并关联到 lead；未配置时使用本地候选种子并标记为 `needs_public_verification`。
- CRM、Email、Finance、Calendar、Browser 的本地工具层会先完成可审计记录；配置模型后，对应 Specialist Agent 会读取结构化上下文生成判断、风险和下一步建议。
- 内容草稿、标题、脚本和发布计划可自动生成；公开发布、广告投放、非邮件批量触达和表单提交仍需要确认或后续连接器，邮件 campaign 可通过 `/send_campaign` 自动执行。
- 把自然语言消息创建成任务。
- 对高风险外部动作创建审批。
- 低风险任务自动进入 BullMQ 队列。
- 审批批准后关联任务进入队列。
- 审批拒绝后关联任务进入阻塞状态。
- worker v0 消费任务并推进 `queued -> running -> done`。
- 查看今日控制台。
- 查看任务列表和任务详情。
- 批准或拒绝审批。
- 发送 `记住：...` 写入公司记忆。
- 通过 `/memory` 查看公司记忆。
- 通过 `/memory preference` 等按类型过滤公司记忆。
- 起草邮件或跟进内容时应用偏好记忆。
- 审批记录会保存草稿使用过的记忆和约束。
- `/today` 输出 Daily Briefing v2：待审批、阻塞事项、正在执行、今日优先任务、CRM 客户跟进、财务提醒、日程与会议准备、邮件处理、浏览器自动化风险和建议下一步，并写入 `briefings`。
- 识别规划、计划、拆解、流程类复杂任务并生成子任务。
- 为子任务分配初始 owner agent，例如 `crm`、`email`、`finance`、`calendar`、`browser`。
- `/task <id>` 可以查看父任务拆解结果。
- `/review <task_id> <复盘内容>` 可以生成任务复盘。
- 复盘内容提到 SOP、流程、标准、沉淀或复用时，会自动生成 playbook。
- `/reviews` 查看最近任务复盘。
- `/playbooks` 查看已沉淀 playbook。
- 发送 `把 Jane 加为新线索，她来自 Acme，对企业版感兴趣。` 创建 CRM 线索。
- 自动创建公司、联系人、机会、互动记录和跟进事项。
- `/crm` 查看热线索、逾期跟进、近期跟进、开放机会和风险客户。
- 发送 `记录邮件 Jane <jane@acme.com> 主题：企业版咨询 正文：客户想了解报价，需要回复。` 手工导入邮件。
- 自动分拣紧急、客户、财务、日历、newsletter 和 ignored 邮件。
- 为需要回复的邮件创建联系人、邮件线程、邮件消息、跟进任务和回复草稿。
- V3 默认不再把普通客户邮件、邮件草稿或邮件 campaign 发送作为高风险审批；Campaign 邮件可通过配置好的 SMTP/Nodemailer 自动发送。
- `/mail` 查看紧急邮件、客户邮件、财务邮件、日历邮件和邮件草稿。
- 发送 `记录收入 12000 元 来自 Acme，企业版订阅。` 手工记录收入。
- 发送 `记录支出 299 元 给 Vercel，云服务订阅。` 手工记录支出。
- 发送 `记录订阅 Vercel 每月 299 元 下次扣费 2026-06-12。` 手工记录订阅。
- 发送 `记录发票 给 Beta 5000 元 状态 overdue 到期 2026-06-01。` 手工记录发票。
- `/finance` 查看本月收入、本月支出、净现金流、未收发票、即将扣费订阅、风险提醒和建议动作。
- 发送 `记录会议 2026-06-12 10:00 和 Alice 讨论企业版 demo，需要准备资料。` 手工记录会议。
- 自动生成会议准备 note。
- `/calendar` 查看今日/明日日程、冲突、空闲时间和会议准备。
- 发送 `去 Stripe 看看最近失败付款，整理原因。` 创建受控浏览器巡检运行记录。
- 浏览器运行会记录目标 URL、步骤、截图证据占位、提取结果占位和被拦截动作。
- allowlist 外域名默认拦截。
- 提交表单、发布、删除、购买、退款、账单修改等高风险网页动作会创建审批。
- `/browser` 查看最近运行、被拦截动作、截图证据和提取结果。
- `/ops` 查看可重试任务、最近重试、集成健康、审计导出、备份运行、评估用例、评估运行和权限配置。
- `/healthcheck` 检查 PostgreSQL、Redis、Telegram、AI、Email/Calendar、Finance 和 Browser 的配置/运行状态。
- `/eval` 运行治理评估套件，检查付费数据源审批、浏览器表单审批、retry 不绕过审批和低风险任务不误审。
- `/retry <task_id>` 手动重试 `failed`、`blocked`、`waiting_external` 或 `planned` 任务。
- 重试会创建 `retry_events`，写入审计日志，并重新进入任务队列。
- 等待审批、运行中、已排队、已完成任务不会被直接重试，避免绕过审批或重复执行。
- `/audit_export [limit]` 导出最近审计日志到本地 JSONL artifact，并在 `audit_exports` 中记录状态和路径。
- `/backup [row_limit]` 把关键业务表导出到本地 JSONL 备份目录，并在 `backup_runs` 中记录状态和路径。
- `/settings` 查看运行配置、审批边界、集成状态和偏好记忆；`/settings preference ...` 可以写入偏好记忆。
- 写入审计日志。

暂未完整实现：

- 真实搜索、地图、企业名录、招聘网站和目录源 connector。
- 真实公开来源抓取、真实联系人发现、官网/邮箱/电话核验和真实 account/contact 自动落表。
- 邮件服务商 webhook/API 自动回传 opened/replied/unsubscribed/bounced。
- 文件上传解析并生成 Skill 草案。
- 文件上传价格表解析、报价 PDF 生成、正式报价外发和开票/收款动作。
- Dev Agent Team 调 Claude Code 的真实执行连接器。
- 更完整的 CRM Agent、阶段推进、跟进识别和客户风险评分。
- 更完整的 Finance Agent、CSV 导入、预算、预测和真实银行/Stripe 连接器。
- 真实 Gmail / Outlook / IMAP 收件箱同步、线程同步和 OAuth 连接器。
- 更完整的 Calendar Agent、找时间、会议准备和 Google Calendar / Outlook Calendar 连接器。
- 真实 Playwright runner、浏览器 session 管理和截图文件落盘。
- 健康检查后台调度和更完整的评估套件后台调度。
- 完整多 Agent handoff、并行执行链路和外部写入工具。
- 更深的公司记忆检索和跨任务引用。
- Planner 的依赖执行调度和人工调整。
- 更完整的 review 评分、周期复盘和 playbook 版本管理。
- 每日简报自动推送、每周复盘和更深的跨模块经营分析。

## Telegram 命令

部署后运行 `npm run telegram:set-webhook` 或 `npm run telegram:set-commands` 会把命令菜单注册到 Telegram。注册成功后，在 bot 对话框输入 `/`，Telegram 会自动弹出可选命令，不需要手动复制命令。

当前可用：

```text
/solve <问题>
```

通用方案入口。适合发多领域、多行业问题，例如：

```text
/solve 评估深圳上班族健康轻食外卖品牌，预算 10 万，3 个月验证。
```

系统会创建 Solution workflow，选择行业 Skill 和职能 Skill，生成问题重述、假设、证据计划、方案选项、推荐方案、风险和 7/30/90 天行动计划，并写入 `solution_runs` 等 V3 专用表。

```text
/prospect <领域/ICP>
```

客户挖掘和销售开发入口。例如：

```text
/prospect 深圳 企业数字化转型 50-300 人 有招聘 IT 或运营岗位
```

系统会创建 Prospecting workflow，生成 ICP、公开来源策略、评分模型、触达草稿、14 天 sequence、候选 lead 和合规边界，并写入 `prospecting_runs`、`lead_sources`、`leads`、`lead_scores`、`enrichment_results`、`outreach_sequences`、`campaigns` 和 planned `campaign_events`。

如果配置了 `PROSPECTING_PUBLIC_SOURCE_URLS`，系统会抓取这些公开目录/搜索/招聘/新闻页面，提取候选账户和来源证据，并把候选 lead 标记为 `public_source_observed`；公开候选会自动 upsert `organizations`，如果页面里有公开邮箱/电话，会创建 `contacts` 并关联 lead。如果没有配置或没有命中，则使用本地候选种子并标记为 `needs_public_verification`。这个 connector 不登录、不购买数据、不批量外发。

```text
/leads
```

查看已写入的候选线索种子。当前展示 `leads`、`lead_scores`、`enrichment_results` 中的 MVP 记录；真实公开来源抓取、联系人发现和 account/contact 自动落表会在搜索/目录 connector 接入后完成。

```text
/campaigns
```

查看当前销售开发活动视图。当前展示 draft campaign，并把 14 天 sequence 展开成 planned `campaign_events` 草稿事件；邮件发送已通过 `/send_campaign` 接入，回复、打开、退订、退信等外部事件可用 `/campaign_event` 手工记录，后续再接服务商 webhook/API 自动回传。

```text
/send_campaign <campaign_id>
```

用 SMTP/Nodemailer 发送某个销售开发 Campaign 的邮件，不需要审批。先发送 `/campaigns` 找到 `cmp_xxx`，再发送例如：

```text
/send_campaign cmp_xxx
```

worker 会读取该 campaign 对应 prospecting run 的 leads，优先使用公开邮箱或 lead metadata 中的邮箱。发送成功写入 `email_sent`，没有邮箱或 SMTP 未配置写入 `email_send_skipped`，发送失败写入 `email_send_failed`。

```text
/campaign_event <campaign_id> <event_type> [lead_id] [备注]
```

手工记录邮件外部事件。当前可用事件包括 `replied`、`opened`、`unsubscribed`、`bounced`，也可写完整的 `email_replied`、`email_opened`、`email_unsubscribed`、`email_bounced`。例如：

```text
/campaign_event cmp_xxx replied lead_xxx 客户感兴趣，约下周沟通
```

```text
/agents
```

查看 Agent Registry。

```text
/agent <id>
```

查看单个 Agent 的职责、能力和确认边界，例如：

```text
/agent prospecting
```

```text
/industry
```

查看内置行业 Skill 列表。

```text
/industry <skill_id>
```

查看单个 Skill 的触发词、必要输入、输出和风险边界，例如：

```text
/industry industry.restaurant_local_life
```

```text
/quote <需求>
```

生成报价草案。先导入文本价格表：

```text
/import 价格表：网站维护套餐 3000 元/月；企业版 12000 元/年
```

然后发送：

```text
/quote 给 Acme 出网站维护套餐报价
```

系统会建立报价任务链，读取 `pricing` memory，生成价格依据、小计、风险提示、邮件草稿和 Markdown/HTML 报价草案，并返回 Markdown 报价文档 artifact ID/URI。它不会自动开票、收款、发送邮件或形成合同承诺。

```text
/content <需求>
```

生成内容草稿、活动文案和发布计划。例如：

```text
/content 给深圳健康轻食品牌写 3 条小红书种草文案
```

系统会建立 Content Agent 任务链；配置模型后会调用 Content Agent AI Runtime 生成受众判断、渠道建议、内容草稿、标题/开头备选、发布节奏和风险边界。它不会自动公开发布、投放广告或非邮件批量触达；包含“发布到”“投放广告”“群发短信/私信/电话”等动作时会进入审批。邮件 campaign 发送走 `/send_campaign`，不需要审批。

```text
/dev <任务>
```

创建 Dev Agent Team 任务链。配置模型后会先调用 Dev Agent AI Runtime 生成开发计划、影响范围、测试计划和风险；当前仍只建立 spec、repo context、实现、测试、review 子任务，Claude Code connector 和真实测试执行仍待接入。

```text
/kb
```

查看知识库和 Skill Registry 状态。

```text
/import
```

导入文本资料。当前已支持文本价格表导入；文件上传解析、行业资料、SOP、合同条款和 Skill 草案生成后续接入。

```text
/runs
```

查看最近 AI Agent run。配置模型后会显示 `agent_runs` 中的真实模型执行记录；如果还没有模型运行记录，则回退显示最近任务链。

```text
/trace <agent_run_id>
```

查看单次 AI Agent run 的可读轨迹。先用 `/runs` 找到 run ID，再发送例如：

```text
/trace agr_xxx
```

系统会显示该 run 的 Agent、模型、状态、任务 ID、输入摘要、输出摘要、metadata、工具调用和关联 handoff run。Chief 发起 Specialist handoff 时，可以从 Chief run 看到下游 Specialist run，也可以从 Specialist run 反查 Chief root run。

```text
/start
```

连接系统，确认 bot 可用。

```text
/today
```

查看今日简报。当前会列出待审批、阻塞事项、正在执行、今日优先任务、客户跟进、财务提醒、日程与会议、邮件处理、浏览器自动化风险和建议下一步，并把本次简报写入 `briefings`。

```text
/briefing
```

当前等同于今日简报入口；后续会支持自动推送和每周复盘。

```text
/crm
```

查看 CRM 看板，包括热线索、逾期跟进、近期跟进、开放机会和风险客户。

```text
/finance
```

查看财务看板，包括本月收入、本月支出、净现金流、未收发票、即将扣费订阅、风险提醒和建议动作。当前版本是内部手工台账，不会连接银行、Stripe 或真实付款渠道。

```text
/calendar
```

查看日历看板，包括今日/明日日程、冲突、空闲时间和会议准备。当前版本是内部手工日程台账，不会连接 Google Calendar、Outlook Calendar，也不会真实发送外部邀请。

```text
/browser
```

查看浏览器看板，包括最近运行、被拦截动作、截图证据和提取结果。当前版本只记录受控运行计划和证据占位，不会启动真实浏览器，也不会提交网页动作。

```text
/ops
```

查看运维治理看板，包括可重试任务、最近重试、集成健康、审计导出、备份运行、评估用例、评估运行和权限配置。

```text
/healthcheck
```

手动运行集成健康检查。当前会检查 PostgreSQL、Redis、Telegram、AI、Email/Calendar、Finance 和 Browser 的配置或运行状态，并写入 `integration_health_checks`。

```text
/eval
```

运行治理评估套件。当前会检查付费数据源是否必须审批、浏览器表单提交是否必须审批、`/retry` 是否不会绕过等待审批任务，以及低风险内部任务是否不会误触发审批；结果写入 `evaluation_runs` 和 `evaluation_results`。

```text
/retry <task_id>
```

手动重试失败或阻塞任务。当前允许重试 `failed`、`blocked`、`waiting_external` 和 `planned` 状态；不会直接重试等待审批、运行中、已排队或已完成任务。

```text
/audit_export [limit]
```

导出最近审计日志。默认导出最近 200 条，最大 1000 条，生成本地 `runtime/artifacts/audit/*.jsonl` 文件，并写入 `audit_exports` 状态记录。

```text
/backup [row_limit]
```

创建本地 JSONL 备份。默认每张表最多导出 5000 行，最大 50000 行，生成 `runtime/artifacts/backups/<backup_id>/` 目录，并写入 `backup_runs` 状态记录。

```text
/mail
```

查看邮件看板，包括紧急邮件、客户邮件、财务邮件、日历邮件和邮件草稿。当前版本的收件箱仍是手工记录邮件；Campaign 邮件发送已通过 SMTP/Nodemailer 接入，可用 `/send_campaign <campaign_id>` 自动发送。

```text
/tasks
```

查看最近任务。

```text
/task <id>
```

查看单个任务详情。

```text
/approve <approval_id>
```

批准一个待审批动作。

```text
/reject <approval_id>
```

拒绝一个待审批动作。

```text
/memory
```

查看最近公司记忆。

```text
/memory <type>
```

按类型查看公司记忆。当前类型包括 `strategic`、`operational`、`relationship`、`financial`、`preference`、`playbook`。

```text
/review <task_id> <复盘内容>
```

生成任务复盘；如果复盘内容适合复用，系统会沉淀 playbook。

```text
/reviews
```

查看最近任务复盘。

```text
/playbooks
```

查看已沉淀 playbook。

```text
/settings
```

查看设置看板，包括运行环境、时区、公开地址、语言、审批边界、集成状态和偏好记忆。发送 `/settings preference 客户跟进邮件最多 120 字` 可以写入偏好记忆。

`/settings` 不会写入 Telegram token、OAuth refresh token、支付密钥或真实 YAML 配置；这些 secret 仍应放在 `.env`、secret manager 或服务器环境变量中。

`/settings guardrails` 会显示 Guardrails Console：审批边界、`external_write_request` 外部写入意图工具、待审批动作和集成状态。AI Agent 请求付款、提交表单、发布、部署、购买数据或执行破坏性操作时，会先生成审批记录，不会直接执行；邮件 campaign 发送由专用发送器自动执行并写入事件。

## 自然语言使用方式

你可以直接说：

```text
今天公司有什么需要我处理？
```

```text
帮我准备一封给 Alice 的跟进邮件，但不要直接发送。
```

```text
找出这周最应该跟进的客户。
```

```text
把 Jane 加为新线索，她来自 Acme，对企业版感兴趣。
```

```text
帮我规划一个客户跟进流程：整理客户名单、起草跟进邮件、安排会议
```

```text
分析这个月现金流，有什么风险？
```

```text
明天日程是什么？帮我准备每个会议的背景资料。
```

```text
去 Stripe 看一下最近失败付款，并总结原因。
```

当前 V3.2 MVP 会先把这些请求转成任务、V3 workflow、专用 run 记录、草稿、子任务计划或内部业务记录。真实外部 connector 完整后，系统会进一步调用搜索、邮件、日历、浏览器、报价和开发工具。

## 审批机制

Tele-OPC OS 不应该偷偷执行高风险动作。

例如你说：

```text
帮我准备一封给 Alice 的跟进邮件，但不要直接发送。
```

系统应该：

1. 创建任务。
2. 识别这是普通单封客户跟进草稿。
3. 应用偏好记忆和 playbook。
4. 生成邮件草稿并进入队列。
5. 不默认创建无意义审批，也不会真实发送。

默认必须审批：

- 批量短信、私信、电话或其他非邮件冷启动外联。
- 购买线索、使用付费数据源或启动广告投放。
- 提交外部网页表单。
- 付款、退款、转账。
- 取消订阅。
- 报税、真实开票、账单修改。
- 发布内容。
- 生产部署。
- 删除记录或文件。
- 密钥变更、破坏性命令或外部承诺合同金额/条款。

默认可以自动处理：

- `/solve` 普通方案分析。
- `/prospect` 客户挖掘草稿、ICP、来源策略、评分模型和触达草稿。
- 总结信息。
- 起草内容。
- 创建内部任务。
- CRM 内部线索/跟进记录。
- 单封普通邮件草稿。
- 写入低风险备注。
- 截图保存证据。
- 读取已授权数据。

## 每日工作流

每天开始时发送：

```text
/today
```

V3.2 输出会包含：

- 今天最重要的 3-5 件事。
- 待审批动作。
- 卡住的任务。
- CRM 跟进。
- 财务提醒。
- 邮件分拣。
- 日历冲突和会议准备。
- 浏览器自动化发现的问题。

你可以继续追问：

```text
只显示需要我审批的事情。
```

```text
低风险事项你先处理，涉及外部动作再问我。
```

```text
把今天的客户跟进排个优先级。
```

## Planner 目标用法

你可以说：

```text
帮我规划一个 CRM、邮件、财务、日历和浏览器自动化的运营流程。
```

当前 Planner v1 会先生成父任务，再拆出子任务，并为每个子任务分配初始负责 agent。你可以用：

```text
/task <id>
```

查看拆解结果和子任务顺序。

## Review Loop 目标用法

任务完成后，你可以说：

```text
/review tsk_xxx 已完成，结果达标。下次应该沉淀为标准流程复用。
```

系统会生成任务复盘，记录结果是否达标、经验、下一步动作。如果复盘里出现 SOP、流程、标准、沉淀或复用等信号，系统会自动生成 playbook。

## CRM 目标用法

你可以问：

```text
今天我最应该推进哪些线索？
```

目标行为：

- 排序高优先级线索。
- 展示上次互动。
- 解释为什么重要。
- 建议下一步动作。
- 起草跟进内容。
- 邮件发送不请求审批；如果下一步涉及非邮件外联、表单提交、付款或合同承诺，再请求审批。

你也可以说：

```text
把 Jane 加为新线索，她来自 Acme，对企业版感兴趣。
```

目标行为：

- 创建或更新联系人。
- 必要时创建公司。
- 记录来源消息。
- 建议下次跟进时间。
- 写入公司记忆。

## 财务目标用法

你可以问：

```text
这个月现金流怎么样？
```

当前 Finance v0 会从内部手工台账生成 `/finance` 看板：

- 总结收入和支出。
- 展示未收发票。
- 展示即将扣费的订阅。
- 标记风险。
- 推荐下一步动作。

你也可以手工记账：

```text
记录收入 12000 元 来自 Acme，企业版订阅。
```

```text
记录支出 299 元 给 Vercel，云服务订阅。
```

```text
记录订阅 Vercel 每月 299 元 下次扣费 2026-06-12。
```

```text
记录发票 给 Beta 5000 元 状态 overdue 到期 2026-06-01。
```

当前版本不会连接银行、Stripe 或真实付款渠道。后续 Finance Agent 会加入 CSV 导入、预算、预测和外部财务连接器。

你也可以说：

```text
找出我应该取消的订阅。
```

目标行为：

- 找出低价值周期费用。
- 估算节省金额。
- 准备取消步骤。
- 真正取消前请求审批。

## 邮件目标用法

Campaign 邮件发送使用 SMTP/Nodemailer。Gmail 推荐配置：

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-gmail@gmail.com
SMTP_PASSWORD=your-google-app-password
SMTP_FROM=your-gmail@gmail.com
```

`SMTP_FROM` 是邮件里的发件人，可以直接填 Gmail 地址，也可以填 `你的名字 <your-gmail@gmail.com>`。`SMTP_SECURE=true` 表示使用 SSL/TLS，通常配 `SMTP_PORT=465`；如果使用 `587` 端口，一般设置 `SMTP_SECURE=false`。

如果填了 `SMTP_USER`，也必须填 `SMTP_PASSWORD`；否则系统会把 SMTP 视为未配置，并把 campaign 事件记为 `email_send_skipped`，不会用空密码尝试登录。

你可以说：

```text
记录邮件 Jane <jane@acme.com> 主题：企业版咨询 正文：客户想了解报价，需要回复。
```

当前 Email v0 会手工导入这封邮件，关联联系人，生成跟进任务和回复草稿。普通客户邮件草稿不默认审批；销售开发 Campaign 邮件可以通过 `/send_campaign <campaign_id>` 使用 SMTP/Nodemailer 自动发送。

你也可以说：

```text
帮我分拣收件箱。
```

目标行为：

- 按紧急程度分组邮件。
- 找出客户邮件。
- 识别需要跟进的线索。
- 把邮件关联到 CRM 联系人。
- 起草回复。
- 普通单封草稿自动排队；Campaign 邮件发送不需要审批；非邮件批量触达、表单提交、付款、发布、部署等高风险动作仍请求审批。

## 日历目标用法

你可以问：

```text
明天日程是什么？
```

当前 Calendar v0 会从内部手工日程台账生成 `/calendar` 看板：

- 总结会议。
- 检测冲突。
- 建议可用时间。

你也可以手工记录会议：

```text
记录会议 2026-06-12 10:00 和 Alice 讨论企业版 demo，需要准备资料。
```

如果文本里出现“准备、资料、背景、议程、客户、demo”等信号，系统会自动生成会议准备 note。当前版本不会连接 Google Calendar、Outlook Calendar，也不会真实发送外部邀请。

## 浏览器自动化目标用法

你可以说：

```text
去 Stripe 看一下失败付款，并总结原因。
```

当前 Browser v0 会创建受控浏览器运行记录，保存目标 URL、运行步骤、截图证据占位、提取结果占位和拦截动作。它不会启动真实 Playwright 浏览器。

目标行为：

- 打开受控浏览器。
- 检查后台页面。
- 收集证据。
- 必要时截图。
- 总结发现。
- 更新财务或 CRM 记录。
- 在重试扣款、退款、提交表单或变更账单前请求审批；给客户发邮件不需要审批。

浏览器自动化必须保存：

- 任务目标。
- 访问 URL。
- 执行步骤。
- 截图。
- 提取数据。
- 被拦截的高风险动作。
- 最终结果。

## Ops/Governance 目标用法

你可以发送：

```text
/ops
```

当前 Ops v0 会展示：

- 可重试任务。
- 最近重试事件。
- 集成健康状态。
- 审计导出计划或结果。
- 备份运行计划或结果。
- 评估用例。
- 最近评估运行。
- Agent 权限配置。
- 审计导出 artifact 路径和状态。
- 本地备份 artifact 路径和状态。

你可以手动检查集成状态：

```text
/healthcheck
```

系统会：

1. 检查 PostgreSQL 是否可读。
2. 检查 Redis 是否可 ping。
3. 检查 Telegram、AI、Email/Calendar、Finance 和 Browser 的关键配置是否存在。
4. 写入 `integration_health_checks`。
5. 写入 `integration_health_checked` 审计日志。

你可以手动运行治理评估：

```text
/eval
```

系统会：

1. 创建评估运行记录。
2. 执行默认治理评估用例。
3. 为每个用例写入评估结果。
4. 汇总通过、失败和跳过数量。
5. 写入 `evaluation_run_completed` 审计日志。

当任务失败、阻塞或等待外部系统恢复后，你可以发送：

```text
/retry tsk_xxx
```

系统会：

1. 检查任务是否存在。
2. 检查任务是否处于可重试状态。
3. 创建重试事件。
4. 写入审计日志。
5. 把任务重新纳入队列。

它不会用 `/retry` 绕过审批。等待审批的任务必须先通过 `/approve <approval_id>` 或 `/reject <approval_id>` 处理。

你也可以导出最近审计日志：

```text
/audit_export 200
```

系统会：

1. 创建审计导出记录。
2. 读取最近审计日志。
3. 写入本地 JSONL 文件。
4. 更新导出状态和 artifact 路径。
5. 写入 `audit_export_completed` 审计日志。

你也可以创建本地备份：

```text
/backup 5000
```

系统会：

1. 创建备份运行记录。
2. 按 allowlist 导出关键业务表。
3. 为每张表写入 JSONL 文件。
4. 写入 `manifest.json`。
5. 更新 `backup_runs` 状态和 artifact 路径。
6. 写入 `backup_completed` 审计日志。

## 公司记忆目标用法

你可以教系统：

```text
记住，客户跟进邮件要短一点，最大 120 字。
```

```text
记住：我们的语气要简洁、直接，不要太销售。
```

```text
记住：Alice 更喜欢周二下午开会。
```

```text
把这个保存为新客户 onboarding 的标准流程。
```

重要记忆变更应该能追溯到来源消息或产物。

当你之后说：

```text
给 Alice 起草一封跟进邮件。
```

系统会生成草稿，并把使用到的偏好记忆写入任务或草稿 metadata；邮件发送不进入审批，非邮件批量触达、表单提交、付款、发布、部署等高风险动作才进入审批。

## 安全预期

Tele-OPC OS 应该有用，但不能鲁莽。

默认行为：

- 在授权范围内读取和分析。
- 先起草，再发送。
- 外部动作前请求审批。
- 记录工具调用。
- 浏览器自动化保存截图和产物。
- 高风险权限保持最小化。
- 审批必须清晰、可见、可追踪。

## 下一步实现顺序

实现顺序以路线图为准：

1. 完善 V3 Agent Registry、Skill Registry 和 Telegram UX。
2. 完善 `/solve` 的 Solution Engine、证据、假设、风险和复盘闭环。
3. 完善 `/prospect` 的真实搜索、目录源、线索补全、评分和 CRM/prospecting 落表。
4. 完善文件上传价格表解析、报价 PDF、合同/SOW 文档生成和报价正式外发边界。
5. 接入邮件、日历、浏览器、GitHub/private Git、Claude Code 和财务系统的真实 connector。
6. 完善 Multi-Agent Execution Loop、tool calls、tracing、失败定位和部分结果汇报。
7. 完善 V3 部署、开源发布、安全、备份和长期运维。

具体见 [V3_AGENT_OS_ROADMAP.zh-CN.md](./V3_AGENT_OS_ROADMAP.zh-CN.md)。
