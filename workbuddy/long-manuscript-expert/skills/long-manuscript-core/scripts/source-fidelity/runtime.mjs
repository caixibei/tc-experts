import {
  PACKAGE_TEXT_DIGEST_ALGORITHM,
  sha256,
  stableJson,
  unique,
} from '../lib/kernel-utils.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const ORIENTATIONS = new Set([0, 90, 180, 270]);
const LAYERS = new Set(['ocr_raw', 'reviewed', 'delivery']);
const REVIEW_STATES = new Set(['ocr_extracted_unreviewed', 'reviewed', 'source_verified']);
const PAGE_BASES = new Set(['explicit', 'page_header', 'file_sequence', 'inferred_offset']);
const SAMPLE_CATEGORIES = new Set(['sparse', 'dense', 'layout_risk', 'cross_page_boundary']);
const ISSUE_CATEGORIES = new Set(['definite_encoding_error', 'probable_ocr_fragment', 'rare_term_candidate', 'source_print_variant', 'numeric_unit_conflict', 'source_conflict', 'cross_page_boundary']);
const ISSUE_STATES = new Set(['open', 'resolved', 'waived']);
const GATE_STATUSES = new Set(['passed', 'failed', 'human_review_pending']);
const RISK_SCORE = { none: 4, low: 3, medium: 1, high: 0, unknown: 0 };
const SOURCE_TYPE_SCORE = { single_page: 2, pdf_page: 1, spread: 0, other: 0 };

export const DEFAULT_OCR_FRAGMENTS = Object.freeze(['亻旦', '纟田', '另刂', '原贝刂', '分另刂', '孑L', '丿L']);
export const SOURCE_FIDELITY_GATE_IDS = Object.freeze(['page-sequence.integrity', 'transcription.fidelity', 'ocr-artifact.suspect']);
export const SOURCE_FIDELITY_IMPLEMENTATION_DIGEST_ALGORITHM = PACKAGE_TEXT_DIGEST_ALGORITHM;
export const SOURCE_FIDELITY_RUNTIME_POLICY = Object.freeze({
  schemaVersion: '1.0.0',
  runtimeSelfContained: true,
  connectorRequired: false,
  donorRuntimeRequired: false,
  actualOcrExecutionAllowed: false,
  fileReadAllowed: false,
  fileWriteAllowed: false,
  hostMutationAllowed: false,
  externalActionCount: 0,
});

const exactCount = (text, token) => token ? String(text).split(String(token)).length - 1 : 0;
const digestObject = (value, digestKey) => {
  const copy = structuredClone(value);
  delete copy[digestKey];
  return sha256(stableJson(copy));
};
const validateDigest = (value, digestKey) => HASH.test(String(value?.[digestKey] ?? '')) && value[digestKey] === digestObject(value, digestKey);
const expectedPageList = ({ start, end } = {}) => Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start
  ? Array.from({ length: end - start + 1 }, (_, index) => start + index)
  : [];
const strictlyIncreasing = (values) => values.every((value, index) => index === 0 || value > values[index - 1]);
const sourceScore = (source) => (SOURCE_TYPE_SCORE[source.sourceType] ?? 0)
  + (RISK_SCORE[source.quality?.blur] ?? 0)
  + (RISK_SCORE[source.quality?.cropRisk] ?? 0)
  + (RISK_SCORE[source.quality?.gutterRisk] ?? 0);
const normalizeStrict = (text) => String(text ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
const normalizeLoose = (text) => normalizeStrict(text).replace(/[\p{P}\p{S}\s]+/gu, '');
const numberTokens = (text) => unique(String(text ?? '').match(/\d+(?:\.\d+)?(?:年|月|日|页|尺|米|厘米|毫米|公斤|克|%|％)?/gu) ?? []);
const bigrams = (text) => text.length < 2 ? [text] : Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2));
const diceSimilarity = (left, right) => {
  if (left === right) return 1;
  if (!left || !right) return 0;
  const counts = new Map();
  for (const gram of bigrams(left)) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  let intersection = 0;
  const rightGrams = bigrams(right);
  for (const gram of rightGrams) {
    const count = counts.get(gram) ?? 0;
    if (count > 0) { intersection += 1; counts.set(gram, count - 1); }
  }
  return (2 * intersection) / (bigrams(left).length + rightGrams.length);
};
const boundedDifference = (left, right, radius = 80) => {
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix += 1;
  return {
    left: left.slice(Math.max(0, prefix - radius), Math.min(left.length, left.length - suffix + radius)),
    right: right.slice(Math.max(0, prefix - radius), Math.min(right.length, right.length - suffix + radius)),
    prefixLength: prefix,
    suffixLength: suffix,
  };
};
const parseSemver = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(String(value ?? ''));
  return match ? match.slice(1, 4).map(Number) : null;
};
const compareSemver = (left, right) => left.reduce((result, value, index) => result || value - right[index], 0);

