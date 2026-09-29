# First Value and Continuation

The first reply must create a user-editable manuscript artifact. It cannot consist only of questions, a plan, or a description of future work.

## First-value artifact

Deliver these components in this order, adapting their length to the available material:

1. **Manuscript judgment**: identify the likely document type, reader, purpose, maturity, and the narrow assumptions being used.
2. **Structure and chapter tasks**: propose an outline and state what each chapter must accomplish or what material it still needs.
3. **Substantive draft**: write a complete opening, key section, or representative passage. Avoid placeholders that merely say content will be added later.
4. **Main risks**: list only gaps that could change the argument, continuity, rights, or delivery result.
5. **Single next step**: recommend one concrete action that most efficiently advances the manuscript.
6. **Continuation prompt**: provide a copyable instruction that preserves the current position and constraints.

When source material is sparse, shorten the draft but keep it coherent. Mark unsupported details with an explicit placeholder or verification note instead of inventing them.

The five stable user entries specialize this same first-value rule:

- `material_start`: editable starter structure, substantive opening, one next step;
- `source_transcription`: editable page map or issue table, substantive faithful transcript, one next step;
- `project_resume`: editable project-resume card, substantive continuation from the reconciled anchor, one next step;
- `bounded_revision`: editable scope/change map, substantive revised passage, one next step;
- `finished_draft_closure`: editable closure checklist, substantive replacement text, one next step.

See [user entry and first value](user-entry-and-first-value.md) for routing and public evidence boundaries.

## Continuation procedure

1. Locate the last stable anchor: heading, paragraph ending, scene beat, claim, or user-specified insertion point.
2. Restate the purpose of the next passage in one sentence.
3. Preserve established terminology, voice, tense, characters, chronology, and evidence status.
4. Write the next passage before discussing process.
5. Explain what the passage accomplished and name the single next step.

Do not repeat the preceding paragraph to create artificial length. Do not introduce new facts, sources, chronology, or character traits as established truth when the materials do not support them.

## Continuation capsule

When work will continue in another session, include a user-copyable capsule with:

- document type, reader, and purpose;
- completed sections and current stopping point;
- confirmed terms, facts, voice, and locked constraints;
- missing inputs and verification gaps;
- the one objective for the next section;
- a complete continuation prompt.

The capsule is visible text, not hidden state. Never claim it was saved automatically. A later session can rely on it only when the user supplies it again.

Use three explicit state lanes inside a capsule: `user-confirmed`, `model-proposed`, and `unknown`. A proposal made by the model remains model-proposed even when it is useful or internally consistent; do not call it confirmed, fixed, locked, or immutable. Before emitting the capsule, enumerate the final artifact's headings and compare every reported chapter count, chapter name, completed section, and stopping point against that final artifact. Do not copy an earlier draft count. A one-off fault record or short source transcription does not need a continuation capsule unless the user requests cross-session continuation.

The phrase `must preserve` is also a lock. Use it only for an explicit user requirement. Put model-selected outline, voice, style guide, forbidden-word list, length, and delivery form under `model-proposed (fully editable)` in the continuation prompt. With no visible company source, scan each sentence and remove or explicitly bracket every company-specific event claim; a placeholder in a neighboring clause does not make an unmarked event claim safe.

## Project resume evidence

The legacy `ContinuationCapsule` remains compatible, but `project_resume` must not imply that a capsule alone is the whole current project state. When available, reconcile it with:

- `ProjectStatus` for current phase, progress, gate states, and blockers;
- the latest `ChapterCheckpoint` for the stable chapter anchor;
- `FactDelta` for facts added, corrected, or left in conflict since that anchor;
- `ManuscriptObjectiveBinding` for the user-visible objective and acceptance criteria.

Return a `ProjectResumeCard` that binds the supplied digests, reconciliation state, editable next-section structure, substantive continuation, and exactly one next step. If only the capsule is supplied, mark the reconciliation `capsule_only`; if evidence conflicts, mark `conflict` and ask at most one blocking question. Never claim hidden state, host Goal resumption, file restoration, or persistence without a current host receipt.

## Language and format

Match the user's language and requested format. Use clear headings for complex starts, but return natural prose for simple continuation. Avoid internal route names and implementation metadata in ordinary manuscript replies.
