# 故事卡、追问设计与确认门

> 何时读我：处理**人物传记、回忆录、口述史、家谱、纪念文集、图文专辑**等以人物为主轴的场景时；或需要把访谈、影像、手稿整理成可追溯的故事单元时。
> 26.9.18 吸收自 `fbsir-mom-dialogue-expert` 的故事卡、追问设计、哈希绑定确认与权限模型，把“妈妈”抽象为“传主 / 主轴人物”。

## 1. 故事卡（20 字段）

结构见 `../schemas/story-card.schema.json`。要点：

| 组 | 字段 | 纪律 |
| --- | --- | --- |
| 标识 | `storyId` / `title` / `supersedes` | 修订用 `supersedes` 保留旧卡，**不删除** |
| 人物 | `subjectRelation` / `people` | 只写材料出现的称呼，不推断亲疏或辈分 |
| 时间 | `timeExpression` / `timePrecision` | 材料的时间表述**原样保留**；精度不足时写 `unknown`，不从文件日期或会话日期补 |
| 地点 | `place` | 同上 |
| 内容 | `eventSummary` | 只写不依赖字符级精确性的语义概要 |
| 来源 | `sourceRefs` / `sourceStatus` | 至少一条，且必须可回读 |
| 三层稿 | `transcriptWording` / `organizedWording` / `manuscriptWording` | **三层必须同时存在或明确为 null**，不得只有成稿 |
| 置信 | `confidence` / `unknowns` | `unknowns` 为空时必须是空数组，不能省略 |
| 敏感 | `sensitivity` / `visibility` | 见第 4 节 |
| 权限 | `manuscriptUse` / `publicUse` | 两者**相互独立** |
| 确认 | `confirmation` | 见第 3 节 |

### 时间精度枚举

`exact_date` / `month` / `year` / `decade` / `period` / `relative` / `approximate` / `unknown`

**“上世纪六十年代”“文革前后”“我十岁那年”都只能标 `relative` 或 `period`，不得换算成具体年份写进正文。** 换算结果是模型推断，不是材料事实。

### 音视频锚点精度

处理录音录像片段时，每个片段带 `timecodePrecision`：

`frame` / `second` / `approximate` / `not_applicable` / `unknown`

- `frame`：有可核对帧号
- `second`：有秒级时间码
- `approximate`：只能给“约第 3 分钟”
- `unknown`：材料未提供时间码，**不得估算**

## 2. 追问设计（五层级）

当材料存在空白需要向当事人或家人补问时，按五层级递进，每轮 **3–7 个问题**，每个问题必须带 `gapBasis`（资料空白依据）。

| 层级 | 方向 | 示例方向 |
| --- | --- | --- |
| L1 日常 | 生活细节与习惯 | 一天怎么过、吃什么、用什么 |
| L2 人物地点 | 关系与空间 | 常来往的人、住处、工作场所 |
| L3 变化选择 | 转折与决策 | 什么时候变的、为什么这么选 |
| L4 关系理解 | 情感与立场 | 当时怎么想、和谁有分歧 |
| L5 当下愿望 | 当下的态度 | 现在怎么看、希望怎么被记住 |

问题状态：`draft` / `asked` / `answered` / `skipped` / `withdrawn`。

**纪律**：

- 每个问题**必须**能回答“为什么问这个”——`gapBasis` 指向具体资料空白。没有空白的提问是闲聊，不进入清单。
- 允许当事人**跳过或撤回**已答内容；撤回后该内容从手稿候选中移除，并记录撤回。
- 不追问当事人明确不愿谈的敏感话题；不把拒绝当作“信息缺口”继续施压。

## 3. 哈希绑定确认（三权分离）

候选内容转正必须走确认门，且**确认只解决“这内容是不是这么说的”，不解决“能不能用”**。

```
确认文件必须包含 storySha256，且等于故事卡当前字节的 SHA-256
        否则 → confirmation_story_binding_invalid，拒绝晋级
```

同时必须确认两项，缺一不可：

- `confirmedSourceLinkage`：来源链接正确
- `confirmedTranscriptWording`：原话措辞正确

**三权分离**（三项互相独立，一次确认不得同时获得）：

| 权限 | 动作 | 效果 |
| --- | --- | --- |
| 确认 | `confirm-story` | 候选 → 已确认。**不改** visibility / manuscriptUse / publicUse |
| 入稿 | `authorize-manuscript` | 允许进入手稿 |
| 公开 | `authorize-public` | 允许公开传播 |

**关键纪律**：确认一个故事“确实是这么讲的”，**不等于**同意把它写进手稿，**更不等于**同意公开。三件事分别取得授权。

故事卡被修改后，`storySha256` 变化，此前确认自动失效，必须重新确认。

## 4. 权限与隐私

四个维度**正交**，各自独立取值：

| 维度 | 取值 |
| --- | --- |
| `visibility` | `private` / `family_only` / `manuscript_only` / `public_allowed` / `unknown` |
| `manuscriptUse` | true / false |
| `publicUse` | true / false |
| `sensitivity` | `none` / `personal` / `family_private` / `third_party` / `legally_sensitive` / `unknown` |

**冲突取更严格的一方。** 两个来源对同一故事的可见范围给出不同答案时，取更严的；不得取交集以外的宽松解释。

涉及第三方的故事（他人隐私、未授权肖像、他人未公开言论）：

- 默认 `sensitivity = third_party`，`publicUse = false`
- 入稿前单独标注，不与其他故事混同处理
- 不因为“故事发生在家里”就默认家人已同意

## 5. 材料来源与原件纪律

- 原件（照片、录像、录音、手稿、书信、证件）**只读**：不移动、不覆盖、不删除、不上传、不自动公开。
- 转写内容必须属于所选来源；不属于时阻断并报 `candidate_transcript_outside_source`。
- 重放同一操作必须幂等，不产生重复故事卡。
- 索引与工作状态写在项目目录内，与素材目录隔离。

## 6. 与其他 reference 的关系

- 证据标签与冲突处理见 `evidence-discipline.md`
- 事实门与零素材逐句门见 `frontstage-p0-gates.md`
- 措辞模式（原话 / 整理表达）见 `../assets/statement-patterns.json` 的 `literal_and_rewrite`
- 图文专辑的卡片编排见 `collection-album-composition.md`

## 证据边界

本文件定义**整理与授权流程**，不证明材料真实性，也不替代当事人确认。故事卡中的任何字段在未获确认前都是候选，不得在正文中写成既成事实。
