# Tele-OPC OS V3 Agent OS 实施路线图

Telegram-first Multi-Agent One-Person Company Operating System

状态：V3.2 MVP 实施中。已落地项已打勾；未接真实外部执行器的项目保持未勾选。

## 0. 当前实现状态

更新时间：2026-06-15。

说明：

- `[x]` 表示已经落到当前工作区代码、测试或迁移文件。
- `[ ]` 表示尚未实现。
- 本轮已完成验证：`npm run typecheck`、`npm test`、`npm run build` 均通过。

重要澄清：

- 当前打勾的 `Agent Registry`、`Skill Registry`、`Solution Engine MVP`、`Prospecting & Sales Engine MVP`，表示已经有 Agent 定义、Skill 定义、命令入口、任务拆解、数据库记录、审计和队列闭环。
- 本轮已经补上最小 AI Agent Runtime：OpenAI-compatible `ModelProvider`、`AgentRunner`、per-agent prompt、只读工具调用、`agent_runs` / `tool_calls` 轨迹，以及咨询类自然语言、Domain Router / Skill Router 预路由 handoff、Research Agent 前置研究计划、`/solve`、`/prospect`、`/quote`、`/content`、`/dev`、CRM、Email、Calendar、Finance、Browser、Ops 自然语言/命令入口的模型接入。
- 最新实现已补上 Chief Agent 驱动的 Specialist handoff MVP：Chief 可通过 `plan_specialist_handoff` 工具选择下游 Specialist，系统按计划并行/串行执行多个 Agent，支持一次重试、部分结果汇报、blocked external write intent 工具和多 Agent `/trace` 链路查看。
- V3 后续必须坚持 AI-first：每个 Agent 的推理、规划、工具选择和复盘都应由模型驱动；TypeScript 代码只负责工具实现、权限闸门、状态、审计、数据结构和兜底 workflow。
- 这仍不等于“每个 Agent 都已经完整 AI 化”。当前 Chief、Domain Router、Skill Router、Research、Solution、Prospecting、Quote、Content、Dev、CRM、Email、Calendar、Finance、Browser、Ops 已接 AI Runtime MVP；代码仍保留确定性 workflow、规则、模板和任务链作为兜底。
- 还未完成真实外部写入 connector、生产级 guardrails UI、可视化 tracing 面板和更完整的跨任务编排。
- 后续原则不变：模型负责推理、规划、工具选择和结果复盘，代码负责工具执行、权限、状态、审计和安全边界。

### 0.1 已打勾：V3 架构骨架

- [x] V3.2 路线图已从“开发单机器人”升级为“多领域方案 + 客户挖掘 + 执行落地”的 Agent OS。
- [x] 多行业能力已从静态 Industry Pack 改为 `Skill Registry + Skill Router + Industry Skills + Function Skills`。
- [x] `Agent Registry` 已扩展，包含 `Domain Router`、`Skill Router`、`Solution Engine`、`Prospecting & Sales Engine`、`ICP Agent`、`Lead Scoring Agent`、`Sales Sequence Agent`、`Quote Agent`、`Dev Agent Team`。
- [x] 新增内置 `Skill Registry`，包含餐饮/本地生活、跨境电商、SaaS/软件服务、内容 IP/自媒体等行业 Skill，以及市场调研、客户挖掘、CRM 跟进、定价报价、财务模型、项目管理、合规检查等职能 Skill。
- [x] `Planner` 已能把方案、客户挖掘、报价、开发等自然语言任务路由到 `solution`、`prospecting`、`quote`、`dev` 等 V3 owner agent。
- [x] `Worker` 已能识别 V3 workflow metadata，并在任务完成结果中返回 workflow 与 Skill trace。
- [x] 最小 AI Agent Runtime 已落地：OpenAI-compatible provider、AgentRunner、Agent prompt、只读工具调用、Agent run/tool call 轨迹。
- [x] Domain Router / Skill Router 预路由 handoff MVP 已落地：咨询类自然语言会先产生 `domain_router` 和 `skill_router` run，再把上下文交给 Chief Agent。
- [x] Research Agent 前置 handoff MVP 已落地：`/solve` 和 `/prospect` 会先产生 `research` run，并把证据计划上下文传给 Solution / Prospecting Agent。
- [x] Ops Agent AI Runtime MVP 已落地：`/ops` 会把治理看板上下文交给 Ops Agent 生成健康判断、风险和下一步建议。
- [x] Content Agent AI Runtime MVP 已落地：`/content` 和低风险自然语言内容需求会创建内容任务链，并调用 Content Agent 生成草稿、标题、脚本和发布计划。
- [x] Work Strategy / Delivery Strategy 已前置到自然语言内容类任务：PPT、网页、代码、长文档会先判断执行方式和最佳展示方式，再发布任务。
- [x] PPT 类任务已升级为 `presentation_deck` / `slide_deck_html` 交付：内部任务契约保留在 metadata/trace，最终幻灯片 artifact 只呈现正式内容。
- [x] 公开首页 `/` 已升级为覆盖 V3 Agent OS 全功能的 motion/react 动效首页，展示 Telegram、Mini App、Web Console、Agent Trace、Artifacts 和 Approvals。

### 0.2 已打勾：Telegram V3 入口

- [x] Telegram 命令菜单已加入 `/solve`、`/prospect`、`/leads`、`/campaigns`、`/industry`、`/agents`、`/agent`、`/quote`、`/content`、`/kb`、`/import`、`/dev`、`/runs`、`/trace`。
- [x] `/agents` 可查看 Agent Registry。
- [x] `/agent <id>` 可查看单个 Agent 的职责、能力和确认边界。
- [x] `/industry` 可查看行业 Skill 列表。
- [x] `/industry <skill_id>` 可查看单个 Skill 的触发词、必要输入、输出和风险边界。
- [x] `/kb` 可查看当前知识库和 Skill Registry 状态。
- [x] `/solve <问题>` 已接入 Solution Engine MVP，能创建 V3 方案任务、子任务、依赖、审计记录和队列任务；配置模型后会调用 Solution Agent AI Runtime。
- [x] `/prospect <领域/ICP>` 已接入 Prospecting & Sales Engine MVP，能创建客户挖掘任务、ICP、来源策略、评分模型、触达草稿、sequence、子任务、依赖、审计记录和队列任务；配置模型后会调用 Prospecting Agent AI Runtime。
- [x] `/leads` 已能优先展示 `leads`、`lead_scores`、`enrichment_results` 中的候选线索种子；`/campaigns` 已能展示真实 `campaigns` 和 planned/sent/replied/opened/unsubscribed `campaign_events`。
- [x] `/quote <需求>` 已能基于 pricing memory 生成报价依据、小计、风险提示、邮件草稿和 Markdown/HTML 草案，并创建 Quote Agent 任务链。
- [x] `/content <需求>` 已能创建 Content Agent 任务链；配置模型后会调用 Content Agent AI Runtime 生成内容草稿、标题/开头备选、脚本和发布计划。
- [x] `/dev <任务>` 已能创建 Dev Agent Team 任务链；配置模型后会调用 Dev Agent AI Runtime 生成开发计划、影响范围、测试计划和风险。
- [x] `/runs` 已能优先查看真实 `agent_runs`，没有模型运行记录时回退显示最近任务链。
- [x] `/trace <agent_run_id>` 已能查看单次 AI Agent run 的模型、状态、输入摘要、输出摘要、metadata、工具调用明细和关联 handoff Agent runs。

### 0.3a 已打勾：Quote Agent MVP

- [x] `/import 价格表：...` 已能导入文本价格表并解析服务项、价格、币种和计费单位。
- [x] 文本价格规则会写入 `pricing` memory，metadata 中保存 `parsedPricingRules`。
- [x] `/quote <需求>` 已能读取 `pricing` memory，匹配报价规则，生成报价草案、价格依据、假设、风险提示、邮件草稿和 Markdown/HTML artifact 字符串。
- [x] `/quote` 已能创建 Quote Agent 父任务、报价子任务链、顺序依赖、metadata 和队列任务。
- [x] `/quote` 已能把 Markdown 报价文档草案写入 `artifacts` 表，返回 artifact ID 和 URI。
- [x] 配置模型后，`/quote` 会调用 Quote Agent AI Runtime；未配置模型时保留本地报价引擎兜底。

### 0.3 已打勾：Solution / Prospecting MVP

- [x] `Solution Engine MVP` 已能根据文本选择 Skill，生成问题重述、关键假设、证据计划、方案选项、推荐方案、风险和 7/30/90 天执行计划。
- [x] `Solution Engine` 的后续 Agent 任务链已扩展为问题定义、证据收集、Skill 调用、预算资源假设、风险执行计划和质量复核。
- [x] `Prospecting & Sales Engine MVP` 已能生成 ICP、线索来源策略、评分模型、触达草稿、14 天 sequence、合规边界和后续 Agent 任务。
- [x] `Prospecting` 的后续 Agent 任务链已扩展为 ICP、来源策略、账户抓取、联系人发现、补全评分、触达 sequence、CRM 跟进和合规检查。
- [x] V3 workflow 创建逻辑已能创建父任务、子任务、顺序依赖、metadata 和 `v3_workflow_created` 审计日志。
- [x] 客户挖掘默认生成 campaign 草稿和内部跟进计划；邮件 campaign 可通过 `/send_campaign <campaign_id>` 使用 Nodemailer 自动发送，不再要求审批。
- [x] `/prospect` 已能把 14 天 sequence 展开写入 planned `campaign_events`，用于追踪 draft campaign 的后续触达计划。
- [x] `/prospect` 的确认边界已写入：购买数据源、广告投放、非邮件批量触达、提交外部表单需要确认；邮件发送不需要审批。
- [x] Solution / Prospecting / Research / Quote / Content / Dev / CRM / Email / Calendar / Finance / Browser 已能在有模型配置时调用真实 AI Agent，并通过只读工具选择 Agent/Skill/Memory 上下文。
- [x] `/prospect` 已能生成候选线索种子并写入 `leads`、`lead_scores`、`enrichment_results`；`/leads` 优先展示真实表记录。

### 0.4 已打勾：数据结构和治理

