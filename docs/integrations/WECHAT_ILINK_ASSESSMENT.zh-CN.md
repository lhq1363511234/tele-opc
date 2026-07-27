# 微信 iLink 接入评估

> 审查日期：2026-07-27  
> 用户提供项目：`x1ah/wechat-ilink-demo`  
> 审查提交：`5e0507b13b24a3c042936b7ac8fd9615d441d728`（2026-03-22）  
> 官方对照：`Tencent/openclaw-weixin` / `@tencent-weixin/openclaw-weixin@2.4.6`（2026-06-22 发布）

## 结论

`wechat-ilink-demo` 证明了 **Tele-OPC 可以不依赖 PC Hook、iPad 协议或逆向注入，直接通过微信 iLink HTTP API 实现扫码登录、长轮询收消息和上下文回复**。技术方向成立，但该仓库只能作为最小协议演示，不能原样进入生产。

推荐路线：

1. 不部署 demo 的 echo Bot；
2. 以腾讯当前官方 `openclaw-weixin 2.4.6` 的协议实现为事实源；
3. 在 Tele-OPC 内新增独立 **M21 微信 iLink Channel**；
4. 复用现有 M03 数字本人、M04 Command Spine、M05 Task/Approval、M06 Trace，而不是再造一套人格或任务引擎；
5. 默认只生成回复草稿，低风险联系人可配置自动回复，高风险消息必须本人批准。

## 项目实际内容

该仓库只有一个 429 行的 `bot.mjs`、一个依赖 `qrcode-terminal` 和一份 README，流程是：

```text
get_bot_qrcode
  → get_qrcode_status
  → 把 bot_token 明文写入 bot_token.json
  → getupdates 长轮询
  → 提取文本
  → sendtyping
  → sendmessage 原样 Echo
```

它没有 AI、人格、知识库、关系记忆、审批、任务、CRM、审计、管理后台或多租户。

## 可以复用的部分

- iLink API 端点和基本请求结构；
- QR 登录流程；
- `get_updates_buf` 长轮询游标；
- `context_token` 回复约束；
- `X-WECHAT-UIN` 请求头生成；
- typing ticket 基础用法；
- 文本消息提取和 Bot 自身消息过滤。

## 不能直接复制的部分

### 1. 协议版本过时

Demo 固定参考 `@tencent-weixin/openclaw-weixin 1.0.2`。截至审查日，腾讯 npm 包最新为 `2.4.6`。当前官方实现已经增加或修正：

- `iLink-App-Id`、`iLink-App-ClientVersion` 和 `bot_agent`；
- 多微信账号和账号隔离；
- `get_updates_buf` 持久化；
- `context_token` 持久化；
- `-14` stale token 一小时保护；
- 二次验证码、二维码刷新和已绑定重定向；
- notify start/stop；
- 消息发送返回值校验；
- fetch 网络错误分类；
- 外发 hook、进度消息、媒体上传和 SILK 处理；
- long-poll AbortSignal 和优雅关闭。

### 2. Token 明文保存

Demo 把 `bot_token` 写入项目根目录 `bot_token.json`，没有加密、权限模式、轮换、审计和多账号隔离。Tele-OPC 必须使用 `APP_ENCRYPTION_KEY` 加密，数据库只存密文或 credential reference。

### 3. 游标不持久化

Demo 每次启动都把 `cursor` 设为空字符串。重启后可能重复读取或产生消息窗口不确定性。Tele-OPC 必须按微信账号持久化游标，并在消息落库和游标推进之间保证可恢复、幂等。

### 4. 没有幂等和并发控制

Demo 没有消息唯一键、重复投递处理、每会话顺序执行和重试死信。Tele-OPC 应继续使用 `channel_messages(channel, external_message_id)` 去重，并按 `account_id + peer_id` 串行处理。

### 5. 没有权限和关系边界

Demo 对任何发消息的人都 Echo。生产环境必须有：

- 微信账号所有者绑定；
- 联系人 allow/deny/approval policy；
- 陌生人默认草稿模式；
- 财务、合同、承诺、冲突、人情敏感内容审批；
- 防提示词注入和知识泄漏；
- 每条回复引用所用人格/关系记忆和审计记录。

### 6. 发送能力受 context_token 限制

这不是任意主动营销通道。回复依赖用户先发消息产生的 `context_token`。Tele-OPC 必须把“能回复”和“能主动触达”分开建模，不能把它包装成无限制群发工具。

