# 当前对话中的项目概况

本规则只管理用户明确选择后，如何把当前对话里已经知道的少量项目事实整理进产品体验事件。它不授权上传完整对话、文件、引用原句或报告正文，也不改变联系入口、反馈、报告开工和业务分析规则。

## 一次说明、一次选择

只在交付首个有用结果后运行 `python3 bin/product_data.py status`。计算 `product_data_prompt_needed` 的算法只有一条：状态中存在 `profile_prompt_needed` 时只使用该值；只有该字段不存在时才回退到 `prompt_needed`，不得用 OR 合并。旧状态为 `disabled` 时不再主动询问。只有路由决定本轮实际显示说明时，才运行 `python3 bin/product_data.py mark-shown --project-context`；若被当前任务或更高优先级联系入口推迟，本轮不得标记已展示。

用户可一次选择以下四项，不逐字段分别确认：

1. **仅基本使用数据**：只记录用了哪个能力、是否完成、生成哪类结果，不含对话和文件；执行 `choose enabled --profile-scope none`。
2. **另含行业和规模**：在基本数据上，允许整理行业、公司规模与本次交易规模；执行 `choose enabled --profile-scope summary`。
3. **另含自愿提供的公司、本人姓名和本人联系方式**：在上一项上，允许加入用户自己明确提供的这些身份信息；执行 `choose enabled --profile-scope identified`。
4. **仅本地**：不发送体验数据；执行 `choose disabled`。

展示时用自然中文同时说明：数据加密存储在上海，项目概况保留 180天；用户以后可说“关闭体验数据”，也可通过联系入口请求删除。以上选择都不影响继续分析、二维码和联系入口。数据不会因本选择用于训练，也不会自动开启主动联系。模糊回复“可以”只视为第一项“仅基本使用数据”，不能推定 identified；未回复不追问。已选同一范围不重复展示，用户主动变更时才更新。

## 从当前对话自然整理

每次准备发送事件前先读取当前 `profile_scope`，再从当前对话整理明确的行业、规模和标的，生成一个明确的当前项目结构化 JSON 临时文件，并通过 `event --project-profile-file <文件>` 传入。文件只保存该范围已经获准的字段；不传引用原句、聊天摘要、文件内容或自由扩展字段。用新建的私有临时目录和文件，避免共享、可预测的 `/tmp` 名称；目录和文件使用当前用户最低权限，并在成功或失败后清理。标识只留在当前对话状态，不另建带原始聊天的历史索引；上下文丢失后不搜索旧聊天恢复标识。

## 可执行 JSON 合同

每个概况必须恰好包含以下全部字段；summary 范围也必须保留四个身份键并填空字符串，不能省略：

```json
{
  "project_id": "project-550e8400-e29b-41d4-a716-446655440000",
  "profile_id": "profile-6ba7b810-9dad-41d1-80b4-00c04fd430c8",
  "context_kind": "actual_project",
  "industry": "制造业",
  "industry_basis": "inferred",
  "company_size": {"metric": "annual_revenue", "band": "100m_500m", "currency": "CNY", "period": "2025", "basis": "user_stated"},
  "deal_size": {"metric": "transaction_value", "band": "10m_50m", "currency": "CNY", "period": "unknown", "basis": "user_stated"},
  "target_company": "",
  "user_company": "",
  "user_name": "",
  "user_contact": "",
  "contact_followup": false
}
```

示例只展示形状；运行时必须生成新的真实随机 UUIDv4，分别加 `project-`、`profile-` 前缀，绝不复制示例 ID。同一标的继续复用当前标识。

- `context_kind`: `actual_project | hypothetical`。
- `industry`: `未知 | 制造业 | 能源与矿业 | 信息技术 | 金融服务 | 医疗健康 | 消费与零售 | 房地产 | 建筑与基础设施 | 物流与交通 | 农业与食品 | 教育 | 文旅与酒店 | 专业服务 | 其他`。
- `industry_basis`: `user_stated | inferred | unknown | declined | not_applicable`；后三项只能搭配“未知”，`inferred` 不能搭配“未知”。
- 公司 `metric`: `annual_revenue | total_assets | unknown`；交易 `metric`: `transaction_value | financing_amount | acquisition_budget | unknown`。
- `band`: `unknown | lt_10m | 10m_50m | 50m_100m | 100m_500m | 500m_1b | gte_1b`。按原币金额分档：`lt_10m` 小于一千万；其他区间均下限含、上限不含；`gte_1b` 含十亿。
- `currency`: `unknown | CNY | HKD | USD | EUR | other`，不换算；已知 band 必须使用已知币种。
- `period`: `unknown` 或四位年份。`basis`: `user_stated | unknown | declined | not_applicable`；只有 `user_stated` 可使用已知 band，其余必须为 `unknown`。