- [x] 新增迁移 `012_v3_agent_os.sql`，包含 `skill_registry`、`skill_versions`、`skill_runs`、`solution_runs`、`evidence_items`、`assumptions`、`risk_items`、`prospecting_runs`、`lead_sources`、`leads`、`lead_scores`、`enrichment_results`、`outreach_sequences`、`campaigns`、`campaign_events`。
- [x] 新增迁移 `013_ai_agent_runtime.sql`，包含 `agent_runs` 和 `tool_calls`，用于记录模型、Agent、输入输出、工具调用、状态和错误。
- [x] 本地备份清单已加入 V3 Skill、Solution、Prospecting、Lead、Campaign 相关表。
- [x] 本地备份清单已加入 `agent_runs` 和 `tool_calls`。
- [x] `Approval Policy` 已升级为 `Finance Gate + Operator Gate`：真实财务动作、付费数据源、广告投放、非邮件批量触达、外部表单、生产部署、删除等需要确认；邮件发送不审批。
- [x] 普通邮件草稿、客户跟进、公开客户挖掘、CRM 写入不再默认作为高风险审批动作。
- [x] 默认设置看板中的审批边界文案已更新为 V3 策略。
- [x] 默认治理资料已从“高风险外部邮件必须审批”调整为“付费数据源/表单/财务/生产等高风险动作必须审批；邮件发送自动执行”。

### 0.5 已打勾：本轮验证和测试

- [x] 本轮 V3 代码已通过 `npm run typecheck`。
- [x] 本轮 V3 代码已通过 `npm test`：15 个测试文件、86 个测试通过。
- [x] 本轮 V3 代码已通过 `npm run build`。
- [x] 已补充 V3 Telegram 命令菜单测试。
- [x] 已补充 V3 Agent Registry、Skill Registry、`/solve`、`/prospect`、`/quote`、`/content`、`/dev`、`/leads`、`/campaigns` 工作流测试。
- [x] 已补充 V3 审批策略测试：普通邮件/CRM/方案/邮件 campaign 不误审，非邮件批量触达、表单提交、真实财务动作进入确认。
- [x] 已补充 V3 专用 run 写入测试：`solution_runs`、`evidence_items`、`assumptions`、`risk_items`、`prospecting_runs`、`lead_sources`、`outreach_sequences`、`campaigns`、planned `campaign_events`、Quote Markdown `artifacts`。
- [x] 已补充 AI Agent Runtime 测试：模型请求工具调用、执行 `select_skills`、写入 `agent_runs` / `tool_calls`、`/runs` 显示真实 Agent run、`/trace` 显示单次和多 Agent handoff 链路，并覆盖 Domain Router / Skill Router handoff、Research -> Solution/Prospecting handoff、Chief -> Specialist 并行 handoff、Quote、Content、Dev、CRM、Email、Finance、Calendar、Browser、Ops 的模型规划。
- [x] 已补充 Quote Agent MVP 测试：价格表解析、pricing memory 导入、标准报价草案生成、报价规则说明和无规则兜底。
- [x] 已更新 README / README.zh-CN / DEPLOYMENT.zh-CN 为 V3.2 Agent OS 使用、部署、配置、开源和当前限制说明。

### 0.6 未打勾：仍待实现

- [x] 已实现 Specialist handoff / 并行多 Agent / 重试 / 部分结果汇报 / blocked external write intent / 多 Agent tracing MVP。
- [x] 已实现外部写入审批记录、`/settings guardrails` Guardrails Console 和 Telegram 多 Agent tracing MVP；真实外部 connector 拆到下面具体集成项继续做。
- [x] 已实现公开来源客户挖掘 connector MVP：可通过 `PROSPECTING_PUBLIC_SOURCE_URLS` 抓取公开目录/搜索/招聘/新闻页面，提取候选账户并写入 prospecting lead 表。
- [ ] 还未接真实地图、付费企业名录、招聘平台 API、联系人发现和补全 connector。
- [x] 已实现候选 leads / lead_scores / enrichment_results 写入 prospecting 专用表。
- [x] 已实现公开来源 connector 命中后的 organization/contact 自动落表：公开候选会关联 `leads.organization_id`，有公开邮箱/电话时自动创建 `contacts` 并关联 `leads.contact_id`。
- [x] 已实现 planned/draft `campaign_events` 自动落表。
- [x] 已实现 Nodemailer 邮件发送器：`/send_campaign <campaign_id>` 会创建发送任务，worker 发送邮件并自动写入 `email_sent` / `email_send_failed` / `email_send_skipped` campaign_events。
- [x] 已实现 `/campaign_event <campaign_id> <event_type> [lead_id] [备注]`，可记录 `email_replied`、`email_opened`、`email_unsubscribed`、`email_bounced` 等外部回传事件。
- [ ] 还未接邮件服务商 webhook/API 自动回传 opened/replied/unsubscribed/bounced。
- [ ] 还未实现文件上传解析并生成 Skill 草案。
- [ ] 还未实现文件上传价格表解析、报价 PDF 生成、正式报价外发和合同/SOW 文档生成。
- [ ] 还未实现 Dev Agent Team 调 Claude Code 的真实执行连接器。

本版修订重点：

- OPC Bot 不再定位为“接开发单机器人”，而是“多领域、多行业问题诊断、方案生成和执行落地的公司大脑”。
- 开发、报价、CRM、邮件、日历、浏览器自动化都是可调用能力，不是系统的中心。
- 顶层新增 Generalist Solution Engine：行业识别、问题定义、资料研究、专家编队、方案生成、风险评估、执行计划、复盘优化。
- 顶层新增 Prospecting & Sales Engine：从“帮我挖某领域客户”自动走到 ICP、名单、补全、评分、触达、CRM 和跟进。
- 多行业能力不靠硬编码几百个行业 Agent，也不靠静态资料包，而是由 Skill Registry 直接调用“行业 Skill + 职能 Skill + 销售/报价等专项 Skill”组合出来。
- 报价由报价规则、服务包、历史报价、合同条款和公司知识库驱动，不默认打断老板。
- 付款、转账、退款、报税、真实开票、账单变更等真实财务动作仍然进入 Finance Gate。
- Dev Agent 升级为 Dev Agent Team，Claude Code 只是代码执行工具之一，不是整个开发架构本身。

## 1. V3.2 定位

V3.2 的 Tele-OPC OS 是一个 Telegram-first 的一人公司 Agent OS。

它要能处理的问题不只包括：

- 写代码、修 bug、部署排错
- 客户跟进、报价、邮件、日程
- CRM、财务、浏览器自动化
- 客户挖掘、销售开发、线索评分、触达跟进

还要包括：

- 一个新行业能不能做
- 一个产品怎么定位
- 一个业务怎么获客
- 某个领域的潜在客户在哪里、怎么找、怎么触达
- 一个服务怎么定价
- 一个项目怎么落地
- 一个公司流程怎么设计
- 一个内容账号怎么增长
- 一个跨境电商品类怎么判断
- 一个线下门店怎么启动
- 一个咨询、教育、SaaS、本地服务、贸易、内容 IP 项目怎么拆解执行

一句话：OPC Bot 应该先像“懂多行业的参谋长”，再像“会执行的自动化员工”。

核心原则：

- Telegram 是老板命令入口，不是命令复制面板。
- 输入 `/` 自动弹出命令菜单，常用任务不需要复制模板。
- Chief Agent 负责理解目标、组织专家、汇总结果。
- Domain Router 判断行业、职能、任务类型和风险级别。
- Solution Engine 负责做诊断、研究、方案、执行计划。
- Prospecting & Sales Engine 负责把“我要客户”变成可执行的销售开发动作。
- Specialist Agents 负责调用工具落地，例如 CRM、报价、邮件、日历、浏览器、开发、财务。
- 默认少问，能根据知识库、行业 Skill 和规则完成的任务就自动完成。
- 对不确定信息要标明假设、证据和置信度。
- 真实资金和账务风险动作必须确认。
- 所有动作必须可追踪、可审计、可复盘。

## 2. 在线学习后的设计原则

本路线图吸收以下公开资料中的 Agent 设计经验：

- Anthropic《Building effective agents》：成功的 Agent 系统通常采用简单、可组合的模式；区分固定路径的 workflow 和由模型动态决策的 agent；常用模式包括 routing、parallelization、orchestrator-workers、evaluator-optimizer。
- Microsoft AutoGen Magentic-One：通用多 Agent 系统可以处理跨领域的开放式 Web 和文件任务；核心是 orchestrator 组织 Web、文件、代码、终端等专业 Agent 协作。
- Microsoft AutoGen Selector Group Chat：用 selector/orchestrator 在多个专业 Agent 中选择下一位发言或执行者，适合复杂问题的专家组协作。
- OpenAI Agents SDK：Agent 应围绕 tools、handoffs、guardrails、sessions、tracing 组织，让专业 Agent 之间可交接、可保护、可追踪。
- LangGraph 多 Agent 思路：多 Agent 可以采用 supervisor/handoff、network、hierarchical graph 等结构，适合把复杂任务拆成多个专业节点。
- SWE-agent：开发 Agent 不能只会聊天，必须围绕 repository、environment、tools、trajectory、verification 来运行，能记录执行轨迹、命令、diff、测试和失败原因。
- HubSpot 销售开发资料：prospecting 不是群发外联，而是研究驱动的相关性；需要 ICP、qualification、research、outreach 和 CRM 记录。
- Salesforce 销售开发资料：销售过程从 lead 到 opportunity 再到 deal，prospecting 是中间的转化过程；资格判断要贯穿每个阶段。
- Clay GTM Automation 资料：现代获客强调 TAM sourcing、公司/联系人 enrichment、signals、ABM、CRM enrichment 和个性化 outbound。
- Close 销售开发资料：prospecting 是识别、研究、主动触达潜在客户，并尽快判断是否适合进入销售漏斗。

落到 Tele-OPC V3.2：

- 顶层使用 Chief Agent + Domain Router + Planner。
- 多行业方案使用 Solution Engine，而不是每个行业单独写死一套流程。
- 专业执行使用 Specialist Agent Teams。
- 行业能力通过 Industry Skills 调用，职能方法通过 Function Skills 调用。
- 普通任务用 workflow 保证稳定性，模糊复杂任务交给 Agent 动态拆解。
- 每次方案都要经过 Evidence、Assumption、Options、Risk、Execution Plan、Review。
- 客户挖掘必须经过 ICP、Source Strategy、Account Sourcing、Enrichment、Scoring、Outreach Plan、CRM Pipeline、Follow-up Review。
- 开发任务由 Dev Agent Team 处理，并记录 repo 扫描、变更 diff、测试结果、review 结论和部署记录。

