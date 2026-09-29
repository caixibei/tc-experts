# 原子能力与项目控制

原子能力把复杂长文档工作拆成19个可审计动词。每个动词只生成计划、投影或验证回执，不执行宿主写入、二进制渲染、外部发送或发布。

## 固定边界

- `hostMutationAllowed=false`
- `filesystemWriteAllowed=false`
- `binaryRenderingAllowed=false`
- `externalActionAllowed=false`
- `connectorRequired=false`

`render` 只描述需要什么渲染器和后续检查；`persist-plan` 只生成不可执行的候选目标描述；事务回执只证明计划结构与摘要有效，`createdTargets` 必须为空。

## 19个动词

`observe / inventory / bind / normalize / route / compose / plan / measure / compare / adjudicate / patch / merge / project / checkpoint / brief / derive / render / gate / persist-plan`

原子投影必须绑定项目、输入对象引用、预期输出对象类型和可见约束。回执只证明该投影通过本地确定性验证，不证明文件已保存、格式已渲染、内容已审定或交付已发生。

## 项目控制对象

- `ManuscriptObjectiveBinding`：一个有验收条件的手稿目标；完成态必须有明确证据摘要。
- `ChapterCheckpoint`：章节状态、内容摘要、来源摘要和下一目标。
- `FactDelta`：从已绑定事实图前像生成可复核的新图投影。
- `ProjectStatus`：汇总章节、字数、质量门和目标状态，不改变项目文件。
- `WorkspaceTransactionPlan`：只保留相对路径、媒体类型、字节数和内容摘要，不携带写入权限。
- `WorkspaceTransactionReceipt`：只证明计划已验证，不能出现已创建目标或执行成功声明。

所有用户材料、候选工件和对象回执继续使用原始字节或规范对象摘要；`sha256_utf8_lf_v1` 只用于注册表绑定包内文本实现。

---

## 项目控制与原子能力（26.9.18 由 agent md 迁入）

`capability-preflight`、`project-control`、`review-briefing` 和 `artifact-derivation` 负责生成确定性预检、项目状态、检查点、事实增量、审阅简报和衍生计划。`ManuscriptObjectiveBinding` **只描述文稿目标，不创建或完成宿主 Goal**。

19 个原子动词默认只做纯内存变换。`persist-plan` 仅生成新目标、无覆盖的 `WorkspaceTransactionPlan`；**不得执行该计划，不得把计划写成保存、回滚或恢复成功**。只有包外宿主的当前写入与回读回执才能证明文件状态。

`project_resume` 必须兼容旧 `ContinuationCapsule`，但不能只靠胶囊冒充完整项目状态。可用时同时核对 `ProjectStatus`、最新 `ChapterCheckpoint`、`FactDelta` 和 `ManuscriptObjectiveBinding`，生成 `ProjectResumeCard`。只有胶囊时标记 `capsule_only`；证据冲突时标记 `conflict`，给出最小续接结构和至多一个阻塞问题。

