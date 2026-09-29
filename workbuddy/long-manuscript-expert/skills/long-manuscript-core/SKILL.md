---
name: long-manuscript-core
display_name: 长文档写作与改稿
display_name_en: Long Manuscript Writing and Revision
description: WorkBuddy-native ManuscriptOS procedures for absorbing mixed text, document, scan, image, and table materials and then planning, drafting, continuing, revising, reviewing, converting, and delivering long-form documents.
description_zh: 吸收文本、文档、扫描件、图片、表格和旧稿，持续生成、续写、改稿、审校并交付可追溯长文档。
description_en: Absorb mixed documents, scans, images, tables, and drafts, then create, continue, revise, review, and deliver traceable long-form manuscripts.
category: writing
version: 26.9.18
author: FBSir
---

# Long Manuscript Core

## 26.9.18 position

26.9.18 的改动是**做减法 + 吸收**：把常驻上下文砍掉约 58%，把入口话术换成人话，接入福帮手连接器，并把同生态其它福帮手专家包里已验证的机制内化为本包资产。写作内核（ManuscriptOS Kernel、Schema、模板、资源注册表、S0-S6 阶段门禁、L0-L5 材料成熟度）不变。

本版从同生态其它福帮手专家包吸收了 8 类机制（连接器四层准入与握手链、交付降级矩阵与三轴状态、任务/结果/失败三信封、12 条表述模式、证据与来源纪律、故事卡与图文编排状态模型、幂等与乐观锁、改稿留痕与写入原子性），全部为包内自持实现，**不引入任何运行时依赖**。来源对照与逐项落点见 `references/reference-routing-detail.md`。

吸收只取机制与字段，**不搬领域内容**（招商业务对象、广告法词库、贴图渲染层、家庭结构假设等一律不吸收），也不引入 `wecom` / `tmeet` 等额外连接器依赖。吸收台账由包外开发工作区维护，不随包分发。

常驻规则只保留本文件。**不要自动把 `references/`、`schemas/`、`resources/gates/`、`scenes/` 灌入上下文**，只在当前任务触发时按下面的路由表读取指定路径。禁止为发现契约而扫描目录或搜索包内源码（`known_relative_paths_no_directory_exploration`）。加载预算见 `contracts/loading-budget.json`。

The package uses three unified ledgers: Artifact Manifest for object identity and hashes, Provenance Graph for source anchors and claim links, and Event Journal for actions and receipts. `ModalityReceipt` separates provider/model declarations, WorkBuddy attachment delivery, actual observation or parsing, and current-task evidence. Original materials remain read-only; default persistence creates a new version and requires a read-back check.

For audio/video, accept a WorkBuddy-provided transcript, keyframe/contact sheet, or other host-visible derivative when the current task proves that derivative is present. Otherwise support contracts, anchors, receipts, degradation states, and test doubles only. Do not claim full audio/video processing without a current WorkBuddy receipt.

## 福帮手连接器加载合同

本版本要求使用福帮手人机协同连接器（`fbs-connector`），声明见 `plugin.json#/dependencies/connectors`，分层准入与降级边界见 `contracts/connector-entry-policy.json`。

**连接器是增强通道，不是首值前置条件。** 四层状态必须分开：产品连接 → 工具可用 → 身份与路由 → 权益与授权。任一层通过都不能证明下一层成立。

握手链固定三步：`skill_whoami` → `fbs_scene_pack_query`（原样透传 `actionEnvelope.toolArguments`，不增删、不改名、不改大小写）→ `skill_consume`（只有内容真实交付后才记录）。任一步返回 `isError=true`、业务 `success=false`、错误包络或缺失预期字段，都不是成功；HTTP 200 本身不是业务成功。

连接器缺失、未授权或调用失败时：本地成果全部保留，依赖服务端的下一步暂停，**不要求用户排查连接器、工具、MCP、插件、会话或运行状态，也不要求查看日志**，更不声称服务成功。服务不可用不等于材料不足。

**连接器状态不改变场景路由。** 领域场景仍由用户目标与材料决定；连接器只影响可选增强动作。

用户可见输出不得出现 `skill_whoami` / `fbs_scene_pack_query` / `skill_consume` / `actionEnvelope` / `MCP` / `connector` / binding / token / 哈希 / trace / 幂等键。技术状态改写成业务状态，例如“服务工具已加载”→“我已开始按流程处理这份材料”、“回执缺失”→“这一步还没有确认结果，我不当作已完成”。

## Core workflow

1. Select exactly one user entry (`material_start`, `source_transcription`, `project_resume`, `bounded_revision`, or `finished_draft_closure`), then route it on `operationMode × domainScene`. Use the general domain fallback when no reviewed scene overlay applies; never let connector or external-tool state choose the route.
2. Separate supplied facts, user opinions, working assumptions, missing inputs, and claims that require verification.
3. Select the smallest reference set needed for this request. Do not load every reference by default.
4. Produce a visible manuscript increment appropriate to the operation.
5. State the most important remaining risk, one next step, and a user-copyable continuation prompt when further work remains.

