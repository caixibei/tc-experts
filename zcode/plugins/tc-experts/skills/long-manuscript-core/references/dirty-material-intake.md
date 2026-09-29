# WorkBuddy-native dirty-material intake

> 何时读我：当前任务涉及附件、图片、扫描件、文档、表格、音视频等实际材料时；或需要判断“材料到底读到了没有”时。
> 本文件由 26.9.10 主 SKILL.md 的 `WorkBuddy-native dirty-material intake` 与 `Context and model policy` 两节迁出，内容未删减。

## 材料盘点的起点

The target host for this release line is WorkBuddy. At the start of any material task, inventory only the attachments and files actually visible in the current task; **choosing a folder or naming a file never proves its bytes were read**. Prefer the richest current WorkBuddy surface that is already available:

1. Directly inspect host-presented images or page renders when they are genuinely visible to the model, recording page/order and region or a precise descriptor.
2. Use the system-assigned `Read` or other current WorkBuddy file surface for authorized text, PDF, Office, and table files when that surface succeeds; never add a `tools` field to the Agent frontmatter.
3. Keep visual observation, OCR/ASR text, document parsing, table extraction, and model inference as separate observation kinds. A model's image-input badge or theoretical ability is not a receipt for a specific attachment.
4. For every used observation, retain source identity, observed range, processor/evidence layer, status, confidence or uncertainty, and a content digest when bytes were actually available.
5. If a format is not delivered to the current model or tool surface, degrade to a page image, contact sheet, exported text/CSV, or user-supplied observation. State the missing layer and continue with reversible first value.

For every attachment-first reply, explicitly state actual visible scope, anchor, numeric or categorical confidence, unknowns, residuals, and processing layer. **Empty unknown/residual sets must be written as empty.** An image requires a `bbox` or coordinate-bound region; when coordinates are unavailable, say `bbox_unavailable` and retain region precision as a residual instead of substituting a page-only anchor.

Do not send user material to another provider or service merely to discover capability. Network, connector, upload, share, and publication remain separately authorized actions.

## 兼容路由

Compatibility routing is explicit: legacy descriptor input to `multimodal-normalizer` keeps the generic capability envelope; `manuscriptos.material-intake-request/v1` input through that module, or the explicit `workbuddy-dirty-material-intake` capability id, uses the dedicated intake runtime and evaluator and returns its dedicated result directly.

For GB-scale sources, the runtime accepts `declaredBytes + contentRef + digest`, enforces byte/inline/batch and in-flight budgets, emits deterministic chunk/checkpoint/coverage receipts, and retains only bounded summaries. It does not read or copy the referenced GB payload, perform host parsing, or prove end-to-end WorkBuddy ingestion; those layers still require current host receipts.

## Context and model policy

Keep the workflow model-agnostic and **do not assume that a large context window is project memory**. Maintain the full material inventory, anchors, claim graph, chapter status, checkpoints, fact deltas, and continuation capsule as durable or user-visible artifacts; load only the smallest source packet needed for the current chapter or review pass. If WorkBuddy compresses a long conversation, reconstruct from those artifacts and report any missing layer instead of inventing continuity. A larger context window may reduce retrieval steps for a bounded pass, but it never replaces source identity, freshness, recovery, or receipt gates.

For multi-gigabyte collections, budget bytes and derived work rather than file count alone. Keep raw bytes behind content references; plan ordered batches with explicit byte/page/frame/time denominators, bounded in-flight work, checkpoints, and residual coverage. Never put base64 media, a full corpus, or duplicated observation content into a normal receipt or model context.

If WorkBuddy exposes multi-Agent execution for the current expert surface, parallelize only independent read-only inventory, extraction, evidence, or review batches. The writing owner freezes the batch plan and is the only actor that merges manuscript text, ledgers, Golden fixtures, or versions. Child tasks receive only their scoped content references, byte/time budget, expected output digest shape, timeout, and stop condition; they return a bounded result or `partial/blocked`, never an unbounded transcript or direct source mutation. If the current host does not expose that capability, run the same batch plan sequentially without weakening evidence rules.

Use this skill to move a manuscript forward in the current reply. Keep the visible writing result ahead of process commentary, internal terminology, and optional tooling.

## 可选媒体工具

For video metadata indexing, use the bundled `scripts/media-index.py` when Python is available and the user authorizes a separate index directory; read `references/media-index-and-content-evidence.md` first. This optional local utility is separate from the pure manuscript core: it writes only its owned index/export directory, preserves immutable index generations, and opens original media only for reading. Format probing and full-file hashing require explicit `--probe` and `--hash`; neither proves visual or spoken-content understanding. Do not recreate the utility by borrowing another Skill or hardcoding a local source path.
