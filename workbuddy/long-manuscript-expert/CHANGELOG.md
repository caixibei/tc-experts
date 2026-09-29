# Changelog

## 26.9.18

本版为长文档专家功能升级候选，保持稳定产品 ID `long-manuscript-expert`、主理人 `long-manuscript-expert`、21 个场景、11 个操作模式、五个用户入口与 23 项共享能力不变。写作内核（ManuscriptOS Kernel、Schema、模板、资源注册表、S0-S6 阶段门禁、L0-L5 材料成熟度）未改动。

### 新增

- **福帮手连接器准入**：在 `.codebuddy-plugin/plugin.json` 声明 `dependencies.connectors=["fbs-connector"]` 与 `experienceModel.connectorRequired=true`。新增 `contracts/connector-entry-policy.json`，把产品连接、工具可用、身份与路由、权益与授权分四层，互不替代；服务暂不可用时保留已达成的本地成果，不要求用户排查连接器，也不把服务不可用写成材料不足。
- **加载预算合同**：新增 `contracts/loading-budget.json`，把常驻上下文预算、禁载清单、基线实测与验证命令写成可测数字。实测常驻上下文由 66,148 字节降至 30,672 字节（−53.6%）。
- **交付降级与状态合同**：新增 `contracts/fallback-matrix.json`（格式降级链 + 假成功禁止）与 `contracts/delivery-state-machine.json`（内容完成 / 用户已拿到 / 外部动作已执行三轴，含禁止组合），并配套可执行实现 `scripts/lib/format-degrade.mjs`。
- **多章节并行协议**：新增任务 / 结果 / 失败三信封模板与 `references/parallel-chapter-protocol.md`，定义事件顺序链、章节草稿隔离、封存规则与单一写作负责人合流。
- **证据纪律**：新增 `references/evidence-discipline.md`（七级证据标签不得晋级、`usageEligibility` 单独过门判定、来源家族、冲突组、反证同等可见）与 `assets/statement-patterns.json`（12 条条件→标准表述）。
- **人物主轴场景资产**：新增 `references/story-card-and-interview.md` 与 `schemas/story-card.schema.json`（故事卡 20 字段、三层稿、五层级追问与 `gapBasis`、哈希绑定确认、权限四维与三权分离），用于传记、回忆录、口述史、家谱、纪念文集与图文专辑。
- **图文专辑编排**：新增 `references/collection-album-composition.md`（卡片 / 顺序 / 锁定 / 审阅状态模型与 9 种有界改稿操作）。
- **渲染不变量**：新增 `references/rendering-invariants.md`（格式可变语义不可变、语义双哈希门、语义不可变字段、允许转换白名单）。
- **续接幂等**：新增 `references/continuation-idempotency.md`（`operationId` 幂等、`expectedRevision` 乐观锁、日志链校验、`legacyFields` 兜底、`supersedes` 替代链）。
- **偏好沉淀**：新增 `references/preference-memory.md`（明确指示 > 固化偏好 > 倾向偏好 > 默认，及固化规则）。
- **Word 改稿留痕**：`docxEdit` 编辑项新增必填 `reason`；回执逐条记录改动理由。
- **包内自检**：新增 `scripts/lib/format-degrade.mjs`（8 项）与 `scripts/docx-edit-self-test.py`（16 项端到端用例）。

### 变更

- **连接器策略由“不依赖”改为“要求启用”**：声明为产品准入项，但连接器仍是增强通道，不阻断首值、不改变场景路由。包内 10 处相关表述按准入层 / 路由层 / 能力返回值层分三层处理，路由正交性与确定性 helper 的 `connectorRequired=false` 语义保持不变。
- **常驻上下文瘦身**：`agents/long-manuscript-expert.md` 由 34,968 字节降至 19,576 字节，`skills/long-manuscript-core/SKILL.md` 由 31,180 字节降至 11,096 字节。原 18 条扁平参考清单改为「当前任务 → 先读取」两列路由表；情境细节迁至按需读取的 reference，**逐条保留，未删减**。
- **入口话术重写**：三条快速提示由 150+ 字规格书式改为 66 / 65 / 54 字场景锚点式，清除“可复制续写口令”“忠实转录”等内部术语，把“几十万字 / 不跑题 / 没有AI味”写进话术。`defaultInitPrompt` 与第一条保持逐字一致。
- **展示描述**：改为“轻松几十万字，不跑题，没有AI味。混杂文档、扫描件、图片、表格与旧稿编成可续接可追溯可交付的长文档。”（50 字，符合 40–50 字规范）。
- **Word 写入**：产出改为“同目录暂存 + `fsync` + 字节回读 + 原子替换”，崩溃只留暂存文件，不在目标路径留下半截 DOCX。
- **品牌图标**：`plugin.json#/avatar` 指向新增的 `avatars/fbsir-icon.png`（512×512，纯图形标）。原 `avatars/fbsir-standard-logo.png` 保留在包内但不再引用。

### 边界与未完成项

- 连接器声明是**包内约定**，宿主侧未发现 `dependencies.connectors` 解析器；本版不依赖宿主拦截，行为写在 Skill 加载合同与包内契约中。
- 新增的 8 类机制**只取机制与字段**，不搬领域内容，不引入 `wecom` / `tmeet` 等额外连接器依赖，不新增运行时依赖。
- 加载预算 30,720 字节是**包内预算，不是宿主端首字延迟的实测结论**。本版只量化了输入体积，未做端到端延迟测量。
- 图标为 64×64 位图放大，**不是矢量重建**；斜纹边缘有轻微柔化，有矢量源应替换。图标权利归属需由发布者向品牌方确认，见 `RIGHTS-NOTICE.md`。
- `os.link` 原子提交经实测撤回：本平台删除暂存名后 `st_nlink` 仍为 2，而 `child_path()` 对源文件强制 `st_nlink == 1`，硬链接会让产出的 DOCX 无法被本包自己的 `inspect` / `edit` 读取。改用同目录 `os.replace`，存在极小的 TOCTOU 窗口（本产品为单一写作负责人模型，不支持并发写同一输出路径）。
- 包内可复现验证：`node skills/long-manuscript-core/scripts/expert-tools.mjs --check`（44 项接口 + 92 条路由 + 5 项资产）、`node skills/long-manuscript-core/scripts/lib/format-degrade.mjs`（8 项）、`python skills/long-manuscript-core/scripts/docx-edit-self-test.py`（16 项）。另有包外开发工作区的官方校验与引用完整性检查。这些只证明包内合同行为与诚实降级，**不证明**真实宿主连接引导、端到端延迟改善、版式正确或已上架。
- 包内 60 例固定回归属源码评审面，不随本包分发。