export function buildPageManifest({ sources = [], expectedPages } = {}) {
  const expected = expectedPageList(expectedPages);
  const issues = [];
  if (!expected.length) issues.push('expected_page_range_invalid');
  const normalized = sources.map((source, index) => {
    const pageBasis = PAGE_BASES.has(source.pageBasis) ? source.pageBasis : 'explicit';
    const pageIdentityConfirmed = source.pageIdentityConfirmed === true
      || (source.pageIdentityConfirmed !== false && ['explicit', 'page_header'].includes(pageBasis));
    return {
      id: String(source.id ?? `source-${index + 1}`),
      sourceRef: String(source.sourceRef ?? source.path ?? ''),
      page: Number(source.page),
      sequence: Number.isInteger(source.sequence) ? source.sequence : null,
      declaredByteLength: Number.isInteger(source.declaredByteLength ?? source.byteLength) && Number(source.declaredByteLength ?? source.byteLength) >= 0 ? Number(source.declaredByteLength ?? source.byteLength) : 0,
      suppliedSha256: String(source.suppliedSha256 ?? source.sha256 ?? ''),
      sourceType: ['single_page', 'spread', 'pdf_page', 'other'].includes(source.sourceType) ? source.sourceType : 'other',
      orientation: Number(source.orientation ?? 0),
      pageBasis,
      pageIdentityConfirmed,
      quality: { blur: source.quality?.blur ?? 'unknown', cropRisk: source.quality?.cropRisk ?? 'unknown', gutterRisk: source.quality?.gutterRisk ?? 'unknown' },
      requestedPrimary: source.primary === true,
      inputIndex: index,
    };
  });
  for (const source of normalized) {
    if (!source.id || !source.sourceRef) issues.push(`${source.id || 'unknown'}:source_identity_missing`);
    if (!Number.isInteger(source.page) || source.page < 1) issues.push(`${source.id}:page_invalid`);
    if (!HASH.test(source.suppliedSha256)) issues.push(`${source.id}:sha256_invalid`);
    if (!ORIENTATIONS.has(source.orientation)) issues.push(`${source.id}:orientation_invalid`);
    if (!source.pageIdentityConfirmed) issues.push(`${source.id}:page_identity_unconfirmed`);
  }
  const uniquePages = unique(normalized.map((item) => item.page).filter(Number.isInteger)).map(Number).sort((left, right) => left - right);
  const missingPages = expected.filter((page) => !uniquePages.includes(page));
  const outOfRangePages = uniquePages.filter((page) => !expected.includes(page));
  const pages = [];
  const duplicatePages = [];
  for (const page of uniquePages) {
    const pageSources = normalized.filter((source) => source.page === page);
    const explicit = pageSources.filter((source) => source.requestedPrimary);
    let primary = null;
    if (explicit.length === 1) primary = explicit[0];
    else if (explicit.length > 1) {
      duplicatePages.push(page);
      issues.push(`page_${page}:multiple_explicit_primary_sources`);
    } else {
      const ranked = pageSources.map((source) => ({ source, score: sourceScore(source) })).sort((left, right) => right.score - left.score || left.source.id.localeCompare(right.source.id, 'en'));
      if (ranked.length && (ranked.length === 1 || ranked[0].score > ranked[1].score)) primary = ranked[0].source;
      else {
        duplicatePages.push(page);
        issues.push(`page_${page}:primary_source_ambiguous`);
      }
    }
    pages.push({
      page,
      primarySourceId: primary?.id ?? null,
      sources: pageSources.map((source) => ({
        id: source.id,
        sourceRef: source.sourceRef,
        sequence: source.sequence,
        declaredByteLength: source.declaredByteLength,
        suppliedSha256: source.suppliedSha256,
        sourceType: source.sourceType,
        orientation: source.orientation,
        pageBasis: source.pageBasis,
        pageIdentityConfirmed: source.pageIdentityConfirmed,
        quality: source.quality,
        primary: source.id === primary?.id,
        bindingEvidence: 'digest_supplied_not_observed',
      })).sort((left, right) => left.id.localeCompare(right.id, 'en')),
      orderKey: primary?.sequence ?? primary?.inputIndex ?? Number.MAX_SAFE_INTEGER,
    });
  }
  const orderKeyCounts = new Map();
  for (const page of pages) orderKeyCounts.set(page.orderKey, (orderKeyCounts.get(page.orderKey) ?? 0) + 1);
  if ([...orderKeyCounts.values()].some((count) => count > 1)) issues.push('source_sequence_duplicate');
  const observedPages = pages.slice().sort((left, right) => left.orderKey - right.orderKey || left.page - right.page).map((item) => item.page);
  for (const page of pages) delete page.orderKey;
  if (missingPages.length) issues.push('page_coverage_missing');
  if (outOfRangePages.length) issues.push('page_out_of_range');
  const monotonic = observedPages.length > 0 && strictlyIncreasing(observedPages);
  if (!monotonic) issues.push('page_order_not_monotonic');
  const status = issues.some((issue) => issue.includes('ambiguous') || issue.includes('multiple_explicit')) ? 'conflict' : issues.length ? 'needs_input' : 'ready';
  const manifest = {
    schemaVersion: '1.0.0',
    artifactType: 'manuscriptos_page_manifest',
    expectedPages: { start: expectedPages?.start ?? null, end: expectedPages?.end ?? null },
    pages,
    coverage: { expectedCount: expected.length, presentCount: uniquePages.filter((page) => expected.includes(page)).length, missingPages, duplicatePages: unique(duplicatePages).map(Number), outOfRangePages },
    ordering: { observedPages, monotonic },
    evidenceClass: 'descriptor_and_digest_supplied_not_source_bytes_observed',
    hostMutationAllowed: false,
    status,
    issues: unique(issues),
  };
  return { ...manifest, manifestDigest: digestObject(manifest, 'manifestDigest') };
}

export function validatePageManifest(manifest) {
  const issues = [];
  if (manifest?.schemaVersion !== '1.0.0' || manifest?.artifactType !== 'manuscriptos_page_manifest' || manifest?.hostMutationAllowed !== false) issues.push('manifest_identity_invalid');
  if (!validateDigest(manifest ?? {}, 'manifestDigest')) issues.push('manifest_digest_mismatch');
  const expected = expectedPageList(manifest?.expectedPages);
  const pages = Array.isArray(manifest?.pages) ? manifest.pages : [];
  const pageNumbers = pages.map((item) => item.page);
  if (!expected.length) issues.push('manifest_expected_range_invalid');
  if (new Set(pageNumbers).size !== pageNumbers.length || pageNumbers.some((page) => !Number.isInteger(page))) issues.push('manifest_page_identity_invalid');
  if (stableJson(pageNumbers.slice().sort((left, right) => left - right)) !== stableJson(expected)) issues.push('manifest_page_set_invalid');
  if (manifest?.status !== 'ready' || (manifest?.issues ?? []).length) issues.push('manifest_not_ready');
  if (manifest?.ordering?.monotonic !== true || stableJson(manifest?.ordering?.observedPages ?? []) !== stableJson(expected)) issues.push('manifest_order_invalid');
  for (const page of pages) {
    const sources = Array.isArray(page.sources) ? page.sources : [];
    const primary = sources.filter((source) => source.primary === true);
    if (primary.length !== 1 || page.primarySourceId !== primary[0]?.id) issues.push(`page_${page.page}:primary_source_invalid`);
    if (!primary[0]?.pageIdentityConfirmed || !ORIENTATIONS.has(primary[0]?.orientation) || !HASH.test(String(primary[0]?.suppliedSha256 ?? '')) || primary[0]?.bindingEvidence !== 'digest_supplied_not_observed') issues.push(`page_${page.page}:primary_source_binding_invalid`);
  }
  return { ok: issues.length === 0, issues: unique(issues) };
}

export function createOcrObservation({
  observationId,
  page,
  engine = { name: 'supplied-observation' },
  sourceId,
  sourceSha256,
  orientation = 0,
  preprocessingProfile = 'none',
  rawText = '',
  lines = null,
  errors = [],
  observedAt = null,
} = {}) {
  if (!observationId || !Number.isInteger(Number(page)) || Number(page) < 1) throw new Error('ocr_observation_identity_invalid');
  if (!engine?.name || !sourceId || !HASH.test(String(sourceSha256 ?? '')) || !ORIENTATIONS.has(Number(orientation))) throw new Error('ocr_source_binding_invalid');
  const text = String(rawText ?? '');
  const normalizedLines = (lines ?? text.replace(/\r\n?/gu, '\n').split('\n').map((line, index) => ({ index: index + 1, text: line, bbox: null }))).map((line, index) => ({
    index: Number.isInteger(line.index) && line.index > 0 ? line.index : index + 1,
    text: String(line.text ?? ''),
    bbox: Array.isArray(line.bbox) && line.bbox.length === 4 && line.bbox.every((value) => Number.isFinite(value) && value >= 0) ? line.bbox.map(Number) : null,
  }));
  if (new Set(normalizedLines.map((line) => line.index)).size !== normalizedLines.length || normalizedLines.map((line) => line.text).join('\n') !== text.replace(/\r\n?/gu, '\n')) throw new Error('ocr_line_binding_invalid');
  const observation = {
    schemaVersion: '1.0.0',
    artifactType: 'manuscriptos_ocr_observation',
    observationId: String(observationId),
    page: Number(page),
    immutable: true,
    executionBoundary: 'supplied_text_only',
    engine: { name: String(engine.name), version: engine.version == null ? null : String(engine.version), host: null },
    input: { sourceId: String(sourceId), sourceSha256: String(sourceSha256), orientation: Number(orientation), preprocessingProfile: String(preprocessingProfile || 'none') },
    output: { rawText: text, rawTextSha256: sha256(text), lines: normalizedLines, errors: unique(errors.map(String)) },
    ocrExecutionPerformed: false,
    hostMutationAllowed: false,
    externalActionCount: 0,
    networkUsed: false,
    observedAt: observedAt == null ? null : String(observedAt),
  };
  return { ...observation, observationDigest: digestObject(observation, 'observationDigest') };
}

