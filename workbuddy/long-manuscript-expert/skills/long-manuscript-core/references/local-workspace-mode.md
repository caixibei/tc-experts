# Local-first workspace mode

## Purpose

The local workspace is the default project container for messy long-document materials. The expert works from the user's selected workspace and selected material scope, then writes a new version back to the workspace when the user explicitly requests persistence.

Local-first does not mean an absolute offline guarantee. Model services, host configuration, organization policy, optional connectors, and external delivery may still involve remote processing. Each capability must declare its current mode: `local`, `local_with_remote_model`, `connector_enhanced`, `degraded`, or `unsupported`.

## Entry contract

1. Ask for a workspace only when the task needs local project material.
2. Record the exact material basket: file, page, section, sheet, cell range, frame, or time range.
3. Treat a listed file as `listed_not_read` until bytes or a host read result is observed.
4. Treat a read file as content input, not automatically as accepted evidence.
5. Exclude unselected files and do not infer their contents.
6. Keep source files read-only; derived artifacts and drafts live in separate paths.

## Visible status language

Use plain language:

- `listed_not_read`: "已列出，但本次还没有读取正文。"
- `read`: "本次已读取这部分内容。"
- `read_partial`: "本次只读取到部分内容。"
- `unsupported`: "当前处理能力不支持该格式。"
- `permission_needed`: "需要你授权更小范围的文件或目录。"
- `evidence_ready`: "这部分内容已有来源锚点，可以进入文稿。"

Never claim that a whole workspace was read when only a file list was observed.

## Write-back contract

Default: `new_version`.

Before writing, show:

- target workspace;
- target folder;
- new file name;
- version label;
- impact boundary;
- files and ranges that will not be changed;
- sharing and publishing status.

After writing, read back the target and verify its key structure, content digest, and version label. Only then use `saved_and_read_back`. If read-back fails, use `writeback_unconfirmed` or `write_conflict`.

Sharing, syncing, uploading to a library, publishing, and saving a reusable asset are separate actions. Do not imply any of them from a local write receipt.

## Recovery

A failed or interrupted task must preserve the workspace, material scope, derived artifacts, evidence graph, draft, patches, and the latest checkpoint. Resume from the latest valid checkpoint rather than asking the user to select all materials again.
