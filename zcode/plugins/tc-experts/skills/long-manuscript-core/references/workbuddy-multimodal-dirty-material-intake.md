# WorkBuddy 多模态脏素材摄取合同（26.9.10）

## 目标与宿主边界

本链的唯一目标宿主是 **WorkBuddy**。开发对齐目标为 WorkBuddy
`5.5.3`，但该版本只是一条集成基线，不是能力白名单。运行时接受任何经当前宿主
观察绑定的 WorkBuddy 版本；缺少当前版本证据时保留 `not_observed`，不得回退到
`5.5.3` 来假装能力已成立。

此实现是 package-local、纯 JSON 的结构化观察摄取器：

- stdin 输入一个 `material-intake-request`；
- stdout 输出一个带自摘要的 `material-intake-result`；
- 不访问网络、宿主、附件、文件系统中的用户材料或外部解析器；
- 不实际执行 Read、PDF/Office 解析、OCR、ASR、抽帧或网页抓取；
- 只验收调用方已经提供且带来源、顺序、锚点、摘要和置信度的结构化观察；
- 原件始终只读，运行时的原件写入次数恒为零。

因此，通过本地夹具只能证明 `fixture_validated`，不能证明 WorkBuddy 5.5.3
已经把某种附件转发给模型，也不能证明某个模型、专家或真实用户材料已被调用。

## 四层证据不能互相回填

按以下顺序分别记录：

1. `model_declaration`：厂商声明、模型目录或模型 badge。它只说明“被声明/被展示”，
   `capabilityObservationState` 仍为 `not_observed`。
2. `attachment_presentation`：WorkBuddy 附件卡、内容面板或内联内容的呈现。只有附件卡
   时，内容仍为 `not_observed`。
3. `content_observation`：Read、解析、OCR、ASR、视觉观察、抽帧或快照形成的结构化
   观察，必须与输入摘要及模态锚点绑定。
4. `expert_use`：专家实际消费了哪些 observation ID，并由运行时解析为对应 observation
   digest 的独立回执。前三层都不能自动证明这一层。

若输入只有附件卡或模型 badge，最终状态必须是 `not_observed`。若输入声称专家使用，
却无法绑定到可消费的观察，最终状态必须阻断。

## 模态、处理阶段与锚点

| 模态 | 可摄取处理阶段 | 必需锚点 |
| --- | --- | --- |
| `text` | `read` | `character_range` |
| `pdf` | `read`、`parse`、`ocr` | `page`、`page_bbox` 或 `character_range` |
| `image` | `ocr`、`visual_observation` | `bbox`；整图可用带 reason 的 `bbox_unavailable` 降为 partial |
| `table` | `parse`、`cell_read` | `cell_range`（含 sheet/cell） |
| `office` | `parse`、`paragraph_read`、`cell_read`、`slide_observation` | `paragraph_range`、`cell_range` 或 `slide` |
| `audio` | `asr` | `time_range` |
| `video` | `asr`、`keyframe_extract`、`visual_observation` | `time_range`、`frame_range` 或 `frame_bbox` |
| `web` | `snapshot`、`read`、`parse` | `url_section` 或 `character_range` |

输入 item 的 `order` 是跨来源顺序，`sourceRef + inputDigest` 共同绑定来源身份；每个
item 的 `source.scope` 是允许观察的原始范围；
每个 observation 的 `anchor` 是真正被读取、解析或派生的位置。重复 item ID、重复顺序、
重复 observation ID、跨模态锚点或处理器/阶段不匹配一律拒绝。

## 摘要、未知项与停止条件

- 每个来源必须携带 `inputDigest`；每个 observation 都必须回绑同一摘要。
- 运行时从规范化 observation 计算 `observationDigest`；若调用方提供
  `expectedObservationDigest`，必须完全一致。
