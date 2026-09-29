# 转录版本比较与来源裁决

转录比较回答“哪里不同”，不能单凭相似度回答“哪一版正确”。

比较前必须验证：

- 至少两个不可变 `TranscriptSnapshot`；
- 快照绑定同一 `PageManifest`；
- 页集合与观察顺序可解释；
- 优选版本来自显式选择、唯一 current 标记或唯一较高语义版本；否则保持歧义。

运行时同时报告严格文本相似度、忽略标点后的相似度、数字单位冲突、疑似乱码/OCR碎片和局部差异窗口。所有结论默认 `sourceVerified=false`、`evidenceState=advisory`。

存在实质差异时，`TranscriptAdjudication` 必须逐项绑定来源：候选读法、来源引用、来源读法、胜出候选和依据。缺少来源图像或人工核对时保持 `partial`，不得用“版本较新”“相似度较高”替代来源判断。

来源修正通过 `TranscriptionPatchSet` 绑定页级前像、后像、唯一出现次数和来源锚点。应用仅产生新内存快照；重复应用返回 `already_applied`，不会写文件。
