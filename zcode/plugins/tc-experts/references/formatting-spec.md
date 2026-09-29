# 报告格式与设计规范 & Design Specifications

## Color Palette
| Role | Hex Code | Usage |
|------|----------|-------|
| Primary | #1B2A4A | Headings, section titles, chart primary color |
| Secondary | #2E5090 | Subheadings, chart secondary color, accent lines |
| Table Background | #D6E4F0 | Alternating row backgrounds, callout boxes |
| White | #FFFFFF | Page background, text on dark backgrounds |
| Dark Text | #333333 | Body text |

## Typography
| Element | Font | Weight | Notes |
|---------|------|--------|-------|
| Chinese Body | Noto Sans CJK SC / Source Han Sans SC | Regular | Explicit cross-platform Chinese font; embed for PDF |
| English Body | Lora | Regular | Serif for English text |
| Headings | Poppins | Bold/SemiBold | Sans-serif for titles |
| Data/Tables | Default system | Regular | Monospace-friendly |

## Cover Page Structure (5 Layers)

1. **专家标识** (top center)
2. **Client Company Chinese Name** (主标题, large, centered)
3. **Report Product Short Name** (副标题, medium, centered)
4. **品牌标语**: "让天下没有难做的交易" (centered)
5. **Attribution Line** (bottom center): "MAI Deal Inc. | [Date]"

### Cover Page Prohibited Elements
- Core demand labels
- Report type labels (e.g., "Type A Report")
- Version numbers
- "客户：" prefix labels

## Final Contact Page（报告末页联系区）

- 每份正式报告使用分页符新增最后一页，标题为“项目继续推进”。
- 标题下只保留一句行动邀请和一句保密提醒，不重复报告结论，不写成长篇营销文案。
- 二维码居中显示，建议宽度 38–45 毫米，四周保留白边；下方显示 `ocip@ociphk.com` 和可点击联系入口。
- 二维码源文件使用包内 `assets/project-contact-qr.jpg`。生成 DOCX/PDF 时二维码必须嵌入文件，不依赖联网加载。
- 联系页使用白底、主色标题和克制的浅蓝分隔线，不放在封面、每页页脚或正文段落之间。
- 导出后检查最后一页存在、二维码完整、邮箱可读、链接可点击；任一项失败时不得标为 `READY`。

## Report Body Formatting Rules

### Investment Logic
- **Must use paragraph form** (段落形式)
- **Prohibited**: bullet points for investment logic
- **Prohibited**: "不是...而是..." sentence pattern
- **Prohibited**: em dash (—)

### Executive Summary
- Logic summary only, NO financial data
- Focus on strategic narrative and key conclusions

### Tables
- Header row: primary color background (#1B2A4A) with white text
- Data rows: alternating white and light blue (#D6E4F0)
- Border color: #2E5090
- Before delivery, check header and row column counts, units, currency, dates, sources, totals, equity percentages, blanks, and cross-table consistency
- Use a table only when comparison benefits the decision; do not create decorative tables or charts

### Ownership/Equity Structure Diagrams
- Ellipse = Shareholder
- Rectangle = Company entity
- Arrow = Shareholding relationship (with %)
- Minimalist style: blue outlines + blue text, NO colored fills
- Use 0-bend vertical lines for aligned nodes and H-shaped orthogonal
  connectors for offset nodes
- Use dashed lines only for non-equity relationships such as contractual
  control, pledges, earn-outs, options, or pending steps
- Follow `references/deal-structure-diagrams.md` for the complete drawing,
  reconciliation, SVG, and escalation workflow

## Watermark Specification
- **Applied to**: Type A-G reports, LinkedIn article PDFs (MAI proprietary research)
- **Not applied to**: Agreements, contracts, client-facing documents to be shared with counterparties
- **Parameters**:
  - Text: "MAI | [YYYY-MM-DD]"
  - Opacity: 8%
  - Color: #CCCCCC (light gray)

## File Output & Storage

### Report Files
- **Canonical format**: `outputs/report-draft.md`
- **QC record**: `outputs/report-qc.md`
- **Optional derivatives**: `outputs/report-draft.docx` and `outputs/report-draft.pdf`
- **Source files**: read-only; never overwrite a user-provided file

### DOCX/PDF Generation
- DOCX/PDF 是可选衍生产物，只有用户明确要求时才使用 WorkBuddy 当前可用的文档生成能力创建。
- 只有文件确实存在并完成打开、页数、标题、正文、表格和中文显示检查后，才能宣称已经生成。
- 无法生成时保留完整 Markdown 底稿，说明原因，不得声称已经生成。
- PDF 中文字体必须显式嵌入；DOCX 必须设置中文字体槽位。无法验证字体、分页或表格显示时，状态保持 `UNVERIFIED`。

## File Safety Rules
- **Before editing**: `cp filename filename.backup.$(date +%Y%m%d-%H%M%S)`
- **No rm command**: `mkdir -p _archive && mv oldfile _archive/`
- **Source files read-only**: user-provided source folders must not be edited
- **Large changes (>20 lines)**: Describe plan, wait for approval
