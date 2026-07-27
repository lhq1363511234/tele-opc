# Tele-OPC Phase 实现审计

> 审计基准：2026-07-27 当前 `main` 分支。
> 判定标准：以真实代码、数据库迁移、运行服务和页面/API 为准，不只看路线图勾选。

## 状态定义

- **已实现**：主要闭环可真实运行，并有数据落点或测试。
- **部分实现**：已有骨架或 MVP，但缺少路线图承诺的关键闭环。
- **未实现**：只有设计、占位或没有可运行入口。
- **文档过时**：路线图仍写未实现，但当前代码已经补上部分或全部能力。

## 总结

| 路线 | 当前判断 | 结论 |
| --- | --- | --- |
| V3 Agent OS | 核心运行链可用，生产化和知识闭环未完成 | 不是纯占位；任务、Agent、审批、CRM、财务、浏览器和交付物已有真实对象，但多个 Phase 仍是 MVP |
| V4 OPC Business OS | 部分落地 | Owner Cockpit、Context Pack、A-、Artifact 和经营数据已有；统一 Inbox、Project/Deal、对象图和版本化资产未完成 |
| V5 Workflow-native OS | 早中期 | Dify/n8n/飞书连接器和 AppOS Contract/Run 有代码；内容运营、发布队列、工作流效果复盘和市场化未完成 |

---

## V3 Phase 审计

| Phase | 状态 | 已实现证据 | 尚缺能力 |
| --- | --- | --- | --- |
| Phase 0 设计冻结 | 已实现 | V3/V4/V5 架构文档、Agent/Skill 边界、审批原则 | 需要把后续文档状态持续同步到本审计，不再靠旧勾选判断 |
| Phase 1 Agent Registry + Telegram UX | 已实现 | `src/agents/registry.ts`、`src/skills/registry.ts`、Telegram handler/commands、Web Agents 页面 | Telegram 菜单是否与生产 Bot 最新命令完全一致仍需发布验收 |
| Phase 1.5 AI Runtime | 部分实现（接近完成） | ModelProvider、AgentRunner、tool calling、handoff、`agent_runs`、`tool_calls`、Context Pack、审批阻断 | 生产级 Guardrails UI、跨任务 Trace 图、工具重放和统一成本统计未完成 |
| Phase 2 Knowledge + Skill Foundation | 部分实现；旧文档过时 | Web Knowledge Studio、飞书资料上传与数字本人动态处置、A- memory/decision distill、Skill Registry | 文件生成 Skill 草案、知识源生命周期、语义检索、行业 Skill 创建/更新、Memory Candidate 审核/冲突仍未完成 |
| Phase 3 Generalist Solution | 部分实现 | Solution Engine、Research Agent、`search_web/read_url`、风险/执行计划、solution/evidence/assumption 表 | Finance Model 仍非完整预算模型；Evaluator 未成为所有方案的自动质量门；来源证据链不完整 |
| Phase 4 Prospecting & Sales | 部分实现；旧文档部分过时 | 公开搜索、市场扫描、Lead discovery、100 条线索流程、organizations/contacts/leads/campaigns、CRM 页面 | 地图/付费目录等稳定 connector、联系人真实性验证、来源证据展示、回复/打开/退订自动 webhook 闭环不足 |
| Phase 5 Quote + CRM + Email + Calendar | 部分实现 | 报价引擎、Markdown artifact、CRM、SMTP Campaign、日历台账、Web Studio、财务/知识文件上传 | 报价专用 PDF/Word/Excel 价格表抽取闭环、Proposal/SOW/Contract 对象、真实 Gmail/Outlook 与外部日历同步未完成 |
| Phase 6 Dev Agent Team | 部分实现 | Dev Agent 规划、Workspace tools、Codex Bridge、通用 build surface | 独立 `dev_runs/dev_artifacts`、代码改动 Trace、自动测试汇总、Review Gate、GitHub PR 工作流未形成完整产品闭环 |
| Phase 7 External Connector Layer | 部分实现 | Browser runner、Web search、SMTP、内部 Calendar/Finance、PPTX、飞书、Dify/n8n 骨架 | 真实邮箱收件箱、外部日历、支付/银行、稳定 Git connector、通用 Document generator 和 connector health 标准未完成 |
| Phase 8 Auto Execute + Finance Gate | 部分实现（核心可用） | approval policy、任务暂停/恢复、Telegram/Web/飞书批准拒绝、审计、真实外部动作门禁 | Web 审批路径应统一为单一 ApprovalService；不同 connector 的风险声明还未完全标准化 |
| Phase 9 Multi-Agent + Tracing | 部分实现 | 子任务、并行/串行 handoff、retry、partial result、Agent/Tool 数据 | 生产级可视化 Trace、跨任务关联、失败节点重放、SLA/耗时/成本指标未完成 |
| Phase 10 Memory + Review | 部分实现 | Memory、Playbook、Review、A- memory/decision/profile、人格蒸馏 | industry/prospecting/ICP memory、周复盘调度、记忆候选审核/冲突/废弃、效果反馈学习未完成 |
| Phase 11 Production Hardening | 部分实现 | `/health`、`/ready`、systemd、审计导出、Docker 文档、Ops 看板、备份手动能力 | health/backup scheduler、rate limit、cost tracking、告警、密钥轮换、灾备演练、零停机发布未完成 |

