# 图文专辑编排与有界改稿

> 何时读我：处理**图文专辑、画册、影像集、纪念册、图片型章节**时；或需要对已编排内容做局部改稿并保持可追溯时。
> 26.9.18 吸收自 `tietu-toutiao` 的多工件编排状态模型，按长文档图文专辑场景改写。**不吸收**其渲染层（版式引擎、平台比例、ZIP 打包、贴图 PNG 输出）——本专家交付 Word / Markdown。

## 1. 状态模型

专辑状态由四组构成，缺一不可：

```
sources[]   来源材料清单，每项强制带 sha256
cards[]     图文卡片，每项必须绑定 source_refs（≥1）
order[]     卡片顺序，必须逐一列全
locks[]     锁定项
reviews{}   审阅摘要
```

### sources[]

```json
{ "sourceId": "src_001", "path": "相对项目路径", "sha256": "…", "kind": "photo|scan|document|audio|video" }
```

- `sha256` **强制**：没有摘要的来源不得进入 `cards[].source_refs`。
- 原件只读；编排只引用，不复制、不移动。

### cards[]

```json
{
  "cardId": "card_007",
  "kind": "image|text|quote|table|timeline",
  "title": "…",
  "text": "配文 / 说明",
  "credit": "署名或来源标注",
  "source_refs": ["src_001"],
  "crop": { "focalPoint": "center|top|left|…", "note": "…" },
  "reviewStatus": "pending|accepted|rejected"
}
```

- `source_refs` 至少一项；配文不得出现来源没有的内容。
- 落选卡片**保留**并标 `rejected`，不删除——落选理由本身是可追溯信息。

### order[]

- **必须逐一列全所有 `accepted` 卡片**，不得用“其余按顺序”省略。
- **第一个元素是封面**，不得留空。
- 顺序变更使整篇确认失效（见第 3 节）。

### locks[]

被锁定的卡片在解锁前拒绝任何修改。锁定用于保护已定稿或用户明确要求保留的内容。

## 2. 改稿操作（9 种）

每次改稿是一条 patch，**必须绑定 `baseRevisionId` 并生成新的 `revisionId`**。一次只做一个操作。

| # | 操作 | 说明 |
| --- | --- | --- |
| 1 | `add_card` | 新增卡片，必须带 `source_refs` |
| 2 | `remove_card` | 移除卡片（改为落选而非物理删除） |
| 3 | `update_card_text` | 改配文 |
| 4 | `update_card_credit` | 改署名 |
| 5 | `replace_card_source` | 换来源，必须带新 sha256 |
| 6 | `set_crop` | 调整裁切与焦点 |
| 7 | `reorder` | 调整顺序，必须列全新的 `order[]` |
| 8 | `lock` / `unlock` | 锁定或解锁 |
| 9 | `set_review_status` | 标记入选 / 落选 |

**纪律**：

- 目标处于 `locks[]` 且未 `unlock` 时，**拒绝修改**。
- `baseRevisionId` 与当前版本不一致时判 `revision_stale`，拒绝执行——不得在旧基线上打补丁。
- 每条 patch 记录操作者、时间与理由；理由不得为空。

## 3. 确认与失效

确认操作要求 `expected_digest` 等于当前 `review_digest`，否则判 **stale** 并拒绝。

```
confirm 需要：expected_digest == review_digest + actor + note
```

**失效粒度**：

| 变更 | 失效范围 |
| --- | --- |
| 卡片顺序变化 | **整篇确认失效**（顺序是专辑语义的一部分） |
| 某卡片内容变化 | 该卡片确认失效；**未变卡片的确认继续有效** |
| 某来源字节变化 | 引用该来源的卡片确认失效 |
| 无关章节变化 | **不**影响本专辑已有效确认 |

> 关键纪律：**不把整份文件摘要变化直接当作每张卡片的语义变化。** 来源片段未变化时，保留无关卡片及其有效审阅。

## 4. 版本回退

回退**同时恢复**状态、编排与封面三者，不允许只回退其中一项。回退不删除新增的用户素材——`rollbackDeletesNewUserAssets: false`。

## 5. 可追溯评审

生成评审视图时：

- 单文件 HTML，图片以 base64 内嵌，**零端口、零 CDN**（离线可开）
- 同时展示入选与落选，以及落选理由
- 表单只做两件事：选方案、填意见；选择结果序列化为 JSON 回贴会话，再转为 patch

**评审视图是展示层，不构成确认。** 用户在视图里的选择必须回到会话中转为显式 patch 才生效。

## 6. 与其他 reference 的关系

- 故事卡与三层稿见 `story-card-and-interview.md`
- 来源摘要与独立性见 `evidence-discipline.md`
- 多格式交付与降级见 `../../contracts/fallback-matrix.json`

## 证据边界

本文件定义**编排状态与改稿纪律**，不执行渲染、不生成图片、不验证图像内容。卡片配文中的事实仍受 `frontstage-p0-gates.md` 的事实门约束。
