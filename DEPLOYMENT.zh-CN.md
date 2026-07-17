# Tele-OPC OS V3 Agent OS 部署与配置手册

Telegram-first One-Person Company Operating System

这份文档面向实际部署：本地开发、Docker Compose、VPS/云服务器、Telegram webhook、配置、升级、备份和故障排查。

## 部署形态

推荐从小到大分三档：

| 场景 | 适合你什么时候用 | 推荐方式 |
| --- | --- | --- |
| 本地开发 | 改代码、跑测试、验证 Telegram webhook | Node.js + 本地 PostgreSQL/Redis，或 Docker 只跑数据库 |
| 个人生产 | 你自己日常使用，一人公司早期系统 | VPS + Docker Compose + HTTPS 反向代理 |
| 私有团队 | 私有 Git 仓库、多人维护、长期运行 | 私有仓库 + CI + secret manager + 日常备份 |

当前 V3.2 仍处在 MVP 阶段：任务、审批、审计、Memory、Planner、CRM、Email、SMTP/Nodemailer Campaign 邮件发送、Finance、Calendar、Browser、Ops/Governance、Agent Registry、Skill Registry、最小 AI Agent Runtime、Domain Router / Skill Router 预路由 handoff、Research Agent 前置研究计划、Ops Agent 治理判断、`/runs`、`/trace`、`/solve`、`/prospect`、`/quote`、`/content`、`/dev`、CRM/Email/Finance/Calendar/Browser 自然语言入口的 Agent Runtime、Quote Markdown artifact、V3 run 专用表写入已有基础实现；真实搜索/地图/企业名录、Gmail/Outlook 收件箱同步、Calendar/Stripe/银行/Playwright runner、报价 PDF、文件上传解析和 Claude Code connector 等连接器还在路线图中。

## 最小生产架构

```text
Internet
  -> HTTPS reverse proxy / Cloudflare Tunnel / ngrok
  -> 127.0.0.1:3000 tele-opc-api
  -> Docker network
       -> tele-opc-worker
       -> postgres
       -> redis
```

核心服务：

- `api`：Fastify HTTP 服务，接收 Telegram webhook。
- `worker`：BullMQ worker，执行低风险任务和已批准任务。
- `postgres`：主数据库，保存任务、审批、审计、CRM、财务、邮件、日历、浏览器运行记录。
- `redis`：队列和 worker 协调。

## 前置准备

本地开发需要：

- Node.js 20 或更高版本。
- npm。
- PostgreSQL 16 或 Docker。
- Redis 7 或 Docker。
- Telegram Bot token。

生产部署需要：

- 一台 VPS 或云服务器。
- Docker 和 Docker Compose。
- 一个域名，例如 `opc.example.com`。
- HTTPS 入口：Caddy、Nginx、Cloudflare Tunnel 或其他反向代理。
- 一个安全保存 secret 的地方：密码管理器、云 secret manager 或服务器受限权限文件。

## 配置文件关系

Tele-OPC OS 有两类配置：

| 文件 | 是否提交 Git | 用途 |
| --- | --- | --- |
| `.env.example` | 是 | 环境变量模板，不能放真实 secret |
| `.env` | 否 | 当前机器真实 secret 和连接串 |
| `config/tele-opc.example.yaml` | 是 | 系统策略模板 |
| `config/tele-opc.yaml` | 否 | 当前机器真实策略，可包含业务偏好 |

复制模板：

```bash
cp .env.example .env
cp config/tele-opc.example.yaml config/tele-opc.yaml
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
Copy-Item config\tele-opc.example.yaml config\tele-opc.yaml
```

## 环境变量最小配置

生产环境至少修改：

```env
APP_ENV=production
PUBLIC_BASE_URL=https://opc.example.com
APP_ENCRYPTION_KEY=replace-with-a-long-random-secret

POSTGRES_USER=tele_opc
POSTGRES_PASSWORD=replace-with-a-strong-db-password
POSTGRES_DB=tele_opc

TELEGRAM_BOT_TOKEN=123456789:your_bot_token
TELEGRAM_OWNER_IDS=123456789
TELEGRAM_WEBHOOK_SECRET=replace-with-a-random-webhook-secret

AI_PROVIDER=openai
AI_AGENT_ENABLED=true
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1
OPENAI_TIMEOUT_MS=60000
```

如使用 DeepSeek 这类 OpenAI-compatible 网关，可改成：

```env
AI_PROVIDER=deepseek
AI_AGENT_ENABLED=true
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_API_KEY=sk-...
OPENAI_MODEL=deepseek-v4-pro
OPENAI_TIMEOUT_MS=120000
```

后续接入真实外部服务时再补：

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://opc.example.com/oauth/google/callback

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