export function validateOcrObservation(observation) {
  const issues = [];
  if (observation?.schemaVersion !== '1.0.0' || observation?.artifactType !== 'manuscriptos_ocr_observation' || observation?.immutable !== true) issues.push('ocr_observation_identity_invalid');
  if (!validateDigest(observation ?? {}, 'observationDigest')) issues.push('ocr_observation_digest_mismatch');
  if (observation?.output?.rawTextSha256 !== sha256(String(observation?.output?.rawText ?? ''))) issues.push('ocr_raw_text_digest_mismatch');
  if (new Set((observation?.output?.lines ?? []).map((line) => line.index)).size !== (observation?.output?.lines ?? []).length || (observation?.output?.lines ?? []).map((line) => line.text).join('\n') !== String(observation?.output?.rawText ?? '').replace(/\r\n?/gu, '\n')) issues.push('ocr_line_binding_invalid');
  if (observation?.executionBoundary !== 'supplied_text_only' || observation?.ocrExecutionPerformed !== false || observation?.hostMutationAllowed !== false || observation?.externalActionCount !== 0 || observation?.networkUsed !== false) issues.push('ocr_observation_boundary_invalid');
  if (!HASH.test(String(observation?.input?.sourceSha256 ?? '')) || !ORIENTATIONS.has(observation?.input?.orientation)) issues.push('ocr_source_binding_invalid');
  return { ok: issues.length === 0, issues: unique(issues) };
}

export function createTranscriptSnapshot({
  snapshotId,
  layer = 'ocr_raw',
  sourceManifestDigest,
  binding = {},
  ocrObservationDigests = [],
  supersedesSnapshotIds = [],
  pages = [],
  observedAt = null,
} = {}) {
  if (!snapshotId || !HASH.test(String(sourceManifestDigest ?? '')) || !LAYERS.has(layer)) throw new Error('snapshot_identity_invalid');
  if (ocrObservationDigests.some((digest) => !HASH.test(String(digest)))) throw new Error('ocr_observation_digest_invalid');
  const pageNumbers = pages.map((item) => Number(item.page));
  if (!pages.length || new Set(pageNumbers).size !== pageNumbers.length || pageNumbers.some((page) => !Number.isInteger(page) || page < 1)) throw new Error('snapshot_pages_invalid');
  const normalizedPages = pages.map((item) => {
    const text = String(item.text ?? '');
    const reviewState = item.reviewState ?? (layer === 'ocr_raw' ? 'ocr_extracted_unreviewed' : layer === 'delivery' ? 'source_verified' : 'reviewed');
    if (!REVIEW_STATES.has(reviewState)) throw new Error('snapshot_review_state_invalid');
    return {
      page: Number(item.page),
      text,
      textSha256: sha256(text),
      reviewState,
      boundary: {
        linePolicy: ['preserve_source_lines', 'paragraphized', 'unknown'].includes(item.boundary?.linePolicy) ? item.boundary.linePolicy : 'unknown',
        continuesFromPrevious: item.boundary?.continuesFromPrevious === true,
        continuesToNext: item.boundary?.continuesToNext === true,
        continuationToken: item.boundary?.continuationToken == null ? null : String(item.boundary.continuationToken),
      },
    };
  }).sort((left, right) => left.page - right.page);
  const joined = normalizedPages.map((item) => `## 第${item.page}页\n${item.text}`).join('\n');
  const snapshot = {
    schemaVersion: '1.0.0',
    artifactType: 'manuscriptos_transcript_snapshot',
    snapshotId: String(snapshotId),
    layer,
    immutable: true,
    sourceManifestDigest: String(sourceManifestDigest),
    binding: {
      ref: binding.ref == null ? null : String(binding.ref),
      declaredByteLength: Number.isInteger(binding.declaredByteLength ?? binding.byteLength) ? Number(binding.declaredByteLength ?? binding.byteLength) : Buffer.byteLength(joined, 'utf8'),
      suppliedSha256: HASH.test(String(binding.suppliedSha256 ?? binding.sha256 ?? '')) ? String(binding.suppliedSha256 ?? binding.sha256) : sha256(joined),
      evidenceClass: binding.evidenceClass ?? 'in_memory_content_observed',
      version: binding.version == null ? null : String(binding.version),
      current: binding.current === true,
    },
    ocrObservationDigests: unique(ocrObservationDigests.map(String)).sort(),
    supersedesSnapshotIds: unique(supersedesSnapshotIds.map(String)).sort(),
    observedPageOrder: pageNumbers,
    pages: normalizedPages,
    hostMutationAllowed: false,
    observedAt: observedAt == null ? null : String(observedAt),
  };
  return { ...snapshot, snapshotDigest: digestObject(snapshot, 'snapshotDigest') };
}

export function validateTranscriptSnapshot(snapshot) {
  const issues = [];
  if (snapshot?.schemaVersion !== '1.0.0' || snapshot?.artifactType !== 'manuscriptos_transcript_snapshot' || snapshot?.immutable !== true || snapshot?.hostMutationAllowed !== false || !LAYERS.has(snapshot?.layer)) issues.push('snapshot_identity_invalid');
  if (!validateDigest(snapshot ?? {}, 'snapshotDigest')) issues.push('snapshot_digest_mismatch');
  if (!HASH.test(String(snapshot?.sourceManifestDigest ?? '')) || !HASH.test(String(snapshot?.binding?.suppliedSha256 ?? ''))) issues.push('snapshot_binding_invalid');
  const pages = Array.isArray(snapshot?.pages) ? snapshot.pages : [];
  const pageNumbers = pages.map((item) => item.page);
  if (!pages.length || new Set(pageNumbers).size !== pageNumbers.length || !strictlyIncreasing(pageNumbers)) issues.push('snapshot_page_order_invalid');
  const observedPageOrder = snapshot?.observedPageOrder ?? [];
  if (new Set(observedPageOrder).size !== observedPageOrder.length || stableJson(observedPageOrder.slice().sort((left, right) => left - right)) !== stableJson(pageNumbers)) issues.push('snapshot_observed_page_order_invalid');
  for (const page of pages) if (!Number.isInteger(page.page) || page.page < 1 || page.textSha256 !== sha256(String(page.text ?? '')) || !REVIEW_STATES.has(page.reviewState)) issues.push(`page_${page.page}:snapshot_page_invalid`);
  if ((snapshot?.ocrObservationDigests ?? []).some((digest) => !HASH.test(String(digest)))) issues.push('snapshot_ocr_observation_binding_invalid');
  return { ok: issues.length === 0, issues: unique(issues) };
}

export function createSampleValidation({ manifest = null, manifestDigest = null, requiredCategories = ['sparse', 'dense', 'layout_risk'], samples = [] } = {}) {
  const digest = String(manifest?.manifestDigest ?? manifestDigest ?? '');
  if (!HASH.test(digest) || unique(requiredCategories).length < 3 || requiredCategories.some((category) => !SAMPLE_CATEGORIES.has(category))) throw new Error('sample_validation_identity_invalid');
  const manifestPages = new Set((manifest?.pages ?? []).map((item) => item.page));
  const normalized = samples.map((sample) => ({
    page: Number(sample.page),
    category: sample.category,
    sourceRef: String(sample.sourceRef ?? ''),
    snapshotDigest: String(sample.snapshotDigest ?? ''),
    reviewedAgainstSource: sample.reviewedAgainstSource === true,
    reviewerEvidenceClass: sample.reviewerEvidenceClass ?? 'human_attestation_supplied',
    issues: unique((sample.issues ?? []).map(String)),
  })).sort((left, right) => left.page - right.page || left.category.localeCompare(right.category, 'en'));
  const issues = [];
  for (const sample of normalized) {
    if (!Number.isInteger(sample.page) || sample.page < 1 || (manifestPages.size && !manifestPages.has(sample.page))) issues.push(`page_${sample.page}:sample_page_invalid`);
    if (!SAMPLE_CATEGORIES.has(sample.category) || !sample.sourceRef || !HASH.test(sample.snapshotDigest)) issues.push(`page_${sample.page}:sample_binding_invalid`);
    if (!sample.reviewedAgainstSource || sample.reviewerEvidenceClass !== 'human_attestation_supplied' || sample.issues.length) issues.push(`page_${sample.page}:sample_not_accepted`);
  }
  const missingCategories = unique(requiredCategories).filter((category) => !normalized.some((sample) => sample.category === category && sample.reviewedAgainstSource && sample.issues.length === 0));
  if (missingCategories.length) issues.push('representative_category_missing');
  const result = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_transcription_sample_validation', manifestDigest: digest,
    requiredCategories: unique(requiredCategories), samples: normalized, missingCategories,
    hostMutationAllowed: false, status: issues.length ? 'needs_input' : 'ready', issues: unique(issues),
  };
  return { ...result, validationDigest: digestObject(result, 'validationDigest') };
}

