# Upgrade alignment（26.9.10 → 26.9.18）

## Product position

This file records the WorkBuddy-targeted upgrade path for both the long-manuscript expert and the FBS-BookWriter workflow donor. It was written for 26.9.10 and remains the alignment basis for 26.9.18; 26.9.18 itself only slimmed the resident context, rewrote the entry prompts, enabled the FBSir connector, and internalised eight cross-expert mechanisms (see `reference-routing-detail.md`). No governance semantics changed. The current validation target is WorkBuddy 5.5.3; compatibility with earlier versions is not proven. FBS-BookWriter is not a runtime dependency. Its validated governance semantics must be re-expressed inside the package as package-local stage gates, receipts, quality runners, memory policy, multi-agent contracts and delivery state, with a closed import and execution graph rather than copied filenames.

## What is inherited as core

- ManuscriptOS project lifecycle and operationMode × domainScene routing.
- FBS-BookWriter S0-S6 stage discipline, S3.5 expansion planning and S3.7 refinement discipline.
- Outline freeze, chapter brief, chapter status, measured word count, source backup and final-clean gate.
- S/P/C/B quality layers, cross-chapter continuity, terminology and temporal checks, and one authoritative final draft.
- Mibao asset manifest, hash identity, incremental inventory, evidence packet and failure list.
- Mom Dialogue question map, entity/relationship/timeline modeling, three-layer text and consent state.
- Tietu Toutiao content state, visual anchors, revision parent chain, editorial log and low-confidence stop.
- Beike Yi local workspace scope, first-value card, new-version write-back, read-back check and recoverable local task state.
- Review Board bounded role pool, decisive question budget, dissent preservation and user decision ownership.
- Compliance Red Team release-time risk card, safe rewrite and publish blocking.
- WorkBuddy-native mixed-material intake that consumes only attachments or file results actually visible in the current task and separates provider declarations, host delivery, parsing/OCR/ASR, expert use and final delivery.
- Current WorkBuddy Open Platform separation between Expert, Skill, Buddy application, Connector and third-party Open API surfaces.

## Non-goals

- Do not import or require `fbs-bookwriter` at runtime.
- Do not promise absolute offline processing.
- Do not turn every short writing request into a project.
- Do not let every vertical Buddy invent a new state machine or ledger.
- Do not claim full audio/video processing in P0.
- Do not submit or publish until current receipts, regression, compatibility and human approval are complete.
- Do not treat the internal Buddy Package schema as an official Buddy-application upload format or platform-created draft.
- Do not use another host product, a sibling runtime, a model badge or a static catalog row to prove WorkBuddy execution.

## Completion rule

A version is a full upgrade only when it provides both visible first value and executable evidence-backed governance: WorkBuddy-presented mixed-material intake with range/confidence receipts, stage transition receipts, material and provenance ledgers, actual write/read-back or honest host degradation, current quality receipts, recoverable multi-agent tasks, final-draft governance and one deterministically built release package with its physical identity held outside the ZIP.
