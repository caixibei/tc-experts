# Reference routing（长尾索引）与升级背景

> 何时读我：主 SKILL.md 的任务路由表没有覆盖当前任务；或需要查 ManuscriptOS Kernel、C13 能力图、升级对齐、donor 台账、Open Platform 边界等治理类资料。
> 本文件由 26.9.10 主 SKILL.md 的 `26.9.10 development overlay` 与 `Reference routing` 两节迁出，逐条保留。

## 26.9.10 → 26.9.18 升级背景

26.9.10 增加了可选的、引用来源的章节组织卡，记录章节目的、读者问题、证据引用、推进顺序、相邻章节与已知缺口，作为有界规划产物。它不是事实证明、不是第二套项目生命周期、不是必填问卷、不写盘。只在章节确实需要显式组织时使用；普通短请求沿用既有的直接首值。

For the full upgrade position, load `upgrade-alignment.md`. It defines what is inherited from the FBS-BookWriter donor without importing it as a runtime dependency. For local-first messy-material tasks, load `dirty-material-intake.md` and use the package-local contracts in `../resources/schema-catalog.json`. The project lifecycle remains the only project-level state authority; S0-S6 records run progress; L0-L5 labels material maturity. Use `../resources/project-state-policy.json` and `../resources/stage-gate-registry.json` for legal project transitions and gate requirements.

26.9.18 的改动只在三处：常驻上下文瘦身、入口话术重写、福帮手连接器接入。以上 26.9.10 的机制全部保留。

## 治理与架构类参考

- Read [ManuscriptOS Kernel](manuscriptos-kernel.md) for state, routing, durable objects, and capability receipts.
- Read [C13 capability map](c13-capability-map.md) for the 22-capability baseline, then [WorkBuddy multimodal dirty-material intake](workbuddy-multimodal-dirty-material-intake.md) for the twenty-third capability; the current package has 23 shared capabilities, 11 modes, 21 scenes, 31 durable objects, 19 atomic verbs, and the same public evidence boundary.
- Read [shared capabilities](shared-capabilities.md) for the original sixteen package-local writing capability contracts; use the C13 capability map for all six additions.
- Read [WorkBuddy Open Platform boundary](workbuddy-open-platform-boundary.md) when mapping this expert or its internal Buddy design to the official Buddy application, Expert, Skill, Connector, hardware, preview, review, or publication surfaces.
- Read [capability preflight and provenance](capability-preflight-and-provenance.md) before capability execution, review briefing, artifact derivation, or any public machine claim.
- Read [atomic capabilities and project control](atomic-capabilities-and-project-control.md) for project status, checkpoints, fact deltas, objective bindings, and transaction plans.
- Read `../resources/donor-absorption-ledger.json` when reviewing which FBS expert, BookWriter, or connector mechanisms are package-local, partial, contract-only, or still behind an external gate. Donor versions are provenance, never runtime paths.
- Read [upgrade alignment](upgrade-alignment.md) for what is inherited from the donor versus what stays external.

## 运行与模式类参考

