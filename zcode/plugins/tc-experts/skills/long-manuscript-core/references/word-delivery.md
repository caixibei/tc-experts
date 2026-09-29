# 可编辑 Word 交付

当用户需要 Word 成果且当前项目文件已实际读取，可用统一 `exportDocument` 入口，在原输入中增加 `formats:["markdown","html","docx"]`。返回的 `openPath` 指向可编辑预览副本；规范交付留在 deliveries 内，并由 manifest 逐文件记录字节和摘要。默认不传 formats 时仍生成原有 Markdown、HTML、resume.json 三件套。

当前新建支持普通段落、一级和二级标题、显式粗体与斜体。Markdown软换行按段内空格处理，一级二级标题会识别相邻正文；复杂表格、代码围栏、图片导入以及三级以上标题不在此转换范围，返回具体未支持原因。不能静默转成不满足用户要求的格式后宣称交付完成。不同格式选择和生成器依赖字节均进入交付身份。

已有DOCX的局部修改用 `expert-tools.mjs docxEdit`，或使用包内 Python 标准库工具 `docx-edit.py`。`--example docxEdit` 给出只读检查输入。检查可用后，编辑输入为：

```json
{
  "operation": "edit",
  "root": "/replace-with-authorized-project",
  "source": "input.docx",
  "expectedSourceSha256": "replace-with-the-actual-64-character-sha256",
  "output": "revised.docx",
  "edits": [{"textAnchor": "原文字串", "replacement": "替换文字", "paragraphAnchor": "包含原文字串的完整段落", "reason": "为什么改这一处"}]
}
```

**`reason` 自 26.9.18 起为必填且不得为空白。** 缺失返回 `docx_edit_invalid`，空白返回 `docx_edit_reason_required`。理由是改稿必须留痕：回执的 `edits[]` 逐条记录 `reason`，使每处改动都能回答“为什么改”。`paragraphAnchor` 仍为可选。

output必须是新的项目内路径。原件不覆盖，目标锚点必须唯一；带字段、公式、修订、图形或其他复杂结构的目标被拒绝。

**写入原子性（26.9.18）**：产出先写入同目录暂存文件并 `fsync`，再做字节回读断言，最后用同目录 `os.replace` 原子提交。崩溃只会留下暂存文件（前缀 `.fbs-docx-`），不会在目标路径留下半截的 DOCX。

> 设计说明：曾尝试用 `os.link` 做原子提交以同时获得“不覆盖”与“崩溃原子性”，实测后撤回——本平台在删除暂存名后 `st_nlink` 仍为 2，而 `child_path()` 对源文件强制要求 `st_nlink == 1`，硬链接会让产出的 DOCX 反过来无法被本包自己的 `inspect` / `edit` 读取。当前实现改为“先确认目标不存在，再原子替换”，保留 `docx_output_exists` 语义；并发写同一输出路径不在本产品支持范围内（单一写作负责人）。

**写入安全限额**（`archive_parts()` 内联实现，无独立模块）：归档 ≤32 MB、解压后 ≤64 MB、单成员 XML ≤16 MB、条目数 ≤3000、拒绝加密成员、拒绝路径穿越、拒绝非常规压缩方法、拒绝异常压缩比（防 zip 炸弹）、拒绝符号链接与 Windows 重解析点、写入前后比对源文件身份。

**自检**：`python scripts/docx-edit-self-test.py` 执行 16 项端到端用例（检查、成功改稿、锚点唯一性、不覆盖、陈旧源拒绝、路径逃逸拒绝、reason 缺失/空白拒绝、reason 留痕、产出可再作源、链接数不变量、无暂存残留）。自检通过只证明合同行为，不证明版式或文字质量。非目标页眉、页脚、图片及其他受支持被动部件保留其解压后字节。工具对可执行、外部关系或未知类型会失败关闭，不承诺处理所有Word文档。Python缺失时说明该可选能力不可用，继续提供可编辑正文，不要求安装常驻服务。

该工具的源保护及字节回读不判断文字是否真实、是否属于作者声音，也不证明当前文件已在宿主或Word界面打开。每次实际交付仍需检查打开结果和页面；若当前任务没有渲染证据，应保留版式待验证。新版本开发样例在隔离LibreOffice中完成过读取、修改、保存、重开和逐页检查，这不替代用户当前文件的验收，也不宣称Microsoft Word或WorkBuddy当前会话已实测。

预览修改不改变规范交付；要将修改后的文件作为新成果，明确采用新版本并重新生成回执。`verifyDelivery` 做两次物理读取核验交付组，之后发生的新改动仍需重新核验。旧v2交付清单可以继续读取，新Word集合使用v3清单，不要求迁移旧项目。