export function validateSampleValidation(validation) {
  const issues = [];
  if (validation?.schemaVersion !== '1.0.0' || validation?.artifactType !== 'manuscriptos_transcription_sample_validation' || validation?.hostMutationAllowed !== false) issues.push('sample_validation_identity_invalid');
  if (!validateDigest(validation ?? {}, 'validationDigest')) issues.push('sample_validation_digest_mismatch');
  if (validation?.status !== 'ready' || (validation?.missingCategories ?? []).length || (validation?.issues ?? []).length) issues.push('sample_validation_not_ready');
  return { ok: issues.length === 0, issues: unique(issues) };
}

export function resolvePreferredCandidate(snapshots = [], selectedId = null) {
  if (selectedId) return snapshots.some((item) => item.snapshotId === selectedId)
    ? { preferredId: selectedId, source: 'explicit', issues: [] }
    : { preferredId: null, source: 'explicit', issues: ['explicit_candidate_missing'] };
  const current = snapshots.filter((item) => item.binding.current === true);
  if (current.length === 1) return { preferredId: current[0].snapshotId, source: 'manifest_current', issues: [] };
  if (current.length > 1) return { preferredId: null, source: 'manifest_current', issues: ['multiple_current_candidates'] };
  const versions = snapshots.map((item) => ({ id: item.snapshotId, parsed: parseSemver(item.binding.version) })).filter((item) => item.parsed);
  if (versions.length) {
    const sorted = versions.slice().sort((left, right) => compareSemver(right.parsed, left.parsed));
    if (sorted.length === 1 || compareSemver(sorted[0].parsed, sorted[1].parsed) !== 0) return { preferredId: sorted[0].id, source: 'semantic_version', issues: [] };
    return { preferredId: null, source: 'semantic_version', issues: ['candidate_version_tie'] };
  }
  return { preferredId: null, source: 'unresolved', issues: ['candidate_selection_ambiguous'] };
}

export function scanTranscriptText(text, { probableFragments = DEFAULT_OCR_FRAGMENTS, rareTermWhitelist = [] } = {}) {
  const value = String(text ?? '');
  const quoteCounts = { leftChinese: exactCount(value, '“'), rightChinese: exactCount(value, '”'), asciiDouble: exactCount(value, '"'), leftSingle: exactCount(value, '‘'), rightSingle: exactCount(value, '’') };
  return {
    definiteEncodingErrors: [...(value.includes('\uFFFD') ? ['U+FFFD'] : []), ...(value.includes('\u0000') ? ['NUL'] : [])],
    probableOcrFragments: probableFragments.filter((token) => value.includes(token)),
    protectedRareTerms: rareTermWhitelist.filter((token) => value.includes(token)),
    numericTokens: numberTokens(value),
    quoteCounts,
    quoteIssues: [...(quoteCounts.leftChinese !== quoteCounts.rightChinese ? ['chinese_double_quote_unbalanced'] : []), ...(quoteCounts.leftSingle !== quoteCounts.rightSingle ? ['chinese_single_quote_unbalanced'] : []), ...(quoteCounts.asciiDouble % 2 !== 0 ? ['ascii_double_quote_unbalanced'] : [])],
  };
}

export function compareTranscriptSnapshots({ snapshots = [], selectedId = null, expectedPages = null, probableFragments = DEFAULT_OCR_FRAGMENTS, rareTermWhitelist = [] } = {}) {
  if (snapshots.length < 2) throw new Error('two_candidates_required');
  const expected = expectedPages === null ? [] : expectedPageList(expectedPages);
  if (expectedPages !== null && !expected.length) throw new Error('expected_page_range_invalid');
  if (new Set(snapshots.map((item) => item.snapshotId)).size !== snapshots.length) throw new Error('candidate_id_duplicate');
  for (const snapshot of snapshots) {
    const validation = validateTranscriptSnapshot(snapshot);
    if (!validation.ok) throw new Error(`candidate_snapshot_invalid:${snapshot.snapshotId}:${validation.issues.join(',')}`);
  }
  const selection = resolvePreferredCandidate(snapshots, selectedId);
  const base = snapshots.find((item) => item.snapshotId === selection.preferredId) ?? snapshots[0];
  const issues = [...selection.issues, ...(new Set(snapshots.map((item) => item.sourceManifestDigest)).size > 1 ? ['candidate_manifest_mismatch'] : [])];
  const candidateBindings = snapshots.map((item) => {
    const pageSet = item.pages.map((page) => page.page);
    const missingPages = expected.filter((page) => !pageSet.includes(page));
    const outOfRangePages = expected.length ? pageSet.filter((page) => !expected.includes(page)) : [];
    const orderingMonotonic = strictlyIncreasing(item.observedPageOrder);
    if (missingPages.length) issues.push(`${item.snapshotId}:page_coverage_missing`);
    if (outOfRangePages.length) issues.push(`${item.snapshotId}:page_out_of_range`);
    if (!orderingMonotonic) issues.push(`${item.snapshotId}:page_order_not_monotonic`);
    return { id: item.snapshotId, binding: item.binding, snapshotDigest: item.snapshotDigest, pageCount: item.pages.length, pageSet, observedPageOrder: item.observedPageOrder, missingPages, outOfRangePages, orderingMonotonic };
  });
  const basePages = new Map(base.pages.map((page) => [page.page, page]));
  const comparisons = [];
  for (const candidate of snapshots.filter((item) => item.snapshotId !== base.snapshotId)) {
    const candidatePages = new Map(candidate.pages.map((page) => [page.page, page]));
    const allPages = unique([...basePages.keys(), ...candidatePages.keys()]).map(Number).sort((left, right) => left - right);
    const pageResults = allPages.map((page) => {
      const left = basePages.get(page)?.text ?? '';
      const right = candidatePages.get(page)?.text ?? '';
      const strictLeft = normalizeStrict(left); const strictRight = normalizeStrict(right);
      const looseLeft = normalizeLoose(left); const looseRight = normalizeLoose(right);
      const baseNumbers = numberTokens(left); const candidateNumbers = numberTokens(right);
      return {
        page,
        missingInBase: !basePages.has(page), missingInCandidate: !candidatePages.has(page),
        strictSimilarity: Number(diceSimilarity(strictLeft, strictRight).toFixed(6)),
        normalizedSimilarity: Number(diceSimilarity(looseLeft, looseRight).toFixed(6)),
        difference: strictLeft === strictRight ? null : boundedDifference(strictLeft, strictRight),
        baseNumericTokens: baseNumbers, candidateNumericTokens: candidateNumbers,
        numericConflict: stableJson(baseNumbers) !== stableJson(candidateNumbers),
        baseScan: scanTranscriptText(left, { probableFragments, rareTermWhitelist }),
        candidateScan: scanTranscriptText(right, { probableFragments, rareTermWhitelist }),
      };
    });
    const mean = (key) => pageResults.length ? pageResults.reduce((sum, item) => sum + item[key], 0) / pageResults.length : 0;
    comparisons.push({
      candidateId: candidate.snapshotId,
      strictSimilarity: Number(mean('strictSimilarity').toFixed(6)),
      normalizedSimilarity: Number(mean('normalizedSimilarity').toFixed(6)),
      lowSimilarityPages: pageResults.filter((item) => item.normalizedSimilarity < 0.985).map((item) => item.page),
      numericConflictPages: pageResults.filter((item) => item.numericConflict).map((item) => item.page),
      pageResults,
    });
  }
  const result = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_transcript_comparison',
    expectedPages: expectedPages === null ? null : { start: expectedPages.start, end: expectedPages.end },
    preferredBase: { id: selection.preferredId, source: selection.source, effectiveComparisonBaseId: base.snapshotId },
    candidateBindings, comparisons,
    qualityAxes: { transcriptionFidelity: 'requires_source_adjudication', editorialReadability: 'not_determined_by_similarity', deliveryCleanliness: 'machine_observed' },
    sourceVerified: false, evidenceState: 'advisory', hostMutationAllowed: false, issues: unique(issues),
  };
  return { ...result, comparisonDigest: digestObject(result, 'comparisonDigest') };
}