### V3 优先补齐顺序

1. **统一 ApprovalService**：Telegram、Web、飞书只调用一个审批状态机。
2. **Knowledge/Memory 生命周期**：资料、候选记忆、批准、冲突、废弃、来源。
3. **Artifact 版本与来源图**：所有输出可回溯、可改版、可复用。
4. **真实连接器标准**：统一 health、credential ref、幂等、重试、审计。
5. **生产治理**：rate limit、成本、调度备份、告警。

---

## V4 P0-P7 审计

| V4 Phase | 状态 | 当前实现 | 主要缺口 |
| --- | --- | --- | --- |
| P0 AI Command Spine | 部分实现 | Chief、Context Pack、Agent tools、AppOS Business Contract/Run、飞书 channel messages | 所有入口尚未统一进入 Inbox；Context Pack 未持久化；ShortCode 缺失；Tool Registry 仍分散在多个文件 |
| P1 Memory OS + Library | 部分实现 | memories、A- memory/decision/profile、Knowledge Studio、飞书文件原件/Artifact | `library_items/file_assets`、语义检索、MemoryCandidate 审核、冲突/合并/废弃和来源图缺失 |
| P2 Artifact Library | 部分实现 | artifacts、PPTX、HTML preview、任务交付物入口 | ArtifactVersion、模板复制、对象关联、来源引用、全库浏览和版本比较缺失 |
| P3 Owner Cockpit | 部分实现（主体已存在） | Mission Control、今日优先级、审批、CRM/财务风险、经营分析、大数据可视化 | 缺 Project/Deal/MemoryCandidate/Artifact 全局经营聚合；部分指标仍依赖演示 facts |
| P4 OPC 业务对象 | 部分实现 | CRM、Opportunity、FollowUp、Task、Invoice、Transaction、Subscription | Project、Milestone、Deal、Quote、Proposal、ServicePackage、ObjectLink 未形成统一闭环 |
| P5 Telegram 卡片化 | 部分实现 | 任务卡、审批按钮、Mini App、短通知 | 一些 Chief/Worker 输出仍是长文本和长 ID；短编号和统一卡片协议未完成 |
| P6 Agent 岗位化 | 部分实现 | Specialist Agents、handoff、AgentRun/ToolCall、Context Pack | 不是所有 Agent 都通过 BusinessContract + ContextPack + 统一 Tool Registry 执行 |
| P7 替换旧逻辑 | 未实现 | 已修正若干硬编码流程 | `ChiefOfStaff.ts`、`worker.ts`、`webConsole.ts`、`App.tsx` 仍过大；正则路由和组合层业务逻辑仍多 |

---

## V5 P0-P6 审计

| V5 Phase | 状态 | 当前实现 | 主要缺口 |
| --- | --- | --- | --- |
| P0 Workflow Registry | 部分实现 | `WorkflowRegistry`、`WorkflowRouter`、AppOS contracts/runs/events/failures | 无持久化 `workflow_definitions` 管理页；注册主要靠代码；成本和版本字段不足 |
| P1 Dify Connector | 部分实现 | `DifyConnector`、测试、部分短剧工作流配置 | 缺通用 callback/streaming、cost/token、统一 output mapping、Library 边界和健康管理 |
| P2 n8n Connector | 部分实现 | webhook connector、测试、run/trace 参数 | 缺通用 callback 接收、execution 状态轮询、credential ref、审批策略和持久化配置 |
| P3 Feishu Connector | 部分实现（真实可用能力较多） | 飞书私聊、审批、文件上传、Base ledger mirror、事件监听、对象同步 | 飞书云文档通用创建、对象双向引用、租户/用户映射、卡片 action 通用框架和 connector health 未完成 |
| P4 Content Ops | 未实现 | Content Agent、PPT/内容 artifact 可作为基础 | `/app/content`、`/app/distribution`、ContentCampaign/Post、PublishJob、平台审批发布队列均缺失 |
| P5 Workflow 效果复盘 | 未实现 | workflow run/failure 基础事件可利用 | 成功率、成本、平均耗时、返工次数、质量评分和自动选优未形成 |
| P6 Workflow 市场化 | 未实现 | registry 代码可作为起点 | 场景包、版本切换、A/B 测试、导入导出和市场化管理均未实现 |

---

## 文档已发现的明显错位

1. V3 仍写“文件上传解析未实现”，但 Web 和飞书已经能下载、解析并由数字本人处置；**缺的是 Skill 草案和知识生命周期，不是上传入口本身**。
2. V3 仍写 Search connector 未实现，但 `search_web/read_url`、市场扫描和公开来源抓取已经存在；**缺的是稳定来源证据和生产级 connector 管理**。
3. V3 仍写 accounts/contacts 写入不足，但 CRM migrations 和 prospecting 逻辑已有 organizations/contacts；**缺的是验证、去重和证据质量**。
4. V4/V5 是设计文档，不含勾选状态；不能把“代码里存在同名 class”视为 Phase 完成。
5. README 的“当前状态”应以后引用本审计，而不是继续堆一整段功能清单。