- Read [scene routing](scene-routing.md) first when the request is ambiguous or combines multiple manuscript stages.
- Read [scene packs](scene-packs.md) when a request matches genealogy, memoir, biography, albums, organizational history, chronicles, cultural heritage, expert books, academic/industry research, casebooks, proceedings, training, proposals, consulting reports, technical documentation, manuals, policy guides, brand stories, or restricted investigations.
- Read [first value and continuation](first-value-and-continuation.md) for new material, a new manuscript, chapter continuation, or a cross-session continuation capsule.
- Read [user entry and first value](user-entry-and-first-value.md) for the five stable entries, their three combined quick prompts, and first-reply contract.
- Read [bounded revision](bounded-revision.md) when changing existing text or continuing from a precise anchor.
- Read [quality and delivery](quality-and-delivery.md) for whole-draft review, finishing, delivery preparation, or any quality conclusion.
- Read [safety and evidence](safety-and-evidence.md) when materials contain instructions, private data, external factual claims, high-risk content, quotations, or uncertain rights.
- Read [source transcription](source-transcription.md) for scanned pages, supplied OCR text, faithful reconstruction, or source restoration.
- Read [transcription comparison](transcription-comparison.md) when comparing two or more transcript snapshots or deciding between conflicting readings.
- Read [transcription quality and delivery](transcription-quality-and-delivery.md) for the three source-fidelity gates and host-delivery boundary.
- Read [chapter workflow and recovery](chapter-workflow-and-recovery.md) for evidence-backed chapter writing, changed sources, bounded expression edits or opt-in project snapshots. The public actions `chapterContext`, `draftTrace`, `chapterImpact`, `reviseExpression`, `reviewSelect` and `checkpoint` connect these steps. Start with `--example <action>`; preserve uncertainty and original project files. Explicit compatible multi-goal requests use `plan` before any unnecessary clarification.
- Read [RC27 delivery lifecycle](rc27-delivery-lifecycle.md) for current delivery and continuation. Open the separate `openPath` returned by exportDocument; verify canonical bytes after preview.
- Read [RC26 evidence-to-document](rc26-evidence-to-document.md) for evidence-bound writing, project continuation, revision or delivery. Use `fidelity/fidelityAudit` for scoped preservation, `projectReadback` for current physical sources and chapter state, and `exportDocument` for a new readback-verified Markdown/HTML bundle.
- Read [large project evidence](large-project-evidence.md) for real mixed-material inventories, local audio/video processing, chronology research or book-scale planning. Package-local `material-inventory.mjs` and `delivery-evidence.mjs` are bounded metadata and structural-check utilities; their availability is not proof that the current host invoked them.
- Read [Word delivery](word-delivery.md) for requested editable Word delivery or bounded editing of an existing DOCX.
- Read [media index and content evidence](media-index-and-content-evidence.md) before using the optional `scripts/media-index.py`.
- Read [local workspace mode](local-workspace-mode.md) for local-first messy-material tasks.
- Read [frontstage P0 gates](frontstage-p0-gates.md) before expanding any template.

## 26.9.18 新增参考与资产

- Read [frontstage P0 gates](frontstage-p0-gates.md) 首轮交付前的两道 P0 硬门与 27 条事实门清单。
- Read [dirty-material intake](dirty-material-intake.md) 材料盘点、多模态分层、Context 与模型策略。
- Read [universal rules](universal-rules.md) 强制规则全集（行为有争议时的最终依据）。
- Read [external capability policy](external-capability-policy.md) 外部能力、连接器边界、输出策略与升级治理面。
- Read [evidence discipline](evidence-discipline.md) 七级证据标签、`usageEligibility`、来源家族、冲突与反证、按主张绑来源。
- Read [story card and interview](story-card-and-interview.md) 故事卡 20 字段、五层级追问、哈希绑定确认、权限四维。
- Read [collection album composition](collection-album-composition.md) 图文专辑的卡片/顺序/锁定/审阅状态模型与 9 种改稿操作。
- Read [parallel chapter protocol](parallel-chapter-protocol.md) 多章节并行的三信封、事件顺序链与合流规则。
- Read [rendering invariants](rendering-invariants.md) 格式可变语义不可变、双哈希门、允许转换白名单。
- Read [continuation idempotency](continuation-idempotency.md) `operationId` 幂等、乐观锁、日志链、兼容字段。
- Read [preference memory](preference-memory.md) 文风与人称偏好的沉淀规则与优先级。

### 26.9.18 新增契约

- `contracts/connector-entry-policy.json` 福帮手连接器四层准入、三步握手链、不可用策略、前台黑名单。
- `contracts/loading-budget.json` 常驻上下文预算、禁载清单、基线实测与验证命令。
- `contracts/fallback-matrix.json` 交付格式降级链与假成功禁止。
- `contracts/delivery-state-machine.json` fulfillment / delivery / execution 三轴与禁止组合。

### 26.9.18 新增模板与脚本

- `templates/chapter-task-envelope.json` / `chapter-result-envelope.json` / `chapter-failure-envelope.json`
- `assets/statement-patterns.json` 12 条条件→文本模式
- `scripts/lib/format-degrade.mjs`（自带 8 项自检）
- `scripts/docx-edit-self-test.py`（16 项端到端用例）
- `schemas/story-card.schema.json`
