# Tele-OPC OS V2 发布到 GitHub / 私有 Git 仓库清单

这份清单用于把 Tele-OPC OS V2 放到公开 GitHub 仓库或私有 Git 仓库前做最后检查。

## 先决定仓库类型

| 类型 | 适合情况 | 注意事项 |
| --- | --- | --- |
| 公开 GitHub | 想开源、接受关注或协作 | 必须清理 secret、选择许可证、写清项目状态 |
| 私有 GitHub/GitLab/Gitea | 自己部署或小团队维护 | 仍然不要提交 secret 和真实客户/财务数据 |
| 双仓库 | 公开核心框架，私有业务配置 | 推荐一人公司长期使用 |

推荐做法：

- 公开仓库保存通用代码、example 配置、文档和测试。
- 私有仓库或服务器保存真实配置、私有 prompt、内部流程和部署 playbook。
- secret 放在 `.env`、secret manager 或服务器环境变量中。

## 可以提交的内容

```text
README.md
README.zh-CN.md
DEPLOYMENT.zh-CN.md
RELEASE_CHECKLIST.zh-CN.md
V2_LONG_TERM_PLAN.md
V2_LONG_TERM_PLAN.zh-CN.md
V2_IMPLEMENTATION_ROADMAP.zh-CN.md
CONTRIBUTING.md
SECURITY.md
.env.example
.gitignore
config/tele-opc.example.yaml
src/
tests/
migrations/
package.json
package-lock.json
tsconfig.json
vitest.config.ts
Dockerfile
docker-compose.yml
```

## 绝对不要提交的内容

```text
.env
.env.*
config/tele-opc.yaml
config/*.local.yaml
runtime/
data/
artifacts/
logs/
browser-profile/
playwright-report/
test-results/
*.dump
*.sqlite
*.sqlite3
backup-*.sql
```

不要提交这些值：

- Telegram bot token。
- Telegram webhook secret。
- OpenAI / Anthropic / OpenRouter key。
- Google OAuth client secret。
- OAuth refresh token。
- Stripe secret key。
- 银行、支付、邮箱、CRM 凭据。
- browser cookie、profile、session。
- 客户数据导出。
- 财务数据导出。
- 数据库 dump。

## 开源前必做检查

运行：

```bash
git status --ignored
git ls-files
git ls-files | rg "(\.env|tele-opc\.yaml|runtime|dump|cookie|token|secret|password|refresh)"
npm run typecheck
npm test
npm run build
npm audit
```

如果没有 `rg`，可以用：

```bash
git ls-files | grep -E "(\.env|tele-opc\.yaml|runtime|dump|cookie|token|secret|password|refresh)"
```

也建议全文搜索敏感词：

```bash
rg -n "sk-|xoxb-|ghp_|gho_|bot_token|TELEGRAM_BOT_TOKEN|OPENAI_API_KEY|STRIPE_SECRET_KEY|GOOGLE_CLIENT_SECRET|password|secret" .
```

看到 `.env.example` 里的占位符是正常的；看到真实 token 或真实密码就要删除并轮换密钥。

## 根 README 必须说清楚

公开仓库的 README 应该明确：

- 这是 `Telegram-first One-Person Company Operating System`。
- 当前阶段不是完整生产版。
- 已实现哪些模块。
- 哪些外部连接器还未真实接入。
- 如何本地启动。
- 如何 Docker Compose 部署。
- 如何设置 Telegram bot 和 webhook。
- 如何配置 `.env` 和 `config/tele-opc.yaml`。
- 高风险动作必须审批。
- 不要提交 secret。
- 部署和发布细节链接到中文文档。

## 许可证

如果公开 GitHub 并希望别人能合法使用代码，需要选择许可证。

常见选择：

| 许可证 | 适合情况 |
| --- | --- |
| MIT | 最宽松，适合个人开源工具 |
| Apache-2.0 | 宽松，同时带专利授权条款 |
| AGPL-3.0 | 想要求网络服务修改也开源 |
| Proprietary / no license | 只公开展示，不授予使用权 |

当前仓库还没有强制写入 `LICENSE`。发布公开仓库前建议你先决定许可证，再添加对应 `LICENSE` 文件。

## GitHub 公开仓库初始化

首次提交：

```bash
git init
git add README.md README.zh-CN.md DEPLOYMENT.zh-CN.md RELEASE_CHECKLIST.zh-CN.md
git add V2_LONG_TERM_PLAN.md V2_LONG_TERM_PLAN.zh-CN.md V2_IMPLEMENTATION_ROADMAP.zh-CN.md
git add CONTRIBUTING.md SECURITY.md
git add .env.example .gitignore config/tele-opc.example.yaml
git add src tests migrations package.json package-lock.json tsconfig.json vitest.config.ts
git add Dockerfile docker-compose.yml
git commit -m "Initial Tele-OPC OS V2"
git branch -M main
git remote add origin git@github.com:<you>/tele-opc.git
git push -u origin main
```

如果 GitHub 上已经建好仓库：

```bash
git remote add origin git@github.com:<you>/tele-opc.git
git push -u origin main
```

建议开启：

- Branch protection。
- Required status checks。
- Dependabot security updates。
- Secret scanning。
- Code scanning。

## 私有仓库初始化

私有仓库命令类似：

```bash
git init
git add README.md README.zh-CN.md DEPLOYMENT.zh-CN.md RELEASE_CHECKLIST.zh-CN.md
git add V2_LONG_TERM_PLAN.md V2_LONG_TERM_PLAN.zh-CN.md V2_IMPLEMENTATION_ROADMAP.zh-CN.md
git add CONTRIBUTING.md SECURITY.md
git add .env.example .gitignore config/tele-opc.example.yaml
git add src tests migrations package.json package-lock.json tsconfig.json vitest.config.ts
git add Dockerfile docker-compose.yml
git commit -m "Initial Tele-OPC OS V2"
git branch -M main
git remote add origin git@github.com:<you>/tele-opc-private.git
git push -u origin main
```

私有仓库可以多放：

- 内部业务流程文档。
- 私有 agent prompt。
- 私有部署脚本。
- 私有集成说明。

但仍然不要放：

- `.env`。
- token。
- browser session。
- 客户数据。
- 财务数据。
- 数据库 dump。

## 双仓库建议

长期建议这样拆：

```text
tele-opc/
  公开：核心代码、example 配置、文档、测试

tele-opc-private/
  私有：真实部署 playbook、私有 prompt、内部 SOP、业务配置模板

服务器：
  真实 .env
  真实 config/tele-opc.yaml
  PostgreSQL volume
  Redis volume
  runtime artifacts
```

公开仓库更新后，在私有仓库或服务器合并上游代码，再部署。

## 发布前最终清单

- [ ] `.env` 没有被 Git 跟踪。
- [ ] `config/tele-opc.yaml` 没有被 Git 跟踪。
- [ ] `runtime/`、browser session、数据库 dump 没有被 Git 跟踪。
- [ ] README 写清当前项目状态。
- [ ] 部署文档能从零跑通。
- [ ] `npm run typecheck` 通过。
- [ ] `npm test` 通过。
- [ ] `npm run build` 通过。
- [ ] `npm audit` 没有高风险问题。
- [ ] 许可证已经选择，或 README 明确暂未授权。
- [ ] SECURITY.md 已存在。
- [ ] CONTRIBUTING.md 已存在。
- [ ] Telegram bot token、OpenAI key、Stripe key 已确认没有泄露。
- [ ] 如果曾经泄露过 secret，已经轮换。