参考链接：

- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Microsoft AutoGen: Magentic-One](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/magentic-one.html)
- [Microsoft AutoGen: Selector Group Chat](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/selector-group-chat.html)
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)
- [LangGraph multi-agent systems](https://langchain-ai.github.io/langgraph/concepts/multi_agent/)
- [SWE-agent documentation](https://swe-agent.com/latest/)
- [HubSpot: Sales Prospecting](https://www.hubspot.com/sales/prospecting)
- [Salesforce: Sales Prospecting](https://www.salesforce.com/sales/prospecting/)
- [Clay University](https://docs.clay.com/)
- [Close: Sales Prospecting](https://www.close.com/blog/sales-prospecting)

## 3. 北极星体验

### 3.1 客户挖掘和销售命令

你在 Telegram 发：

```text
帮我去挖掘深圳做企业数字化转型的潜在客户，优先找 50-300 人规模、最近在招 IT 或运营岗位、有官网和联系方式的公司。给我一套获客方案，并先整理 30 个高匹配线索。
```

V3.2 应该自动完成：

1. Chief Agent 理解你要的是“客户挖掘 + 销售开发 + 可执行名单”。
2. Domain Router 识别行业为企业服务/数字化转型，职能包括销售、市场、CRM、浏览器研究、邮件触达。
3. ICP Agent 定义理想客户画像：城市、规模、行业、岗位信号、技术/运营痛点、预算可能性。
4. Prospecting Strategy Agent 选择线索来源：搜索引擎、招聘网站、企业名录、园区名单、行业协会、展会名单、公开新闻、B2B 平台。
5. Account Sourcing Agent 调用 Browser/Search 工具抓取候选公司。
6. Enrichment Agent 补全官网、行业、规模、联系人线索、邮箱/表单/电话、招聘信号、技术栈或业务信号。
7. Lead Scoring Agent 按 fit、intent、urgency、accessibility、risk 给线索打分。
8. Value Proposition Agent 为不同客户分组生成痛点、切入点和服务卖点。
9. Outreach Draft Agent 生成个性化首触达邮件/表单/私信草稿。
10. Sales Sequence Agent 设计 7-14 天跟进节奏。
11. CRM Agent 写入 leads/accounts/contacts/opportunities，并标记来源和评分。
12. Sales Compliance Agent 检查隐私、反垃圾邮件、平台规则和不应自动提交的动作。
13. Telegram 返回获客策略、30 个线索、评分原因、触达草稿、下一步跟进任务。

默认自动：

- 研究公开公司信息
- 生成候选客户名单
- 补全公开联系方式
- 生成线索评分
- 生成触达草稿
- 写入 CRM
- 安排跟进任务

需要确认：

- 批量短信、私信、电话等非邮件外部触达
- 提交网页表单
- 使用付费数据源
- 访问登录后或受限平台
- 对外承诺报价、合同、交付周期
- 购买线索、投放广告、开通付费工具

输出不是“去找客户”四个字，而是销售开发作战包：

```text
目标 ICP：深圳 50-300 人企业，近期招聘 IT/运营/数字化相关岗位。
推荐来源：招聘网站、产业园企业名录、行业协会、搜索引擎、官网新闻。
线索结果：30 个候选账户，按 A/B/C 评分。
高分原因：招聘信号、业务复杂度、官网留资入口、可能痛点。
触达策略：先发诊断型邮件，再 3 天后跟进行业案例，7 天后询问是否需要免费检查清单。
CRM 动作：已创建 leads；邮件 campaign 可通过 /send_campaign 自动发送，短信/私信/电话等非邮件触达需确认。
```

### 3.2 多行业方案命令

业务/客户场景示例：

```text
评估一个深圳面向上班族的健康轻食外卖品牌项目，预算 10 万，3 个月内验证，判断能不能做，怎么做。
```

V3.2 应该自动完成：

1. Chief Agent 理解任务类型是“行业判断 + 商业方案 + 执行计划”。
2. Domain Router 识别行业为餐饮/外卖/本地生活，职能包括市场、产品、供应链、财务、运营、增长。
3. Problem Framer 把问题改写成可回答的问题：目标客户、验证周期、预算、城市、渠道、盈利模型。
4. Research Agent 搜集公开资料或读取已有公司知识库。
5. Skill Router 调用餐饮、本地生活、外卖平台、供应链、食品安全等行业 Skill。
6. Market Agent 分析目标用户、竞品、渠道和需求假设。
7. Finance Model Agent 估算启动成本、毛利、客单价、日单量、盈亏平衡点。
8. Risk Agent 检查证照、食品安全、平台规则、现金流、人员和交付风险。
9. Strategy Agent 给出 2-3 个方案，并说明推荐方案。
10. Execution Planner 拆成 7 天、30 天、90 天行动计划。
11. Evaluator Agent 检查方案是否过度乐观、缺关键假设、缺验证指标。
12. Telegram 返回方案、预算表、风险、行动清单和下一步可执行任务。

输出不是一段泛泛建议，而是结构化结果：

```text
结论：建议先做小范围验证，不建议直接开店。
关键假设：目标客群、客单价、复购、平台流量、制作成本。
推荐方案：先做 20 个企业微信群 + 预售菜单 + 午餐档测试。
预算：设备、原料、包装、投放、人员、备用金。
7 天动作：竞品调研、菜单测试、供应商询价、预售页面。
30 天动作：跑通 100 单、复购率测试、毛利模型。
90 天动作：决定是否扩大厨房、签约固定供应商。
风险：食品安全、现金流、平台抽佣、低复购。
```

### 3.3 客户跟进和报价

你在 Telegram 发：

```text
帮我跟进 Acme：查一下最近邮件，整理客户状态，按我们的报价规则给他出一个网站维护套餐报价，写一封跟进邮件，约下周会议。
```

V3.2 应该自动完成：

1. CRM Agent 查客户状态、历史沟通、机会阶段。
2. Email Agent 整理最近邮件并提取客户需求。
3. Quote Agent 查询报价知识库、服务包、折扣规则、历史报价。
4. Quote Agent 生成报价草案、适用规则、置信度和风险提示。
5. Calendar Agent 找时间并准备会议建议。
6. Memory Agent 记录客户偏好、本次上下文和新规则。
7. Email Agent 生成跟进邮件和报价附件草案。
8. Telegram 返回最终汇总、报价依据、邮件草稿、会议建议。

只有以下情况才打断你：

- 报价知识库缺失，系统无法判断价格。
- 报价规则冲突，例如同一服务存在多个有效价格。
- 折扣超出你设置的自动授权范围。
- 客户要求合同外承诺、排他条款、退款条款或其他高风险条款。
- 需要真实付款、转账、退款、报税、开票、修改账单或取消订阅。

### 3.4 开发任务

你在 Telegram 发：

```text
修一下登录失败的问题，先找原因，再改代码，跑测试，给我一份结果。不要直接部署生产。
```

V3.2 应该自动完成：

1. Dev Orchestrator 接收开发任务。
2. Product/Spec Agent 把问题整理成可验证目标。
3. Repo Context Agent 扫描仓库、日志、配置、近期变更。
4. Architect Agent 判断影响范围和修改路径。
5. Implementation Agent 调用 Claude Code 或其他代码执行工具改代码。
6. Test/QA Agent 运行类型检查、单测、相关集成测试。
7. Code Review Agent 检查风险、边界条件、回归风险。
8. Release/Ops Agent 只准备部署建议，不自动部署生产，除非策略允许。
9. Telegram 返回原因、改动、测试结果、剩余风险和下一步。

## 4. 总体架构

```text
Telegram
  -> Telegram Gateway
  -> Owner Auth / Slash Command Menu
  -> Chief Agent
  -> Domain Router
  -> Skill Router
  -> Problem Framer
  -> Planner Agent
  -> Task Queue
  -> Generalist Solution Engine
       - Research Agent
       - Industry Expert Pool
       - Function Expert Pool
       - Market / Customer Agent
       - Strategy / Solution Architect Agent
       - Finance Model Agent
       - Risk / Compliance Agent
       - Execution Planner Agent
       - Evaluator / Critic Agent
  -> Prospecting & Sales Engine
       - ICP Agent
       - Prospecting Strategy Agent
       - Account Sourcing Agent
       - Contact Discovery Agent
       - Enrichment Agent
       - Lead Scoring Agent
       - Value Proposition Agent
       - Outreach Draft Agent
       - Sales Sequence Agent
       - CRM Pipeline Agent
       - Sales Compliance Agent
  -> Specialist Agent Teams
       - CRM Agent
       - Quote Agent
       - Email Agent
       - Calendar Agent
       - Browser Agent
       - Finance Agent
       - Dev Agent Team
       - Knowledge / Memory Agent
       - Ops Agent
  -> Knowledge Layer
       - Company Knowledge Base
       - Industry Skills
       - Function Skills
       - ICP Library
       - Lead Source Playbooks
       - Outreach Template Library
       - Objection / Reply Library
       - Sales Playbook Library
       - Pricing Knowledge Base
       - Case Library
       - SOP / Playbook Library
  -> Tool / Connector Layer
       - PostgreSQL
       - Redis / BullMQ
       - File Import / Document Parser
       - Web Research / Browser Automation
       - Search / Maps / Directory Sources
       - Gmail / Outlook / IMAP
       - Google Calendar / Outlook Calendar
       - Claude Code / Dev Sandbox
       - Git / GitHub / Private Git
       - Stripe / Bank / Invoice systems
  -> Audit / Memory / Artifacts / Tracing
  -> Telegram Result Report
```

## 5. 核心分层

### 5.1 对话入口层

职责：

- Telegram 消息接收
- `/` 命令菜单
- Owner 鉴权
- 文件上传
- 语音/图片/文档入口预留
- 结果汇报

### 5.2 智能编排层

职责：

- 判断用户真正想解决什么问题
- 判断行业、职能、风险级别
- 决定走固定 workflow 还是动态 Agent 编队
- 拆任务、派 Agent、合并结果
- 控制是否需要确认

### 5.3 多领域方案层

职责：

- 定义问题
- 搜集证据
- 调用行业 Skill 和职能 Skill
- 生成多个方案
- 做财务测算
- 做风险评估
- 拆执行计划
- 让 Evaluator 反向审查

### 5.4 客户挖掘和销售层

职责：

- 定义 ICP
- 选择线索来源
- 挖掘账户名单
- 发现联系人和公开触达入口
- 补全公司和联系人信息
- 识别购买信号和触发事件
- 线索评分和分组
- 生成个性化触达草稿
- 设计销售 sequence
- 写入 CRM 和 pipeline
- 跟进转化和复盘

### 5.5 专业执行层

职责：

- 销售触达准备
- CRM 跟进
- 报价生成
- 邮件和日历
- 浏览器自动化
- 财务查询和 Finance Gate
- 开发任务
- 运维任务

### 5.6 知识和记忆层

职责：

- 公司知识库
- 行业 Skill
- 职能方法库
- ICP 和销售 Playbook
- 线索来源配置
- 触达模板和异议处理
- 报价规则
- SOP 和 playbook
- 历史任务和结果
- 客户偏好和长期记忆

### 5.7 审计和复盘层

职责：

- agent_runs
- tool_calls
- artifacts
- evidence
- assumptions
- decisions
- approvals
- traces
- weekly review

## 6. Agent 分工

| Agent | 职责 | 默认行为 | 必须确认 |
|---|---|---|---|
| Chief Agent | 总指挥、理解命令、组织专家、汇总结果 | 自动 | 无 |
| Domain Router | 判断行业、职能、任务类型、风险级别 | 自动 | 无 |
| Skill Router | 按行业、职能、任务和风险选择 Industry / Function / Execution Skills | 自动 | 无 |
| Problem Framer | 把模糊问题改写成可分析、可执行的问题 | 自动 | 无 |
| Planner Agent | 拆解任务、依赖、优先级、并行计划 | 自动 | 无 |
| Research Agent | 联网研究、资料提取、来源整理 | 自动 | 访问受限/付费/敏感来源可配置确认 |
| Industry Expert Pool | 调用行业 Skill，生成行业判断、约束、指标和执行模板 | 自动 | 无 |
| Function Expert Pool | 调用市场、销售、运营、产品、供应链、人事、法务风险等职能 Skill | 自动 | 法律/税务/医疗等高风险建议必须标注非专业意见 |
| Strategy Agent | 生成战略选择、商业模式、定位、方案组合 | 自动 | 无 |
| Market / Customer Agent | 用户、竞品、渠道、增长、转化分析 | 自动 | 无 |
| ICP Agent | 定义理想客户画像、排除条件、优先级 | 自动 | 无 |
| Prospecting Strategy Agent | 设计客户挖掘渠道、关键词、数据源和批次计划 | 自动 | 使用付费数据源可配置确认 |
| Account Sourcing Agent | 挖掘公司名单、官网、行业名录、招聘和新闻信号 | 自动抓取公开信息 | 访问受限平台/登录态平台可配置确认 |
| Contact Discovery Agent | 发现联系人角色、公开邮箱、表单、电话、社媒入口 | 自动整理公开信息 | 购买联系人数据或绕过访问限制 |
| Enrichment Agent | 补全公司规模、行业、技术栈、招聘、融资、门店、地址等字段 | 自动 | 无 |
| Lead Scoring Agent | 按 fit、intent、urgency、accessibility、risk 给线索评分 | 自动 | 无 |
| Value Proposition Agent | 为不同客户分组生成痛点、切入点、案例和卖点 | 自动 | 无 |
| Outreach Draft Agent | 生成个性化邮件、表单、私信、电话提纲 | 默认生成草稿；邮件 campaign 可自动发送 | 非邮件批量触达可配置确认 |
| Sales Sequence Agent | 设计多触点跟进节奏、提醒和下一步任务 | 自动创建内部跟进任务；邮件可由发送器执行 | 非邮件触达、表单提交按策略确认 |
| CRM Pipeline Agent | 创建 lead/account/contact/opportunity，更新阶段和来源 | 自动 | 删除/合并关键客户可配置确认 |
| Sales Compliance Agent | 检查隐私、反垃圾邮件、平台规则、敏感行业触达风险 | 自动 | 高风险触达必须升级 |
| Finance Model Agent | 成本、收入、毛利、现金流、预算、情景测算 | 查询和测算自动 | 真实付款/转账/退款 |
| Risk / Compliance Agent | 合规、合同、执行、声誉、现金流风险识别 | 自动 | 高风险承诺升级 |
| Execution Planner Agent | 7 天/30 天/90 天行动计划、任务拆解、里程碑 | 自动 | 无 |
| Evaluator / Critic Agent | 反向审查方案、找漏洞、检查证据和假设 | 自动 | 无 |
| Knowledge Agent | 导入公司资料、SOP、价格表、合同条款、历史记录 | 自动解析、自动建立草案 | 覆盖关键知识库可配置确认 |
| Memory Agent | 公司记忆、偏好、客户上下文检索 | 自动 | 删除关键记忆可配置确认 |
| CRM Agent | 线索、客户、机会、跟进、客户风险 | 自动 | 无 |
| Quote Agent | 报价规则匹配、报价草案、报价附件、折扣检查 | 有规则则自动生成 | 规则缺失、冲突、超折扣阈值、高风险条款 |
| Email Agent | 邮件分拣、摘要、草稿、跟进、发送策略 | 自动起草，Campaign 邮件自动发送 | 删除邮件等破坏性操作可配置确认 |
| Calendar Agent | 日程、会议准备、找时间、冲突检测 | 自动 | 外部邀请可配置确认 |
| Browser Agent | 网页检查、表单准备、截图、提取数据 | 自动 | 付款、退款、账单变更 |
| Finance Agent | 收支、发票、订阅、预算、现金流、账务风险 | 查询自动 | 付款、转账、退款、报税、真实开票、账单修改 |
| Dev Agent Team | 需求、仓库分析、架构、实现、测试、审查、发布准备 | 自动执行开发任务 | 生产部署、破坏性命令、密钥变更可配置确认 |
| Ops Agent | 健康检查、重试、备份、审计导出、监控 | 自动 | 删除备份、清空数据、生产破坏性操作 |

## 7. 多行业能力：Industry Skills + Function Skills

OPC Bot 要覆盖多领域多行业，不能靠“每个行业写一个巨型 Agent”，也不应该只加载静态资料包。更好的方式是直接调用可执行的“行业 Skill”。

Skill 是一个可复用能力单元，不只是知识库。它同时包含：

- 适用场景和触发条件
- 必要输入和缺失信息追问策略
- 行业知识和判断框架
- 分析步骤和执行流程
- 输出结构和模板
- 可调用工具和数据源
- 风险边界和合规提示
- 质量检查和评估标准
- 示例任务和 few-shot 样例
- 版本、来源、审核状态

核心调用链：

```text
用户命令
  -> Domain Router
  -> Skill Router
  -> 选择 Industry Skills
  -> 选择 Function Skills
  -> 选择 Tool / Execution Skills
  -> 组建临时专家队
  -> 生成方案或执行计划
  -> Evaluator 检查
  -> Telegram 汇报
```

### 7.1 Industry Skill 包含什么

一个行业 Skill 至少包含：

- `skill_id`：例如 `industry.restaurant_local_life`
- `display_name`：餐饮/本地生活
- `domains`：适用行业、子行业、关键词
- `trigger_examples`：哪些用户命令会触发它
- `required_inputs`：城市、预算、目标客户、周期、渠道等
- `missing_input_policy`：缺信息时自动假设、联网研究，还是追问
- `industry_map`：行业定义、细分赛道、价值链、关键参与者
- `business_models`：常见商业模式和收入结构
- `unit_economics`：关键指标、成本结构、毛利区间、盈亏平衡
- `customer_journey`：客户画像、购买路径、决策人、触达渠道
- `go_to_market`：获客渠道、销售方式、内容打法、合作方式
- `operations_playbook`：交付、供应链、服务、人员、质量控制
- `risk_rules`：监管、许可、合规、现金流、平台规则、声誉风险
- `templates`：方案模板、调研模板、预算模板、SOP 模板
- `tools`：建议调用的搜索、浏览器、CRM、报价、财务、文档工具
- `output_schema`：该行业问题的标准输出结构
- `evaluation_rubric`：判断方案质量的标准

示例行业 Skill：

- `industry.restaurant_local_life`：餐饮/本地生活
- `industry.cross_border_ecommerce`：跨境电商
- `industry.content_ip_media`：内容 IP / 自媒体
- `industry.education_training`：教育培训
- `industry.saas_software_service`：SaaS / 软件服务
- `industry.consulting_professional_service`：咨询和专业服务
- `industry.local_service_store`：本地服务门店
- `industry.trade_supply_chain`：贸易和供应链
- `industry.light_manufacturing`：小型制造
- `industry.real_estate_space_operation`：房产/租赁/空间运营
- `industry.ai_automation_service`：AI 自动化服务

### 7.2 Function Skill 包含什么

职能 Skill 不绑定行业，解决通用经营问题。它可以和任意行业 Skill 组合。

示例职能 Skill：

- `function.market_research`：市场调研
- `function.customer_profile`：用户画像
- `function.product_positioning`：产品定位
- `function.pricing_quote`：定价和报价
- `function.sales_funnel`：销售漏斗
- `function.prospecting`：客户挖掘
- `function.crm_followup`：CRM 跟进
- `function.private_domain_growth`：私域增长
- `function.content_marketing`：内容运营
- `function.ads_planning`：广告投放规划
- `function.finance_modeling`：财务模型
- `function.supply_chain_procurement`：供应链和采购
- `function.project_management`：项目管理
- `function.hiring_outsourcing`：招聘和外包
- `function.legal_risk_note`：法务风险提示
- `function.compliance_check`：合规检查
- `function.customer_support`：客服和售后

### 7.3 Skill 如何获得

第一阶段支持四种方式：

1. 内置基础 Skill：系统自带少量通用行业 Skill 和职能 Skill。
2. 文件导入生成 Skill：上传行业报告、价格表、SOP、案例、合同、课程、调研资料，生成待审核 Skill 草案。
3. AI 引导式创建 Skill：Agent 追问关键规则，形成结构化 Skill。
4. 联网研究生成草案：Research Agent 搜集公开资料，生成待审核 Skill 草案。

系统必须区分：

- 已审核 Skill
- 未审核 Skill 草案
- Skill 引用的知识来源
- 联网研究结果
- 用户口头偏好
- 任务中临时假设

### 7.4 Skill 调用规则

Skill Router 需要记录：

- 为什么选择这个 Skill
- 这个 Skill 的版本
- 输入是否完整
- 自动假设了什么
- 调用了哪些工具
- 产出了哪些 artifacts
- Evaluator 是否通过

当多个 Skill 冲突时：

- 优先使用已审核 Skill。
- 同级冲突时标注冲突点和来源。
- 高风险行业或高风险建议必须保守输出。
- 缺关键输入时，只追问会改变结论的问题。

## 8. Generalist Solution Engine

Solution Engine 是 V3.2 的核心，不是某个行业的固定模板。

### 8.1 方案生成流程

```text
用户问题
  -> Intent / Domain / Risk 分类
  -> Problem Framing
  -> Context Retrieval
  -> Web / File Research
  -> Industry Skill + Function Skill 调用
  -> Expert Team Assembly
  -> Options Generation
  -> Financial / Resource Modeling
  -> Risk Review
  -> Evaluator Critique
  -> Execution Plan
  -> Telegram Report
  -> Optional: 创建任务并调用执行 Agent
```

### 8.2 标准方案输出

每个多领域方案都应包含：

- 问题重述
- 目标和约束
- 已知事实
- 关键假设
- 证据和来源
- 行业判断
- 方案选项
- 推荐方案
- 财务或资源测算
- 风险和反例
- 7 天行动计划
- 30 天行动计划
- 90 天行动计划
- 可交给 Agent 执行的下一步任务
- 需要你确认的决策点

### 8.3 何时追问

V3.2 不是完全不问，而是只问关键缺口。

可以自动假设：

- 常规行业背景
- 公开市场信息
- 一般商业模型
- 可被验证的轻量实验

必须追问或标明假设：

- 预算上限
- 城市和目标市场
- 你已有资源
- 合规许可
- 真实合同承诺
- 高风险财务动作
- 影响公司方向的重大选择

## 9. 客户挖掘与销售系统

Prospecting & Sales Engine 是 V3.2 的商业闭环核心之一。它回答的问题不是“这个行业能不能做”，而是“客户在哪里、哪些最值得先打、怎么触达、怎么跟进、怎么进入 pipeline”。

### 9.1 客户挖掘不是简单搜索

成熟销售开发流程的核心是：

```text
ICP
  -> Source Strategy
  -> Account Sourcing
  -> Contact Discovery
  -> Enrichment
  -> Lead Scoring
  -> Segmentation
  -> Personalized Outreach
  -> Sales Sequence
  -> CRM Pipeline
  -> Conversion Review
```

OPC Bot 必须避免：

- 随机搜一批公司名
- 只给网址不解释为什么匹配
- 没有联系人路径
- 没有痛点和触达理由
- 没有评分和优先级
- 没有后续跟进节奏
- 没有写入 CRM
- 没有合规边界

### 9.2 可挖掘客户类型

第一阶段支持以下类型：

- B2B 企业客户
- 本地商户和门店
- SaaS 潜在用户
- 咨询/服务类客户
- 招聘信号客户
- 正在扩张或融资的客户
- 有官网、表单、公开邮箱、电话或社媒入口的客户
- 指定行业、城市、规模、岗位、技术栈、痛点的客户

后续可扩展：

- 跨境电商卖家
- 品牌方和渠道商
- 产业园企业
- 政企招投标线索
- 内容 IP 合作对象
- 教育培训机构
- 线下连锁门店

### 9.3 客户挖掘执行流程

```text
Telegram prospecting command
  -> Chief Agent
  -> Domain Router
  -> ICP Agent
  -> Prospecting Strategy Agent
  -> Account Sourcing Agent
  -> Contact Discovery Agent
  -> Enrichment Agent
  -> Lead Scoring Agent
  -> Value Proposition Agent
  -> Outreach Draft Agent
  -> Sales Sequence Agent
  -> CRM Pipeline Agent
  -> Sales Compliance Agent
  -> Telegram Prospecting Report
```

### 9.4 线索评分模型

每条线索至少有这些评分：

- `fit_score`：是否符合 ICP，例如行业、城市、规模、客群。
- `intent_score`：是否有购买信号，例如招聘、扩张、融资、新官网、新业务。
- `urgency_score`：是否可能近期需要解决问题。
- `accessibility_score`：是否有公开触达入口和可识别联系人。
- `value_score`：潜在合同金额或长期价值。
- `risk_score`：合规、行业敏感、低匹配、数据质量风险。
- `confidence_score`：信息来源是否可靠，是否需要人工复核。

评分结果分组：

- A：优先触达，适合个性化消息。
- B：进入 nurture，先观察或轻触达。
- C：暂存，不主动触达。
- Reject：不符合 ICP 或风险过高。

### 9.5 触达和跟进

默认自动：

- 生成触达策略
- 生成个性化邮件/表单/私信草稿
- 生成电话提纲
- 生成 7-14 天跟进节奏
- 生成不同客户分组的话术
- 写入 CRM 和任务列表

默认不自动：

- 批量提交表单
- 自动拨打电话
- 批量短信或私信
- 购买联系人数据
- 使用付费广告预算
- 对外承诺价格、合同、交付周期

建议第一阶段策略：

- 邮件触达先生成草稿，再由 `/send_campaign` 通过 Nodemailer 自动发送。
- 表单、短信、私信、电话等非邮件触达先生成草稿。
- 非邮件批量触达必须确认。
- 所有外发必须记录来源、内容、时间、对象、结果。

### 9.6 销售结果复盘

每个 prospecting run 必须记录：

- 目标领域和 ICP
- 使用的数据源
- 搜索关键词
- 抓取和筛选规则
- 线索列表
- 补全字段
- 评分依据
- 触达草稿
- sequence
- CRM 写入结果
- 回复、预约、拒绝、无响应
- 下次优化建议

复盘目标：

- 哪些来源线索质量最高
- 哪些 ICP 转化更好
- 哪类话术回复率更高
- 哪些行业不值得继续投入
- 是否需要调整报价、案例、落地页或服务包

## 10. 报价与公司知识库体系

报价必须从“老板临时判断”升级为“公司知识库和规则驱动”。

### 10.1 可导入资料

系统应支持从 Telegram 文件、仓库文件、后台目录或未来 Web UI 导入：

- 服务项目和套餐表
- 价格表、阶梯价、币种、税率
- 折扣规则、授权范围、最低利润率
- 报价模板、合同模板、SOW 模板
- 常见条款、付款周期、交付周期
- 历史报价、已成交价格、失败报价原因
- 客户分层、行业标签、特殊客户规则
- 公司介绍、案例、FAQ、售后政策

### 10.2 AI 引导式导入

当知识库不足时，不是直接问“这次报多少钱”，而是由 Agent 引导补齐规则：

```text
系统：我缺少网站维护套餐的价格规则。请上传价格表，或直接告诉我：
1. 基础版/月价格和包含内容
2. 专业版/月价格和包含内容
3. 企业版/月价格和包含内容
4. 可自动给出的最大折扣
5. 哪些情况必须升级给你确认
```

导入后系统生成：

- `pricing_rules` 结构化规则
- `quote_playbook` 报价 SOP
- `contract_terms` 条款库
- `quote_templates` 报价模板
- `source_artifacts` 原始文件和解析结果

你审核一次规则后，后续同类报价自动执行。

### 10.3 报价执行流程

```text
客户需求
  -> CRM/Email/Browser 提取上下文
  -> Quote Agent 检索报价知识库
  -> 规则匹配和价格计算
  -> 折扣/利润/条款检查
  -> 生成报价草案和依据
  -> Email/Document Agent 生成邮件或报价单
  -> Telegram 返回结果
```

默认自动的报价动作：

- 生成报价草案
- 选择标准套餐
- 计算标准价格
- 使用规则内折扣
- 生成报价邮件草稿
- 生成报价 PDF/Markdown/HTML 草案
- 记录报价到 CRM

需要升级确认的报价异常：

- 没有可用规则
- 规则互相冲突
- 客户需求不属于现有服务
- 折扣超过授权范围
- 毛利低于阈值
- 客户要求非标准合同条款
- 报价变成法律/账务承诺，例如已经要求正式盖章合同或开票

## 11. Dev Agent Team 设计

开发能力是 OPC Bot 的一个专业团队，不是系统中心。

### 11.1 Dev Agent Team 角色

| Dev Agent | 职责 | 产物 |
|---|---|---|
| Dev Orchestrator | 接收开发任务、分派角色、控制循环、汇总结果 | dev_run、任务状态、最终报告 |
| Product/Spec Agent | 把自然语言需求变成验收标准 | spec、acceptance criteria |
| Repo Context Agent | 扫描仓库、依赖、日志、配置、相关文件 | repo map、context bundle |
| Architect Agent | 判断修改路径、接口边界、风险 | implementation plan |
| Implementation Agent | 调用 Claude Code、Codex CLI 或本地工具修改代码 | patch、diff |
| Test/QA Agent | 选择并运行测试、复现 bug、验证修复 | test report |
| Code Review Agent | 审查代码质量、回归风险、安全问题 | review report |
| Security Agent | 检查密钥、权限、注入、依赖风险 | security notes |
| Release/Ops Agent | 准备部署、回滚、变更说明 | release plan |
| Docs Agent | 更新 README、部署文档、变更日志 | docs patch |

### 11.2 开发执行链路

```text
Telegram 开发命令
  -> Dev Orchestrator
  -> Product/Spec Agent
  -> Repo Context Agent
  -> Architect Agent
  -> Implementation Agent
  -> Test/QA Agent
  -> Code Review Agent
  -> Evaluator Loop
  -> Release/Ops Agent
  -> Telegram 开发报告
```

每次开发运行必须记录：

- 原始需求
- 验收标准
- 仓库上下文
- 修改计划
- 执行工具，例如 Claude Code
- 命令日志
- 文件 diff
- 测试结果
- review 结果
- 安全检查结果
- 是否需要人工确认
- 最终摘要

### 11.3 Claude Code 的位置

Claude Code 只作为 Dev Agent Team 的代码执行工具：

```text
Implementation Agent
  -> Claude Code
  -> patch / command output / test output
  -> Test/QA Agent
  -> Code Review Agent
```

未来可以并行接入 Codex、OpenAI、Claude、fable-5 或本地模型作为不同执行器。

## 12. V3 审批策略

V2 的问题：审批边界太宽，邮件、浏览器、日历、报价等普通任务会频繁打断你。

V3.2 默认策略：

```text
方案分析：自动执行
行业研究：自动执行，来源和假设必须标明
客户挖掘：公开信息研究、线索整理、评分、CRM 写入自动执行
销售触达：默认生成草稿和跟进任务；邮件 campaign 自动发送，非邮件触达和表单提交按策略确认
普通任务：自动执行
CRM：自动执行
报价：规则和知识库内自动生成
邮件：自动分拣、摘要、起草、跟进，Campaign 发送自动执行
日历：自动整理、准备、建议时间
浏览器：自动访问、截图、提取、填写草稿
开发：Dev Agent Team 自动执行代码任务
运维：自动健康检查、重试、备份、审计
财务：真实资金/账务动作必须确认
```

必须确认的 Finance Gate 动作：

- 付款
- 转账
- 退款
- 报税
- 真实开票
- 修改账单
- 取消订阅
- 增加付费订阅
- 超预算支出
- 生产环境破坏性财务操作

高风险建议必须加标识：

- 法律建议
- 税务建议
- 医疗健康建议
- 投资建议
- 监管许可判断
- 雇佣和劳动争议
- 冷邮件、短信、电话、私信等外部触达合规风险

这些场景可以给出常识性分析、风险清单和咨询专业人士的提醒，但不能伪装成专业执业意见。

## 13. Telegram 体验要求

V3.2 Telegram 必须做到：

- 输入 `/` 自动弹出命令菜单。
- `/start` 返回清晰可用入口。
- `/solve` 处理任意行业问题并生成方案。
- `/prospect` 挖掘某领域客户，生成 ICP、线索、评分、触达草稿和 CRM 任务。
- `/leads` 查看线索池、评分、来源和跟进状态。
- `/campaigns` 查看销售开发 campaign、sequence 和回复结果。
- `/industry` 查看或创建行业 Skill。
- `/agents` 查看所有 Agent 状态。
- `/agent <name>` 查看某个 Agent 的能力、工具和权限。
- `/today` 查看公司今日状态。
- `/tasks` 查看执行中任务。
- `/task <id>` 查看任务详情、子任务、Agent、结果。
- `/quote` 新建报价、查看报价规则、导入报价资料。
- `/content` 发起内容草稿、活动文案和发布计划。
- `/kb` 查看公司知识库状态。
- `/import` 上传价格表、合同、SOP、客户资料、行业资料。
- `/finance` 查看财务状态。
- `/approve <id>` 只用于财务或明确策略动作。
- `/reject <id>` 拒绝待确认财务动作。
- `/dev` 发起开发任务、查看 dev run。
- `/runs` 查看 Agent 执行历史。
- `/trace` 查看单次 Agent run 输入、输出、metadata 和工具调用。

建议命令：

```text
/solve
/prospect
/leads
/campaigns
/industry
/agents
/agent
/today
/tasks
/task
/quote
/content
/kb
/import
/inbox
/cash
/pipeline
/meetings
/dev
/runs
/trace
/approve
/reject
```

## 14. 数据模型升级方向

V3.2 尽量复用现有表，不先大迁移。优先在现有 `tasks`、`audit_logs`、`memories`、`briefings` 上扩展 metadata。

第一阶段建议新增或明确：

```text
agents
agent_runs
tool_calls
artifacts
task_messages
approval_policies
knowledge_sources
knowledge_chunks
skill_registry
skill_versions
skill_runs
industry_skills
function_skills
solution_runs
solution_options
evidence_items
assumptions
risk_items
prospecting_runs
icp_profiles
lead_sources
accounts
contacts
leads
lead_scores
enrichment_results
outreach_sequences
outreach_steps
campaigns
campaign_events
pricing_rules
quote_templates
quotes
dev_runs
dev_run_steps
dev_artifacts
```

方案任务必须记录：

- 原始 Telegram message
- Chief Agent 判断
- Domain Router 判断
- Problem Framer 结果
- 使用的行业 Skill 和职能 Skill
- 证据和来源
- 假设
- 方案选项
- 推荐方案
- 风险
- 执行计划
- 可交给 Agent 执行的任务

客户挖掘必须记录：

- prospecting_run
- ICP
- 目标行业、地区、规模、排除条件
- 数据源和搜索关键词
- 候选账户
- 联系人和公开触达入口
- enrich 字段和来源
- 线索评分
- 分组和优先级
- 触达草稿
- sequence
- CRM 写入结果
- 回复和转化结果
- 下次优化建议

报价必须记录：

- 客户
- 需求摘要
- 使用的价格规则
- 使用的知识库来源
- 折扣和授权范围
- 报价草案
- 风险提示
- 是否升级确认

开发必须记录：

- dev_run
- spec
- repo context
- implementation plan
- diff
- command logs
- test report
- review report
- release notes

## 15. 实施阶段

### Phase 0：冻结 V2，确认 V3.2 设计

目标：先停止盲目实现，确认路线。

交付：

- [x] 本路线图
- [x] V3.2 架构审核结论
- [x] V2 到 V3.2 的迁移策略
- [x] 多行业方案引擎边界确认
- [x] 客户挖掘和销售开发边界确认
- [x] 行业 Skill 和职能 Skill 策略确认
- [x] 报价知识库策略确认
- [x] Finance Gate 边界确认
- [x] Dev Agent Team 边界确认

验收：

- [x] 你确认 OPC Bot 不是开发单机器人，而是多领域公司大脑。
- [x] 你确认 OPC Bot 必须能主动挖掘客户、生成销售开发方案并调用工具落地。
- [x] 明确哪些 V2 设计废弃，哪些保留。
- [x] 明确报价不是默认人工审批动作。
- [x] 明确开发不是单 Agent，而是 Dev Agent Team。

### Phase 1：Agent Registry + Telegram Command UX

目标：把系统里“有哪些 Agent、每个 Agent 能做什么”显式化。

边界：本阶段的打勾只代表 Agent 名册、命令 UX 和任务链存在，不代表这些 Agent 已经调用 AI 模型自主推理。

交付：

- [x] Agent Registry
- [x] Skill Registry 占位
- [x] `/solve`
- [x] `/prospect`
- [x] `/leads`
- [x] `/campaigns`
- [x] `/industry`
- [x] `/agents`
- [x] `/agent <name>`
- [x] Telegram 命令菜单完整注册
- [x] `/quote`、`/content`、`/kb`、`/import`、`/dev` 命令占位
- [x] README 中的完整 V3.2 使用说明

验收：

- [x] Telegram 命令菜单已在代码中注册；真实 Bot 菜单需运行 `setCommands` 后确认。
- [x] `/solve` 能作为通用问题入口。
- [x] `/prospect` 能作为客户挖掘入口。
- [x] `/agents` 能列出 Agent。
- [x] 每个 Agent 有职责、能力、工具、审批边界。

### Phase 1.5：AI Agent Runtime + Model Provider

目标：把“代码写死的 Agent 外壳”升级为“模型驱动、可调用工具、可追踪的真实 AI Agent”。

交付：

- [x] `ModelProvider` 抽象，支持 OpenAI-compatible API 和兼容网关模型配置。
- [x] `AgentRunner`：接收 Agent 定义、system prompt、上下文、工具清单和审批边界，执行一次真实模型推理。
- [x] per-agent prompt：Chief Agent、Domain Router、Skill Router、Research Agent、Solution Agent、Prospecting Agent、Quote Agent、Content Agent、Dev Agent Team、CRM Agent、Email Agent、Calendar Agent、Finance Agent、Browser Agent、Ops Agent 已有独立职责提示词；其他 Agent 先使用通用 prompt。
- [x] tool-calling loop MVP：Agent 能选择只读内部工具，例如 `list_agents`、`select_skills`、`list_memories`。
- [x] handoff MVP：咨询类自然语言先交给 Domain Router 和 Skill Router 形成预路由，再把上下文交给 Chief Agent，并保留 `agent_runs` 轨迹。
- [x] Specialist handoff MVP：Chief Agent 能通过 `plan_specialist_handoff` 工具把任务动态交给 Solution、Prospecting、Quote、Dev、CRM、Email、Calendar、Finance、Browser、Content、Ops 等下游 Agent，并支持并行/串行、一次重试和部分结果汇报。
- [x] guardrails MVP：Agent prompt、tool-level `approvalRequired` 阻断机制和 `external_write_request` 外部写入意图工具已落地；真实外部写入 connector 仍未开放。
- [x] `agent_runs` 和 `tool_calls` 最小实现：记录模型、输入摘要、输出摘要、工具调用、状态、错误和审计事件。
- [x] Telegram 入口改造 MVP：咨询类自然语言消息进入 Chief Agent AI Runtime；`/solve`、`/prospect`、`/quote`、`/content`、`/dev` 进入对应 Specialist AI Agent；CRM、Email、Calendar、Finance、Browser 的自然语言写入/运行入口和 `/ops` 看板也会调用对应 Specialist AI Agent；slash command 作为显式快捷入口保留。
- [x] Trace View MVP：`/trace <agent_run_id>` 可查看单次 Agent run 的模型、状态、输入摘要、输出摘要、metadata、工具调用和关联 handoff Agent runs。

验收：

- [x] 发送一个咨询类自然语言问题，Chief Agent 会真实调用模型做意图理解，而不是只走正则/硬编码命令。
- [x] `/solve` 的方案能由 Solution Agent 结合模型、Skill 和上下文生成，并保留本地 workflow 兜底。
- [x] `/prospect` 的客户挖掘方案能由 Prospecting Agent 调用模型生成，并保留本地 workflow 兜底。
- [x] `/solve` 和 `/prospect` 会先调用 Research Agent 生成证据计划、公开来源和待验证假设，再把上下文交给 Solution / Prospecting Agent。
- [x] `/quote` 的报价任务能由 Quote Agent 调用模型生成补充判断，并保留本地报价引擎兜底。
- [x] `/content` 和低风险自然语言内容需求能由 Content Agent 调用模型生成草稿、标题/开头、脚本、发布节奏和风险边界，并保留本地任务链兜底。
- [x] `/dev` 的开发任务能由 Dev Agent Team 调用模型生成计划、影响范围、测试计划和风险，并保留本地任务链兜底。
- [x] CRM / Email / Calendar / Finance / Browser 的自然语言记录或运行入口能调用对应 Specialist Agent 生成模型判断，并保留本地工具层兜底。
- [x] `/ops` 能调用 Ops Agent 读取治理看板上下文，生成健康判断、最高优先级风险和下一步建议。
- [x] 咨询类自然语言能产生 Domain Router、Skill Router、Chief Agent 三段真实 Agent run，并把上游 handoff 上下文传给 Chief Agent。
- [x] 每次 Agent 执行都能在 `agent_runs` 看到模型、Agent、输入、输出、状态和错误。
- [x] 每次工具调用都能在 `tool_calls` 看到工具名、参数摘要、结果摘要和审批状态。
- [x] Telegram 可用 `/trace <agent_run_id>` 查看单次 AI Agent run 和多 Agent handoff 链路的可读轨迹，便于确认模型实际执行和工具调用。
- [x] AI Agent Runtime 当前只开放只读工具和审批阻断型外部写入意图工具，不能绕过 Finance Gate / Operator Gate 执行真实高风险动作。
- [x] Specialist handoff、多 Agent 并行、重试和部分结果汇报 MVP 已落地。
- [ ] 真实外部写入 connector、生产级 guardrails UI 和可视化 tracing 面板仍待后续阶段实现。

### Phase 2：Knowledge Base + Skill Foundation

目标：让系统具备多行业知识加载能力。

交付：

- [x] 文件导入入口：`/import` 已预留 Telegram 入口
- [ ] 文件上传解析和 Skill 草案生成
- [ ] 知识源管理
- [x] Skill Registry 数据结构
- [x] 行业 Skill 数据结构
- [x] 职能 Skill 数据结构
- [x] ICP、线索、sequence、campaign、playbook 相关最小数据结构
- [x] 线索来源配置草案
- [x] 证据和假设记录表结构
- [x] `/industry` 查看行业 Skill
- [ ] `/industry` 创建、更新行业 Skill
- [x] `/import` 支持文本价格表导入，并引导后续行业资料、SOP、文件价格表和合同条款上传

验收：

- [ ] 上传一份行业资料后，系统能生成行业 Skill 草案。
- [x] 数据模型已能区分已审核知识、草案、联网研究结果和临时假设；真实写入流程待接。
- [x] `/industry` 能查看当前行业 Skill 状态。

### Phase 3：Generalist Solution Engine MVP

目标：让 OPC Bot 能处理多领域问题并给出结构化方案。

交付：

- [x] Domain Router
- [x] Skill Router
- [x] Problem Framer
- [x] Research Agent 定义和证据计划
- [x] Research Agent AI Runtime 前置 run：`/solve` 和 `/prospect` 会先生成研究计划并传给下游 Agent
- [ ] Research Agent 真实联网检索 connector
- [x] Industry Expert Pool v1
- [x] Function Expert Pool v1
- [x] Strategy Agent
- [ ] Finance Model Agent 真实预算/现金流模型
- [x] Risk Agent
- [x] Execution Planner
- [ ] Evaluator Agent 自动复核方案质量
- [x] solution_runs / evidence_items / assumptions 表结构
- [x] solution_runs / evidence_items / assumptions / risk_items repository 写入

验收：

- [x] 你发一个非开发、非报价的行业问题，系统能生成结构化方案 MVP。
- [x] 方案包含问题重述、假设、证据计划、方案选项、推荐、风险、7/30/90 天计划。
- [ ] 方案包含真实预算/资源测算。
- [x] 系统能明确标出不确定信息。
- [x] 系统能把下一步拆成可执行任务。

### Phase 4：Prospecting & Sales Engine MVP

目标：让 OPC Bot 能从“帮我挖某领域客户”自动生成客户挖掘方案和第一批可跟进线索。

交付：

- [x] ICP Agent
- [x] Prospecting Strategy Agent
- [ ] Account Sourcing Agent 真实公开来源抓取
- [ ] Contact Discovery Agent 真实联系人发现
- [ ] Enrichment Agent 真实补全
- [x] Lead Scoring Agent 评分模型 MVP
- [x] Value Proposition Agent MVP
- [x] Outreach Draft Agent
- [x] Sales Sequence Agent
- [ ] CRM Pipeline Agent 真实写入 prospecting 专用表
- [x] Sales Compliance Agent 确认边界
- [x] `/prospect` 发起客户挖掘
- [x] `/leads` 查看候选 leads 专用表视图
- [x] `/campaigns` 查看当前 prospecting campaign 和 planned events 视图
- [x] prospecting_runs / leads / accounts / contacts / lead_scores 相关表结构
- [x] prospecting_runs / lead_sources / outreach_sequences / campaigns / planned campaign_events repository 写入
- [x] 候选 leads / lead_scores / enrichment_results repository 写入
- [ ] 真实 accounts / contacts repository 写入

验收：

- [x] 你发“帮我挖某领域客户”，系统能先生成 ICP 和数据源策略。
- [x] 系统能通过配置的公开来源 URL 整理第一批候选账户。
- [x] 系统能生成候选线索种子、补全字段占位并给出逐条评分。
- [x] 系统能把 14 天 sequence 生成 planned campaign_events，用于后续发送器或人工跟进。
- [x] 系统能生成触达草稿和跟进 sequence。
- [x] 系统能写入 prospecting 专用表；邮件 campaign 可通过发送器执行，非邮件触达不默认执行。
- [ ] 系统能说明每条真实线索为什么值得跟进。

### Phase 5：Quote + CRM + Email + Calendar MVP

目标：把方案能力连接到实际业务跟进。

交付：

- [x] 文本价格表解析
- [x] 报价规则结构化到 pricing memory metadata
- [x] Markdown/HTML 报价草案模板
- [x] Quote Agent 任务链占位
- [x] Quote Agent 真实报价引擎 v1
- [x] Quote Agent Markdown 报价文档 artifact MVP
- [x] CRM internal connector
- [x] Email draft connector
- [x] Calendar suggestion connector
- [x] `/quote` 创建报价任务链
- [x] `/quote` 查看和生成真实报价草案
- [ ] 文件上传价格表解析
- [ ] 报价 PDF 生成

验收：

- [x] 导入一份文本价格表后，系统能提取服务项和价格。
- [x] 对标准需求能自动生成报价草案。
- [x] Quote Agent 能生成 Markdown 报价文档草案 artifact。
- [x] 报价结果能说明使用了哪些规则。
- [x] 客户跟进能生成 CRM 摘要、邮件草稿和会议建议。
- [ ] 上传 PDF/Excel/Word 价格表后，系统能提取服务项和价格。

### Phase 6：Dev Agent Team MVP

目标：把开发从“Dev Agent 调工具”升级为可审计、可验证的开发团队。

交付：

- [x] Dev Orchestrator 任务链占位
- [x] Product/Spec Agent 子任务占位
- [x] Repo Context Agent 子任务占位
- [x] Architect Agent 子任务占位
- [x] Implementation Agent 子任务占位
- [x] Test/QA Agent 子任务占位
- [x] Code Review Agent 子任务占位
- [ ] Claude Code connector
- [ ] dev_runs / dev_artifacts
- [x] `/dev` 创建开发任务链
- [x] `/dev` 配置模型后调用 Dev Agent AI Runtime 生成开发计划和风险判断
- [ ] `/dev` 查看真实开发运行状态

验收：

- [x] Telegram 发一个开发任务，系统能生成 spec/repo context/实现/测试/review 子任务计划。
- [x] 配置模型后，Dev Agent Team 能生成模型驱动的开发计划、影响范围、测试计划和风险。
- [ ] 系统能调用 Claude Code 修改代码。
- [ ] 系统能运行测试并汇总失败原因。
- [ ] Code Review Agent 能给出真实代码风险和是否需要继续修复。
- [x] 不自动部署生产。

### Phase 7：Browser / Finance / External Connector Layer

目标：让 Agent 真正调用工具。

交付优先级：

1. [x] Browser runner MVP
2. [ ] Search / directory source connector
3. [x] Email connector MVP：邮件导入/分拣/草稿，不含真实邮箱 API 同步
4. [x] Calendar connector MVP：内部日程和会议建议，不含真实日历 API 同步
5. [ ] Document artifact generator
6. [x] Finance ledger connector MVP：内部台账和风险识别，不含真实付款/Stripe 执行
7. [ ] GitHub / private Git connector

验收：

- [x] Browser Agent 能运行页面抓取/审计 MVP 并保存记录。
- [ ] Prospecting Agent 能保存真实搜索证据和数据来源。
- [x] Email Agent 能读取或导入邮件并生成草稿。
- [x] Calendar Agent 能生成日程建议。
- [x] Quote Agent 能生成 Markdown 报价文档草案 artifact。
- [x] Finance Agent 能做查询和摘要，但不自动执行真实资金动作。

### Phase 8：Auto-Execute Policy + Finance Gate

目标：减少无意义审核问题，保留真实财务风险控制。

交付：

- [x] 新审批策略：Finance Gate + Operator Gate
- [x] 标准报价不默认进入 Finance Gate
- [x] 方案分析不默认进入审批
- [x] 客户挖掘和线索评分不默认进入审批
- [x] 非邮件批量触达、购买数据源、付费投放进入确认；邮件 campaign 自动发送
- [x] 邮件、CRM、日历、浏览器普通任务默认执行
- [x] 财务动作确认
- [x] 审计记录保留

验收：

- [x] 标准报价不再要求无意义审批。
- [x] 多行业方案分析不要求审批。
- [x] 客户挖掘和 CRM 写入不要求无意义审批。
- [x] 非邮件批量触达和付费获客动作仍然必须确认；邮件发送不审批。
- [x] 邮件跟进不再要求无意义审批。
- [x] 浏览器普通检查不审批。
- [x] 付款、退款、转账、报税、真实开票仍然必须确认。

### Phase 9：Multi-Agent Execution Loop + Tracing

目标：从“创建任务”升级为“多个 Agent 并行完成任务”。

边界：Phase 1.5 先完成单次真实 AI Agent Runtime；Phase 9 再把多个 Agent run 组织成并行、串行、重试、部分结果汇报和完整 tracing 视图。
当前状态：多 Agent 编排 MVP 已提前落地；生产级可视化 tracing 面板、真实外部 connector 和更完整的失败恢复策略仍在后续阶段。

交付：

- [x] agent_runs
- [x] tool_calls
- [x] artifacts 基础表和导出目录
- [x] task result aggregation 基础 worker 结果闭环
- [x] failure retry
- [x] `/trace` 单次 Agent run 轨迹视图 MVP
- [x] partial result reporting MVP
- [x] 多 Agent 链路 tracing view MVP
- [ ] 生产级可视化 tracing 面板

验收：

- [x] 一个老板命令可以产生多个子任务。
- [x] 一个老板命令可以产生至少一个真实 AI Agent run。
- [x] 每个 Agent run 有输入、输出、工具调用、状态。
- [x] Chief Agent 能汇总成 Telegram 结果。
- [x] 单次 AI Agent run 失败可以定位到具体 Agent；工具失败可以定位到具体 tool call。
- [x] 单次 AI Agent run 可以通过 `/trace <agent_run_id>` 在 Telegram 查看输入、输出、metadata 和工具调用。
- [x] 多 Agent 链路失败定位和 tracing view MVP 已实现。
- [ ] 生产级跨任务 tracing 面板、失败恢复 UI 和更细粒度指标仍待实现。

### Phase 10：Memory + Review Loop

目标：系统越用越懂你的公司和行业。

交付：

- [x] Memory write policy
- [x] preference memory
- [x] customer memory
- [ ] industry memory
- [ ] prospecting memory
- [ ] ICP memory
- [x] pricing memory
- [x] playbook memory
- [x] task review
- [ ] weekly review

验收：

- [x] 系统能复用你的偏好。
- [x] 重复任务能沉淀 SOP。
- [ ] 行业 Skill 能持续更新。
- [ ] ICP、线索来源和触达话术能持续优化。
- [ ] 报价规则能持续更新。
- [x] Telegram 能查看记忆和 SOP。

### Phase 11：Production Hardening + 开源部署准备

目标：能长期运行，也能放到 GitHub 或私有 Git 仓库。

交付：

- [ ] healthcheck scheduler
- [ ] backup scheduler
- [x] audit export
- [ ] cost tracking
- [ ] rate limit
- [x] error dashboard / Ops 看板 MVP
- [x] `.env.example` 基础完整化
- [x] Docker / Docker Compose 部署路径
- [x] Cloudflare Tunnel 部署说明
- [x] 私有部署安全说明
- [x] README / README.zh-CN / DEPLOYMENT.zh-CN 已有 V2 部署与使用说明
- [x] README / README.zh-CN / DEPLOYMENT.zh-CN 完整 V3.2 使用和部署说明

验收：

- [x] 断线后任务可通过队列/状态重试路径恢复。
- [x] 任务失败可重试。
- [x] 审计日志可导出。
- [x] V3.2 部署文档完整。
- [x] 新用户能按当前 README/DEPLOYMENT 配置 Telegram、模型、数据库、Cloudflare Tunnel。

## 16. 暂不做的事

V3.2 第一轮不做：

- 不做复杂前端 Dashboard。
- 不做大型 SaaS CRM 克隆。
- 不先接真实付款执行。
- 不默认开放所有浏览器域名。
- 不把所有 Agent 都做成独立进程。
- 不把所有能力一次性接入真实外部 API。
- 不让开发 Agent 自动生产部署。
- 不把报价等同于付款审批。
- 不默认批量发送短信、私信、电话或提交网页表单；邮件 campaign 由 `/send_campaign` 自动发送并记录事件。
- 不默认购买线索数据、开广告预算或使用付费数据源。
- 不假装系统对所有行业都有已验证数据。
- 不把法律、税务、医疗、投资建议伪装成专业执业意见。

## 17. 审核问题

请重点审核这些点：

1. 是否确认 OPC Bot 的顶层定位是“多领域方案 + 执行落地”，而不是开发单机器人？
2. 是否确认新增 `/solve` 作为通用问题入口？
3. 是否确认新增 `/prospect` 作为客户挖掘和销售开发入口？
4. 是否确认客户挖掘默认可以抓取公开信息、生成线索、评分并写入 CRM？
5. 是否确认非邮件批量触达、购买数据源、广告投放、提交表单必须确认，邮件发送不审批？
6. 是否确认采用 Industry Skills + Function Skills，由 Skill Registry 调用，而不是每个行业硬写一个 Agent？
7. 是否确认“联网研究结果、未审核草案、已审核知识、临时假设”必须分层标记？
8. 是否确认“报价由知识库和规则驱动，标准报价不默认问你”？
9. [已决] 报价外发邮件不默认进入审批；当前报价仍先生成草稿，后续正式发送走邮件发送器策略。
10. [已决] 邮件发送默认自动，不保留发送前确认；财务、表单、生产部署和破坏性动作仍确认。
11. 日历外部邀请是否需要确认？
12. Dev Agent Team 是否允许自动调用 Claude Code 改代码？
13. Browser Agent 的非财务表单提交是否允许自动？
14. 新命令 `/solve`、`/prospect`、`/leads`、`/campaigns`、`/industry`、`/agents`、`/agent`、`/quote`、`/content`、`/kb`、`/import`、`/dev` 是否加入？
15. 第一阶段是否先做 Agent Registry + Telegram UX，再做 Solution Engine 和 Prospecting MVP？

## 18. 审核通过后的第一批行动

审核通过后，建议按这个顺序执行：

1. [x] 清理并把 V3 代码正式纳入 Phase 1/2/3/4 MVP 路径。
2. [x] 新增 Agent Registry，并包含 Solution Engine、Prospecting & Sales Engine、Quote Agent 和 Dev Agent Team。
3. [x] 新增 `/solve`、`/prospect`、`/leads`、`/campaigns`、`/industry`、`/agents` 和 `/agent <name>`。
4. [x] 新增 `/quote`、`/content`、`/kb`、`/import`、`/dev` 命令入口。
5. [x] 更新 Telegram 命令菜单。
6. [x] 新增知识库、Skill Registry、行业 Skill、职能 Skill、ICP、线索、证据、假设的最小数据结构。
7. [x] 做 Solution Engine MVP：问题定义、行业路由、方案生成、风险评估、执行计划。
8. [x] 做 Prospecting 草案 MVP：ICP、来源策略、评分模型、触达草稿、sequence、任务链。
9. [x] 接入 AI Agent Runtime MVP：模型 Provider、Agent Runner、per-agent prompt、只读 tool calling、agent/tool trace，让 Chief/Solution/Prospecting/Quote/Content/Dev 不再只是代码模板。
10. [ ] 做 Prospecting 真实执行：公开线索挖掘、补全、逐条评分、CRM/prospecting 专用表写入。
11. [x] 做 Quote Agent MVP：导入文本价格表、生成标准报价草案。
12. [x] 做 Dev Agent Team 任务链 MVP：spec、repo context、实现、测试、review 子任务。
13. [ ] 接入 Dev Agent Team 真实执行：Claude Code connector、测试执行、review 结果写入。
14. [x] 改审批策略为 Finance Gate + Operator Gate，并排除标准报价、普通方案分析、公开客户挖掘。
15. [x] 更新 README / README.zh-CN / DEPLOYMENT.zh-CN 为 V3.2 使用和部署方式。
16. [x] 更新测试，确保非财务任务不再要求审批。
17. [x] 跑 `npm run typecheck`、`npm test`、`npm run build`。

## 19. 完成定义

V3.2 第一阶段完成，不是指所有 Agent 都接入真实 API，而是：

- [x] 你能在 Telegram 下自然语言命令。
- [x] Telegram 命令菜单已在代码中注册。
- [x] `/solve` 能处理多领域、多行业问题 MVP。
- [x] `/prospect` 能生成客户挖掘、线索评分和销售开发计划 MVP。
- [x] 系统能识别行业、职能、风险和任务类型。
- [x] 系统能生成结构化方案，而不是泛泛建议。
- [x] 方案能标明证据计划、假设、风险和行动计划。
- [ ] 方案能生成真实预算和资源测算。
- [x] 系统能生成 ICP、线索来源策略、评分模型、触达草稿和跟进 sequence。
- [ ] 系统能生成真实候选客户名单和逐条评分依据。
- [x] 系统能把候选 prospecting lead seed 写入 `leads`、`lead_scores`、`enrichment_results`，并标记需要公开来源验证。
- [x] 系统能在配置公开来源 URL 后把公开来源验证到的 account/contact 写入 CRM/prospecting 专用表；邮件 campaign 可自动发送，非邮件触达不默认执行。
- [x] 系统能在任务层面拆解并分配给多个 owner agent（当前是 workflow/子任务，不是模型驱动的真实 Agent run）。
- [x] 系统能让 Chief Agent、Domain Router、Skill Router、Research Agent、Solution Agent、Prospecting Agent、Quote Agent、Content Agent、Dev Agent Team、CRM Agent、Email Agent、Calendar Agent、Finance Agent、Browser Agent、Ops Agent 通过 AI Agent Runtime 调用模型完成推理和只读工具选择。
- [x] 标准报价能基于 pricing memory 和规则自动生成草案。
- [x] 普通任务自动执行。
- [x] 真实财务风险动作必须确认。
- [x] 开发任务能由 Dev Agent Team 拆成 spec、repo context、实现、测试和 review 子任务。
- [ ] Dev Agent Team 能真实调用 Claude Code、跑测试并生成 review。
- [x] Telegram 能看到 Agent、任务、结果、审计。
- [x] 后续接邮件、日历、浏览器、Claude Code、GitHub、财务系统都有明确挂载点。
