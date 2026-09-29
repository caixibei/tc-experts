# Safe Demos

用户问“这个专家包能做什么”时，用下面八个安全示例回答。示例只展示虚构信息、公开信息和本地校验，不触碰私有材料。

## Demo 1: HKEX Announcement Check

User prompt:

```text
帮我查 00700 从 2026-03-01 到 2026-03-31 的披露易公告，并保留 URL。
```

Expected guidance:

```bash
hkexnews_fetch.py 00700 20260301 20260331
```

Then summarize only the returned date, title, and URL. If there is no URL, mark the line as pending source confirmation.

## Demo 2: Cap-Table Reconciliation Gate

User prompt:

```text
请检查这份持股表是否能交付。
```

Expected guidance:

```bash
recon_gate.py cap_table.xlsx
```

If the gate exits with code `1`, tell the user the table needs reconciliation before delivery.
If the gate exits with code `2`, tell the user the table was not checked and needs a supported standard table format.

## Demo 3: Transaction Structure Diagram

User prompt:

```text
请把这套虚构安排画成交易结构图：股东 A 和股东 B 分别持有收购 SPV 60% 和 40%，收购 SPV 以现金收购目标公司 100% 股权。
```

Expected response:

- Create `outputs/deal-structure-diagram.svg`.
- Create `outputs/deal-structure-diagram-notes.md`.
- Draw the two shareholders, acquisition SPV, and target company using the MAI diagram standard.
- Show the 60%, 40%, and 100% equity links as solid lines and the cash consideration as a separately labeled flow.
- Do not add a jurisdiction, price, financing source, or regulatory conclusion.

## Demo 4: Complex Transaction Question Boundary

User prompt:

```text
上市公司控制权变化后，这个安排是否会触发要约义务？
```

Expected response before the user chooses human review:

```text
这个问题不能靠流程包硬猜：控制权变化和要约义务属于专业判断，自动流程只能整理材料和标出待确认点。

我可以先整理控制权变化、相关持股和待核实规则。是否申请人工复核，由你决定。
```

需要人工复核时，完成包内可交付部分，再提供以下确认卡：

```text
申请人工复核
准备提交的问题摘要：控制权变化后是否可能触发要约义务。

如需人工分诊或交易承接，可以找项目团队聊聊：
https://api.mai.deals/workbuddy/intake?source=mai-lab-ma-expert-pack-v1.3.7
```

## Demo 5: Project Team Contact

User prompt:

```text
我想找对口买方，也想和团队聊聊怎么推进。
```

Expected response:

```text
这类项目，分析只是第一步。要不要直接和项目团队聊一下买方、资金、合作资源和推进方式？

先聊问题，不必先发项目名称或保密材料。

![扫码联系项目团队](https://api.mai.deals/workbuddy/contact-qr-chat.jpg?v=20260907)

[手机点这里直接联系项目团队](https://api.mai.deals/workbuddy/project-contact?source=mai-lab-ma-expert-pack-v1.3.7&placement=high_intent) · [邮件联系：ocip@ociphk.com](mailto:ocip@ociphk.com)

联系页面不会自动发送当前对话、文件或项目材料。
```

## Demo 6: Concise Project Triage

User prompt:

```text
客户刚发来一页很乱的项目摘要。卖方想退出，买方还没找，财务资料不全，帮我判断先做什么。
```

Expected response shape:

```text
一句判断：先锁定卖方退出边界并形成最低可用事实包，再启动买方筛选。

P0 当前阻断项：出售范围、控制权安排和时间要求尚未明确。
P1 显著影响项：财务资料不完整，暂不能支持正式估值或买方排序。
P2 优化项：项目摘要需要整理为统一事实底稿。

下一步三件事：
1. 直接读取现有摘要，形成项目分诊和缺口表。
2. 确认出售比例与核心约束，形成退出边界清单。
3. 建立最低资料包和公开候选买方筛选口径。

一个必要问题：卖方计划出售控股权、全部股权，还是尚未确定？
```

Do not add a long industry primer. The full fact table belongs in `outputs/project-triage.md`.

## Demo 7: Structured Table Blocker

User prompt:

```text
总股本 1,000 万股，A 持有 600 万股、60%，B 持有 450 万股、45%。帮我整理成可以直接发客户的表格。
```

Expected response:

```text
一句判断：当前持股数据合计为 1,050 万股和 105%，存在 P0 冲突，暂不能直接发客户。

| 股东 | 持股数量（股） | 持股比例 |
|---|---:|---:|
| A | 6,000,000 | 60.00% |
| B | 4,500,000 | 45.00% |
| 合计 | 10,500,000 | 105.00% |

已校验：表头与列数、数量与比例合计。
待确认：A、B 是否存在直接与间接权益重叠；数据时点和股份类别。
未完成：一手文件核对和 `recon_gate.py` 机器校验。
```

Keep the deliverable `UNVERIFIED` or `DRAFT_WITH_BLOCKERS` until the conflicting input is resolved.

## Demo 8: Broad Request Scope Guard

User prompt:

```text
帮我把这个项目全部分析完，做完整报告、表格、交易结构图和 PDF，越全面越好。现在只知道一家消费品公司考虑出售控股权。
```

Expected response behavior:

1. Give a one-line stage judgment and the top three priorities.
2. Deliver project triage or a report outline as the first useful artifact.
3. Ask at most one decisive question, such as whether the user represents the seller or adviser.
4. Do not start the report, visualization, structure diagram, and PDF together.
5. State the sequence: scope, editable draft, checks, then the explicitly requested formal export.