BROWSER_ALLOWED_DOMAINS=stripe.com,github.com,google.com
BROWSER_REQUIRE_APPROVAL_FOR_SUBMIT=true
```

如果要启用 `/send_campaign <campaign_id>` 发送邮件，补 SMTP。Gmail 推荐：

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-gmail@gmail.com
SMTP_PASSWORD=your-google-app-password
SMTP_FROM=your-gmail@gmail.com
```

`SMTP_FROM` 是发件人显示地址，可以填 `your-gmail@gmail.com` 或 `Your Name <your-gmail@gmail.com>`。`SMTP_SECURE=true` 通常配 `465` 端口；使用 `587` 端口时通常填 `false`。

如果填了 `SMTP_USER`，也必须填 `SMTP_PASSWORD`；否则系统会把 SMTP 视为未配置，并把 campaign 事件记为 `email_send_skipped`。

不要把 `.env` 发给别人，不要提交到 Git，不要贴进 issue。

## YAML 策略配置

`config/tele-opc.yaml` 管这些东西：

- Telegram 命令和 owner ids。
- 审批动作类型。
- Memory 层级。
- Agent 是否启用。
- Agent 权限和需要审批的动作。
- V3 Agent Registry / Skill Registry 的启用状态和策略边界。
- CRM、财务、邮件、日历、浏览器自动化的边界。
- 浏览器 allowlist。
- 每日简报和每周复盘计划。

建议先只改：

```yaml
app:
  timezone: Asia/Shanghai
  language: zh-CN

telegram:
  owner_ids:
    - 123456789

agents:
  browser:
    allowed_domains:
      - stripe.com
      - github.com
      - google.com
```

如果公开仓库，真实 `config/tele-opc.yaml` 不提交，只提交 `config/tele-opc.example.yaml`。

## 本地开发启动

安装依赖：

```bash
npm install
```

启动数据库和 Redis：

```bash
docker compose up -d postgres redis
```

如果没有 Docker，也可以本机安装 PostgreSQL 和 Redis，并修改 `.env` 里的 `DATABASE_URL` 与 `REDIS_URL`。

执行数据库迁移：

```bash
npm run db:migrate
```

V3.2 至少需要执行到 `012_v3_agent_os.sql`，其中包含 `skill_registry`、`solution_runs`、`prospecting_runs`、`lead_sources`、`outreach_sequences`、`campaigns` 等 V3 表。迁移脚本会按文件名前缀自动顺序执行。

启动 API：

```bash
npm run dev
```

另开终端启动 worker：

```bash
npm run worker
```

检查健康状态：

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
```

## Docker Compose 生产部署

构建镜像：

```bash
docker compose build
```

启动数据库和 Redis：

```bash
docker compose up -d postgres redis
```

执行迁移：

```bash
docker compose run --rm api npm run db:migrate:prod
```

确认迁移日志包含 `012_v3_agent_os.sql`。如果是旧 V2 数据库升级，先备份 PostgreSQL，再执行迁移。

启动 API 和 worker：

```bash
docker compose up -d api worker
```

查看日志：

```bash
docker compose logs -f api worker
```

检查服务：

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
```

默认 `docker-compose.yml` 把 API、PostgreSQL、Redis 都绑定在 `127.0.0.1`。生产环境应该用 HTTPS 反向代理暴露 API，不要把数据库和 Redis 暴露到公网。

## HTTPS 反向代理

Caddy 示例：

