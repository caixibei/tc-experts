# RC27：交付、预览、审阅与来源派生

本协议接续RC26。目标是让用户拿到可读、可修改、可追溯的作品，不是每次回复都执行所有工具。普通写作、AI审阅和已授权编辑照常推进；不能把模拟更正、人类身份或宿主状态由模型自报提升为已证事实。

## 1. 正式副本与预览副本

`exportDocument`生成规范交付目录，并自动返回独立预览的 `openPath`。向用户展示或交给宿主预览器时使用openPath，不直接打开规范目录下的HTML。规范目录仍包含Markdown、HTML、resume和manifest；预览放在同项目previews目录，可被渲染器添加属性。

交付ID绑定当前观察、渲染器源码摘要及可选deliveryRevision。重复导出保持规范副本身份，生成新的预览副本：canonicalIdempotent与previewAlwaysFresh分开记录。没有修改或覆盖原稿。

预览结束后调用 `verifyDelivery {root,directory,expectedManifestDigest}`，核验清单身份、精确文件集、大小及原始字节SHA。新增data-page-node-id即使不改变正文，也使规范HTML不再匹配。检查器可以说明“仅预览属性差异”，但永远不会通过去属性或归一化将其判为通过。

如规范副本确被改写，保留旧文件诊断；从当前稿件以新的deliveryRevision重新导出，再重新预览和核验。`preparePreview`也可单独创建新预览。这里的规范副本是逻辑上不可变的交付对象，不是操作系统ACL写保护承诺。

## 2. 审阅必须对应当前正文与来源上下文

`projectReadback`返回reviewSubjects，每章有textDigest与basisDigest。basisDigest绑定该章正文及其依赖摘要。把实际模型/人工审阅记录保存在reviewFiles指定的版本化文件：id、chapterId、actorType、decision、reviewedTextDigest、basisDigest。

没有审阅可以继续产出明确的工作稿；已配置的审阅若过期或要求修改，不能当作当前通过回执导出。改稿或相关来源变化后更新实际审阅，再选择新回执、保存新快照。旧审阅文件保留在历史中，不要把整个历史目录都列进当前reviewFiles。

reviewBindings只检查版本与上下文绑定，不认证评审人身份，也不证明模型确实完成了语义评审。人类来源仍由独立可信证据核验。一次“授权执行”不等于接受结果。

## 3. 来源更正产生新派生物

使用 `deriveSource`，提供原件路径/摘要、明确patch、kind和basisRef。simulation用于故障测试或模拟；proposed_correction用于具有依据的更正提议。工具不改原件，在项目内生成新内容和lineage记录。

派生关系记录原件、父版本、变化和依据。已知模拟派生物在同项目中换名后仍能通过摘要关联，其后继续更正也不能擦除模拟属性。稿件、HTML、manifest及快照都会继承test_derived并显示“包含模拟更正，不可作为原件事实”。

真实来源更正可以由当前已授权工作执行；正式事实验收时，需要可信来源对该lineage的依据作确认。公共CLI不会把basisRef字符串当成认证。历史来源有变化但没有分类记录时，保留“未分类变更”提示。跨项目复制时应同时携带派生记录；工具不能从没有任何来源记录的文本反推出曾发生的所有编辑。

`sourcePathOverrides`可在fromCheckpoint回读时预演切换到新派生源，沿旧依赖检查影响，不修改已有快照。确认修改范围后再保存新快照。不要直接修改真实材料副本再把模拟值写成纪实事实。

## 4. 片段级依赖

chapter的sourceSelectors可声明id/sourceId/exact/prefix/suffix。唯一匹配的原文片段可在前文插入后重新定位；找不到或有多个匹配时失败关闭，不猜位置。fidelityBindings中的sourceSelectorId指向该片段，检查时使用当前位置。

未使用selectors的旧项目保留整文件依赖，不自动迁移。采用片段依赖后，只有相关片段变化才使对应章失效；无关章的正文和审阅可以保留。它仅覆盖已声明依赖，不能自动推断所有隐含语义关系。

## 5. 覆盖与最终验收

fidelityAudit分别统计来源映射、逐字匹配、未核实文字、结构文字和未映射文字。零未映射不表示全文事实正确；不要用覆盖率替代语义质量。

`auditProject`一起核验当前源、正文、审阅、规范交付和派生属性。working_draft允许诚实的草稿状态；factual_acceptance还检查来源性质与当前审阅。RC27宿主门将这些结果与真实宿主/人类证据组合报告，不因权限缺口而隐去已经发现的文件问题。

当前工具不自动安装专家、配置权威索引、创建真实宿主会话、提审或发布。旧快照、原件与既有交付保持独立，不以旧回执验收新版本。