- `confidence.extraction/alignment/identity` 取最小值作为聚合置信度。
- 默认阈值是 `0.7`；低于阈值即 `human_review_required` 并停止消费。
- 默认 `stopOnUnknown=true`；非空 `unknowns` 即停止。只有显式关闭该策略时，未知项才
  能保留为不阻断的 `partial` 线索，但不得被抹去。
- 输入摘要或观察摘要不一致属于完整性阻断，不得降格为普通 warning。

`contentReadClaimAllowed=true` 只在原件证据状态为 `bytes_observed` 且观察未被拒绝时
出现。`digest_supplied_not_observed` 和 `descriptor_only` 永远不能支撑“已读全文”。

## GB 级素材与控制信封

对用户明确指定的一个文件，可先通过包内
`node scripts/material-intake/hash-material-file.mjs --file <文件路径>` 做真实只读字节盘点。
散列器只用 1 MiB 缓冲，默认上限 16 GiB、120 秒，校验读取前后文件身份/大小/修改时间，
遇到变化、超时、取消或超预算时保持 hash_pending，不提供完整文件哈希。
返回内容引用摘要、read/residual 字节和完整散列；`contentObservationState=not_observed`。
这不是解析器，后续仍由当前宿主处理内容。取消后的标准 SHA-256 从头重算，不宣称断点续算。
目录材料应先逐文件列出并分批调用，禁止为了算摘要把文件全文读入模型上下文。

GB 级素材只能进入控制面，不能进入 JSON 正文：

- source 必须用 `declaredBytes + contentRef + inputDigest` 描述；
- batch observation 也只保留 `contentRef`、digest、covered/residual 和小摘要；
- `capacity.declaredBytes/inlineBytes/contentRefCount` 必须与 item 守恒；
- `policy.byteBudget` 分别限制总声明字节、内联字节和单批字节；
- `base64` 无论大小都阻断；超预算内联正文也阻断；
- CLI 以流式方式读取最大 4 MiB 的控制信封，超限返回
  `stdin:control_envelope_too_large`，不会先把完整 stdin 读入内存；
- module API 在计算 observation digest 前先做字段和长度检查；超限内容不进入
  `stableJson`，结果中不回显 `text/data/cells` 原文；
- `executionBoundary.allocatedLargePayloadBytes=0`，这是一条可检查合同，而不是“已经
  实际读取过 5 GB 文件”的性能声明。

`capacityReceipt` 同时报告声明值、按 items 计算的值、守恒状态、预算结论和
`metadataOnly=true`。只要声明字节、引用数或 inline 字节不守恒，就不能消费。

## 确定性 batch、checkpoint 与 hash

RC4 修正：在校验、摘要和批计划分配前，最多接受 256 个 item、1024 个 observation、
1024 个 chunk/digest reference；使用安全整数及 BigInt 预估跨源总分块数。
超过上限直接返回小型 `invalid_input`，调用方需增大 chunk 或拆分请求。
完整结果上限为 4 MiB；超限返回 `result:output_byte_limit_exceeded`，不回显大结果。
这些门限制元数据，并不声称真实 GB 材料已被读取。

`bbox_unavailable` 只能绑定整图范围，必须解释坐标不可用原因；不能满足局部 bbox 授权，
也不能将结果升级为精确区域已验证或 L4 完整观察。结果保留区域精度残余。

只要 source 有 `declaredBytes + contentRef`，运行时就按 `maxBatchBytes` 生成确定性计划。
每个 chunk 含全局 ordinal、source ordinal、offset、length、剩余字节、source digest、
可选 chunk digest ref，且所有 `lengthBytes` 之和必须等于 declared bytes。计划只生成
元数据，不读取或分配 chunk payload。

标准整文件 SHA-256 的内部状态不能靠普通 checkpoint digest 安全恢复。因此：

- 没有覆盖已完成前缀的逐 chunk digest refs 时，`hashResumeMode=full_restart`、
  `hashState=hash_pending`，并明确 `standardFileShaInternalStateResumed=false`；