export function createTranscriptionIssue({ issueId, page, line = null, anchor = '', token = '', category, candidates = [], decision = null, decisionBasis = null, sourceRef = null, sourceCrop = null, state = 'open' } = {}) {
  if (!issueId || !Number.isInteger(Number(page)) || Number(page) < 1 || !ISSUE_CATEGORIES.has(category) || !ISSUE_STATES.has(state)) throw new Error('transcription_issue_identity_invalid');
  if (line !== null && (!Number.isInteger(Number(line)) || Number(line) < 1)) throw new Error('transcription_issue_line_invalid');
  const crop = Array.isArray(sourceCrop) && sourceCrop.length === 4 && sourceCrop.every((value) => Number.isFinite(value) && value >= 0) ? sourceCrop.map(Number) : null;
  if (sourceCrop !== null && crop === null) throw new Error('transcription_issue_source_crop_invalid');
  if (state === 'resolved' && (!decision || !decisionBasis || !sourceRef)) throw new Error('resolved_issue_requires_source_decision');
  if (state === 'waived' && (!decisionBasis || !sourceRef)) throw new Error('waived_issue_requires_source_basis');
  const issue = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_transcription_issue', issueId: String(issueId),
    page: Number(page), line: line == null ? null : Number(line), anchor: String(anchor), token: String(token), category,
    candidates: unique(candidates.map(String)), decision: decision == null ? null : String(decision),
    decisionBasis: decisionBasis == null ? null : String(decisionBasis), sourceRef: sourceRef == null ? null : String(sourceRef), sourceCrop: crop,
    state, hostMutationAllowed: false,
  };
  return { ...issue, issueDigest: digestObject(issue, 'issueDigest') };
}

export function validateTranscriptionIssue(issue) {
  const issues = [];
  if (issue?.schemaVersion !== '1.0.0' || issue?.artifactType !== 'manuscriptos_transcription_issue' || issue?.hostMutationAllowed !== false || !ISSUE_CATEGORIES.has(issue?.category) || !ISSUE_STATES.has(issue?.state)) issues.push('transcription_issue_identity_invalid');
  if (!validateDigest(issue ?? {}, 'issueDigest')) issues.push('transcription_issue_digest_mismatch');
  if (issue?.state === 'resolved' && (!issue.decision || !issue.decisionBasis || !issue.sourceRef)) issues.push('resolved_issue_source_evidence_missing');
  if (issue?.state === 'waived' && (!issue.decisionBasis || !issue.sourceRef)) issues.push('waived_issue_source_evidence_missing');
  return { ok: issues.length === 0, issues: unique(issues) };
}

export function createAdjudicationLedger({ comparisonDigest, entries = [] } = {}) {
  if (!HASH.test(String(comparisonDigest ?? ''))) throw new Error('comparison_digest_invalid');
  const normalized = entries.map((entry) => {
    const candidateReadings = Object.fromEntries(Object.entries(entry.candidateReadings ?? {}).sort(([left], [right]) => left.localeCompare(right, 'en')).map(([key, value]) => [key, String(value)]));
    const winner = entry.winner == null ? null : String(entry.winner);
    if (!Number.isInteger(Number(entry.page)) || Number(entry.page) < 1 || !String(entry.anchor ?? '') || Object.keys(candidateReadings).length === 0) throw new Error('adjudication_entry_invalid');
    const sourceBacked = Boolean(entry.sourceRef && entry.sourceReading != null && winner && Object.hasOwn(candidateReadings, winner) && candidateReadings[winner] === String(entry.sourceReading));
    return {
      page: Number(entry.page), anchor: String(entry.anchor), candidateReadings,
      sourceRef: entry.sourceRef == null ? null : String(entry.sourceRef), sourceReading: entry.sourceReading == null ? null : String(entry.sourceReading),
      winner, confidence: sourceBacked ? (entry.confidence ?? 'medium') : null,
      evidenceState: sourceBacked ? 'source_image_reviewed' : 'advisory', notes: entry.notes == null ? null : String(entry.notes),
    };
  }).sort((left, right) => left.page - right.page || left.anchor.localeCompare(right.anchor, 'en'));
  const verifiedDecisionCount = normalized.filter((entry) => entry.evidenceState === 'source_image_reviewed').length;
  const unresolvedDecisionCount = normalized.filter((entry) => !entry.winner || entry.evidenceState !== 'source_image_reviewed').length;
  const ledger = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_transcript_adjudication', comparisonDigest: String(comparisonDigest),
    entries: normalized, status: normalized.length > 0 && unresolvedDecisionCount === 0 ? 'complete' : 'partial',
    verifiedDecisionCount, unresolvedDecisionCount, hostMutationAllowed: false,
  };
  return { ...ledger, ledgerDigest: digestObject(ledger, 'ledgerDigest') };
}

export function validateAdjudicationLedger(ledger, comparisonDigest = null) {
  const issues = [];
  if (ledger?.schemaVersion !== '1.0.0' || ledger?.artifactType !== 'manuscriptos_transcript_adjudication' || ledger?.hostMutationAllowed !== false) issues.push('adjudication_identity_invalid');
  if (!validateDigest(ledger ?? {}, 'ledgerDigest')) issues.push('adjudication_digest_mismatch');
  if (comparisonDigest && ledger?.comparisonDigest !== comparisonDigest) issues.push('adjudication_comparison_mismatch');
  if (ledger?.status !== 'complete' || ledger?.unresolvedDecisionCount !== 0) issues.push('adjudication_incomplete');
  for (const entry of ledger?.entries ?? []) if (entry.evidenceState !== 'source_image_reviewed' || !entry.sourceRef || entry.sourceReading == null || !entry.winner || entry.candidateReadings?.[entry.winner] !== entry.sourceReading) issues.push(`page_${entry.page}:adjudication_source_evidence_invalid`);
  return { ok: issues.length === 0, issues: unique(issues) };
}

