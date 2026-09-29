# 26.8.26 C13 能力图

本页描述长文档专家 26.8.26 候选包的逻辑能力合同。它用于解释包内代码，不证明正式上架、官方审核、真实宿主激活、真实外部调用或业务效果。

## 22 个共享能力

基础16项：

1. `material-activation`：把零散材料转成可编辑首值。
2. `scene-router`：选择操作模式与领域场景。
3. `scene-composer`：组合多个已审核场景约束。
4. `chapter-planning-expansion`：生成章节职责与推进任务。
5. `continuation-recovery`：从稳定锚点和续接胶囊继续。
6. `scope-lock-diff`：锁定改稿范围并输出差异。
7. `source-ledger-claim-graph`：区分来源、主张、推断和缺口。
8. `entity-timeline-continuity`：检查人物、实体和时间线连续性。
9. `voice-profile-humanizer`：保持作者声音并减少模板化表达。
10. `review-revise-quality-loop`：执行有界审校与修订循环。
11. `research-verification`：规划查证并标记未核事实。
12. `rights-privacy-consent`：处理权利、隐私和同意边界。
13. `multimodal-normalizer`：把调用方提供的多模态描述归一为材料记录。
14. `media-illustration-planning`：生成插图与媒体计划。
15. `multi-format-rendering`：生成格式计划或内存产物；不暗示已写盘。
16. `asset-repurposing`：在质量门后规划摘要、图文、课程等衍生物。

C13 新增6项：

17. `source-transcription`：页清单、只读观察、忠实转录、抽样和三门检查。
18. `transcription-adjudication`：比较多份转录，要求来源裁决，并产生内存补丁。
19. `capability-preflight`：在执行前核对能力、输入、证据和边界。
20. `project-control`：生成项目状态、章节检查点、事实增量和事务计划。
21. `review-briefing`：把审阅范围、依据、问题和人工责任整理为简报。
22. `artifact-derivation`：从已验证来源产物规划衍生物及其出处。

## 11 个操作模式

`material_activation`、`source_transcription`、`project_planning`、`chapter_generation`、`continuation`、`bounded_revision`、`review_quality`、`finished_draft_closure`、`template_fill_conversion`、`export_delivery`、`asset_repurposing`。

`source_transcription` 是来源忠实工作流，不是普通写作模式：它不润色原文，不把疑似字符自动改成“更通顺”的文字。多稿比较与裁决作为 `review_quality:transcription_comparison` 子模式执行。

## 21 个领域场景

`general` 加20个领域场景：`academic-monograph`、`annual-chronicle`、`biography-memorial`、`brand-story-longform`、`casebook`、`collection-album`、`conference-proceedings`、`consulting-decision-report`、`cultural-heritage`、`expert-book`、`genealogy`、`investigative-report-restricted`、`memoir-oral-history`、`operation-manual`、`organization-history`、`policy-standard-guide`、`proposal-rfp`、`technical-documentation`、`training-course`、`whitepaper-research`。

操作模式与场景正交。连接器状态、外部工具可用性或营销入口不能改变领域路由。

## 31 类耐久对象

基础12类：`ManuscriptProject`、`MaterialItem`、`SourceLedger`、`ClaimGraph`、`EntityTimeline`、`ScopeLock`、`ChapterPlan`、`ReviewCycle`、`DeliveryManifest`、`ContinuationCapsule`、`MediaPlan`、`CapabilityReceipt`。

C13 新增19类：`ManuscriptObjectiveBinding`、`CapabilitySnapshot`、`ArtifactProvenance`、`ProjectStatus`、`ChapterCheckpoint`、`FactDelta`、`ReviewBrief`、`DerivedArtifactPlan`、`WorkspaceTransactionPlan`、`WorkspaceTransactionReceipt`、`PageManifest`、`OcrObservation`、`TranscriptSnapshot`、`TranscriptionSampleValidation`、`TranscriptComparison`、`TranscriptionIssue`、`TranscriptAdjudication`、`TranscriptionPatchSet`、`SourceFidelityStatus`。

这些对象是确定性数据合同。包内的“持久”表示对象可由宿主保存和恢复，不表示本包已经写入文件、改变宿主 Goal 或建立跨会话隐藏记忆。

## 19 个原子动词

`observe`、`inventory`、`bind`、`normalize`、`route`、`compose`、`plan`、`measure`、`compare`、`adjudicate`、`patch`、`merge`、`project`、`checkpoint`、`brief`、`derive`、`render`、`gate`、`persist-plan`。

原子能力默认是纯内存变换。`persist-plan` 只生成新目标、无覆盖的事务计划；本包不执行该计划，也不把计划写成已保存回执。

## 3 个来源忠实度门

- `page-sequence.integrity`：页覆盖、唯一主来源、页序与方向。
- `transcription.fidelity`：原始观察绑定、来源复核、代表性抽样、裁决和修正证明。
- `ocr-artifact.suspect`：编码错误、疑似OCR碎片和未关闭问题。

三门的实现身份使用 `sha256_utf8_lf_v1`，允许 LF/CRLF 安装差异，但字符、空格或逻辑变化仍失败。`OcrObservation` 只记录调用方提供的文本观察；包内不执行OCR。

## 26.8.20 承诺的落地边界

26.8.20 文档中列为后续增强的来源忠实转录、多稿比较与裁决、项目控制、能力预检、审阅简报、衍生产物、耐久检查点和受控事务计划，已在26.8.26 C13形成平台中立代码、Schema、模板和夹具。

这次落地不扩大宿主权限：

- Codex Goal 绑定转换为包内 `ManuscriptObjectiveBinding`，不调用或冒充宿主 Goal 服务。
- OCR适配器转换为 `supplied_text_only` 观察合同，包内不读图片、不启动OCR。
- 工作区事务转换为计划与校验，包内不写盘、不覆盖目标、不执行回滚。
- MCP、Hooks和Codex专属注入未进入WorkBuddy专家包。

## 证据与公开表述

`externalToolsAvailable` 只表示调用方声明外部工具可能可用，不是工具发现、连接、授权或执行回执。外部OCR、企业微信/FBS端口、网络查证、文件保存、导出和发布都必须由包外宿主显式执行并返回当前回执。

任何公开机器结论都只能覆盖当前回执实际证明的范围：

- 无当前回执：`advisory`。
- 当前机器回执覆盖：`machine_receipt_present`。
- 来源、权利、高风险专业判断或最终发布仍待确认：`human_review_pending`。

候选包测试、注册表和本地检查不能证明正式上架、官方审核、真实宿主调用、外部服务成功或业务闭环。