完整事件示例：

```bash
python3 bin/product_data.py event --skill-id mai-deal-advisor --skill-version 1.3.7 --event-name first_value_completed --entry-point expert_pack --outcome success --artifact-type other --project-profile-file "/私有临时目录/current-project-profile.json"
```

单标的结果可把概况附在真实完成事件上。一个结果比较多个标的时，只记录一次真实 `first_value_completed` 基本事件，再为每个实际标的各记录一次带概况的 `project_context_recorded`；同一 `project_id`、不同 `profile_id`，不得复制完成事件。概况记录不是新完成、新启动、新产物或线索，原始 `totals.events` 也不能称为完成任务数。

- 没有明确项目的泛知识问答只传基本事件，不造项目，也不创建概况文件。
- 同一项目复用 `project_id`；同一标的复用 `profile_id`；不同标的分别使用新的 UUID 形式 `profile_id`。三个内置技能沿用主专家为该项目、标的建立的相同 ID。
- 标的公司写入 `target_company`，用户所属公司写入 `user_company`，两者不能混同。identified 也只收用户本人自愿提供的姓名、公司和本人联系方式；不要收集别人的姓名或别人的电话。
- 行业可按用户明确描述的业务合理归入固定行业并标 `inferred`；只有用户直接说明所属标准行业才标 `user_stated`。无法判断或拒绝时行业为“未知”，依据分别为 `unknown` 或 `declined`。
- 公司规模优先使用用户已说的年营收 `annual_revenue`；没有营收而明确给出总资产时才用 `total_assets`。估值不是营收或资产。
- 交易规模优先实际交易对价 `transaction_value`；按任务可依次使用融资金额 `financing_amount` 或收购预算 `acquisition_budget`。模型自己算出的估值或报价不能标成 `user_stated`。
- 金额、币种、期间或身份不猜。没有金额用 `unknown`；“规模一亿”未说明含义时，公司规模和交易规模都为 `unknown`。跨多个金额档、多个币种或金额含义不清时也标 `unknown`，不猜换算。
- 制造业年营收与交易金额必须分别进入 `company_size` 和 `deal_size`，不能互相覆盖。规模未知不构成小项目自动拒绝门槛，也不为了采集而追问。
- `summary` 范围的身份字段必须留空，`contact_followup=false`。`identified` 只允许当前用户自愿提供的身份字段；用户给出他人联系方式时不保存。单纯自愿提供联系方式不代表希望联系；只有用户明确要求 MAI 联系本人且提供本人联系方式时 `contact_followup=true`。
- `declined` 表示用户明确拒绝该项；拒绝后不追问。`not_applicable` 只用于确实不适用，不用来掩盖未知。

缺信息时，只有它对当前业务分析确实具有决定性作用才轻问一个合并问题；能继续就用 `unknown`。这不是数据采集问卷，不能为了补全概况阻挡结果、二维码或联系入口。

## 与既有工作流的边界

- quick 快速档仍不读取其他大量规则、不启动重工作流；首值后读取本文件、查询状态并按已授权范围生成最小项目概况文件，是体验数据客户端的有限例外。
- 用户明确选择“仅基本使用数据”或“仅本地”时不创建项目概况文件。
- 正式报告仍遵守 `references/report-intake.md`：已有信息先带入，只补对报告有决定性作用的缺项，并尽量合并为一次确认。完整选择卡不发送；其中已授权的行业和规模仅可按本文件白名单整理。交易角色、报告用途、搜索范围、阅读对象等不在本次增量采集清单。
- profile 授权不代表训练授权，不代表同意主动联系，也不代替反馈确认、项目档案授权或报告开工确认。
- 关闭体验数据后不再发送事件；请求删除按客户端现有删除入口处理。网络失败安静跳过，不阻断业务结果。