- 只有逐 chunk digest manifest 覆盖 checkpoint 之前的完整前缀时，才允许
  `hashResumeMode=chunk_manifest` 和 `checkpointResumeExecutable=true`；
- 未绑定 chunk ref、越界 checkpoint 或 batch 字节不守恒均阻断。

`flowControl.requestedInFlightBatches` 超过 `maxInFlightBatches` 时，返回
`backpressure_required`；结果仍保持 payload buffer 为零。

## Material role、成熟度与覆盖分母

每个 item 可声明：

- `content`：只允许事实贡献；
- `reference_style`：只允许风格贡献，事实贡献必须为 `forbidden`；
- `both_scoped`：事实与风格都可使用，但必须提供非空 `scopeRefs`；
- `control_instruction`：只进入控制指令面，不进入事实或风格面。

`reference_style` 若开放 fact use，必须以 `reference_style_fact_leakage` 阻断，不能把
参考样式里的实体、数字或事件静默写进正文。

成熟度由回执推导，不接受调用方直接宣称：

- `L0`：只观察到 metadata；
- `L1`：hash 仍在 streaming/incremental pending；
- `L2`：hash 完整，但无内容观察；
- `L3`：已有 partial、低置信、残余或 hash 未闭合的观察；
- `L4`：完整、可消费的内容观察；
- `L5`：存在与 observation digest 绑定、并由包外当前 WorkBuddy 任务证据独立确认的专家使用回执。便携运行时只能把调用方提供的结构化使用信息标为 `receipt_bound_input_only`，保持 `canPromoteHostEvidence=false`，不得自行把它提升为 L5 或真实宿主调用。

默认 `sourceRefDisclosure=opaque_digest`。回执与批计划只输出稳定的 source/content reference 摘要，不持久化真实盘符、目录和文件名；只有用户明确要求可读路径且当前交付边界允许时，才使用 `as_supplied`。

coverage receipt 独立保留 item、byte、page、time-ms 和 frame 分母、covered、residual。
partial byte coverage 必须满足 `covered + residual = declared`；未知分母保持 `null`，
不得填零或猜测。

## 音视频特殊边界

音频、视频只接受 **当前 WorkBuddy 宿主派生物**：

- host 必须是 `current_host_observed`；
- 派生物必须绑定同一个 WorkBuddy product、version、instance；
- 呈现层必须是 `current_host_derived_artifact_received`；
- 派生物必须有自己的 SHA-256。

任一条件缺失，item 进入 `degraded`，并以
`current_host_derived_artifact_required` 阻断。来自本地假想 ASR、旧宿主、另一
WorkBuddy 实例、其他宿主或未绑定版本的派生物都不能升级为 observed。

## 运行与解释

```powershell
Get-Content -Raw .\request.json |
  node .\skills\long-manuscript-core\scripts\material-intake\runtime.mjs
```

结构错误退出码为 `2`，同时仍输出确定性 JSON；合法但 `not_observed`、`degraded`、
低置信或未知阻断属于领域结果，退出码为 `0`。每个结果包含：

- `resultDigest`：除自身外完整输出的 canonical JSON SHA-256；
- `executionBoundary`：网络、宿主交互、外部动作和原件写入均为零；
- 按源顺序排列的 item；
- presentation、extraction、expert-use 三类独立 receipt；
- capacity、batch、flow-control、role、inventory、coverage 和 L0-L5 maturity receipt；
- observation 只返回 contentRef、digest 与不超过 512 字符的小摘要，不复制全文；
- 聚合计数、`consumptionReady` 和精确 stop reason。

离线通过后，下一道真实门禁仍是：使用明确隐私许可下的自有/合成材料，在当前
WorkBuddy 入口取得版本、实例、呈现、派生物及专家使用的独立运行回执。没有这些回执，
不得声称 `per_host_probe_verified` 或 `effective_capability`。
