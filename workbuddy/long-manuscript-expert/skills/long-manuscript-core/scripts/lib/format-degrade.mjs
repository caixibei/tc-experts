/**
 * 交付格式降级规划（26.9.18 吸收自 fbsir-eight-seat-board 的 format-degrade 机制，
 * 按长文档交付面改写）。命名空间统一为 manuscriptos.*。
 *
 * 职责：在声明某格式"已交付"之前，强制要求宿主能力与回读证据同时成立。
 * 包内可自证只有 Markdown 与自包含 HTML；其余格式一律走 CONDITIONAL 分支。
 *
 * 契约：contracts/fallback-matrix.json
 */

const VERIFIED = new Set(['markdown_manuscript', 'markdown_transcript', 'markdown_memo'])
const CONDITIONAL = new Set(['self_contained_html', 'docx', 'pdf', 'pptx', 'xlsx', 'epub', 'bilingual'])

const FALLBACK_ARTIFACT = {
  self_contained_html: 'markdown_source_not_html_preview',
  docx: 'markdown_structure_not_docx',
  pdf: 'markdown_structure_not_pdf',
  pptx: 'page_outline_and_speaker_notes_not_pptx',
  xlsx: 'table_in_markdown_not_xlsx',
  epub: 'markdown_manuscript_not_epub',
  bilingual: 'glossary_draft_not_certified_translation',
}

const fail = (code) => {
  const error = new Error(code)
  error.code = code
  throw error
}

const check = (ok, code) => {
  if (!ok) fail(code)
}

/**
 * @param {object} input
 * @param {string[]} input.requested            请求的交付格式
 * @param {string[]} [input.hostCapabilities]   当前宿主真实可用的渲染能力
 * @param {string[]} [input.readbackVerified]   已完成解析/回读核验的格式
 * @param {string}   [input.primaryFormat]      用户指定的主交付格式
 * @returns {{schema:string, onePrimaryOneCompanion:boolean, claimed:string[], degraded:object[], items:object[], evidenceBoundary:string}}
 */
export function planFormatDelivery(input) {
  check(input && typeof input === 'object' && !Array.isArray(input), 'FORMAT_PLAN_REQUIRED')
  const requested = Array.isArray(input.requested) ? input.requested : []
  const available = new Set(Array.isArray(input.hostCapabilities) ? input.hostCapabilities : [])
  const readback = new Set(Array.isArray(input.readbackVerified) ? input.readbackVerified : [])

  check(requested.length > 0 && requested.length <= 8, 'FORMAT_REQUEST_INVALID')

  const items = []
  for (const format of requested) {
    check(typeof format === 'string', 'FORMAT_NAME_INVALID')

    if (VERIFIED.has(format)) {
      items.push({ format, status: 'verified_local', claimAllowed: true, artifact: artifactNameFor(format) })
      continue
    }

    check(CONDITIONAL.has(format), 'FORMAT_UNKNOWN')

    const hostOk = available.has(format)
    const readOk = readback.has(format)
    if (hostOk && readOk) {
      items.push({ format, status: 'host_verified', claimAllowed: true, artifact: `host:${format}` })
    } else {
      items.push({
        format,
        status: 'degraded',
        claimAllowed: false,
        reason: !hostOk ? 'host_capability_unavailable' : 'readback_unverified',
        fallback: FALLBACK_ARTIFACT[format] || 'markdown_manuscript',
      })
    }
  }

  const claimed = items.filter((item) => item.claimAllowed).map((item) => item.format)
  const degraded = items.filter((item) => !item.claimAllowed)

  // 假成功禁止：任何被声明为可交付的格式都必须有对应证据来源。
  check(
    claimed.every((format) => VERIFIED.has(format) || (available.has(format) && readback.has(format))),
    'FORMAT_FALSE_SUCCESS_FORBIDDEN',
  )

  const primary = typeof input.primaryFormat === 'string' ? input.primaryFormat : null
  if (primary !== null) {
    check(requested.includes(primary), 'FORMAT_PRIMARY_NOT_REQUESTED')
  }

  return {
    schema: 'manuscriptos.format-plan/v1',
    onePrimaryOneCompanion: claimed.length <= 2,
    claimed,
    degraded,
    items,
    evidenceBoundary:
      'host_capability_and_readback_required_before_format_claim_markdown_is_the_only_package_verified_format',
  }
}

function artifactNameFor(format) {
  if (format === 'markdown_manuscript') return 'manuscript.md'
  if (format === 'markdown_transcript') return 'transcript.md'
  return 'memo.md'
}

/** 供 reference 与文档引用：格式 → 降级产物标签 */
export function fallbackArtifactFor(format) {
  return FALLBACK_ARTIFACT[format] || null
}

/** 供 reference 与文档引用：包内可自证格式 */
export function packageVerifiedFormats() {
  return [...VERIFIED]
}

const CASES = [
  { name: 'markdown-only-verified', input: { requested: ['markdown_manuscript'] }, expect: { claimed: ['markdown_manuscript'], degraded: 0 } },
  { name: 'docx-without-host-degrades', input: { requested: ['docx'] }, expect: { claimed: [], degraded: 1 } },
  { name: 'docx-host-but-no-readback-degrades', input: { requested: ['docx'], hostCapabilities: ['docx'] }, expect: { claimed: [], degraded: 1 } },
  { name: 'docx-host-and-readback-claims', input: { requested: ['docx'], hostCapabilities: ['docx'], readbackVerified: ['docx'] }, expect: { claimed: ['docx'], degraded: 0 } },
  { name: 'unknown-format-throws', input: { requested: ['quarto'] }, expectError: 'FORMAT_UNKNOWN' },
  { name: 'empty-request-throws', input: { requested: [] }, expectError: 'FORMAT_REQUEST_INVALID' },
  { name: 'primary-not-requested-throws', input: { requested: ['markdown_manuscript'], primaryFormat: 'docx' }, expectError: 'FORMAT_PRIMARY_NOT_REQUESTED' },
  { name: 'one-primary-one-companion', input: { requested: ['markdown_manuscript', 'self_contained_html'], hostCapabilities: ['self_contained_html'], readbackVerified: ['self_contained_html'] }, expect: { claimed: 2 } },
]

export function selfTest() {
  const results = []
  for (const testCase of CASES) {
    try {
      const result = planFormatDelivery(testCase.input)
      if (testCase.expectError) {
        results.push({ caseId: testCase.name, passed: false, detail: 'expected_error_not_thrown' })
        continue
      }
      const ok = Object.entries(testCase.expect).every(([key, value]) => {
        const actual = result[key]
        return typeof value === 'number' ? (Array.isArray(actual) ? actual.length : actual) === value : JSON.stringify(actual) === JSON.stringify(value)
      })
      results.push({ caseId: testCase.name, passed: ok })
    } catch (error) {
      const ok = testCase.expectError === error.code
      results.push({ caseId: testCase.name, passed: ok, detail: ok ? undefined : `got ${error.code}` })
    }
  }
  return {
    schema: 'manuscriptos.format-degrade-self-test/v1',
    ok: results.every((item) => item.passed),
    passed: results.filter((item) => item.passed).length,
    total: results.length,
    results,
    evidenceBoundary: 'pure_in_memory_contract_cases_only_no_host_capability_or_rendering_proof',
  }
}

if (process.argv[1] && process.argv[1].endsWith('format-degrade.mjs')) {
  process.stdout.write(`${JSON.stringify(selfTest(), null, 2)}\n`)
}