### 7. 工程和许可证不足

仓库 README 写 MIT，但仓库没有实际 LICENSE 文件，GitHub API 也没有识别到许可证；正式复用代码前需让作者补许可证或只参考协议思路、重新实现。仓库只有一个提交和一个主文件，缺测试、CI、类型约束、监控和生产部署。

## Tele-OPC 推荐模块：M21 微信 iLink Channel

```text
微信用户
  ↓
iLink long-poll adapter
  ↓
channel_messages(channel=wechat)
  ↓
M04 Command Spine + M03 数字本人
  ↓
M05 Task / Approval
  ↓
回复策略
  ├─ 自动回复：明确授权的低风险联系人/场景
  ├─ 草稿回复：默认模式
  └─ 强制审批：钱、合同、承诺、冲突、隐私、战略
  ↓
iLink sendmessage(context_token)
```

### 后端子模块

```text
src/channels/wechat-ilink/
├── api-client.ts          # 当前官方协议、超时、ret 校验、脱敏
├── login-service.ts       # QR、二次验证码、账号绑定
├── account-store.ts       # 加密 token、多账号、状态
├── cursor-store.ts        # get_updates_buf 持久化
├── context-token-store.ts # account + peer 的回复上下文
├── poller.ts              # 长轮询、取消、退避、stale-token guard
├── normalizer.ts          # 微信消息 → ChannelMessage
├── reply-policy.ts        # 自动/草稿/审批
├── sender.ts              # 文本/媒体回复、client_id 幂等
└── web-routes.ts          # 控制台扫码、状态、解绑、策略
```

### 建议数据对象

- `wechat_accounts`
- `wechat_sync_cursors`
- `wechat_context_tokens`
- `wechat_contact_policies`
- 复用 `channel_messages`、`tasks`、`approvals`、`agent_runs`、`audit_logs`

### Web 控制台

- 扫码连接/重新连接；
- 在线状态、最后收信时间、最后错误；
- 联系人回复策略；
- 待批准回复；
- 回复历史、使用的人格证据和关系记忆；
- 一键暂停自动回复；
- 多微信账号隔离。

## 分阶段实施

### M21-P0 协议探针

只做 QR 登录、加密保存 token、收一条消息、人工回复一条消息。所有外发必须审批。

### M21-P1 数字本人草稿

微信消息进入 M03/M04，但只生成草稿，在飞书/Web 中批准后回复。

### M21-P2 关系记忆

按联系人加载关系、历史、边界和最近承诺；回复后写关系交互记录。

### M21-P3 有限自动回复

仅对明确配置的低风险联系人和场景自动回复，设置频率、时间段和熔断。

### M21-P4 多用户产品化

每个租户独立账号、token、游标、联系人策略、人格和审计；禁止跨租户上下文。

## 最终判断

- **方向价值：高**
- **Demo 直接可用性：低**
- **协议验证价值：高**
- **生产安全性：低**
- **推荐：重新实现 M21 adapter，复用 Tele-OPC 核心，不部署 Echo Demo**

## M21-P0 当前实现状态（2026-07-27）

已完成并部署：

- `018_wechat_ilink.sql`：账号、扫码会话、同步游标、联系人上下文令牌；
- `APP_ENCRYPTION_KEY` + AES-256-GCM：`bot_token`、二维码登录凭证、`context_token` 加密落库；
- QR 登录与二次验证码接口；
- 独立 `tele-opc-wechat` 长轮询 Worker；
- `get_updates_buf` 持久化、消息幂等和 `-14` stale session 熔断；
- 外部微信消息进入现有 `channel_messages`、任务和审计；
- 现有 A- 人格资料参与回复草稿生成，外部消息按不可信输入隔离；
- 回复策略支持 `approval` 和 `auto`；当前实例已按所有者要求启用 `auto`，收到可处理的 Bot 私聊后由数字本人直接回复；
- `approval` 模式下，每条微信外发创建 `wechat_send_message` 高风险审批；
- 审批通过后由现有 Worker 使用最新加密 `context_token` 真实回复；
- Web 管理 API：账号状态、发起扫码、轮询扫码状态。

当前真实账号已经完成扫码绑定，服务端同步游标已建立。下一验收点是收到一条真实微信消息、在飞书批准草稿并验证微信实际送达。
