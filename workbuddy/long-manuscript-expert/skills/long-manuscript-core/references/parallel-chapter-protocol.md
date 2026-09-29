# 多章节并行协议

> 何时读我：当前 WorkBuddy 真实提供多 Agent 能力，且任务可以拆成互不依赖的只读批次（盘点、抽取、证据核验、审校）时。
> 吸收自 `fbsir-eight-seat-board` 的会议协同协议，按章节写作场景改写。

## 使用边界

- 本协议**不创建团队、不调度 Agent、不发送消息**，也不证明宿主调用成功。它只定义信封格式、事件顺序与合流规则。
- 若当前宿主不暴露多 Agent 能力，**用同一批次计划顺序执行**，不削弱任何证据规则。
- 并行**只做独立只读工作**。正文、账本、Golden 与版本始终由单一 `writing_owner` 合流。

## 角色

| 角色 | 职责 | 是否可写正文 |
| --- | --- | --- |
| `writing_owner` | 冻结批次计划、合并正文、写账本、发版本；唯一的状态写入者 | ✅ 唯一 |
| `inventory_worker` | 材料盘点：文件/字节/页/时长分母、已读范围 | ❌ |
| `extraction_worker` | 抽取与转录：按来源绑定锚点 | ❌ |
| `evidence_worker` | 主张核验、反证、冲突分组 | ❌ |
| `review_worker` | 结构、连续性、可读性、交付准备审校 | ❌ |

映射关系：章节 → 议题；角色 → 席位；`revision` → 改稿轮次；章节草稿隔离 → 席位独立封存。

## 三信封

| 信封 | 模板 | 方向 |
| --- | --- | --- |
| 任务 | `templates/chapter-task-envelope.json` | `writing_owner` → worker |
| 结果 | `templates/chapter-result-envelope.json` | worker → `writing_owner` |
| 失败 | `templates/chapter-failure-envelope.json` | worker → `writing_owner` |

**任务信封必填**：`runId` / `chapterId` / `workerRole` / `taskClass` / `revision` / `objective` / `scope`（含 `coveredTargets`、`byteOrPageBudget`、`timeoutSeconds`）/ `returnTo` / `resultTarget` / `stopCondition` / `forbidden`。

**结果信封必填**：`status` / `confidence` / `conclusionReady` / `coverage`（含 `denominator`）/ 六段 `sections`。

worker **只接收内容引用、范围、预算、超时和停止条件**，不接收无界上下文，也不直接改原件。

## 事件顺序链

```
plan.frozen
  → worker.dispatch_requested
  → worker.result_received | worker.failure_received
  → round.isolated_sealed
  → collection.ready
  → manuscript.merged
```

规则：

1. **`plan.frozen` 先于任何派发。** 批次计划冻结后不得在运行中追加批次；需要新增批次就开新的 `revision`。
2. **复合作用域 = `chapterId + workerRole + revision`。** 三个字段共同定位一次工作，缺一不可；同一三元组不得有两条结果。
3. **`round.isolated_sealed` 之后禁止追加 `worker.*` 事件。** 封存表示该轮所有 worker 结果已收齐，此后的新结果只能进入下一 `revision`。
4. **章节草稿隔离**：并行轮内各 worker 看不到彼此输出（`chapterDraftIsolation: true`），避免互相污染判断。
5. **`collection.ready` 只在覆盖分母闭合时置位。** `coverage.residual` 非空时，`collection.ready` 不得置位；应记 `partial` 并继续或收尾。
6. **重试收敛**：同一三元组重试必须复用同一幂等键；丢响应时先回读未决状态，不生成新键重复记录。

## 合流规则

- `writing_owner` 是**唯一**合并正文、账本、Golden 与版本的角色。
- 合流前逐项核对：`coverage.denominator` 是否闭合、`sections.uncertainty` 是否已进入正文的待核验位置、`sections.dissent` 是否被保留而非抹平。
- **证据状态随内容传播**：worker 标为候选或未核实的字段，合流进正文后仍须保持同样标签，不得在合并时升级为事实。
- 失败信封不得夹带未经验证的正文；失败批次的 `impact.affectedTargets` 必须进入最终答复的残余说明。

## 与续接胶囊的关系

并行轮的收敛状态是**内部工作状态**，不直接等同于用户可见的续接胶囊。

生成胶囊时：

- 章节数量、标题、当前停点必须**从本轮最终正文逐项重算**，不能复用批次计划里的旧数字。
- 胶囊仍使用三态分栏（`用户已确认` / `模型暂定` / `未知`），不得把 worker 结果晋级为“已确认”。
- 批次覆盖分母、残余与失败批次如需保留，写在胶囊的“仍缺的材料或待核验事项”一栏，不要另开内部字段。

## 证据边界

- 信封存在、格式合法、`status=completed` 都只证明**结构成立**，不证明语义质量、事实真实性或宿主调用成功。
- 只有包外宿主的当前回执才能证明某次派发或某次写入真实发生。
- 不得把顺序执行的批次写成“多代理并行”；**只有实际起止时间重叠才能称并行**。