```caddyfile
opc.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Nginx 示例：

```nginx
server {
  listen 443 ssl http2;
  server_name opc.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

Cloudflare Tunnel 也可以，核心是让 Telegram 能访问：

```text
https://opc.example.com/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>
```

## Telegram Bot 和 webhook

创建 Bot：

1. 打开 Telegram 的 [@BotFather](https://t.me/BotFather)。
2. 发送 `/newbot`。
3. 保存 BotFather 返回的 token。

获取你的 Telegram user id：

1. 打开 [@userinfobot](https://t.me/userinfobot)。
2. 复制数字 ID。

写入 `.env`：

```env
TELEGRAM_BOT_TOKEN=123456789:your_token_here
TELEGRAM_OWNER_IDS=123456789
TELEGRAM_WEBHOOK_SECRET=replace-with-a-random-secret
PUBLIC_BASE_URL=https://opc.example.com
```

设置 webhook：

```bash
npm run telegram:set-webhook
```

注册 Telegram 斜杠菜单：

```bash
npm run telegram:set-commands
```

Docker 生产环境：

```bash
docker compose run --rm api npm run telegram:set-webhook:prod
docker compose run --rm api npm run telegram:set-commands:prod
```

然后在 Telegram 里对 bot 发送：

```text
/start
/today
/agents
/industry
/solve 评估深圳上班族健康轻食外卖品牌，预算 10 万，3 个月验证。
/prospect 深圳 企业数字化转型 50-300 人 有招聘 IT 或运营岗位
```

## 数据库迁移与升级

每次拉取新代码后：

```bash
git pull
docker compose build
docker compose run --rm api npm run db:migrate:prod
docker compose up -d api worker
```

迁移脚本位于 `migrations/`，按文件名前缀顺序执行。不要手工改已经在生产执行过的 migration；需要变更时新增一个更高编号的 migration。

升级前建议备份：

```bash
docker compose exec postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-tele-opc.sql
```

PowerShell 可以直接指定用户名和库名：

```powershell
docker compose exec postgres pg_dump -U tele_opc tele_opc > backup-tele-opc.sql
```

## 备份与恢复

至少备份：

- PostgreSQL。
- `.env`，放在安全位置。
- `config/tele-opc.yaml`。
- `runtime/` 下未来产生的 artifacts、截图、browser session。

建议节奏：

| 类型 | 频率 | 保留 |
| --- | --- | --- |
| PostgreSQL dump | 每日 | 14-30 天 |
| `.env` 和真实 YAML | 每次变更 | 加密长期保留 |
| browser session | 仅必要时 | 严格限制权限 |
| runtime artifacts | 每日增量 | 视空间而定 |

恢复 PostgreSQL 示例：

```bash
cat backup-tele-opc.sql | docker compose exec -T postgres psql -U tele_opc tele_opc
```

## 安全加固

上线前检查：

- `.env` 不在 Git 中。
- `config/tele-opc.yaml` 不在 Git 中。
- `TELEGRAM_OWNER_IDS` 只包含可信用户。
- `TELEGRAM_WEBHOOK_SECRET` 足够随机。
- `POSTGRES_PASSWORD` 已修改。
- 服务器防火墙不开放 PostgreSQL 和 Redis。
- 只通过 HTTPS 暴露 API。
- 高风险动作保持审批开启。
- 浏览器 allowlist 只包含必要域名。
- OpenAI、Stripe、Google 等 key 设置最小权限。

高风险动作应该始终先创建审批：

- 批量短信、私信、电话或其他非邮件冷启动外联。
- 购买线索、使用付费数据源或启动广告投放。
- 创建、修改、取消真实外部日历邀请。
- 付款、退款、转账。
- 报税、真实开票、账单修改。
- 提交网页表单。
- 发布内容。
- 删除记录。
- 生产部署。
- 密钥变更、破坏性命令或对外承诺合同金额/条款。

## 运行验证

代码验证：

```bash
npm run typecheck
npm test
npm run build
npm audit
```

配置验证：

```bash
node -e "const fs=require('fs'); const YAML=require('yaml'); YAML.parse(fs.readFileSync('config/tele-opc.example.yaml','utf8')); console.log('yaml ok')"
```

服务验证：

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
```

Telegram 验证：

```text
/start
/today
/tasks
/memory
/crm
/finance
/calendar
/browser
/ops
/healthcheck
/eval
/settings
/audit_export 20
/backup 100
/mail
```

## 常见故障

`/ready` 数据库失败：

- 检查 `DATABASE_URL`。
- 确认 PostgreSQL 已启动。
- Docker 环境里 API 应该连 `postgres:5432`，不是 `localhost:5432`。
- 执行 `npm run db:migrate` 或 `npm run db:migrate:prod`。

`/ready` Redis 失败：

- 检查 `REDIS_URL`。
- 确认 Redis 已启动。
- Docker 环境里 API 应该连 `redis:6379`。

Telegram 没有回复：

- 检查 `TELEGRAM_BOT_TOKEN`。
- 检查 `TELEGRAM_OWNER_IDS` 是否是你的数字 user id。
- 检查 `PUBLIC_BASE_URL` 是否可公网 HTTPS 访问。
- 重新执行 `npm run telegram:set-webhook`。
- 如果 Telegram 输入 `/` 没有新命令，执行 `npm run telegram:set-commands`。
- 查看 `docker compose logs -f api`。

worker 不执行：

- 查看 `docker compose logs -f worker`。
- 检查 Redis 连接。
- 检查任务是否处于 `queued`。
- 高风险任务需要先 `/approve <approval_id>`。

## 私有仓库部署流程

服务器首次部署：

```bash
git clone git@github.com:<you>/tele-opc.git
cd tele-opc
cp .env.example .env
cp config/tele-opc.example.yaml config/tele-opc.yaml
```

填好 secret 后：

```bash
docker compose build
docker compose up -d postgres redis
docker compose run --rm api npm run db:migrate:prod
docker compose up -d api worker
docker compose run --rm api npm run telegram:set-webhook:prod
docker compose run --rm api npm run telegram:set-commands:prod
```

后续更新：

```bash
git pull
docker compose build
docker compose run --rm api npm run db:migrate:prod
docker compose up -d api worker
```

私有仓库也不要提交 `.env`、OAuth refresh token、browser session、客户数据、财务数据、数据库 dump。
