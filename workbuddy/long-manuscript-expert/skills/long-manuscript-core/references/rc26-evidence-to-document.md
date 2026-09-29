# 从来源到可继续使用的稿件

目标是交付可信、可修改、可继续的文稿。不要把本协议变成每次回复都必须执行的繁重流程。短任务直接给结果；长项目仅调用当前步骤所需工具。AI 可以执行写作、编辑和模型审稿；只有用户明确要求人工评价或正式验收时，才需要对应的人类证据，不能为了消除“human pending”而伪造它。

## 写作与改稿

先确定用户目标、体裁、材料范围和当前可见内容，给出结构及实质正文。沿用已有 `plan`、`sourceCard` 和 `draftTrace`，不要要求用户学习内部场景ID。明确复合目标直接形成复合安排。

对纪实、口述、研究、手册等来源约束写作，把事实主张绑定到**最小充分来源片段**。使用 `fidelity` 比较片段与改写；使用 `fidelityAudit` 检查整段或整章的非空白字符映射。`draftTrace` 的每个claim可增加 `sourceRanges:[{evidenceId,start,end}]`，自动消费同一保真检查。字符下标为UTF-16起止区间，end不含；摘要为实际UTF-8字节。

保留的不只是数字，还包括谁在说、可能/大约、未完成、至少/不超过、日期、引语和习惯强度。例如“急不来”不能无依据改成“从不着急”；“可能到年底”不能摘要成确定到年底。支持限定词同类替换及部分中西文数字归一，不把所有改写都要求逐字相同。

`fidelityAudit` 将正文绑定区分为 claim、quote、structure、unverified。structure仅用于标题/分隔线；未引用的实质正文应明确列入unverified，而不是隐藏在“六条主张都通过”之后。映射覆盖不等于原子事实完整性；把整段声明成一个主张、错配主体、改变因果或省略隐含条件，仍需模型或人类按段阅读。`semanticTruthVerified` 始终false，机械检查无冲突不等于语义自动通过。

表达优化先指出具体冗余、节奏或论证问题，再产生范围明确的patch。`reviseExpression` 已接入保真检查，继续保留原稿和旧基础版本保护。AI审稿结果记为model_review，可以辅助选择候选；`reviewSelect` 返回的 declaredReviewActor 只是声明，humanAcceptanceVerified不因此变真。作者样本仅帮助当前体裁的措辞、视角和节奏，不转移样本事实；不要以禁词数量或所谓AI概率评定质量。

## 续接与当前文件

需要持续保存的项目先用 `projectReadback`：显式指定已授权根、source文件和chapter文件的相对路径。工具读取实际字节并生成当前目录、章节状态、依赖和snapshot；来源与章节合计最多4MiB，单文件最多1MiB，严格UTF-8。它不扫描整个磁盘，不自动调用OCR/ASR，也不把媒体元数据当正文。

第一次输入用 `--example projectReadback` 获取结构。每个chapter的 sourceIds 声明依赖，可加 fidelityBindings；缺少保真映射时明示not_assessed，不给语义通过。chapter文件应是明确章节；包含旧目录的聚合稿会检查其目录是否与当前章节状态矛盾，发现矛盾需修订新副本，不能用新封面目录掩盖旧目录。

保存时将工具返回的snapshot交给已有 `checkpoint initialize/commit`，沿用版本号+摘要CAS及幂等键。`fileBindings` 随快照保存，不创建第二套生命周期。下一次用 `projectReadback {root,fromCheckpoint:true}` 重新读取来源；即使调用方没有手工更新sourceDigests，也能发现实际变化。若来源变化或保真锚点失效，先复核受影响章，无关章保留。

续接卡使用完整原文段落摘录，不自动重述它的事实。单段超出摘录预算时明确不内联并给出文件引用，不能截掉句末限定。`draft_available` 表示有草稿，绝不等于定稿或人工验收。已有旧快照仍可用原 `checkpoint read` 读取；缺physical links时新回读流程会说明未建立链接，不自动迁移、重建或清理旧项目。

## 本地交付

`exportDocument` 消费刚得到的 observationDigest，并再次回读当前源和章。来源过期、保真冲突、旧目录矛盾或观察版本不匹配时不生成新交付。通过后写入新的 `deliveries/<digest>/`：manuscript.md、manuscript.html、resume.json和manifest.json；回读精确文件集与摘要，原件不改。

目录、状态和下一步来自同一projection，不分别手填。HTML转义原始内容，无外部脚本或网络依赖。已有目录只做身份回读，内容被改或多出文件就拒绝覆盖。中断临时目录保留诊断材料，不清除恢复证据。此能力是Markdown/HTML交付，不声明Word/PDF渲染完成。

## 证据与验收

`reviewEvidence` 区分 deterministic_check、model_review、human_review、execution_authorization、owner_acceptance、installed_copy、host_activation、session_resume、material_observation。

- 执行授权允许完成已授权工作，但不是“业主已验收结果”。
- AI完整阅读全文属于模型审阅；不能因“代执行”改成人工审阅。
- 安装副本和创建者marker不证明当前专家激活；进程重启或子代理不证明新的宿主会话。
- 合成样本可以检验机制，不能变成真实用户材料或自然使用。
- JSON字段和哈希只能说明内容与绑定；默认CLI不会认证人类或宿主来源。正式验收需要单独、已核验的authority registry；不能由模型在测试目录里自制信任锚。

开发者固定回归、运行前冻结的验收预期、模型语义评审和真实用户效果分别报告。新测试的stdout/stderr/退出码由runner实际采集，不手工填退出码；不从actual candidate反抄期望值。当前包内工具通过、宿主通过、人工验收、可提审、提交和上架仍独立记录。