export function createPatchSet({ snapshot, patches = [] } = {}) {
  if (!validateTranscriptSnapshot(snapshot).ok) throw new Error('snapshot_required_or_invalid');
  const pageMap = new Map(snapshot.pages.map((page) => [page.page, page.text]));
  const normalized = [];
  const issues = [];
  if (!patches.length) issues.push('patch_set_empty');
  const patchIds = new Set();
  for (let index = 0; index < patches.length; index += 1) {
    const patch = patches[index];
    const page = Number(patch.page); const from = String(patch.from ?? ''); const to = String(patch.to ?? '');
    const current = pageMap.get(page);
    if (current === undefined) { issues.push(`patch_${index + 1}:page_missing`); continue; }
    if (!from || from === to) { issues.push(`patch_${index + 1}:replacement_invalid`); continue; }
    const actualOccurrences = exactCount(current, from);
    const expectedOccurrences = Number(patch.expectedOccurrences ?? actualOccurrences);
    if (!Number.isInteger(expectedOccurrences) || expectedOccurrences < 1 || actualOccurrences !== expectedOccurrences) { issues.push(`patch_${index + 1}:occurrence_mismatch`); continue; }
    if (!patch.sourceAnchor) { issues.push(`patch_${index + 1}:source_anchor_missing`); continue; }
    const before = sha256(current); const next = current.split(from).join(to); const after = sha256(next);
    const patchId = String(patch.patchId ?? `patch-${index + 1}`);
    if (!patchId || patchIds.has(patchId)) { issues.push(`patch_${index + 1}:patch_id_duplicate`); continue; }
    patchIds.add(patchId);
    normalized.push({ patchId, page, from, to, expectedOccurrences, pagePreimageSha256: before, pagePostimageSha256: after, sourceAnchor: String(patch.sourceAnchor), reason: String(patch.reason ?? 'source_correction') });
    pageMap.set(page, next);
  }
  const patchSet = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_transcription_patch_set', snapshotDigest: snapshot.snapshotDigest,
    patches: normalized, status: issues.length ? 'rejected' : 'ready', issues: unique(issues), hostMutationAllowed: false,
  };
  return { ...patchSet, patchSetDigest: digestObject(patchSet, 'patchSetDigest') };
}

export function applyPatchSet(snapshot, patchSet) {
  const issues = [];
  const snapshotValidation = validateTranscriptSnapshot(snapshot);
  if (!snapshotValidation.ok) issues.push(...snapshotValidation.issues);
  if (!validateDigest(patchSet ?? {}, 'patchSetDigest')) issues.push('patch_set_digest_mismatch');
  if (patchSet?.status !== 'ready' || patchSet?.hostMutationAllowed !== false) issues.push('patch_set_not_ready');
  if (!(patchSet?.patches ?? []).length) issues.push('patch_set_empty');
  const grouped = new Map();
  for (const patch of patchSet?.patches ?? []) {
    if (!grouped.has(patch.page)) grouped.set(patch.page, []);
    grouped.get(patch.page).push(patch);
  }
  const allFinalPostimagesPresent = grouped.size > 0 && [...grouped].every(([pageNumber, pagePatches]) => {
    const page = (snapshot?.pages ?? []).find((item) => item.page === pageNumber);
    return page && sha256(page.text) === pagePatches[pagePatches.length - 1].pagePostimageSha256;
  });
  if (patchSet?.snapshotDigest !== snapshot?.snapshotDigest && !allFinalPostimagesPresent) issues.push('patch_snapshot_digest_mismatch');
  if (issues.length) return { ok: false, status: 'rejected', issues: unique(issues), changedPages: [], alreadyApplied: [], snapshot, hostMutationAllowed: false, externalActionCount: 0 };
  if (allFinalPostimagesPresent) {
    const result = { ok: true, status: 'already_applied', issues: [], changedPages: [], alreadyApplied: patchSet.patches.map((patch) => patch.patchId), snapshot, hostMutationAllowed: false, externalActionCount: 0 };
    return { ...result, receiptDigest: sha256(stableJson(result)) };
  }
  const pageMap = new Map((snapshot?.pages ?? []).map((page) => [page.page, page.text]));
  const changedPages = new Set();
  for (const [pageNumber, pagePatches] of grouped) {
    let current = pageMap.get(pageNumber);
    if (current === undefined) { issues.push(`page_${pageNumber}:page_missing`); continue; }
    for (const patch of pagePatches) {
      if (sha256(current) !== patch.pagePreimageSha256) { issues.push(`${patch.patchId}:preimage_mismatch`); break; }
      if (exactCount(current, patch.from) !== patch.expectedOccurrences) { issues.push(`${patch.patchId}:occurrence_mismatch`); break; }
      const next = current.split(patch.from).join(patch.to);
      if (sha256(next) !== patch.pagePostimageSha256) { issues.push(`${patch.patchId}:postimage_mismatch`); break; }
      current = next;
    }
    pageMap.set(pageNumber, current); changedPages.add(pageNumber);
  }
  if (issues.length) return { ok: false, status: 'rejected', issues: unique(issues), changedPages: [], alreadyApplied: [], snapshot, hostMutationAllowed: false, externalActionCount: 0 };
  const nextSnapshot = createTranscriptSnapshot({
    snapshotId: `${snapshot.snapshotId}-patched-${patchSet.patchSetDigest.slice(0, 8)}`,
    layer: 'reviewed', sourceManifestDigest: snapshot.sourceManifestDigest,
    binding: { ref: null, version: snapshot.binding.version, current: false, evidenceClass: 'in_memory_content_observed' },
    observedAt: snapshot.observedAt, ocrObservationDigests: snapshot.ocrObservationDigests,
    supersedesSnapshotIds: unique([...snapshot.supersedesSnapshotIds, snapshot.snapshotId]),
    pages: snapshot.pages.map((page) => ({ page: page.page, text: pageMap.get(page.page), reviewState: page.reviewState === 'source_verified' ? 'source_verified' : 'reviewed', boundary: page.boundary })),
  });
  const result = { ok: true, status: 'applied', issues: [], changedPages: [...changedPages].sort((left, right) => left - right), alreadyApplied: [], snapshot: nextSnapshot, hostMutationAllowed: false, externalActionCount: 0 };
  return { ...result, receiptDigest: sha256(stableJson(result)) };
}

export function createSourceFidelityContinuation({ manifest, rawSnapshot = null, sampleValidation = null, snapshot, sourceFidelityStatus = null, issues = [], currentPage = null, currentSourceId = null, nextPageBatch = null } = {}) {
  if (!manifest?.manifestDigest || !snapshot?.snapshotDigest) throw new Error('source_fidelity_continuation_identity_invalid');
  const expectedPages = expectedPageList(manifest.expectedPages);
  const extractedPages = (rawSnapshot?.pages ?? []).map((page) => page.page).sort((left, right) => left - right);
  const sourceReviewedPages = (snapshot?.pages ?? []).filter((page) => page.reviewState === 'source_verified').map((page) => page.page).sort((left, right) => left - right);
  const pendingIssueIds = issues.filter((issue) => issue.state === 'open').map((issue) => issue.issueId).filter(Boolean).sort();
  const remainingPages = expectedPages.filter((page) => !sourceReviewedPages.includes(page));
  const continuation = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_source_fidelity_continuation',
    expectedPageStart: manifest.expectedPages.start, expectedPageEnd: manifest.expectedPages.end,
    manifestDigest: manifest.manifestDigest, rawSnapshotDigest: rawSnapshot?.snapshotDigest ?? null,
    sampleValidationDigest: sampleValidation?.validationDigest ?? null,
    primarySourceIds: unique((manifest.pages ?? []).map((page) => page.primarySourceId).filter(Boolean)),
    extractedPages, sourceReviewedPages, pendingIssueIds,
    lastStablePage: sourceReviewedPages.at(-1) ?? null,
    currentPage: currentPage == null ? remainingPages[0] ?? null : Number(currentPage),
    currentSourceId: currentSourceId == null ? null : String(currentSourceId),
    snapshotDigest: snapshot.snapshotDigest,
    lifecycleState: sourceFidelityStatus?.lifecycleState ?? 'intake',
    nextPageBatch: Array.isArray(nextPageBatch) ? unique(nextPageBatch).map(Number).sort((left, right) => left - right) : remainingPages.slice(0, 8),
    gateStates: Object.fromEntries((sourceFidelityStatus?.gates ?? []).map((gate) => [gate.gateId, gate.status]).sort(([left], [right]) => left.localeCompare(right, 'en'))),
    hostMutationAllowed: false,
  };
  return { ...continuation, continuationDigest: digestObject(continuation, 'continuationDigest') };
}

