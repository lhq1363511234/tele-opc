# 飞书 CPS 选剧入口

## 当前可用平台

- 北斗智影：`inbeidou_start_selection`
- MoboBoost / CDReader：`moboboost_start_selection`

MoboBoost 默认工作台地址：

```text
https://ckoc.cdreader.com/cn/material/content/v2/center
```

兜底邀请入口：

```text
https://mckoc.cdreader.com/#/home?invCode=M939405
```

## 固定公网地址

当前飞书卡片回调地址仍可沿用旧地址，它已经兼容 `inbeidou_*` 和 `moboboost_*` 动作：

```text
https://feishu.opctoai.xyz/api/appos/cps/inbeidou/feishu/card-action
```

机器人菜单事件订阅地址也可沿用旧地址：

```text
https://feishu.opctoai.xyz/api/appos/cps/inbeidou/feishu/menu-event
```

也可以使用 MoboBoost 独立地址：

```text
https://feishu.opctoai.xyz/api/appos/cps/moboboost/feishu/menu-event
https://feishu.opctoai.xyz/api/appos/cps/moboboost/feishu/card-action
```

## 启动本地服务

在 `B:\Cir\CodexProjects\tele-opc` 执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\appos\start_feishu_inbeidou_entry.ps1
```

该脚本负责：

- 确保 Tele-OPC 后端在线
- 确保 Cloudflare Tunnel `tele-opc-feishu` 在线
- 确保 `feishu.opctoai.xyz` 指向本机 `http://127.0.0.1:3000`
- 启动飞书消息监听器

停止：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\appos\stop_feishu_inbeidou_entry.ps1
```

## 飞书机器人菜单配置

机器人菜单只支持单聊，不支持群聊。

在飞书开发者后台进入 `opctoai` 应用：

1. 打开 **添加应用能力 > 机器人**。
2. 开启 **机器人自定义菜单**。
3. 新增菜单项：

```text
菜单名称：北斗选剧
响应动作：推送事件
event_key：inbeidou_start_selection
```

4. 再新增菜单项：

```text
菜单名称：MoboBoost选剧
响应动作：推送事件
event_key：moboboost_start_selection
```

5. 打开 **事件与回调 > 事件配置**。
6. 订阅事件：`机器人自定义菜单事件`，事件类型 `application.bot.menu_v6`。
7. 事件订阅请求地址填写：

```text
https://feishu.opctoai.xyz/api/appos/cps/inbeidou/feishu/menu-event
```

8. 创建应用版本并发布。发布成功后等 5 分钟，再在机器人单聊窗口查看菜单。

## 飞书文字命令

飞书消息监听器支持：

```text
北斗选剧
MoboBoost选剧
CDReader选剧
拉剧
```

`拉剧` 默认进入北斗智影；MoboBoost/CDReader 需要明确包含 `MoboBoost`、`Mobo`、`CDReader`、`ckoc` 或 `mckoc`。

## MoboBoost 本地验证命令

只拉平台和候选短剧：

```powershell
$env:CLOAKBROWSER_PROFILE="152a3eef-6b63-4ef1-a0cb-0c7127110ed5"
npm run appos:moboboost:cps -- --output runtime/moboboost-cps-output --list-only
```

采集第 1 条候选短剧，生成 AppOS JSON：

```powershell
$env:CLOAKBROWSER_PROFILE="152a3eef-6b63-4ef1-a0cb-0c7127110ed5"
npm run appos:moboboost:cps -- --output runtime/moboboost-cps-output --tasks 0 --no-download
```

当前 MoboBoost 脚本默认不自动点击下载按钮，会生成下载任务：

- 添加至MoboTree
- TTO锚点
- 复制网盘地址
- 原片下载
- 素材下载

等按钮行为确认稳定后，再把真实点击下载做成显式模式。

## 当前 Cloudflare 配置

配置文件：

```text
config/cloudflared/tele-opc-feishu.yml
```

Tunnel：

```text
tele-opc-feishu
4f898c5e-77f2-4bd2-91e5-596fc5e93f22
```
