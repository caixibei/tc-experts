# Layered memory policy

26.9.10 keeps these layers separate:

- `project_truth`: current project files, source ledger, manuscript versions, checkpoints and permissions. This is the writing truth.
- `workspace_log`: append-only development or project work log. It records durable decisions and completed work, not hidden user content.
- `host_memory`: optional host-managed memory. A host receipt is required for create/update/delete claims.
- `user_preference`: stable writing preferences such as language, tone, format and output style.

Project facts, people, events, quotations, claims, source locations and permissions must not be silently promoted to global memory. If a memory conflicts with current project truth, current project truth wins and the conflict is recorded. A user correction must supersede or withdraw the old entry rather than silently append a contradictory preference.

A continuation capsule is visible continuation text, not proof of hidden persistence. Without a current host or workspace write receipt, state must be described as `capsule_only`, `not_executed`, or `advisory`.