function validatePatchProof(proof) {
  const issues = [];
  if (proof?.patchSet?.status !== 'ready' || !validateDigest(proof?.patchSet ?? {}, 'patchSetDigest')) issues.push('patch_set_proof_invalid');
  if (!proof?.applyReceipt?.ok || proof.applyReceipt.status !== 'applied' || !validateDigest(proof.applyReceipt ?? {}, 'receiptDigest')) issues.push('patch_apply_receipt_invalid');
  if (!proof?.reapplyReceipt?.ok || proof.reapplyReceipt.status !== 'already_applied' || (proof.reapplyReceipt.changedPages ?? []).length !== 0 || !validateDigest(proof.reapplyReceipt ?? {}, 'receiptDigest')) issues.push('patch_idempotency_receipt_invalid');
  if (proof?.applyReceipt?.snapshot?.snapshotDigest !== proof?.reapplyReceipt?.snapshot?.snapshotDigest) issues.push('patch_idempotency_snapshot_mismatch');
  return { ok: issues.length === 0, issues };
}

export function verifySourceFidelity({
  mode = { operationMode: 'source_transcription', reviewSubmode: null },
  manifest,
  snapshot,
  rawSnapshot = null,
  ocrObservations = [],
  sampleValidation = null,
  sampleSnapshots = [],
  comparison = null,
  issues = [],
  adjudication = null,
  patchProofs = [],
  deliverySnapshotDigest = null,
  probableFragments = DEFAULT_OCR_FRAGMENTS,
  rareTermWhitelist = [],
} = {}) {
  const operationMode = mode?.operationMode ?? 'source_transcription';
  const reviewSubmode = mode?.reviewSubmode ?? (operationMode === 'review_quality' ? 'transcription_comparison' : null);
  const sourceMode = operationMode === 'source_transcription';
  const compareOnlyMode = operationMode === 'review_quality' && reviewSubmode === 'transcription_comparison';
  const makeGate = (gateId, status, gateIssues) => {
    const payload = { gateId, status, issues: unique(gateIssues) };
    return { ...payload, receiptDigest: sha256(stableJson(payload)) };
  };
  const gateResults = [];
  const sequence = validatePageManifest(manifest);
  gateResults.push(makeGate('page-sequence.integrity', sequence.ok ? 'passed' : 'failed', sequence.issues));

  const fidelityIssues = [];
  if (!sourceMode && !compareOnlyMode) fidelityIssues.push('source_fidelity_mode_invalid');
  const snapshotValidation = validateTranscriptSnapshot(snapshot);
  fidelityIssues.push(...snapshotValidation.issues);
  if (snapshot?.sourceManifestDigest !== manifest?.manifestDigest) fidelityIssues.push('snapshot_manifest_mismatch');
  const manifestPages = (manifest?.pages ?? []).map((item) => item.page).sort((left, right) => left - right);
  const snapshotPages = (snapshot?.pages ?? []).map((item) => item.page).sort((left, right) => left - right);
  if (stableJson(manifestPages) !== stableJson(snapshotPages)) fidelityIssues.push('snapshot_page_set_mismatch');
  const unreviewedPages = (snapshot?.pages ?? []).filter((item) => sourceMode ? item.reviewState !== 'source_verified' : !['reviewed', 'source_verified'].includes(item.reviewState)).map((item) => item.page);
  if (unreviewedPages.length) fidelityIssues.push('source_review_pending');

  let rawEvidenceValid = !sourceMode;
  if (sourceMode) {
    const rawValidation = rawSnapshot ? validateTranscriptSnapshot(rawSnapshot) : { ok: false, issues: ['raw_snapshot_missing'] };
    if (!rawValidation.ok) fidelityIssues.push(...rawValidation.issues);
    else if (rawSnapshot.layer !== 'ocr_raw' || rawSnapshot.sourceManifestDigest !== manifest?.manifestDigest || !rawSnapshot.ocrObservationDigests.length) fidelityIssues.push('raw_snapshot_binding_invalid');
    else {
      const observationByDigest = new Map(ocrObservations.map((item) => [item.observationDigest, item]));
      const missing = rawSnapshot.ocrObservationDigests.filter((digest) => !observationByDigest.has(digest));
      const invalid = rawSnapshot.ocrObservationDigests.filter((digest) => observationByDigest.has(digest) && !validateOcrObservation(observationByDigest.get(digest)).ok);
      const primaryByPage = new Map((manifest?.pages ?? []).map((item) => [item.page, item.sources.find((source) => source.primary)]));
      const bindingInvalid = rawSnapshot.ocrObservationDigests.filter((digest) => {
        const observation = observationByDigest.get(digest); const primary = primaryByPage.get(observation?.page);
        return observation && (!primary || observation.input.sourceId !== primary.id || observation.input.sourceSha256 !== primary.suppliedSha256);
      });
      const observedPages = unique(rawSnapshot.ocrObservationDigests.map((digest) => observationByDigest.get(digest)?.page).filter(Number.isInteger)).map(Number).sort((left, right) => left - right);
      const textInvalid = rawSnapshot.pages.filter((page) => !rawSnapshot.ocrObservationDigests.some((digest) => {
        const observation = observationByDigest.get(digest);
        return observation?.page === page.page && observation.output.rawTextSha256 === page.textSha256;
      }));
      if (missing.length) fidelityIssues.push('raw_ocr_observation_missing');
      if (invalid.length) fidelityIssues.push('raw_ocr_observation_invalid');
      if (bindingInvalid.length) fidelityIssues.push('raw_ocr_source_binding_mismatch');
      if (stableJson(observedPages) !== stableJson(rawSnapshot.pages.map((item) => item.page))) fidelityIssues.push('raw_ocr_page_coverage_mismatch');
      if (textInvalid.length) fidelityIssues.push('raw_ocr_text_binding_mismatch');
      rawEvidenceValid = !missing.length && !invalid.length && !bindingInvalid.length && !textInvalid.length && stableJson(observedPages) === stableJson(rawSnapshot.pages.map((item) => item.page));
    }
  }

  let sampleValid = !sourceMode;
  if (sourceMode) {
    const sampleResult = sampleValidation ? validateSampleValidation(sampleValidation) : { ok: false, issues: ['sample_validation_missing'] };
    if (!sampleResult.ok) fidelityIssues.push(...sampleResult.issues);
    else if (sampleValidation.manifestDigest !== manifest?.manifestDigest) fidelityIssues.push('sample_validation_manifest_mismatch');
    else {
      const snapshotByDigest = new Map(sampleSnapshots.map((item) => [item.snapshotDigest, item]));
      const missing = unique(sampleValidation.samples.map((sample) => sample.snapshotDigest)).filter((digest) => !snapshotByDigest.has(digest));
      const invalid = unique(sampleValidation.samples.map((sample) => sample.snapshotDigest)).filter((digest) => {
        const sampleSnapshot = snapshotByDigest.get(digest);
        return sampleSnapshot && (!validateTranscriptSnapshot(sampleSnapshot).ok || sampleSnapshot.sourceManifestDigest !== manifest?.manifestDigest);
      });
      const invalidPages = sampleValidation.samples.filter((sample) => snapshotByDigest.get(sample.snapshotDigest)?.pages?.find((item) => item.page === sample.page)?.reviewState !== 'source_verified');
      if (missing.length) fidelityIssues.push('sample_snapshot_evidence_missing');
      if (invalid.length) fidelityIssues.push('sample_snapshot_evidence_invalid');
      if (invalidPages.length) fidelityIssues.push('sample_page_not_source_verified');
      sampleValid = !missing.length && !invalid.length && !invalidPages.length;
    }
  }

  fidelityIssues.push(...issues.flatMap((issue) => validateTranscriptionIssue(issue).issues.map((item) => `${issue.issueId ?? 'unknown'}:${item}`)));
  const sourceCorrections = issues.filter((issue) => issue.state === 'resolved' && issue.decision != null && issue.token !== issue.decision);
  if (sourceCorrections.length && !patchProofs.length) fidelityIssues.push('source_correction_patch_proof_missing');
  for (const proof of patchProofs) fidelityIssues.push(...validatePatchProof(proof).issues);
  const differenceCount = (comparison?.comparisons ?? []).flatMap((item) => item.pageResults ?? []).filter((item) => item.difference !== null || item.missingInBase || item.missingInCandidate).length;
  let adjudicationValid = adjudication == null && differenceCount === 0;
  if (adjudication) {
    const validation = validateAdjudicationLedger(adjudication, comparison?.comparisonDigest ?? null);
    if (!validation.ok) fidelityIssues.push(...validation.issues);
    else adjudicationValid = true;
  } else if (differenceCount) fidelityIssues.push('source_adjudication_pending');
  const humanIssues = new Set(['source_review_pending', 'source_adjudication_pending', 'adjudication_incomplete']);
  const humanPending = fidelityIssues.some((issue) => humanIssues.has(issue));
  const hardFailure = fidelityIssues.some((issue) => !humanIssues.has(issue));
  gateResults.push(makeGate('transcription.fidelity', hardFailure ? 'failed' : humanPending ? 'human_review_pending' : 'passed', fidelityIssues));

  const suspectIssues = [];
  const resolved = issues.filter((issue) => ['resolved', 'waived'].includes(issue.state));
  for (const page of snapshot?.pages ?? []) {
    const scan = scanTranscriptText(page.text, { probableFragments, rareTermWhitelist });
    if (scan.definiteEncodingErrors.length) suspectIssues.push(`page_${page.page}:encoding_error`);
    for (const token of scan.probableOcrFragments) if (!resolved.some((issue) => issue.page === page.page && issue.token === token && issue.sourceRef && issue.decisionBasis)) suspectIssues.push(`page_${page.page}:unresolved_fragment:${token}`);
  }
  if (issues.some((issue) => issue.state === 'open')) suspectIssues.push('transcription_issue_open');
  const suspectHardFailure = suspectIssues.some((issue) => issue.includes('encoding_error'));
  gateResults.push(makeGate('ocr-artifact.suspect', suspectHardFailure ? 'failed' : suspectIssues.length ? 'human_review_pending' : 'passed', suspectIssues));

  const anyFailed = gateResults.some((gate) => gate.status === 'failed');
  const anyHumanPending = gateResults.some((gate) => gate.status === 'human_review_pending');
  const deliveryReady = sourceMode && !anyFailed && !anyHumanPending && deliverySnapshotDigest === snapshot?.snapshotDigest;
  const dimensions = {
    coverage: sequence.ok ? 'verified' : 'failed',
    ordering: manifest?.ordering?.monotonic === true ? 'verified' : 'failed',
    orientation: (manifest?.pages ?? []).every((page) => ORIENTATIONS.has(page.sources?.find((source) => source.primary)?.orientation)) ? 'verified' : 'failed',
    rawEvidence: sourceMode ? rawEvidenceValid ? 'verified' : 'missing' : 'not_required',
    sampleValidation: sourceMode ? sampleValid ? 'verified' : 'missing' : 'not_required',
    extraction: (snapshot?.pages ?? []).length ? 'supplied_observation_receipt_present' : 'not_run',
    reconciliation: !(snapshot?.pages ?? []).length ? 'not_run' : anyHumanPending ? 'partial' : adjudicationValid || !issues.length ? 'complete' : 'not_run',
    humanReview: anyHumanPending ? 'pending' : 'not_required',
    delivery: compareOnlyMode ? 'not_applicable' : deliveryReady ? 'ready_for_host_delivery' : 'blocked',
  };
  let lifecycleState = 'intake';
  if (sequence.ok) lifecycleState = 'page_mapped';
  if (sequence.ok && sampleValid) lifecycleState = 'sample_validated';
  if (sequence.ok && rawEvidenceValid && (snapshot?.pages ?? []).length) lifecycleState = 'extracted';
  if (sequence.ok && snapshotValidation.ok && adjudicationValid) lifecycleState = 'reconciled';
  if (anyFailed) lifecycleState = 'quality_gate_required';
  else if (anyHumanPending) lifecycleState = 'human_review_pending';
  else if (deliveryReady) lifecycleState = 'delivery_ready';
  const status = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_source_fidelity_status',
    mode: { operationMode, reviewSubmode }, lifecycleState,
    manifestDigest: String(manifest?.manifestDigest ?? ''), snapshotDigest: String(snapshot?.snapshotDigest ?? ''),
    rawSnapshotDigest: rawSnapshot?.snapshotDigest ?? null, sampleValidationDigest: sampleValidation?.validationDigest ?? null,
    deliverySnapshotDigest: deliverySnapshotDigest == null ? null : String(deliverySnapshotDigest),
    patchProofCount: patchProofs.length,
    evidenceState: anyFailed ? 'advisory' : anyHumanPending ? 'human_review_pending' : 'machine_receipt_present',
    dimensions, gates: gateResults, issues: unique(gateResults.flatMap((gate) => gate.issues)),
    ocrExecutionPerformed: false, hostMutationAllowed: false, externalActionCount: 0,
  };
  return { ...status, statusDigest: digestObject(status, 'statusDigest') };
}

