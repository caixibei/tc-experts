# External capability policy / Output policy / Upgrade execution modes

> 何时读我：涉及外部能力调用、降级、宿主边界、多格式交付结构选择时；或需要确认升级治理面（阶段门、账本、回归）时。
> 本文件由 26.9.10 主 SKILL.md 的 `External capability policy`、`Output policy`、`Upgrade execution modes` 三节迁出，逐条保留。

## External capability policy

Complete the core writing task from the conversation even when persistent state, file tools, or the separate BookWriter Skill are absent. The package-local Kernel, schemas, templates, references, and capability registry are the portable core runtime. WorkBuddy may additionally present attachments or system-assigned file tools; use them when the current task proves availability, but keep those host observations outside the portable C13 in-memory claim. The portable core does not itself execute OCR, external ports, workspace writes, Goal changes, publication, or rollback.

### 福帮手连接器

本版本要求启用福帮手人机协同连接器（`fbs-connector`），声明见 `plugin.json#/dependencies/connectors`，分层准入、握手链与降级边界见 `../../contracts/connector-entry-policy.json`。要点：

- 四层状态分开：产品连接 → 工具可用 → 身份与路由 → 权益与授权。任一层通过都不能证明下一层成立。
- 连接器缺失、未授权或调用失败时，本地成果全部保留，依赖服务端的下一步暂停；不要求用户排查连接器状态，不声称服务成功。
- **服务不可用不等于材料不足**，也不得写成材料缺口。
- 连接器状态不改变场景路由，只影响可选增强动作。
- 用户可见输出不得出现工具名、binding、token、哈希、trace 或幂等键。

Optional capabilities may enhance import, OCR, verification, or export only when a package-external host exposes them, they are relevant, and explicit user authorization covers this action. The current request may provide that authorization; otherwise obtain confirmation covering the purpose, minimum data scope, and external target or recipient before the call. Host permission and `externalToolsAvailable=true` are insufficient. Require a bounded timeout; if bounded execution is unavailable, skip the optional call rather than blocking core writing.

If an optional action fails, disclose the failure and continue with a chat-level artifact. **Never turn a planned call, pending request, or background possibility into a success claim.**

用户指定 Word 交付时，按 [可编辑Word交付](word-delivery.md) 使用现有导出入口的 formats 选项，或对已有 DOCX 进行唯一锚点局部修改。默认展示返回的独立预览路径，保留规范文件和原件；格式不在当前支持范围时说明具体缺口。工具回执和实际页面检查分别记录。

## Output policy

Use the lightest structure that keeps the work auditable:

- For new material, provide the manuscript judgment, proposed structure, chapter tasks, substantive opening, risks, and one next step.
- For continuation, identify the anchor and purpose, then write the next passage before giving commentary.
- For revision, show the authorized scope, original anchor, revised text, and concise change log. A request to “直接给改稿” may compress these labels, but does not waive this minimum audit frame.
- For finishing, state the overall judgment, repair the highest-value passage, list remaining delivery risks, and give one next step.
- For project resume, reconcile the supplied `ContinuationCapsule` with available `ProjectStatus`, latest `ChapterCheckpoint`, `FactDelta`, and `ManuscriptObjectiveBinding`; return an editable `ProjectResumeCard`, a substantive continuation, and one next step. A capsule-only resume must say `capsule_only` rather than imply hidden state.

Do not force ordinary prose into JSON. Use a table only when it makes chapter ownership, evidence status, or before/after comparison easier to inspect.

## Upgrade execution modes

The package-local 26.9.18 runtime must treat these as executable governance surfaces, not labels:

- Stage gates: `stage-runtime.mjs` plus `resources/stage-gate-registry.json`; transitions require current gate receipts.
- Ledger append: `ledger-runtime.mjs`; every real action must be journaled with input/output digests and a current receipt.
- Final cleanliness: `quality/final-clean-gate.mjs`; process markers block release scope.
- Regression smoke: `quality/regression-smoke.mjs`; smoke coverage is not the 60-case product regression and must never be reported as such.
- FBS-BookWriter donor tools in `scripts/` are package-local copies or adapted implementations; they must not import or locate the donor skill at runtime.

The full upgrade alignment is in `upgrade-alignment.md`. A candidate is not a full upgrade until the executable stage, ledger, write/read-back, recovery, memory, multi-agent, quality and release evidence is current.
