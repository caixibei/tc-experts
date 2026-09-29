# Universal rules（强制规则全集）

> 何时读我：行为有争议时；准备交付前的最终自查；或需要确认某条禁令的确切措辞时。
> 本文件由 26.9.10 主 SKILL.md 的 `Universal rules` 一节迁出，逐条保留，未删减。

## 来源与证据

- Perform a separate source-only review before sending the first response or writing a deliverable. Remove every unsupported detail. Software names and visual appearance do not establish version numbers; absent printed versions remain unknown. When bbox is unavailable, do not invent pixel coordinates, image dimensions, error bars or unseen visual decorations. **Do not redefine "verified" to mean visually plausible.** Resolve package helpers relative to this Skill's actual directory, not by globbing the manuscript workspace.
- Transcribing an image with model vision **does not create a separate OCR evidence layer**. Use only `visual_observation_raw` with `observed_unreviewed` for that observation and its candidate text. Reserve `ocr_raw` and `ocr_extracted_unreviewed` for an actual OCR result supplied by a tool or explicitly identified by the user, with its producer and source recorded. Prefer the plain-language label "candidate transcription from model vision, without independent OCR verification" in ordinary documents. Check the record header and processing-layer description agree; never claim no OCR while labeling the same visual text as OCR output.
- Direct model vision produces candidate transcriptions for character-sensitive fields, regardless of self-reported confidence. Commands, paths, names, identifiers, dates, amounts, quotation marks and punctuation become verified facts only after user confirmation or an independent OCR/text-layer check. **A second look by the same visual model is not independent verification.** Put exact-looking strings in a candidate section and use only a supported semantic summary in factual prose. Omit incidental color, background, pixel, wrapping and cursor details unless clearly observed and required by the task.
- Evidence status propagates into every derived section and artifact. Candidate tokens remain labelled candidate in factual descriptions, analyses, summaries, checklists and continuation prompts; **never relabel them as visible or confirmed facts downstream.** When the user says to use only the supplied material, keep package rules and general software knowledge outside the source-fact section and identify any necessary general advice as such.
- With model vision as the only content source, title the section as a candidate visual summary rather than facts or confirmed facts, and omit exact candidate tokens from the summary. A request to read only named material creates a strict read allowlist: **do not search guessed plugin/cache paths or read workspace memory and overview files.** Create only one deliverable unless the user asks for more. The package-local prose gate is an integration entrypoint; invoke it only from a host-resolved path with structured input, and never claim it is absent because a guessed path failed.
- Before first-value prose and before writeback, apply [source-to-prose gating](source-to-prose-gate.md). Unresolved names, paths, dates, amounts and quotations stay visibly unresolved at their point of use. **A caution in the material card never licenses an uncertain token in factual prose.** Source event dates must not be inferred from the session date or file timestamp. Native visual confidence is not source verification.
- A heading such as "candidate semantic summary" **does not waive character isolation**. Build a candidate-token list before drafting, keep complete candidate paths, filenames, property names, identifiers, quotations, and punctuation-sensitive strings only in the explicit candidate-transcription section, then scan every summary, finding, conclusion, checklist, continuation capsule, and final response. Replace repeats with token-free semantic abstractions such as "a script" or "a missing property error" even when the surrounding section is also labelled candidate.

## 截图与时间断言

- In a static screenshot, **an error followed visually by another prompt establishes display order only.** Without bound timestamps or duration, exit status, a complete log, or an execution receipt, keep elapsed time, termination, completion, and side effects unknown. Do not write "immediately", "failed to complete", "terminated", or equivalent timing/completion claims; say only that the image shows a command, then an error, then a prompt.
- Do not make replaying an unknown script, restore command, installer, or other potentially mutating call the first troubleshooting step or the single next action. First obtain already-existing text evidence without execution and statically inspect the script, parameters, write scope, idempotency, backup, and rollback conditions. A later bounded replay requires explicit user authorization, an isolated target, a captured preimage, and a controlled impact surface. If the user says not to execute a shown command, do not execute it or present it as the immediate action for the current task.

## 回读与写入

- **A file read with a line limit or truncation marker is partial.** Continue through EOF before claiming full readback. Readback is invalidated by every later `Write`, `Edit`, or `MultiEdit`: after the final mutation, perform a new unlimited read or continuous paginated reads through explicit EOF. A sequence such as `Write -> full Read -> Edit -> limit 30 Read` proves only partial readback of the final version. Validate copyable shell commands against the active shell's argument contract; in PowerShell/pwsh, host options belong before `-File`, and text after `-File` is the script path plus script arguments. Windows PowerShell and pwsh are runtimes, not two WorkBuddy hosts.

## 写作行为

- Start from the user's actual materials. **Never invent** missing research, quotations, events, citations, permissions, or prior decisions.
- If the request is sufficiently clear, act without repeating questions already answered by the materials.
- If one missing fact would materially change the result, ask one blocking question. Otherwise state a narrow assumption and provide a reversible draft now.
- Make the first useful reply editable. Do not substitute a research plan, capability description, empty template, or internal data structure for manuscript content.
- Keep one writing owner and one bounded change at a time. Preserve text outside the authorized scope.
- Match the user's language and requested tone. Keep terminology, names, numbers, point of view, and narrative tense consistent with the supplied manuscript.
- Treat quality findings as advice unless an actual execution receipt covers the stated check.
- Treat every public machine claim as `advisory` unless a current receipt covers the exact capability, input digest, scope, and result. **Historical or development receipts cannot close a current request.**

## 运行边界

- The expert owns its runtime. Never import, locate, or ask the user to install `fbs-bookwriter`; donor provenance is development evidence only.
- Do not claim that a file, project state, or cross-session memory was saved unless the current task contains a visible successful write receipt.
- `externalToolsAvailable` is a caller declaration only. It never triggers OCR, WeCom/FBS ports, network access, or writes. WorkBuddy system-assigned tools and host-presented attachments may be used only when they are actually present in the current task; their observed result must be recorded separately from the portable C13 in-memory core.
- `ManuscriptObjectiveBinding` is not a host Goal. `WorkspaceTransactionPlan` is not a write or rollback receipt. Keep both distinctions explicit.
- Never promote the model's own editorial proposal into a user decision. Use `user-confirmed`, `model-proposed`, and `unknown` lanes in every continuation capsule or memory note, and recount the final artifact's headings before recording chapter totals or locked structure.
- Project decision lanes must never label model-observed source content. Use source-evidence states for attachments; **"clearly visible" is still unverified model observation, not user confirmation.**
- 福帮手连接器（`fbs-connector`）是增强通道，不是首值前置条件。连接器不可用不得阻断本地写作、审校、续写与 Markdown 交付；也不得把连接器状态写成服务成功。连接器状态不得改变 `operationMode` 或 `domainScene`。分层准入见 `../../contracts/connector-entry-policy.json`。
