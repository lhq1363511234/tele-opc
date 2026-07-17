# Contributing to Tele-OPC OS

欢迎贡献 Tele-OPC OS。这个项目的目标是构建 Telegram-first One-Person Company Operating System，一人公司可以用 Telegram 驱动任务、审批、CRM、财务、邮件、日历和浏览器自动化。

## 项目原则

- 先读路线图，再改代码。
- 低风险动作可以自动化。
- 高风险、外部、不可逆动作必须先创建审批。
- 所有关键动作都应该可追踪、可审计、可复盘。
- 不要提交 secret、客户数据、财务数据或 browser session。

主要文档：

- `README.md`
- `README.zh-CN.md`
- `DEPLOYMENT.zh-CN.md`
- `RELEASE_CHECKLIST.zh-CN.md`
- `V2_LONG_TERM_PLAN.zh-CN.md`
- `V2_IMPLEMENTATION_ROADMAP.zh-CN.md`

## 本地开发

```bash
npm install
cp .env.example .env
cp config/tele-opc.example.yaml config/tele-opc.yaml
docker compose up -d postgres redis
npm run db:migrate
npm run dev
```

另开终端：

```bash
npm run worker
```

## 验证

提交前至少运行：

```bash
npm run typecheck
npm test
npm run build
```

如果改了依赖或部署配置，也运行：

```bash
npm audit
node -e "const fs=require('fs'); const YAML=require('yaml'); YAML.parse(fs.readFileSync('config/tele-opc.example.yaml','utf8')); console.log('yaml ok')"
```

## 数据库迁移

- migration 放在 `migrations/`。
- 使用递增编号，例如 `011_feature_name.sql`。
- 不要修改已经发布或已经在生产执行过的 migration。
- 新表要考虑审计、索引、状态字段和 JSONB metadata。

## 审批规则

新增 agent、connector 或自动化能力时，必须明确：

- 它可以读取什么。
- 它可以写入什么内部记录。
- 它触发哪些审批。
- 它会写入哪些审计日志。
- 它失败时如何恢复。

默认必须审批：

- 发送邮件。
- 联系客户。
- 创建、修改、取消外部日历事件。
- 付款、退款、转账。
- 提交网页表单。
- 发布内容。
- 删除记录。
- 生产部署。

## 文档同步

改功能时同步更新：

- `README.md` 的当前实现状态。
- `README.zh-CN.md` 的 Telegram 使用说明。
- `config/tele-opc.example.yaml` 的命令、agent 或审批配置。
- `V2_IMPLEMENTATION_ROADMAP.zh-CN.md` 的阶段状态。

## Pull Request 建议

PR 描述建议包含：

```text
## Summary
- ...

## Safety
- High-risk actions require approval: yes/no
- Secrets or customer data added: no

## Tests
- npm run typecheck
- npm test
- npm run build
```

## 不接受的提交

- 真实 `.env`。
- 真实 `config/tele-opc.yaml`。
- API key、OAuth token、cookie。
- 客户数据、财务数据、数据库 dump。
- 绕过审批直接执行外部动作。
- 没有测试或没有文档同步的高风险行为改动。
