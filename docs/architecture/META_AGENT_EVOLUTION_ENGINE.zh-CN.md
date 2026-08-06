# Tele-OPC 元智能体架构师与进化引擎

## 目标

把用户任意业务需求转换为一条可追踪的动态运行链：

```text
业务需求
  → 元架构蓝图
  → 生产 / 审计 / 支援岗位图谱
  → GitHub Search + MCP Registry 实时发现
  → 组件适配评分
  → 只读参考装配
  → 生产执行
  → 独立审计
  → 不合格/超时/空输出则热替换
  → 最终交付与运行轨迹
```

## 模块边界

- `src/meta-agent/architect.ts`：将自然语言需求变成声明式蓝图。
- `src/meta-agent/discovery.ts`：固定访问 GitHub API 与官方 MCP Registry，搜索并初评分。
- `src/meta-agent/service.ts`：组件重排、生产、审计、故障淘汰和有界热替换。
- `src/meta-agent/assembler.ts`：把候选写成 `runtime/meta-agent/components/*/manifest.json`，形成可追踪的只读装配件。
- `src/meta-agent/store.ts`：PostgreSQL 生命周期与运行轨迹。
- `src/meta-agent/web-routes.ts`：Web API。
- `web/src/components/MetaAgentWorkbench.tsx`：非程序员操作台。

## 数据表

- `meta_agent_blueprints`：需求、岗位图谱、验收标准、检索词和审批边界。
- `meta_agent_components`：GitHub/MCP 候选、来源、评分、版本和装配状态。
- `meta_agent_runs`：一次实际运行与最终结果。
- `meta_agent_attempts`：每轮生产、审计、错误、分数和热替换记录。

## Web API

- `GET /api/web/meta-agent`
- `POST /api/web/meta-agent/blueprints`
- `POST /api/web/meta-agent/blueprints/:id/rediscover`
- `POST /api/web/meta-agent/blueprints/:id/run`
- `GET /api/web/meta-agent/runs/:id`

## 当前安全模型

第三方仓库 README、MCP 描述、包定义和远程地址全部视为不可信输入：

- 可以搜索、评分、保存来源和只读挂载；
- 不接受第三方内容覆盖系统提示词；
- 不把 API Key、Token 或宿主机权限传给候选；
- 不在宿主机自动执行 `npm install`、`pip install`、shell 或远程 MCP；
- 模型超时、空输出、审计失败都形成 attempt，并触发下一候选；
- 可执行安装必须进入下一阶段的审批、隔离容器、资源配额、健康检查和回滚机制。

## 下一阶段：Executable Adapter Sandbox

1. 下载固定 commit/tag 的源码或包，并计算 SHA-256。
2. 静态检查许可证、安装脚本、网络权限、文件权限和凭证需求。
3. 生成审批卡，明确代码来源、hash、权限和回滚点。
4. 在 rootless 容器中安装，默认无宿主文件、无凭证、受限网络和资源配额。
5. 运行健康检查和标准能力测试。
6. 通过后注册为 Tool/MCP Adapter；不通过自动删除隔离实例并恢复旧版本。
7. 记录成本、成功率、延迟和质量评分，用于后续自动选优。