Before expanding any template, apply the two frontstage P0 checks in `references/frontstage-p0-gates.md`: project decision state has exactly three lanes (user-confirmed / model-proposed / unknown), and a strict source-only image task uses source-evidence states instead. Re-enumerate the final manuscript headings before emitting a continuation capsule; chapter count, names, stopping point, and pending work must match the final artifact.

When package tools are available at a host-resolved location, use `scripts/expert-tools.mjs --describe` for input contracts and `--example <action>` for valid inputs; do not guess field names. `--self-test` runs bounded public contract cases, not host acceptance. The deterministic `route` action combines lexical facets and may return candidates; its score is not a probability. Do not expose internal route IDs in ordinary manuscript prose.

## 任务 → 参考路由表

只读本轮实际触发的资源。

| 当前任务 | 先读取 |
| --- | --- |
| 材料启动 / 零散材料 / 首值 | `references/first-value-and-continuation.md` + `references/user-entry-and-first-value.md` |
| 场景判断（模糊或多阶段混合） | `references/scene-routing.md`，命中场景包再读 `references/scene-packs.md` |
| 扫描页 / 逐字稿 / OCR 核对 / 来源恢复 | `references/source-transcription.md` + `references/source-to-prose-gate.md` |
| 多稿比较与裁决 | `references/transcription-comparison.md` + `references/transcription-quality-and-delivery.md` |
| 续接已有项目 / 章节推进 / 来源变更传播 | `references/chapter-workflow-and-recovery.md` + `references/rc27-delivery-lifecycle.md` |
| 限定范围改稿 | `references/bounded-revision.md` |
| 成稿收口 / 质量结论 | `references/quality-and-delivery.md` |
| Word 交付 / 已有 DOCX 局部修改 | `references/word-delivery.md` |
| 多格式导出 / 降级 / 渲染转换 | `references/rendering-invariants.md` + `contracts/fallback-matrix.json` |
| 交付状态判断（生成 ≠ 交付） | `contracts/delivery-state-machine.json` |
| 音视频 / GB 级材料 / 按年梳理 | `references/media-index-and-content-evidence.md` + `references/large-project-evidence.md` |
| 脏素材 / 多模态材料 | `references/dirty-material-intake.md` |
| 证据核验 / 来源冲突 / 外部查证 / 反证 | `references/evidence-discipline.md` + `references/05-ops/search-policy.json` |
| 传记 / 回忆录 / 口述史 / 家谱 | `references/story-card-and-interview.md` + `schemas/story-card.schema.json` |
| 图文专辑 / 画册 / 图片型章节 | `references/collection-album-composition.md` |
| 多章节并行 / 子任务派发 / 批次收敛 | `references/parallel-chapter-protocol.md` |
| 跨会话续接 / 重放 / 旧版本兼容 | `references/continuation-idempotency.md` |
| 文风、人称、篇幅偏好 | `references/preference-memory.md` |
| 冲突 / 未核验 / 未知的标准措辞 | `assets/statement-patterns.json` |
| 安全、隐私、版权、外部事实 | `references/safety-and-evidence.md` |
| 项目状态、检查点、事实增量 | `references/atomic-capabilities-and-project-control.md` |
| 能力预检、审阅简报、衍生产物 | `references/capability-preflight-and-provenance.md` |
| 运行边界、降级、外部能力、强制规则全集 | `references/external-capability-policy.md` + `references/universal-rules.md` |
| 首轮交付前的 P0 过门 | `references/frontstage-p0-gates.md` |

长尾索引（ManuscriptOS Kernel、C13 能力图、升级对齐、donor 台账、Open Platform 边界、全部 references 说明）见 `references/reference-routing-detail.md`。

## Operation modes

- `material_activation`: inventory material and produce reversible first value.
- `source_transcription`: preserve source wording page by page; separate raw extraction, source review, adjudication, and delivery readiness.
- `project_planning`: define audience, goal, chapter promises, materials, and risks.
- `chapter_generation`: write a bounded chapter increment from approved facts and plans.
- `continuation`: continue from a stable anchor and update the visible continuation capsule.
- `bounded_revision`: change only the authorized scope and preserve rollback anchors.
- `review_quality`: review, revise, and retain residual warnings or human gates.
- `finished_draft_closure`: close structure, continuity, evidence, rights, and delivery readiness.
- `template_fill_conversion`: transform supplied content into a requested structure without inventing missing facts.
- `export_delivery`: prepare local Markdown/HTML or explicitly degrade unavailable binary formats.
- `asset_repurposing`: create adaptation briefs only after required quality gates.

## Completion check

Before responding, confirm that:

- the reply advances exactly one selected operation mode and keeps the selected domain scene or general fallback explicit when it matters;
- at least one user-editable structure or prose artifact is present;
- assumptions and evidence gaps are visible;
- revision scope is respected;
- no unsupported save, export, verification, publication, or external-state claim appears;
- source-transcription work keeps raw observation, source review, adjudication, and editorial rewriting separate, and all three source-fidelity gates have an explicit state;
- any machine claim cites a current receipt rather than a registry entry, old test, or development report;
- connector state was neither used to choose the route nor reported as a success without a current receipt;
- exactly one recommended next step is clear.

规则有争议时以 `references/universal-rules.md` 为准；该文件与本文件不一致时，取更严格的一方。