export function validateSourceFidelityStatus(status) {
  const issues = [];
  if (status?.schemaVersion !== '1.0.0' || status?.artifactType !== 'manuscriptos_source_fidelity_status') issues.push('source_fidelity_status_identity_invalid');
  if (!validateDigest(status ?? {}, 'statusDigest')) issues.push('source_fidelity_status_digest_mismatch');
  if (status?.ocrExecutionPerformed !== false || status?.hostMutationAllowed !== false || status?.externalActionCount !== 0) issues.push('source_fidelity_status_boundary_invalid');
  const gates = Array.isArray(status?.gates) ? status.gates : [];
  if (stableJson(gates.map((gate) => gate.gateId).sort()) !== stableJson([...SOURCE_FIDELITY_GATE_IDS].sort()) || gates.some((gate) => {
    const payload = { gateId: gate.gateId, status: gate.status, issues: unique((gate.issues ?? []).map(String)) };
    return !GATE_STATUSES.has(gate.status) || gate.receiptDigest !== sha256(stableJson(payload));
  })) issues.push('source_fidelity_gate_set_invalid');
  if (status?.lifecycleState === 'delivery_ready' && (status?.dimensions?.delivery !== 'ready_for_host_delivery' || gates.some((gate) => gate.status !== 'passed') || (status?.issues ?? []).length || status?.deliverySnapshotDigest !== status?.snapshotDigest)) issues.push('source_fidelity_delivery_ready_invalid');
  return { ok: issues.length === 0, issues: unique(issues) };
}
