# Windows 个人微信桥接客户端

## 架构

```text
Windows 微信桌面端
→ TeleOpc.WechatBridge（UI Automation）
→ POST /api/bridge/v1/messages
→ A- 人格与记忆生成回复
→ bridge_outbox
→ Windows 客户端轮询、定位原会话并发送
→ ACK sent / failed
```

飞书作为状态与人工控制面，不通过鼠标操作飞书桌面窗口传输数据。

## 客户端调节项

- 自动回复 / 观察模式；
- 暂停与恢复；
- 是否处理群聊（默认关闭）；
- 轮询间隔；
- 服务器地址与设备令牌；
- 微信 UIA 控件树诊断导出；
- 托盘后台运行。

## 安全与可靠性

- 设备令牌只在创建时返回，服务器仅保存 SHA-256 哈希；
- 入站使用 `device + messageId` 幂等；
- 回复队列使用 PostgreSQL `FOR UPDATE SKIP LOCKED` 和 60 秒租约；
- 客户端发送后必须 ACK，失败会保留错误；
- 群聊默认不自动回复；
- 外部聊天内容作为不可信数据，不允许直接调用工具；
- 设备配置文件生成在发布包中，不提交 Git。

## 首次校准

不同微信 Windows 版本暴露的 UI Automation 控件树可能不同。首次运行应：

1. 登录并打开微信；
2. 启动客户端；
3. 点击“导出微信诊断”；
4. 将桌面生成的 `wechat-uia-*.txt` 提供给维护端；
5. 根据真实控件树校准联系人列表、消息区域和输入框选择器；
6. 使用第二个微信账号完成收发验收。
