# 北斗智影短剧 CPS 剪辑指南

## 核心目标

为短剧 CPS 矩阵分发生成可执行的 CapCut 剪辑计划。计划由 Dify/AI 根据字幕、媒体分析、剧集顺序和剪辑指南生成；代码层只负责校验、归一化、加字幕、二创增强和执行。

## 剪辑策略

1. AI 自主判断每一集的剧情钩子、切点、是否为混剪/预告/回顾型素材。不能假设第 1 集一定是混剪。
2. 正常剧情集从 AI 选出的最强钩子开始剪。
3. 如果某一集钩子前有铺垫内容，且存在上一条成片，这段内容应放到上一条成片结尾，`purpose` 使用 `next_episode_pre_hook_setup`。
4. 一直剪到最后一集结束，不按固定视频数量停止。
5. 每个可执行 cut 目标 90-180 秒。超过 180 秒时应拆成下一条连续 cut。

## 固定风格矩阵

AI 必须生成三套完整的全剧剪辑策略，而不是只给单个 cut 换标题。三套策略都要从第一条有效成片开始，一直覆盖到最后一集结束。

### 高燃冲突版

目标：让用户在前 3 秒感到“马上出事”，适合冷启动流量和强情绪点击。

AI 需要生成：

- 一套从头到尾的高燃冲突版 cut 列表，例如 `high_burn_001`、`high_burn_002`、`high_burn_003`。
- 每条 cut 的钩子优先选择危险、争吵、追杀、献祭、威胁、强情绪、命令、尖叫、逃跑、对抗。
- timeline 要优先保留冲突爆发、冲突升级、人物对抗和强情绪转折。
- 顶部 hook caption 要直接、短、强刺激，例如 `She was chosen as the sacrifice.`、`The dragon came for her.`。
- `publishCopy` 要突出危险、选择、代价、冲突升级。
- `riskNotes` 要提醒暴力、强迫、亲密关系、误导性承诺等平台风险。

### 悬念反转版

目标：让用户产生“为什么会这样”的疑问，适合连续追更和评论互动。

AI 需要生成：

- 一套从头到尾的悬念反转版 cut 列表，例如 `suspense_001`、`suspense_002`、`suspense_003`。
- 每条 cut 的钩子优先选择身份暴露、误会、诅咒、隐藏关系、命运绑定、背叛、反常台词、剧情反转。
- timeline 可以让开头先出现悬念句或反常画面，但主体剧情仍要连贯，不能乱跳。
- 顶部 hook caption 要制造未知感，例如 `The sacrifice was never random.`、`He needs her to break the curse.`。
- `publishCopy` 要突出疑问、秘密、反转、下一步会发生什么。
- `riskNotes` 要提醒标题党、过度夸张、剧情误导和敏感关系表达。

### 解说引导版

目标：降低理解成本，让用户即使没看过前文也能看懂剧情，适合 Facebook 等剧情消费场景。

AI 需要生成：

- 一套从头到尾的解说引导版 cut 列表，例如 `narration_001`、`narration_002`、`narration_003`。
- 每条 cut 的钩子优先选择能概括人物关系、世界观、任务目标、核心矛盾的字幕或画面。
- timeline 要更重视剧情完整性，少跳切，保留因果关系和人物动机。
- 可以加入英文旁白或顶部引导字幕，但不能遮挡原英文字幕。
- 顶部 hook caption 要讲清楚剧情，例如 `A cursed dragon king needs a human bride.`。
- `publishCopy` 要突出剧情设定、人物关系、冲突原因和继续观看动机。
- `riskNotes` 要提醒剧透程度、旁白遮挡字幕、平台敏感词和推广链接表达。

### 三套策略的关系

- 三套策略都必须从头剪到尾，不能只生成某一段的三个包装版本。
- 三套策略可以使用同一批素材，但 AI 必须分别生成自己的 `hook`、`timeline`、`captions`、`voiceover`、`publishCopy`、`riskNotes`。
- 如果某条 cut 的核心剧情相同，三套风格也要在开头钩子、顶部字幕、旁白角度、发布文案和风险说明上明显不同。
- `variantId` 建议使用风格加序号：`high_burn_001`、`suspense_001`、`narration_001`。

## 二创增强要求

所有版本都必须做二创增强：

- 英文字幕，只保留英文。
- 9:16 重构图。
- 轻微缩放、裁切、构图偏移。
- 调色、对比度、饱和度微调。
- 去黑屏、去无效空白。
- 顶部钩子字幕或封面钩子。
- 重编码输出，避免原片直搬。

## timeline 规范

每个 `styleVariants[].timeline[]` 必须引用真实素材时间：

- `episode`: 剧集编号。
- `start`: 原视频起始秒。
- `end`: 原视频结束秒。
- `purpose`: 推荐使用 `story_after_hook`、`next_episode_pre_hook_setup`、`montage_secondary_enhancement`、`continuation`、`cliffhanger_close`。
- `caption`: 说明这一段在剪辑中的作用。

## 输出要求

- `ownerApprovalRequired` 必须为 `true`。
- 不自动发布。
- 输出必须是 JSON，不要输出 Markdown 解释。
- 输出结构要方便 n8n、Dify、CapCut Mate 直接读取。
