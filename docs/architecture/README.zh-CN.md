# Tele-OPC 架构与维护入口

> 审计日期：2026-07-27
> 目的：让路线图、实际代码和故障定位使用同一套模块语言。

## 文档入口

1. [Phase 实现审计](./PHASE_IMPLEMENTATION_AUDIT.zh-CN.md)：V3 / V4 / V5 哪些已实现、部分实现、未实现。
2. [模块架构地图](./MODULE_ARCHITECTURE.zh-CN.md)：每个模块负责什么，前端、API、数据表、服务和依赖在哪里。
3. [Bug 路由手册](./BUG_ROUTING_INDEX.zh-CN.md)：根据症状直接定位模块、日志、接口和代码。
4. [机器可读模块目录](./module-catalog.yaml)：用于脚本、Agent 和后续自动故障分派。

## 维护规则

- 新功能必须先选择一个主模块；跨模块调用通过公开接口，不直接复制业务逻辑。
- Bug 单必须写模块编号，例如：`M09 Finance / 飞书表格上传解析失败`。
- 一个模块的前端、API、领域逻辑、数据表和测试要在模块目录中保持对应。
- 路线图打勾前必须有：代码入口、数据落点、真实运行验证、测试或明确的人工验收记录。
- `src/brain/chiefOfStaff.ts`、`src/worker.ts`、`src/webConsole.ts`、`web/src/App.tsx` 只作为组合层逐步瘦身，不再继续吸收独立业务规则。
