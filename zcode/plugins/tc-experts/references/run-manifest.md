# 本地运行清单

标准档和深度档必须创建或更新 `outputs/run-manifest.json`。快速档不创建任何清单。清单记录本次工作实际生成了什么、使用了什么来源、运行了哪些校验门，以及当前产物是否可交付。它不是项目报告，也不替代质检记录。

## 数据边界

- 清单和清单引用的本地产物均保留在用户当前工作目录。
- `data_boundary` 固定为 `local_only`，表示用户文件、生成产物和运行记录不回传 MAI，不表示所有可选查询都离线完成。
- 调用港交所披露易等公开端点前取得用户确认，并在 `external_queries` 记录服务名称、股票代码和日期范围；不得记录密钥或上传用户文件。
- 不把用户材料、对话内容、清单或产物发送给 MAI；只有用户主动申请人工复核时，才按用户确认的摘要另行提交。
- 联系链接可在服务端匿名记录专家包来源和入口位置；运行清单不记录点击、联系方式或联系页面提交内容。
- 清单不得写入访问令牌、账号密码或其他密钥。

## 字段定义

| 字段 | 含义 |
|---|---|
| `schema_version` | 运行清单结构版本，当前为 `1.2` |
| `package_version` | 专家包版本，当前为 `1.3.5` |
| `workflow_id` | 来自问题路由表的稳定工作流编号 |
| `workflow_tier` | `standard` 或 `deep`；快速档不创建清单 |
| `response_mode` | `concise`、`standard` 或 `deep`；默认 `concise` |
| `intent_clarity` | `clear`、`partial` 或 `unclear` |
| `clarification_triggered` | 是否提出了会改变首个产物的决定性问题 |
| `response_length_bucket` | `short`、`medium` 或 `long` |
| `priority_summary` | 本轮最多三项 `P0/P1/P2` 判断及状态 |
| `artifacts` | 本次创建或更新的文件及其类型和状态 |
| `source_status` | 信息截止日、报告期和来源定位记录 |
| `gate_status` | 各适用校验门是否运行、退出码及结果 |
| `acceptance_status` | 路由表所列验收条件及其完成状态 |
| `manual_checks` | SVG 视觉预览等无法由当前脚本替代的必需人工检查 |
| `structured_output_checks` | 表头、列数、口径、来源、合计、股权、空值和跨表一致性检查 |
| `table_structure_check_status` | `passed`、`blocked`、`not_applicable` 或 `not_run` |
| `export_duration_ms` | 正式导出实际耗时；未导出时为 `null` |
| `time_to_first_preview_ms` | 从开始任务到首次可检查预览的实际耗时 |
| `time_to_final_artifact_ms` | 从开始任务到最终产物的实际耗时；未完成时为 `null` |
| `tool_call_count` | 本工作流可可靠统计的工具或脚本调用数量 |
| `retry_count` | 本工作流可可靠统计的失败后重试次数 |
| `progress_stages` | 范围、可编辑底稿和正式导出的真实完成状态 |
| `deliverable_status` | `READY`、`DRAFT_WITH_BLOCKERS` 或 `UNVERIFIED` |
| `open_issues` | 尚未解决的事实缺口、冲突和拦截项 |
| `human_review_requested` | 用户是否主动要求 MAI 人工复核 |
| `data_boundary` | 固定为 `local_only` |
| `external_queries` | 用户确认后向公开端点发送的最小查询参数；未查询时为空数组 |

## 最小示例

```json
{
  "schema_version": "1.2",
  "package_version": "1.3.5",
  "workflow_id": "project_triage",
  "workflow_tier": "standard",
  "response_mode": "concise",
  "intent_clarity": "partial",
  "clarification_triggered": true,
  "response_length_bucket": "short",
  "priority_summary": [
    {
      "level": "P0",
      "item": "确认交易方向",
      "status": "open"
    }
  ],
  "artifacts": [
    {
      "path": "outputs/project-triage.md",
      "type": "project_triage",
      "status": "created"
    }
  ],
  "source_status": {
    "cutoff_date": null,
    "reporting_period": null,
    "provenance": []
  },
  "gate_status": {},
  "acceptance_status": [
    {
      "condition": "项目阶段、资料缺口和下一步三件事已填写",
      "status": "pending"
    }
  ],
  "manual_checks": [],
  "structured_output_checks": [
    {
      "artifact": "outputs/project-triage.md",
      "checks": {
        "headers_and_columns": "passed",
        "units_currency_dates": "not_applicable",
        "sources": "pending",
        "totals_and_equity": "not_applicable",
        "blanks": "passed",
        "cross_artifact_consistency": "pending"
      },
      "status": "pending"
    }
  ],
  "table_structure_check_status": "not_applicable",
  "export_duration_ms": null,
  "time_to_first_preview_ms": null,
  "time_to_final_artifact_ms": null,
  "tool_call_count": 0,
  "retry_count": 0,
  "progress_stages": [
    {"stage": "scope", "status": "completed"},
    {"stage": "editable_draft", "status": "pending"},
    {"stage": "formal_export", "status": "not_requested"}
  ],
  "deliverable_status": "UNVERIFIED",
  "open_issues": [],
  "human_review_requested": false,
  "data_boundary": "local_only",
  "external_queries": []
}
```

## 更新时点

1. 进入标准档或深度档后创建清单，初始状态为 `UNVERIFIED`；快速档不得创建清单。
2. 确定回复模式和优先级后，更新 `response_mode` 与 `priority_summary`。
3. 每生成一个标准产物，就更新 `artifacts` 和 `progress_stages`。
4. 每轮校验后，更新 `gate_status`、`structured_output_checks`、`acceptance_status`、`manual_checks`、`open_issues` 和 `deliverable_status`。
5. 运行公开端点查询后更新 `external_queries`，写明用户确认状态和最小查询参数。
6. 交付时确认清单中的文件路径真实存在，且状态与对用户的表述一致。
