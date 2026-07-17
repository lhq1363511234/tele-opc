# Codex 项目自检与修复循环

这个循环用于持续检测 Tele-OPC 项目是否还能正常构建、测试和运行关键短剧 CPS 逻辑。

它默认只做检测和生成报告，不会自动改代码。只有显式加 `--repair` 时才会调用 Codex CLI 尝试修复。

## 快速使用

只检测一次：

```powershell
npm run codex:repair-loop -- --max-iterations 1 --check-updates
```

完整检测一次：

```powershell
npm run codex:repair-loop -- --full --max-iterations 1 --check-updates
```

检测失败后自动调用 Codex 修复，最多 3 轮：

```powershell
npm run codex:repair-loop -- --full --repair --max-iterations 3 --check-updates
```

Windows 一键脚本：

```powershell
.\run-codex-repair-loop.ps1 -Mode full -MaxIterations 3 -Repair -CheckUpdates
```

## 检查内容

quick 模式：

- `npm run typecheck`
- CPS 关键测试：
  - `tests/appos/drama-run.test.ts`
  - `tests/appos/short-drama-capcut-prep.test.ts`
  - `tests/appos/short-drama-edit-planner-contract.test.ts`

full 模式额外检查：

- `npm run web:typecheck`
- `npm test`
- `npm run build`

加 `--check-updates` 时会执行：

- `npm outdated --json`

更新结果只写入报告，不会自动升级依赖。依赖升级可能引入破坏性变化，应该单独执行并重新跑 full 检查。

## 报告位置

每轮输出：

```text
runtime/codex-repair-loop/iteration-XX.json
runtime/codex-repair-loop/iteration-XX.md
```

最新报告固定在：

```text
runtime/codex-repair-loop/latest.json
runtime/codex-repair-loop/latest.md
```

## 修复模式

加 `--repair` 后，如果某轮检查失败，脚本会调用：

```text
codex exec resume --last --skip-git-repo-check -
```

它会把失败报告作为 prompt 传给 Codex，并要求只修复本轮失败，不做无关重构。

修复结果写入：

```text
runtime/codex-repair-loop/repair-XX.json
```

## 当前短剧 CPS 关键约束

循环里的 CPS 关键测试会防止以下回退：

- 不允许写死某部剧、某个平台、某个 5 集目录。
- 每次选剧必须生成独立 `DramaRun`。
- 不允许重新引入固定 20 秒切片策略。
- 不允许把整集或单个长片段当成剪辑结果。
- 每条剪辑计划必须 hook-first。
- 必须保留三种固定风格：高燃冲突版、悬念反转版、解说引导版。

## 已知边界

- 这个循环能证明代码层面的 typecheck、测试和 build 正常。
- 它不能替代真实平台端到端测试，例如 CloakBrowser 是否登录、素材平台是否改版、CapCut 是否成功导出。
- 真实链路仍需要用一部剧跑完整 `DramaRun -> 采集 -> 预处理 -> AI 策略 -> 剪辑 -> 导出 -> 飞书审核`。
