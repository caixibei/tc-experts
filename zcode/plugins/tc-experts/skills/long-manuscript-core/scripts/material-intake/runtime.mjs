#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, stableJson } from '../lib/kernel-utils.mjs';

export const capabilityId = 'workbuddy-dirty-material-intake';
export const requestSchemaVersion = 'manuscriptos.material-intake-request/v1';
export const resultSchemaVersion = 'manuscriptos.material-intake-result/v1';

export const modalities = Object.freeze([
  'text', 'pdf', 'image', 'table', 'office', 'audio', 'video', 'web'
]);

const MODALITY_SET = new Set(modalities);
const HASH = /^[a-f0-9]{64}$/iu;
const CELL = /^[A-Z]+[1-9][0-9]*$/u;
const ONE_MIB = 1024 * 1024;
const DEFAULT_MAX_TOTAL_DECLARED_BYTES = 16 * 1024 * 1024 * 1024;
const DEFAULT_MAX_INLINE_BYTES = ONE_MIB;
const DEFAULT_MAX_BATCH_BYTES = 64 * ONE_MIB;
const MAX_STDIN_JSON_BYTES = 4 * ONE_MIB;
const MAX_SMALL_SUMMARY_CHARS = 512;
export const MAX_PLANNED_CHUNKS = 1024;
export const MAX_RESULT_BYTES = 4 * ONE_MIB;
const MAX_ITEMS = 256;
const MAX_OBSERVATIONS = 1024;

// Reject cardinality before validation, normalization or per-chunk allocation.
// A small JSON envelope can otherwise describe billions of one-byte chunks.
function cardinalityErrors(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.items)) return [];
  if (input.items.length > MAX_ITEMS) return ['items:cardinality_limit_exceeded'];
  if ((input.batch?.chunkDigestRefs?.length ?? 0) > MAX_PLANNED_CHUNKS) return ['batch:chunk_reference_limit_exceeded'];
  let observations = 0;
  let plannedChunks = 0n;
  const size = input.batch?.maxBatchBytes ?? input.flowControl?.maxBatchBytes
    ?? input.policy?.byteBudget?.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES;
  for (const item of input.items) {
    observations += Array.isArray(item?.observations) ? item.observations.length : 0;
    if (observations > MAX_OBSERVATIONS) return ['observations:cardinality_limit_exceeded'];
    if (typeof item?.id === 'string' && item.id.length > 256) return ['item.id:length_limit_exceeded'];
    for (const observation of Array.isArray(item?.observations) ? item.observations : []) {
      if (typeof observation?.id === 'string' && observation.id.length > 256) return ['observation.id:length_limit_exceeded'];
      if ((observation?.unknowns?.length ?? 0) > 32) return ['observation.unknowns:cardinality_limit_exceeded'];
      if (Array.isArray(observation?.unknowns) && observation.unknowns.some((x) => typeof x === 'string' && x.length > 512)) return ['observation.unknowns:length_limit_exceeded'];
    }
    const bytes = item?.source?.declaredBytes;
    if (Number.isSafeInteger(bytes) && bytes >= 0 && Number.isSafeInteger(size) && size > 0 && item?.source?.contentRef) {
      plannedChunks += (BigInt(bytes) + BigInt(size) - 1n) / BigInt(size);
      if (plannedChunks > BigInt(MAX_PLANNED_CHUNKS)) return ['batch:planned_chunk_limit_exceeded'];
    }
  }
  return [];
}
const PRESENTED_CONTENT_STATES = new Set([
  'content_surface_observed',
  'inline_content_received',
  'current_host_derived_artifact_received'
]);
const ORIGINAL_OBSERVED_STATES = new Set(['bytes_observed', 'derived_artifact_observed']);

const STAGES = Object.freeze({
  text: new Set(['read']),
  pdf: new Set(['read', 'parse', 'ocr']),
  image: new Set(['ocr', 'visual_observation']),
  table: new Set(['parse', 'cell_read']),
  office: new Set(['parse', 'paragraph_read', 'cell_read', 'slide_observation']),
  audio: new Set(['asr']),
  video: new Set(['asr', 'keyframe_extract', 'visual_observation']),
  web: new Set(['snapshot', 'read', 'parse'])
});

const PROCESSOR_KIND = Object.freeze({
  read: 'read',
  parse: 'parser',
  ocr: 'ocr',
  visual_observation: 'vision',
  cell_read: 'parser',
  paragraph_read: 'parser',
  slide_observation: 'vision',
  asr: 'asr',
  keyframe_extract: 'keyframe_extractor',
  snapshot: 'parser'
});

const ANCHOR_TYPES = Object.freeze({
  text: new Set(['character_range']),
  pdf: new Set(['character_range', 'page', 'page_bbox']),
  image: new Set(['bbox', 'bbox_unavailable']),
  table: new Set(['cell_range']),
  office: new Set(['paragraph_range', 'cell_range', 'slide']),
  audio: new Set(['time_range']),
  video: new Set(['time_range', 'frame_range', 'frame_bbox']),
  web: new Set(['character_range', 'url_section'])
});

const SCOPE_TYPES = Object.freeze({
  text: new Set(['whole_source', 'character_range']),
  pdf: new Set(['whole_source', 'page_range']),
  image: new Set(['whole_source', 'bbox']),
  table: new Set(['whole_source', 'cell_range']),
  office: new Set(['whole_source', 'paragraph_range', 'cell_range', 'slide_range']),
  audio: new Set(['whole_source', 'time_range']),
  video: new Set(['whole_source', 'time_range', 'frame_range']),
  web: new Set(['whole_source', 'url_section'])
});

const SCOPE_KEYS = Object.freeze({
  whole_source: new Set(['type']),
  character_range: new Set(['type', 'start', 'end']),
  page_range: new Set(['type', 'startPage', 'endPage']),
  bbox: new Set(['type', 'bbox']),
  cell_range: new Set(['type', 'sheet', 'startCell', 'endCell']),
  paragraph_range: new Set(['type', 'start', 'end']),
  slide_range: new Set(['type', 'startSlide', 'endSlide']),
  time_range: new Set(['type', 'startMs', 'endMs']),
  frame_range: new Set(['type', 'startFrame', 'endFrame']),
  url_section: new Set(['type', 'section'])
});

const ANCHOR_KEYS = Object.freeze({
  bbox_unavailable: new Set(['type', 'reason']),
  character_range: new Set(['type', 'start', 'end']),
  paragraph_range: new Set(['type', 'start', 'end']),
  page: new Set(['type', 'page']),
  page_bbox: new Set(['type', 'page', 'bbox']),
  bbox: new Set(['type', 'bbox']),
  cell_range: new Set(['type', 'sheet', 'startCell', 'endCell']),
  slide: new Set(['type', 'slide']),
  time_range: new Set(['type', 'startMs', 'endMs']),
  frame_range: new Set(['type', 'startFrame', 'endFrame']),
  frame_bbox: new Set(['type', 'frame', 'bbox']),
  url_section: new Set(['type', 'section'])
});

const ALLOWED_TOP_LEVEL = new Set([
  'schemaVersion', 'requestId', 'host', 'modelDeclaration', 'policy', 'capacity', 'batch', 'flowControl', 'items', 'expertUse'
]);
const ALLOWED_ITEM = new Set(['id', 'modality', 'order', 'materialRole', 'useScope', 'source', 'presentation', 'observations']);
const ALLOWED_SOURCE = new Set([
  'sourceRef', 'scope', 'inputDigest', 'evidenceState', 'declaredBytes', 'contentRef', 'inventoryState', 'hashMode',
  'hashedBytes', 'originalReadOnly', 'originalMutationAllowed', 'originalMutationCount'
]);
const ALLOWED_PRESENTATION = new Set(['state', 'hostProduct', 'hostInstanceId']);
const ALLOWED_OBSERVATION = new Set([
  'id', 'stage', 'state', 'sourceInputDigest', 'processor', 'anchor', 'confidence', 'unknowns', 'content',
  'expectedObservationDigest', 'derivedArtifact'
]);
const ALLOWED_CONTENT = new Set([
  'text', 'description', 'summary', 'cells', 'contentRef', 'digest', 'declaredBytes', 'inlineBytes', 'coveredBytes',
  'residualBytes', 'encoding', 'data', 'pageCount', 'durationMs', 'frameCount'
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteUnit(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function uniqueSorted(values) {
  return [...new Set(values.map(String))].sort((a, b) => a.localeCompare(b, 'en'));
}

function unexpectedKeys(value, allowed, pathPrefix, errors) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${pathPrefix}.${key}:unexpected_key`);
  }
}

function validIsoTime(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function validBbox(value) {
  return Array.isArray(value)
    && value.length === 4
    && value.every((entry) => Number.isFinite(entry) && entry >= 0)
    && value[2] > 0
    && value[3] > 0;
}

function validRange(start, end, integer = true) {
  const typeOk = integer
    ? isNonNegativeInteger(start) && isNonNegativeInteger(end)
    : Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end >= 0;
  return typeOk && end > start;
}

function cellCoordinate(cell) {
  const match = /^([A-Z]+)([1-9][0-9]*)$/u.exec(String(cell ?? ''));
  if (!match) return null;
  let column = 0;
  for (const character of match[1]) column = (column * 26) + character.charCodeAt(0) - 64;
  return { column, row: Number(match[2]) };
}

function bboxContains(outer, inner) {
  return validBbox(outer) && validBbox(inner)
    && inner[0] >= outer[0]
    && inner[1] >= outer[1]
    && inner[0] + inner[2] <= outer[0] + outer[2]
    && inner[1] + inner[3] <= outer[1] + outer[3];
}

function cellRangeContains(scope, anchor) {
  if (scope.sheet !== anchor.sheet) return false;
  const scopeStart = cellCoordinate(scope.startCell);
  const scopeEnd = cellCoordinate(scope.endCell);
  const anchorStart = cellCoordinate(anchor.startCell);
  const anchorEnd = cellCoordinate(anchor.endCell);
  return Boolean(scopeStart && scopeEnd && anchorStart && anchorEnd)
    && anchorStart.column >= scopeStart.column
    && anchorStart.row >= scopeStart.row
    && anchorEnd.column <= scopeEnd.column
    && anchorEnd.row <= scopeEnd.row;
}

function cellRangeOrdered(range) {
  const start = cellCoordinate(range.startCell);
  const end = cellCoordinate(range.endCell);
  return Boolean(start && end) && start.column <= end.column && start.row <= end.row;
}

function scopeContainsAnchor(scope, anchor) {
  if (scope.type === 'whole_source') return true;
  if (scope.type === 'character_range' && anchor.type === 'character_range') {
    return anchor.start >= scope.start && anchor.end <= scope.end;
  }
  if (scope.type === 'page_range' && ['page', 'page_bbox'].includes(anchor.type)) {
    return anchor.page >= scope.startPage && anchor.page <= scope.endPage;
  }
  if (scope.type === 'bbox' && anchor.type === 'bbox') return bboxContains(scope.bbox, anchor.bbox);
  if (scope.type === 'cell_range' && anchor.type === 'cell_range') return cellRangeContains(scope, anchor);
  if (scope.type === 'paragraph_range' && anchor.type === 'paragraph_range') {
    return anchor.start >= scope.start && anchor.end <= scope.end;
  }
  if (scope.type === 'slide_range' && anchor.type === 'slide') {
    return anchor.slide >= scope.startSlide && anchor.slide <= scope.endSlide;
  }
  if (scope.type === 'time_range' && anchor.type === 'time_range') {
    return anchor.startMs >= scope.startMs && anchor.endMs <= scope.endMs;
  }
  if (scope.type === 'frame_range' && ['frame_range', 'frame_bbox'].includes(anchor.type)) {
    const startFrame = anchor.type === 'frame_bbox' ? anchor.frame : anchor.startFrame;
    const endFrame = anchor.type === 'frame_bbox' ? anchor.frame : anchor.endFrame;
    return startFrame >= scope.startFrame && endFrame <= scope.endFrame;
  }
  if (scope.type === 'url_section' && anchor.type === 'url_section') return scope.section === anchor.section;
  return false;
}

function validateAnchor(anchor, modality, errorPath, errors) {
  if (!isObject(anchor) || !isNonEmptyString(anchor.type)) {
    errors.push(`${errorPath}:anchor_required`);
    return;
  }
  if (!ANCHOR_TYPES[modality]?.has(anchor.type)) {
    errors.push(`${errorPath}.type:anchor_not_allowed_for_${modality}`);
    return;
  }
  unexpectedKeys(anchor, ANCHOR_KEYS[anchor.type] ?? new Set(['type']), errorPath, errors);
  switch (anchor.type) {
    case 'bbox_unavailable':
      if (!isNonEmptyString(anchor.reason) || anchor.reason.length > 512) errors.push(`${errorPath}:bbox_unavailable_reason_required`);
      break;
    case 'character_range':
    case 'paragraph_range':
      if (!validRange(anchor.start, anchor.end)) errors.push(`${errorPath}:invalid_${anchor.type}`);
      break;
    case 'page':
      if (!isPositiveInteger(anchor.page)) errors.push(`${errorPath}:invalid_page`);
      break;
    case 'page_bbox':
      if (!isPositiveInteger(anchor.page) || !validBbox(anchor.bbox)) errors.push(`${errorPath}:invalid_page_bbox`);
      break;
    case 'bbox':
      if (!validBbox(anchor.bbox)) errors.push(`${errorPath}:invalid_bbox`);
      break;
    case 'cell_range':
      if (!isNonEmptyString(anchor.sheet) || !CELL.test(String(anchor.startCell ?? '')) || !CELL.test(String(anchor.endCell ?? ''))
        || !cellRangeOrdered(anchor)) {
        errors.push(`${errorPath}:invalid_cell_range`);
      }
      break;
    case 'slide':
      if (!isPositiveInteger(anchor.slide)) errors.push(`${errorPath}:invalid_slide`);
      break;
    case 'time_range':
      if (!validRange(anchor.startMs, anchor.endMs)) errors.push(`${errorPath}:invalid_time_range`);
      break;
    case 'frame_range':
      if (!validRange(anchor.startFrame, anchor.endFrame)) errors.push(`${errorPath}:invalid_frame_range`);
      break;
    case 'frame_bbox':
      if (!isNonNegativeInteger(anchor.frame) || !validBbox(anchor.bbox)) errors.push(`${errorPath}:invalid_frame_bbox`);
      break;
    case 'url_section':
      if (!isNonEmptyString(anchor.section)) errors.push(`${errorPath}:invalid_url_section`);
      break;
    default:
      errors.push(`${errorPath}:unknown_anchor_type`);
  }
}

function validateScope(scope, modality, errorPath, errors) {
  if (!isObject(scope) || !isNonEmptyString(scope.type)) {
    errors.push(`${errorPath}:source_scope_required`);
    return;
  }
  if (!SCOPE_TYPES[modality]?.has(scope.type)) {
    errors.push(`${errorPath}.type:scope_not_allowed_for_${modality}`);
    return;
  }
  unexpectedKeys(scope, SCOPE_KEYS[scope.type] ?? new Set(['type']), errorPath, errors);
  switch (scope.type) {
    case 'whole_source':
      break;
    case 'character_range':
    case 'paragraph_range':
      if (!validRange(scope.start, scope.end)) errors.push(`${errorPath}:invalid_${scope.type}`);
      break;
    case 'page_range':
      if (!isPositiveInteger(scope.startPage) || !isPositiveInteger(scope.endPage) || scope.endPage < scope.startPage) {
        errors.push(`${errorPath}:invalid_page_range`);
      }
      break;
    case 'bbox':
      if (!validBbox(scope.bbox)) errors.push(`${errorPath}:invalid_bbox`);
      break;
    case 'cell_range':
      if (!isNonEmptyString(scope.sheet) || !CELL.test(String(scope.startCell ?? '')) || !CELL.test(String(scope.endCell ?? ''))
        || !cellRangeOrdered(scope)) {
        errors.push(`${errorPath}:invalid_cell_range`);
      }
      break;
    case 'slide_range':
      if (!isPositiveInteger(scope.startSlide) || !isPositiveInteger(scope.endSlide) || scope.endSlide < scope.startSlide) {
        errors.push(`${errorPath}:invalid_slide_range`);
      }
      break;
    case 'time_range':
      if (!validRange(scope.startMs, scope.endMs)) errors.push(`${errorPath}:invalid_time_range`);
      break;
    case 'frame_range':
      if (!validRange(scope.startFrame, scope.endFrame)) errors.push(`${errorPath}:invalid_frame_range`);
      break;
    case 'url_section':
      if (!isNonEmptyString(scope.section)) errors.push(`${errorPath}:invalid_url_section`);
      break;
    default:
      errors.push(`${errorPath}:unknown_scope_type`);
  }
}

function validateHost(host, errors) {
  const allowed = new Set(['product', 'version', 'versionEvidence', 'instanceId', 'observedAt']);
  if (!isObject(host)) {
    errors.push('host:object_required');
    return;
  }
  unexpectedKeys(host, allowed, 'host', errors);
  if (host.product !== 'WorkBuddy') errors.push('host.product:workbuddy_required');
  if (!(host.version === null || isNonEmptyString(host.version))) errors.push('host.version:string_or_null_required');
  if (!['current_host_observed', 'target_baseline', 'not_observed'].includes(host.versionEvidence)) {
    errors.push('host.versionEvidence:invalid_state');
  }
  if (!(host.instanceId === null || isNonEmptyString(host.instanceId))) errors.push('host.instanceId:string_or_null_required');
  if (!(host.observedAt === null || validIsoTime(host.observedAt))) errors.push('host.observedAt:iso_time_or_null_required');
  if (host.versionEvidence === 'current_host_observed') {
    if (!isNonEmptyString(host.version)) errors.push('host.version:current_version_required');
    if (!isNonEmptyString(host.instanceId)) errors.push('host.instanceId:current_instance_required');
    if (!validIsoTime(host.observedAt)) errors.push('host.observedAt:current_observation_time_required');
  }
}

function validateModelDeclaration(modelDeclaration, errors) {
  const allowed = new Set(['state', 'providerId', 'modelId', 'displayLabel', 'declaredModalities']);
  if (!isObject(modelDeclaration)) {
    errors.push('modelDeclaration:object_required');
    return;
  }
  unexpectedKeys(modelDeclaration, allowed, 'modelDeclaration', errors);
  if (!['not_observed', 'model_badge_only', 'provider_declaration', 'workbuddy_catalog_observed'].includes(modelDeclaration.state)) {
    errors.push('modelDeclaration.state:invalid_state');
  }
  for (const key of ['providerId', 'modelId', 'displayLabel']) {
    if (!(modelDeclaration[key] === null || isNonEmptyString(modelDeclaration[key]))) {
      errors.push(`modelDeclaration.${key}:string_or_null_required`);
    }
  }
  if (!Array.isArray(modelDeclaration.declaredModalities)
    || modelDeclaration.declaredModalities.some((value) => !MODALITY_SET.has(value))) {
    errors.push('modelDeclaration.declaredModalities:known_modality_array_required');
  }
  if (modelDeclaration.state === 'provider_declaration'
    && (!isNonEmptyString(modelDeclaration.providerId) || !isNonEmptyString(modelDeclaration.modelId))) {
    errors.push('modelDeclaration:provider_and_model_required');
  }
}

function validatePolicy(policy, errors) {
  if (policy === undefined) return;
  const allowed = new Set(['lowConfidenceThreshold', 'stopOnUnknown', 'sourceRefDisclosure', 'byteBudget']);
  if (!isObject(policy)) {
    errors.push('policy:object_required');
    return;
  }
  unexpectedKeys(policy, allowed, 'policy', errors);
  if (policy.lowConfidenceThreshold !== undefined && !isFiniteUnit(policy.lowConfidenceThreshold)) {
    errors.push('policy.lowConfidenceThreshold:unit_interval_required');
  }
  if (policy.stopOnUnknown !== undefined && typeof policy.stopOnUnknown !== 'boolean') {
    errors.push('policy.stopOnUnknown:boolean_required');
  }
  if (policy.sourceRefDisclosure !== undefined && !['opaque_digest', 'as_supplied'].includes(policy.sourceRefDisclosure)) {
    errors.push('policy.sourceRefDisclosure:invalid_state');
  }
  if (policy.byteBudget !== undefined) {
    const byteBudget = policy.byteBudget;
    const byteBudgetKeys = new Set(['maxTotalDeclaredBytes', 'maxInlineBytes', 'maxBatchBytes']);
    if (!isObject(byteBudget)) errors.push('policy.byteBudget:object_required');
    else {
      unexpectedKeys(byteBudget, byteBudgetKeys, 'policy.byteBudget', errors);
      for (const key of byteBudgetKeys) {
        if (!isPositiveSafeInteger(byteBudget[key])) errors.push(`policy.byteBudget.${key}:positive_safe_integer_required`);
      }
    }
  }
}

function validateCapacity(capacity, errors) {
  if (capacity === undefined) return;
  const allowed = new Set(['declaredBytes', 'inlineBytes', 'contentRefCount']);
  if (!isObject(capacity)) {
    errors.push('capacity:object_required');
    return;
  }
  unexpectedKeys(capacity, allowed, 'capacity', errors);
  for (const key of allowed) {
    if (!isNonNegativeSafeInteger(capacity[key])) errors.push(`capacity.${key}:nonnegative_safe_integer_required`);
  }
}

function validateBatch(batch, errors) {
  if (batch === undefined) return;
  const allowed = new Set(['maxBatchBytes', 'nextBatchIndex', 'checkpointDigest', 'resumeFromCheckpoint', 'chunkDigestRefs']);
  if (!isObject(batch)) {
    errors.push('batch:object_required');
    return;
  }
  unexpectedKeys(batch, allowed, 'batch', errors);
  if (!isPositiveSafeInteger(batch.maxBatchBytes)) errors.push('batch.maxBatchBytes:positive_safe_integer_required');
  if (!isNonNegativeSafeInteger(batch.nextBatchIndex)) errors.push('batch.nextBatchIndex:nonnegative_safe_integer_required');
  if (!(batch.checkpointDigest === null || HASH.test(String(batch.checkpointDigest ?? '')))) errors.push('batch.checkpointDigest:sha256_or_null_required');
  if (typeof batch.resumeFromCheckpoint !== 'boolean') errors.push('batch.resumeFromCheckpoint:boolean_required');
  if (!Array.isArray(batch.chunkDigestRefs ?? [])) errors.push('batch.chunkDigestRefs:array_required');
  else {
    const seen = new Set();
    for (const [index, ref] of (batch.chunkDigestRefs ?? []).entries()) {
      const refPath = `batch.chunkDigestRefs[${index}]`;
      if (!isObject(ref)) {
        errors.push(`${refPath}:object_required`);
        continue;
      }
      unexpectedKeys(ref, new Set(['sourceRef', 'ordinal', 'digest']), refPath, errors);
      if (!isNonEmptyString(ref.sourceRef)) errors.push(`${refPath}.sourceRef:required`);
      if (!isPositiveSafeInteger(ref.ordinal)) errors.push(`${refPath}.ordinal:positive_safe_integer_required`);
      if (!HASH.test(String(ref.digest ?? ''))) errors.push(`${refPath}.digest:sha256_required`);
      const key = `${ref.sourceRef}\u0000${ref.ordinal}`;
      if (seen.has(key)) errors.push(`${refPath}:duplicate_chunk_digest_ref`);
      seen.add(key);
    }
  }
  if (batch.resumeFromCheckpoint === true && !HASH.test(String(batch.checkpointDigest ?? ''))) {
    errors.push('batch.checkpointDigest:required_for_resume');
  }
}

function validateFlowControl(flowControl, errors) {
  if (flowControl === undefined) return;
  const allowed = new Set(['maxInFlightBatches', 'requestedInFlightBatches', 'maxBatchBytes']);
  if (!isObject(flowControl)) {
    errors.push('flowControl:object_required');
    return;
  }
  unexpectedKeys(flowControl, allowed, 'flowControl', errors);
  for (const key of allowed) {
    if (!isPositiveSafeInteger(flowControl[key])) errors.push(`flowControl.${key}:positive_safe_integer_required`);
  }
}

function defaultUseScope(materialRole = 'content') {
  if (materialRole === 'reference_style') {
    return { factUse: 'forbidden', styleUse: 'allowed', instructionUse: 'forbidden', scopeRefs: ['whole_project'] };
  }
  if (materialRole === 'control_instruction') {
    return { factUse: 'forbidden', styleUse: 'forbidden', instructionUse: 'allowed', scopeRefs: ['whole_project'] };
  }
  if (materialRole === 'both_scoped') {
    return { factUse: 'allowed', styleUse: 'allowed', instructionUse: 'forbidden', scopeRefs: [] };
  }
  return { factUse: 'allowed', styleUse: 'forbidden', instructionUse: 'forbidden', scopeRefs: ['whole_project'] };
}

function validateMaterialRole(item, itemPath, errors) {
  const role = item.materialRole ?? 'content';
  if (!['content', 'reference_style', 'both_scoped', 'control_instruction'].includes(role)) {
    errors.push(`${itemPath}.materialRole:invalid_role`);
  }
  if (item.useScope === undefined) return;
  const useScope = item.useScope;
  if (!isObject(useScope)) {
    errors.push(`${itemPath}.useScope:object_required`);
    return;
  }
  unexpectedKeys(useScope, new Set(['factUse', 'styleUse', 'instructionUse', 'scopeRefs']), `${itemPath}.useScope`, errors);
  for (const key of ['factUse', 'styleUse', 'instructionUse']) {
    if (!['allowed', 'forbidden'].includes(useScope[key])) errors.push(`${itemPath}.useScope.${key}:allowed_or_forbidden_required`);
  }
  if (!Array.isArray(useScope.scopeRefs) || useScope.scopeRefs.some((value) => !isNonEmptyString(value))) {
    errors.push(`${itemPath}.useScope.scopeRefs:string_array_required`);
  }
}

function validateContent(content, observationPath, errors) {
  if (!isObject(content)) return;
  unexpectedKeys(content, ALLOWED_CONTENT, `${observationPath}.content`, errors);
  for (const key of ['text', 'description', 'summary', 'contentRef', 'encoding', 'data']) {
    if (content[key] !== undefined && !(typeof content[key] === 'string' && content[key].length > 0)) {
      errors.push(`${observationPath}.content.${key}:nonempty_string_required`);
    } else if (typeof content[key] === 'string' && content[key].length > MAX_STDIN_JSON_BYTES) {
      errors.push(`${observationPath}.content.${key}:control_envelope_field_too_large`);
    }
  }
  if (content.digest !== undefined && !HASH.test(String(content.digest ?? ''))) errors.push(`${observationPath}.content.digest:sha256_required`);
  for (const key of ['declaredBytes', 'inlineBytes', 'coveredBytes', 'residualBytes', 'pageCount', 'durationMs', 'frameCount']) {
    if (content[key] !== undefined && !isNonNegativeSafeInteger(content[key])) {
      errors.push(`${observationPath}.content.${key}:nonnegative_safe_integer_required`);
    }
  }
  if (content.cells !== undefined && !Array.isArray(content.cells)) errors.push(`${observationPath}.content.cells:array_required`);
}

function validatePresentation(presentation, itemPath, errors) {
  if (!isObject(presentation)) {
    errors.push(`${itemPath}.presentation:object_required`);
    return;
  }
  unexpectedKeys(presentation, ALLOWED_PRESENTATION, `${itemPath}.presentation`, errors);
  if (!['not_observed', 'attachment_card_observed', 'content_surface_observed', 'inline_content_received', 'current_host_derived_artifact_received'].includes(presentation.state)) {
    errors.push(`${itemPath}.presentation.state:invalid_state`);
  }
  if (!(presentation.hostProduct === null || isNonEmptyString(presentation.hostProduct))) {
    errors.push(`${itemPath}.presentation.hostProduct:string_or_null_required`);
  }
  if (!(presentation.hostInstanceId === null || isNonEmptyString(presentation.hostInstanceId))) {
    errors.push(`${itemPath}.presentation.hostInstanceId:string_or_null_required`);
  }
  if (['attachment_card_observed', 'content_surface_observed', 'current_host_derived_artifact_received'].includes(presentation.state)) {
    if (presentation.hostProduct !== 'WorkBuddy') errors.push(`${itemPath}.presentation.hostProduct:workbuddy_required`);
    if (!isNonEmptyString(presentation.hostInstanceId)) errors.push(`${itemPath}.presentation.hostInstanceId:required`);
  }
}

function validateDerivedArtifact(artifact, observationPath, errors) {
  if (artifact === undefined || artifact === null) return;
  const allowed = new Set(['origin', 'hostProduct', 'hostVersion', 'hostInstanceId', 'artifactDigest']);
  if (!isObject(artifact)) {
    errors.push(`${observationPath}.derivedArtifact:object_or_null_required`);
    return;
  }
  unexpectedKeys(artifact, allowed, `${observationPath}.derivedArtifact`, errors);
  if (artifact.origin !== 'workbuddy_current_host') errors.push(`${observationPath}.derivedArtifact.origin:invalid_origin`);
  if (!isNonEmptyString(artifact.hostProduct)) errors.push(`${observationPath}.derivedArtifact.hostProduct:required`);
  if (!isNonEmptyString(artifact.hostVersion)) errors.push(`${observationPath}.derivedArtifact.hostVersion:required`);
  if (!isNonEmptyString(artifact.hostInstanceId)) errors.push(`${observationPath}.derivedArtifact.hostInstanceId:required`);
  if (!HASH.test(String(artifact.artifactDigest ?? ''))) errors.push(`${observationPath}.derivedArtifact.artifactDigest:sha256_required`);
}

function validateObservation(observation, modality, observationPath, errors) {
  if (!isObject(observation)) {
    errors.push(`${observationPath}:object_required`);
    return;
  }
  unexpectedKeys(observation, ALLOWED_OBSERVATION, observationPath, errors);
  if (!isNonEmptyString(observation.id)) errors.push(`${observationPath}.id:required`);
  if (!STAGES[modality]?.has(observation.stage)) errors.push(`${observationPath}.stage:not_allowed_for_${modality}`);
  if (!['observed', 'partial', 'not_observed', 'failed'].includes(observation.state)) {
    errors.push(`${observationPath}.state:invalid_state`);
  }
  if (!HASH.test(String(observation.sourceInputDigest ?? ''))) errors.push(`${observationPath}.sourceInputDigest:sha256_required`);
  if (!isObject(observation.processor) || !isNonEmptyString(observation.processor.id) || !isNonEmptyString(observation.processor.kind)) {
    errors.push(`${observationPath}.processor:id_and_kind_required`);
  } else {
    unexpectedKeys(observation.processor, new Set(['id', 'kind']), `${observationPath}.processor`, errors);
    if (PROCESSOR_KIND[observation.stage] !== observation.processor.kind) {
      errors.push(`${observationPath}.processor.kind:stage_processor_mismatch`);
    }
  }
  validateAnchor(observation.anchor, modality, `${observationPath}.anchor`, errors);
  if (['observed', 'partial'].includes(observation.state)) {
    if (!isObject(observation.confidence)
      || !isFiniteUnit(observation.confidence.extraction)
      || !isFiniteUnit(observation.confidence.alignment)
      || !isFiniteUnit(observation.confidence.identity)) {
      errors.push(`${observationPath}.confidence:complete_unit_scores_required`);
    } else {
      unexpectedKeys(observation.confidence, new Set(['extraction', 'alignment', 'identity']), `${observationPath}.confidence`, errors);
    }
    if (!isObject(observation.content) || Object.keys(observation.content).length === 0) {
      errors.push(`${observationPath}.content:structured_content_required`);
    } else validateContent(observation.content, observationPath, errors);
  } else {
    if (!(observation.confidence === null || observation.confidence === undefined)) {
      errors.push(`${observationPath}.confidence:null_required_when_not_observed`);
    }
    if (!(observation.content === null || observation.content === undefined)) {
      errors.push(`${observationPath}.content:null_required_when_not_observed`);
    }
  }
  if (!Array.isArray(observation.unknowns) || observation.unknowns.some((value) => !isNonEmptyString(value))) {
    errors.push(`${observationPath}.unknowns:string_array_required`);
  }
  if (observation.expectedObservationDigest !== undefined
    && !HASH.test(String(observation.expectedObservationDigest ?? ''))) {
    errors.push(`${observationPath}.expectedObservationDigest:sha256_required`);
  }
  validateDerivedArtifact(observation.derivedArtifact, observationPath, errors);
}

function validateSource(source, modality, itemPath, errors) {
  if (!isObject(source)) {
    errors.push(`${itemPath}.source:object_required`);
    return;
  }
  unexpectedKeys(source, ALLOWED_SOURCE, `${itemPath}.source`, errors);
  if (!isNonEmptyString(source.sourceRef)) errors.push(`${itemPath}.source.sourceRef:required`);
  else if (source.sourceRef.length > 4096) errors.push(`${itemPath}.source.sourceRef:too_long`);
  validateScope(source.scope, modality, `${itemPath}.source.scope`, errors);
  if (!HASH.test(String(source.inputDigest ?? ''))) errors.push(`${itemPath}.source.inputDigest:sha256_required`);
  if (!['bytes_observed', 'derived_artifact_observed', 'digest_supplied_not_observed', 'descriptor_only'].includes(source.evidenceState)) {
    errors.push(`${itemPath}.source.evidenceState:invalid_state`);
  }
  if (source.declaredBytes !== undefined && !isNonNegativeSafeInteger(source.declaredBytes)) {
    errors.push(`${itemPath}.source.declaredBytes:nonnegative_safe_integer_required`);
  }
  if (source.contentRef !== undefined && !(source.contentRef === null || isNonEmptyString(source.contentRef))) {
    errors.push(`${itemPath}.source.contentRef:string_or_null_required`);
  } else if (typeof source.contentRef === 'string' && source.contentRef.length > 4096) {
    errors.push(`${itemPath}.source.contentRef:too_long`);
  }
  if (source.inventoryState !== undefined && !['metadata_observed', 'hash_pending', 'hash_complete'].includes(source.inventoryState)) {
    errors.push(`${itemPath}.source.inventoryState:invalid_state`);
  }
  if (source.hashMode !== undefined && !['metadata_only', 'streaming', 'incremental', 'complete'].includes(source.hashMode)) {
    errors.push(`${itemPath}.source.hashMode:invalid_mode`);
  }
  if (source.hashedBytes !== undefined && !isNonNegativeSafeInteger(source.hashedBytes)) {
    errors.push(`${itemPath}.source.hashedBytes:nonnegative_safe_integer_required`);
  }
  if (source.originalReadOnly !== true) errors.push(`${itemPath}.source.originalReadOnly:true_required`);
  if (source.originalMutationAllowed !== false) errors.push(`${itemPath}.source.originalMutationAllowed:false_required`);
  if (source.originalMutationCount !== 0) errors.push(`${itemPath}.source.originalMutationCount:zero_required`);
}

function validateExpertUse(expertUse, errors) {
  const allowed = new Set(['state', 'expertId', 'hostProduct', 'hostInstanceId', 'consumedObservationIds', 'outputArtifactDigest']);
  if (!isObject(expertUse)) {
    errors.push('expertUse:object_required');
    return;
  }
  unexpectedKeys(expertUse, allowed, 'expertUse', errors);
  if (!['not_observed', 'structured_receipt'].includes(expertUse.state)) errors.push('expertUse.state:invalid_state');
  if (!(expertUse.expertId === null || isNonEmptyString(expertUse.expertId))) errors.push('expertUse.expertId:string_or_null_required');
  if (!(expertUse.hostProduct === null || isNonEmptyString(expertUse.hostProduct))) errors.push('expertUse.hostProduct:string_or_null_required');
  if (!(expertUse.hostInstanceId === null || isNonEmptyString(expertUse.hostInstanceId))) errors.push('expertUse.hostInstanceId:string_or_null_required');
  if (!Array.isArray(expertUse.consumedObservationIds)
    || expertUse.consumedObservationIds.some((value) => !isNonEmptyString(value))) {
    errors.push('expertUse.consumedObservationIds:string_array_required');
  }
  if (!(expertUse.outputArtifactDigest === null || HASH.test(String(expertUse.outputArtifactDigest ?? '')))) {
    errors.push('expertUse.outputArtifactDigest:sha256_or_null_required');
  }
  if (expertUse.state === 'structured_receipt') {
    if (!isNonEmptyString(expertUse.expertId)) errors.push('expertUse.expertId:required_for_receipt');
    if (expertUse.hostProduct !== 'WorkBuddy') errors.push('expertUse.hostProduct:workbuddy_required_for_receipt');
    if (!isNonEmptyString(expertUse.hostInstanceId)) errors.push('expertUse.hostInstanceId:required_for_receipt');
    if (expertUse.consumedObservationIds.length === 0) errors.push('expertUse.consumedObservationIds:nonempty_required_for_receipt');
    if (!HASH.test(String(expertUse.outputArtifactDigest ?? ''))) errors.push('expertUse.outputArtifactDigest:required_for_receipt');
  }
}

function validateRequest(input) {
  const errors = [];
  if (!isObject(input)) return ['input:object_required'];
  unexpectedKeys(input, ALLOWED_TOP_LEVEL, 'input', errors);
  if (input.schemaVersion !== requestSchemaVersion) errors.push('schemaVersion:unsupported');
  if (!isNonEmptyString(input.requestId)) errors.push('requestId:required');
  validateHost(input.host, errors);
  validateModelDeclaration(input.modelDeclaration, errors);
  validatePolicy(input.policy, errors);
  validateCapacity(input.capacity, errors);
  validateBatch(input.batch, errors);
  validateFlowControl(input.flowControl, errors);
  if (!Array.isArray(input.items) || input.items.length === 0) {
    errors.push('items:nonempty_array_required');
  } else {
    const itemIds = new Set();
    const itemOrders = new Set();
    const observationIds = new Set();
    input.items.forEach((item, index) => {
      const itemPath = `items[${index}]`;
      if (!isObject(item)) {
        errors.push(`${itemPath}:object_required`);
        return;
      }
      unexpectedKeys(item, ALLOWED_ITEM, itemPath, errors);
      if (!isNonEmptyString(item.id)) errors.push(`${itemPath}.id:required`);
      else if (itemIds.has(item.id)) errors.push(`${itemPath}.id:duplicate`);
      else itemIds.add(item.id);
      if (!MODALITY_SET.has(item.modality)) errors.push(`${itemPath}.modality:unsupported`);
      validateMaterialRole(item, itemPath, errors);
      if (!isPositiveInteger(item.order)) errors.push(`${itemPath}.order:positive_integer_required`);
      else if (itemOrders.has(item.order)) errors.push(`${itemPath}.order:duplicate`);
      else itemOrders.add(item.order);
      validateSource(item.source, item.modality, itemPath, errors);
      validatePresentation(item.presentation, itemPath, errors);
      if (!Array.isArray(item.observations)) errors.push(`${itemPath}.observations:array_required`);
      else item.observations.forEach((observation, observationIndex) => {
        const observationPath = `${itemPath}.observations[${observationIndex}]`;
        validateObservation(observation, item.modality, observationPath, errors);
        if (isObject(observation) && isNonEmptyString(observation.id)) {
          if (observationIds.has(observation.id)) errors.push(`${observationPath}.id:duplicate`);
          else observationIds.add(observation.id);
        }
      });
    });
  }
  validateExpertUse(input.expertUse, errors);
  return uniqueSorted(errors);
}

function executionBoundary() {
  return {
    deterministic: true,
    allocatedLargePayloadBytes: 0,
    externalActionCount: 0,
    hostInteractionPerformed: false,
    networkUsed: false,
    originalMutationCount: 0,
    originalReadOnlyEnforced: true,
    rawContentRetained: false,
    stdinJsonByteLimit: MAX_STDIN_JSON_BYTES,
    runtimeBoundary: 'structured_json_observation_intake_only'
  };
}

function sealResult(payload) {
  if (Buffer.byteLength(stableJson(payload), 'utf8') > MAX_RESULT_BYTES - 128) {
    return invalidResult(null, ['result:output_byte_limit_exceeded']);
  }
  return { ...payload, resultDigest: sha256(stableJson(payload)) };
}

function invalidResult(requestId, errors) {
  return sealResult({
    schemaVersion: resultSchemaVersion,
    capabilityId,
    requestId: isNonEmptyString(requestId) ? requestId : null,
    ok: false,
    status: 'invalid_input',
    host: null,
    modelDeclarationReceipt: null,
    items: [],
    expertUseReceipt: null,
    capacityReceipt: null,
    batchReceipt: null,
    flowControlReceipt: null,
    summary: {
      itemCount: 0,
      observedCount: 0,
      partialCount: 0,
      notObservedCount: 0,
      degradedCount: 0,
      humanReviewRequiredCount: 0,
      consumptionReady: false,
      stopRequired: true,
      stopReasons: ['invalid_input']
    },
    errors: uniqueSorted(errors),
    warnings: [],
    executionBoundary: executionBoundary()
  });
}

function modelReceipt(modelDeclaration) {
  const stateMap = {
    not_observed: 'not_observed',
    model_badge_only: 'badge_observed_declaration_only',
    provider_declaration: 'provider_declared_only',
    workbuddy_catalog_observed: 'catalog_entry_observed_declaration_only'
  };
  const payload = {
    state: stateMap[modelDeclaration.state],
    sourceState: modelDeclaration.state,
    providerId: modelDeclaration.providerId,
    modelId: modelDeclaration.modelId,
    displayLabel: modelDeclaration.displayLabel,
    declaredModalities: uniqueSorted(modelDeclaration.declaredModalities),
    capabilityObservationState: 'not_observed',
    claimBoundary: 'declaration_or_badge_does_not_prove_workbuddy_media_forwarding_or_expert_use'
  };
  return { ...payload, receiptDigest: sha256(stableJson(payload)) };
}

function normalizeHost(host) {
  return {
    product: 'WorkBuddy',
    version: host.version,
    versionEvidence: host.versionEvidence,
    instanceId: host.instanceId,
    observedAt: host.observedAt,
    developmentTargetVersion: '5.5.3',
    versionAllowlistApplied: false,
    capabilityAdmissionRule: 'evidence_bound_not_version_whitelisted'
  };
}

function presentationReceipt(item, host, policy) {
  const presentation = item.presentation;
  const bindingMatches = presentation.hostProduct === null
    || (presentation.hostProduct === host.product && presentation.hostInstanceId === host.instanceId);
  const stateMap = {
    not_observed: 'not_observed',
    attachment_card_observed: 'attachment_presented_content_not_observed',
    content_surface_observed: bindingMatches ? 'content_surface_observed' : 'host_binding_mismatch',
    inline_content_received: 'inline_content_received',
    current_host_derived_artifact_received: bindingMatches ? 'current_host_derived_artifact_received' : 'host_binding_mismatch'
  };
  const payload = {
    sourceArtifactId: item.id,
    sourceRef: discloseReference(item.source.sourceRef, policy),
    inputDigest: String(item.source.inputDigest).toLowerCase(),
    state: stateMap[presentation.state],
    sourceState: presentation.state,
    hostProduct: presentation.hostProduct,
    hostInstanceId: presentation.hostInstanceId,
    bindingMatches,
    contentObservationState: PRESENTED_CONTENT_STATES.has(presentation.state) && bindingMatches
      ? 'content_available_for_structured_intake'
      : 'not_observed'
  };
  return { ...payload, receiptDigest: sha256(stableJson(payload)) };
}

function boundedValueBytes(value, stopAfter) {
  let bytes = 0;
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === 'string') {
      if (current.length > stopAfter - bytes) return stopAfter + 1;
      bytes += Buffer.byteLength(current, 'utf8');
    }
    else if (typeof current === 'number' || typeof current === 'boolean') bytes += 16;
    else if (current === null) bytes += 4;
    else if (Array.isArray(current)) {
      if (current.length > stopAfter - bytes) return stopAfter + 1;
      for (let index = current.length - 1; index >= 0; index -= 1) stack.push(current[index]);
    }
    else if (isObject(current)) {
      for (const [key, child] of Object.entries(current)) {
        bytes += Buffer.byteLength(key, 'utf8');
        stack.push(child);
      }
    }
    if (bytes > stopAfter) return stopAfter + 1;
  }
  return bytes;
}

function smallSummary(content) {
  if (!isObject(content)) return null;
  const candidate = [content.summary, content.text, content.description].find((value) => typeof value === 'string' && value.length > 0);
  if (!candidate) return null;
  return candidate.length <= MAX_SMALL_SUMMARY_CHARS
    ? candidate
    : `${candidate.slice(0, MAX_SMALL_SUMMARY_CHARS - 1)}…`;
}

function discloseReference(value, policy, label = 'source-ref') {
  if (!isNonEmptyString(value)) return null;
  if (policy.sourceRefDisclosure === 'as_supplied') return value;
  return `${label}:sha256:${sha256(String(value))}`;
}

function contentReceipt(item, observation, policy) {
  const content = observation.content;
  if (!isObject(content)) {
    return {
      contentRef: null,
      contentDigest: null,
      digestScope: 'none',
      smallSummary: null,
      declaredBytes: null,
      inlineBytes: 0,
      coveredBytes: null,
      residualBytes: null,
      rawContentRetained: false,
      inlineEncoding: null,
      inspectionTruncated: false
    };
  }
  const inspectionBytes = boundedValueBytes(content, MAX_STDIN_JSON_BYTES);
  const inspectionTruncated = inspectionBytes > MAX_STDIN_JSON_BYTES;
  const contentRef = isNonEmptyString(content.contentRef) ? content.contentRef : null;
  const explicitDigest = HASH.test(String(content.digest ?? '')) ? String(content.digest).toLowerCase() : null;
  const referenceBacked = Boolean(contentRef || isNonEmptyString(item.source.contentRef));
  const overInlineInspectionBudget = !referenceBacked && inspectionBytes > policy.byteBudget.maxInlineBytes;
  const contentDigest = explicitDigest
    ?? (contentRef ? String(item.source.inputDigest).toLowerCase() : inspectionTruncated || overInlineInspectionBudget ? null : sha256(stableJson(content)));
  const declaredBytes = isNonNegativeSafeInteger(content.declaredBytes) ? content.declaredBytes : null;
  const encodedInline = isNonEmptyString(content.encoding) || isNonEmptyString(content.data);
  const inlineBytes = isNonNegativeSafeInteger(content.inlineBytes)
    ? content.inlineBytes
    : encodedInline
      ? declaredBytes ?? (isNonEmptyString(content.data) ? Buffer.byteLength(content.data, 'utf8') : 0)
      : referenceBacked ? 0 : inspectionBytes;
  return {
    contentRef: discloseReference(contentRef, policy, 'content-ref'),
    contentDigest,
    digestScope: explicitDigest ? 'content' : contentRef ? 'source_input' : contentDigest ? 'small_inline_observation' : 'none',
    smallSummary: smallSummary(content),
    declaredBytes,
    inlineBytes,
    coveredBytes: isNonNegativeSafeInteger(content.coveredBytes) ? content.coveredBytes : null,
    residualBytes: isNonNegativeSafeInteger(content.residualBytes) ? content.residualBytes : null,
    rawContentRetained: false,
    inlineEncoding: isNonEmptyString(content.encoding) ? content.encoding : null,
    inspectionTruncated
  };
}

function normalizedObservationPayload(item, observation, normalizedContentReceipt, policy) {
  return {
    sourceArtifactId: item.id,
    sourceRef: discloseReference(item.source.sourceRef, policy),
    modality: item.modality,
    observationId: observation.id,
    stage: observation.stage,
    state: observation.state,
    sourceInputDigest: String(observation.sourceInputDigest).toLowerCase(),
    processor: observation.processor,
    anchor: observation.anchor,
    confidence: observation.confidence ?? null,
    unknowns: uniqueSorted(observation.unknowns),
    contentReceipt: normalizedContentReceipt,
    derivedArtifact: observation.derivedArtifact ?? null
  };
}

function currentHostDerivedMatches(observation, presentation, host) {
  const artifact = observation.derivedArtifact;
  return host.versionEvidence === 'current_host_observed'
    && presentation.state === 'current_host_derived_artifact_received'
    && isObject(artifact)
    && artifact.origin === 'workbuddy_current_host'
    && artifact.hostProduct === 'WorkBuddy'
    && artifact.hostProduct === host.product
    && artifact.hostVersion === host.version
    && artifact.hostInstanceId === host.instanceId
    && HASH.test(String(artifact.artifactDigest ?? ''));
}

function normalizeObservation(item, observation, host, policy, presentation) {
  const normalizedContentReceipt = contentReceipt(item, observation, policy);
  const payload = normalizedObservationPayload(item, observation, normalizedContentReceipt, policy);
  const observationDigest = sha256(stableJson(payload));
  const reasons = [];
  const warnings = [];
  const sourceDigestMatches = payload.sourceInputDigest === String(item.source.inputDigest).toLowerCase();
  const suppliedDigestMatches = observation.expectedObservationDigest === undefined
    || String(observation.expectedObservationDigest).toLowerCase() === observationDigest;
  const contentPresented = PRESENTED_CONTENT_STATES.has(item.presentation.state) && presentation.bindingMatches;
  const originalEvidenceObserved = ORIGINAL_OBSERVED_STATES.has(item.source.evidenceState);
  const audiovisual = item.modality === 'audio' || item.modality === 'video';
  const currentHostDerived = audiovisual ? currentHostDerivedMatches(observation, item.presentation, host) : null;
  const anchorInScope = scopeContainsAnchor(item.source.scope, observation.anchor);

  if (!sourceDigestMatches) reasons.push('source_input_digest_mismatch');
  if (!suppliedDigestMatches) reasons.push('observation_digest_mismatch');
  if (!anchorInScope) reasons.push('anchor_outside_source_scope');
  if (!contentPresented) reasons.push('content_presentation_not_observed');
  if (!audiovisual && !originalEvidenceObserved) reasons.push('source_content_not_observed');
  if (audiovisual && !currentHostDerived) reasons.push('current_host_derived_artifact_required');
  if (normalizedContentReceipt.inlineEncoding?.toLowerCase() === 'base64') reasons.push('inline_base64_forbidden');
  if (normalizedContentReceipt.inlineBytes > policy.byteBudget.maxInlineBytes || normalizedContentReceipt.inspectionTruncated) {
    reasons.push('inline_byte_budget_exceeded');
  }
  if (normalizedContentReceipt.contentRef && normalizedContentReceipt.inlineBytes > 0) reasons.push('content_ref_with_inline_payload_forbidden');
  if (observation.state === 'failed') reasons.push('processor_failed');
  if (observation.state === 'not_observed') reasons.push('observation_not_observed');

  const confidenceScore = observation.confidence
    ? Math.min(observation.confidence.extraction, observation.confidence.alignment, observation.confidence.identity)
    : null;
  const lowConfidence = confidenceScore !== null && confidenceScore < policy.lowConfidenceThreshold;
  const hasUnknowns = observation.unknowns.length > 0;
  if (lowConfidence) warnings.push('low_confidence');
  if (hasUnknowns) warnings.push('unknowns_present');

  const hardReasons = reasons.filter((reason) => !['observation_not_observed'].includes(reason));
  let status = observation.state;
  if (hardReasons.length > 0 || observation.state === 'failed') status = 'rejected';
  else if (observation.state === 'not_observed') status = 'not_observed';
  else if (observation.anchor.type === 'bbox_unavailable') {
    status = 'partial';
    warnings.push('bbox_unavailable_region_precision_residual');
  }
  if (status === 'observed' && observation.stage === 'visual_observation') {
    status = 'partial';
    warnings.push('model_visual_observation_requires_independent_source_review');
  }

  return {
    ...payload,
    observationDigest,
    expectedObservationDigest: observation.expectedObservationDigest?.toLowerCase() ?? null,
    suppliedDigestMatches,
    sourceDigestMatches,
    contentReadClaimAllowed: originalEvidenceObserved && item.source.evidenceState === 'bytes_observed' && status !== 'rejected',
    currentHostDerivedArtifactAccepted: currentHostDerived,
    anchorWithinSourceScope: anchorInScope,
    aggregateConfidence: confidenceScore,
    lowConfidence,
    status,
    reasonCodes: uniqueSorted(reasons),
    warnings: uniqueSorted(warnings)
  };
}

function unionLength(ranges) {
  const sorted = ranges
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  if (sorted.length === 0) return 0;
  let total = 0;
  let [currentStart, currentEnd] = sorted[0];
  for (const [start, end] of sorted.slice(1)) {
    if (start <= currentEnd) currentEnd = Math.max(currentEnd, end);
    else {
      total += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    }
  }
  return total + currentEnd - currentStart;
}

function dimensionCoverage(item, accepted, dimension) {
  const scope = item.source.scope;
  if (dimension === 'pages' && scope.type === 'page_range') {
    const declared = scope.endPage - scope.startPage + 1;
    const pages = new Set(accepted
      .filter((observation) => ['page', 'page_bbox'].includes(observation.anchor.type))
      .map((observation) => observation.anchor.page));
    const covered = Math.min(declared, pages.size);
    return { declared, covered, residual: declared - covered, unit: 'page' };
  }
  if (dimension === 'timeMs' && scope.type === 'time_range') {
    const declared = scope.endMs - scope.startMs;
    const covered = Math.min(declared, unionLength(accepted
      .filter((observation) => observation.anchor.type === 'time_range')
      .map((observation) => [observation.anchor.startMs, observation.anchor.endMs])));
    return { declared, covered, residual: declared - covered, unit: 'millisecond' };
  }
  if (dimension === 'frames' && scope.type === 'frame_range') {
    const declared = scope.endFrame - scope.startFrame;
    const ranges = accepted
      .filter((observation) => ['frame_range', 'frame_bbox'].includes(observation.anchor.type))
      .map((observation) => observation.anchor.type === 'frame_bbox'
        ? [observation.anchor.frame, observation.anchor.frame + 1]
        : [observation.anchor.startFrame, observation.anchor.endFrame]);
    const covered = Math.min(declared, unionLength(ranges));
    return { declared, covered, residual: declared - covered, unit: 'frame' };
  }
  return { declared: null, covered: null, residual: null, unit: dimension };
}

function normalizeInventory(item) {
  const declaredBytes = isNonNegativeSafeInteger(item.source.declaredBytes) ? item.source.declaredBytes : null;
  const inferredState = ORIGINAL_OBSERVED_STATES.has(item.source.evidenceState) || isNonEmptyString(item.source.contentRef)
    ? 'hash_complete'
    : item.source.evidenceState === 'descriptor_only' ? 'metadata_observed' : 'hash_pending';
  const state = item.source.inventoryState ?? inferredState;
  const mode = item.source.hashMode ?? (state === 'hash_complete' ? 'complete' : state === 'hash_pending' ? 'streaming' : 'metadata_only');
  const hashedBytes = item.source.hashedBytes ?? (state === 'hash_complete' && declaredBytes !== null ? declaredBytes : 0);
  const reasonCodes = [];
  if (declaredBytes !== null && hashedBytes > declaredBytes) reasonCodes.push('hashed_bytes_exceed_declared_bytes');
  if (state === 'hash_complete' && declaredBytes !== null && hashedBytes !== declaredBytes) reasonCodes.push('hash_complete_byte_conservation_failed');
  if (state === 'metadata_observed' && mode !== 'metadata_only') reasonCodes.push('metadata_state_hash_mode_conflict');
  if (state === 'hash_pending' && !['streaming', 'incremental'].includes(mode)) reasonCodes.push('hash_pending_mode_conflict');
  if (state === 'hash_complete' && !['complete', 'incremental'].includes(mode)) reasonCodes.push('hash_complete_mode_conflict');
  const payload = {
    state,
    mode,
    declaredBytes,
    hashedBytes,
    remainingHashBytes: declaredBytes === null ? null : Math.max(0, declaredBytes - hashedBytes),
    inputDigest: String(item.source.inputDigest).toLowerCase(),
    digestClaim: state === 'hash_complete' ? 'complete_digest_bound' : state === 'hash_pending' ? 'digest_not_yet_complete' : 'metadata_only',
    reasonCodes: uniqueSorted(reasonCodes)
  };
  return { ...payload, receiptDigest: sha256(stableJson(payload)) };
}

function normalizeRole(item) {
  const materialRole = item.materialRole ?? 'content';
  const useScope = item.useScope ?? defaultUseScope(materialRole);
  const reasonCodes = [];
  if (materialRole === 'reference_style' && useScope.factUse !== 'forbidden') reasonCodes.push('reference_style_fact_leakage');
  if (materialRole === 'both_scoped'
    && (useScope.factUse !== 'allowed' || useScope.styleUse !== 'allowed' || useScope.scopeRefs.length === 0)) {
    reasonCodes.push('both_scoped_requires_explicit_scope');
  }
  if (materialRole === 'control_instruction'
    && (useScope.factUse !== 'forbidden' || useScope.styleUse !== 'forbidden' || useScope.instructionUse !== 'allowed')) {
    reasonCodes.push('control_instruction_scope_violation');
  }
  const payload = {
    materialRole,
    useScope,
    factContributionAllowed: useScope.factUse === 'allowed' && materialRole !== 'reference_style',
    styleContributionAllowed: useScope.styleUse === 'allowed',
    instructionContributionAllowed: useScope.instructionUse === 'allowed',
    factIsolationEnforced: materialRole === 'reference_style',
    reasonCodes: uniqueSorted(reasonCodes)
  };
  return { ...payload, receiptDigest: sha256(stableJson(payload)) };
}

function normalizeCoverage(item, observations, accepted, status) {
  const declaredBytes = isNonNegativeSafeInteger(item.source.declaredBytes) ? item.source.declaredBytes : null;
  const byteCoverageEntries = observations
    .map((observation) => observation.contentReceipt)
    .filter((content) => content.coveredBytes !== null || content.residualBytes !== null);
  let coveredBytes = null;
  let residualBytes = null;
  const reasonCodes = [];
  if (byteCoverageEntries.length > 1) reasonCodes.push('ambiguous_byte_coverage');
  if (byteCoverageEntries.length === 1) {
    coveredBytes = byteCoverageEntries[0].coveredBytes;
    residualBytes = byteCoverageEntries[0].residualBytes;
  } else if (declaredBytes !== null && status === 'observed') {
    coveredBytes = declaredBytes;
    residualBytes = 0;
  } else if (declaredBytes !== null && accepted.length === 0) {
    coveredBytes = 0;
    residualBytes = declaredBytes;
  }
  if (declaredBytes !== null && status === 'partial' && (coveredBytes === null || residualBytes === null)) {
    reasonCodes.push('partial_byte_coverage_required');
  }
  if (declaredBytes !== null && coveredBytes !== null && residualBytes !== null
    && coveredBytes + residualBytes !== declaredBytes) {
    reasonCodes.push('byte_coverage_conservation_failed');
  }
  const payload = {
    items: {
      declared: 1,
      covered: accepted.length > 0 ? 1 : 0,
      residual: accepted.length > 0 ? 0 : 1,
      unit: 'item'
    },
    bytes: {
      declared: declaredBytes,
      covered: coveredBytes,
      residual: residualBytes,
      conserved: declaredBytes === null || (coveredBytes !== null && residualBytes !== null && coveredBytes + residualBytes === declaredBytes),
      unit: 'byte'
    },
    pages: dimensionCoverage(item, accepted, 'pages'),
    timeMs: dimensionCoverage(item, accepted, 'timeMs'),
    frames: dimensionCoverage(item, accepted, 'frames'),
    coveredBytes,
    residualBytes,
    reasonCodes: uniqueSorted(reasonCodes)
  };
  return { ...payload, receiptDigest: sha256(stableJson(payload)) };
}

function maturityLevel({ accepted, status, coverageReceipt, inventoryReceipt }) {
  if (accepted.length === 0) {
    if (inventoryReceipt.state === 'hash_complete') return 'L2';
    if (inventoryReceipt.state === 'hash_pending') return 'L1';
    return 'L0';
  }
  if (inventoryReceipt.state !== 'hash_complete') return 'L3';
  if (status === 'partial' || status === 'human_review_required' || coverageReceipt.bytes.residual > 0) return 'L3';
  return 'L4';
}

function normalizeItem(item, host, policy) {
  const presentation = presentationReceipt(item, host, policy);
  const observations = item.observations.map((observation) => normalizeObservation(item, observation, host, policy, presentation));
  const accepted = observations.filter((observation) => ['observed', 'partial'].includes(observation.status));
  const rejected = observations.filter((observation) => observation.status === 'rejected');
  const roleReceipt = normalizeRole(item);
  const inventoryReceipt = normalizeInventory(item);
  const lowConfidence = accepted.some((observation) => observation.lowConfidence);
  const unknowns = uniqueSorted(accepted.flatMap((observation) => observation.unknowns));
  const unknownStop = policy.stopOnUnknown && unknowns.length > 0;
  const digestStop = rejected.some((observation) => observation.reasonCodes.some((reason) => [
    'source_input_digest_mismatch', 'observation_digest_mismatch', 'anchor_outside_source_scope'
  ].includes(reason)));
  const audiovisualStop = rejected.some((observation) => observation.reasonCodes.includes('current_host_derived_artifact_required'));
  const inlineStopReasons = uniqueSorted(rejected.flatMap((observation) => observation.reasonCodes.filter((reason) => [
    'inline_base64_forbidden', 'inline_byte_budget_exceeded', 'content_ref_with_inline_payload_forbidden'
  ].includes(reason))));
  const stopReasons = [];
  if (lowConfidence) stopReasons.push('low_confidence');
  if (unknownStop) stopReasons.push('unknown_observation');
  if (digestStop) {
    if (rejected.some((observation) => observation.reasonCodes.includes('anchor_outside_source_scope'))) stopReasons.push('source_scope_violation');
    if (rejected.some((observation) => observation.reasonCodes.some((reason) => ['source_input_digest_mismatch', 'observation_digest_mismatch'].includes(reason)))) {
      stopReasons.push('digest_integrity_failure');
    }
  }
  if (audiovisualStop) stopReasons.push('current_host_derived_artifact_required');
  stopReasons.push(...inlineStopReasons);
  stopReasons.push(...roleReceipt.reasonCodes);
  stopReasons.push(...inventoryReceipt.reasonCodes);

  let status;
  if (lowConfidence || unknownStop) status = 'human_review_required';
  else if (rejected.length > 0) status = 'degraded';
  else if (accepted.length === 0) status = 'not_observed';
  else if (accepted.some((observation) => observation.status === 'partial') || accepted.length !== observations.length) status = 'partial';
  else status = 'observed';

  const coverageReceipt = normalizeCoverage(item, observations, accepted, status);
  stopReasons.push(...coverageReceipt.reasonCodes);
  if (stopReasons.length > 0 && status === 'observed') status = 'degraded';
  const maturityPayload = {
    level: maturityLevel({ accepted, status, coverageReceipt, inventoryReceipt }),
    inventoryState: inventoryReceipt.state,
    hashMode: inventoryReceipt.mode,
    coverageState: coverageReceipt.bytes.conserved ? 'conserved' : 'not_conserved',
    expertUseState: 'not_observed'
  };
  const maturityReceipt = { ...maturityPayload, receiptDigest: sha256(stableJson(maturityPayload)) };

  const extractionPayload = {
    sourceArtifactId: item.id,
    sourceRef: discloseReference(item.source.sourceRef, policy),
    modality: item.modality,
    inputDigest: String(item.source.inputDigest).toLowerCase(),
    sourceEvidenceState: item.source.evidenceState,
    sourceScope: item.source.scope,
    originalReadOnly: true,
    originalMutationCount: 0,
    status,
    observationDigests: accepted.map((observation) => observation.observationDigest),
    aggregateConfidence: accepted.length
      ? Math.min(...accepted.map((observation) => observation.aggregateConfidence))
      : null,
    unknowns,
    stopRequired: stopReasons.length > 0,
    stopReasons: uniqueSorted(stopReasons)
  };
  const extractionReceipt = {
    ...extractionPayload,
    receiptDigest: sha256(stableJson(extractionPayload))
  };

  return {
    id: item.id,
    modality: item.modality,
    order: item.order,
    materialRole: roleReceipt.materialRole,
    useScope: roleReceipt.useScope,
    roleReceipt,
    sourceRef: discloseReference(item.source.sourceRef, policy),
    contentRef: discloseReference(item.source.contentRef, policy, 'content-ref'),
    declaredBytes: item.source.declaredBytes ?? null,
    sourceScope: item.source.scope,
    inputDigest: String(item.source.inputDigest).toLowerCase(),
    inputDigestEvidence: item.source.evidenceState,
    originalReadOnly: true,
    originalMutationCount: 0,
    presentationReceipt: presentation,
    observations,
    extractionReceipt,
    inventoryReceipt,
    coverageReceipt,
    maturityReceipt,
    status,
    stop: {
      required: stopReasons.length > 0,
      reasonCodes: uniqueSorted(stopReasons)
    }
  };
}

function normalizeExpertUse(expertUse, host, items) {
  const notObservedPayload = {
    state: 'not_observed',
    expertId: expertUse.expertId,
    hostProduct: expertUse.hostProduct,
    hostInstanceId: expertUse.hostInstanceId,
    consumedObservations: [],
    outputArtifactDigest: expertUse.outputArtifactDigest,
    reasonCodes: []
  };
  if (expertUse.state === 'not_observed') {
    return { ...notObservedPayload, receiptDigest: sha256(stableJson(notObservedPayload)) };
  }

  const observationIndex = new Map();
  for (const item of items) {
    if (item.stop.required) continue;
    for (const observation of item.observations) {
      if (observation.status === 'observed' && !observation.lowConfidence && observation.unknowns.length === 0) {
        observationIndex.set(observation.observationId, {
          observationId: observation.observationId,
          observationDigest: observation.observationDigest,
          sourceArtifactId: item.id,
          materialRole: item.materialRole,
          useScope: item.useScope
        });
      }
    }
  }
  const reasonCodes = [];
  if (host.versionEvidence !== 'current_host_observed') reasonCodes.push('current_host_observation_required');
  if (expertUse.hostProduct !== host.product || expertUse.hostInstanceId !== host.instanceId) reasonCodes.push('expert_use_host_binding_mismatch');
  if (new Set(expertUse.consumedObservationIds).size !== expertUse.consumedObservationIds.length) reasonCodes.push('duplicate_consumed_observation_id');
  const consumedObservations = expertUse.consumedObservationIds
    .map((observationId) => observationIndex.get(observationId) ?? null)
    .filter(Boolean);
  if (consumedObservations.length !== expertUse.consumedObservationIds.length) reasonCodes.push('expert_use_observation_unbound');

  const payload = {
    state: reasonCodes.length ? 'rejected' : 'receipt_bound_input_only',
    evidenceClass: 'caller_supplied_structured_receipt',
    canPromoteHostEvidence: false,
    expertId: expertUse.expertId,
    hostProduct: expertUse.hostProduct,
    hostInstanceId: expertUse.hostInstanceId,
    consumedObservations,
    outputArtifactDigest: String(expertUse.outputArtifactDigest).toLowerCase(),
    reasonCodes: uniqueSorted(reasonCodes)
  };
  return { ...payload, receiptDigest: sha256(stableJson(payload)) };
}

function promoteExpertUseMaturity(items, expertUseReceipt) {
  if (expertUseReceipt.state !== 'receipt_bound_observed') return items;
  const consumed = new Set(expertUseReceipt.consumedObservations.map((observation) => observation.observationId));
  return items.map((item) => {
    const used = item.observations.some((observation) => consumed.has(observation.observationId));
    if (!used) return item;
    const payload = {
      ...item.maturityReceipt,
      level: 'L5',
      expertUseState: 'receipt_bound_observed'
    };
    delete payload.receiptDigest;
    return { ...item, maturityReceipt: { ...payload, receiptDigest: sha256(stableJson(payload)) } };
  });
}

function normalizeCapacity(input, items, policy) {
  const calculatedDeclaredBytes = items.reduce((sum, item) => sum + (item.declaredBytes ?? 0), 0);
  const calculatedContentRefCount = items.filter((item) => isNonEmptyString(item.contentRef)).length;
  const calculatedInlineBytes = items.reduce((sum, item) => sum + item.observations.reduce(
    (observationSum, observation) => observationSum + observation.contentReceipt.inlineBytes,
    0
  ), 0);
  const declared = input.capacity !== undefined;
  const declaredBytes = declared ? input.capacity.declaredBytes : calculatedDeclaredBytes;
  const inlineBytes = declared ? input.capacity.inlineBytes : calculatedInlineBytes;
  const contentRefCount = declared ? input.capacity.contentRefCount : calculatedContentRefCount;
  const reasonCodes = [];
  if (declared && declaredBytes !== calculatedDeclaredBytes) reasonCodes.push('declared_byte_conservation_failed');
  if (declared && inlineBytes !== calculatedInlineBytes) reasonCodes.push('inline_byte_conservation_failed');
  if (declared && contentRefCount !== calculatedContentRefCount) reasonCodes.push('content_ref_count_conservation_failed');
  if (declaredBytes > policy.byteBudget.maxTotalDeclaredBytes) reasonCodes.push('total_declared_byte_budget_exceeded');
  if (inlineBytes > policy.byteBudget.maxInlineBytes) reasonCodes.push('inline_byte_budget_exceeded');
  if (declared && declaredBytes > 0 && items.some((item) => item.declaredBytes === null || !isNonEmptyString(item.contentRef))) {
    reasonCodes.push('capacity_source_binding_incomplete');
  }
  const payload = {
    declared,
    declaredBytes,
    inlineBytes,
    contentRefCount,
    calculatedDeclaredBytes,
    calculatedInlineBytes,
    calculatedContentRefCount,
    conserved: !reasonCodes.some((reason) => reason.endsWith('_conservation_failed')),
    byteBudget: policy.byteBudget,
    byteBudgetAccepted: !reasonCodes.some((reason) => reason.includes('byte_budget_exceeded')),
    referenceOnly: inlineBytes === 0 && contentRefCount > 0,
    metadataOnly: true,
    allocatedPayloadBytes: 0,
    rawContentRetained: false,
    reasonCodes: uniqueSorted(reasonCodes)
  };
  return { ...payload, receiptDigest: sha256(stableJson(payload)) };
}

function makeChunkDigestIndex(batch, policy) {
  return new Map((batch?.chunkDigestRefs ?? []).map((ref) => [
    `${discloseReference(ref.sourceRef, policy, 'content-ref')}\u0000${ref.ordinal}`,
    String(ref.digest).toLowerCase()
  ]));
}

function normalizeBatch(input, items, policy) {
  const maxBatchBytes = input.batch?.maxBatchBytes ?? input.flowControl?.maxBatchBytes ?? policy.byteBudget.maxBatchBytes;
  const digestIndex = makeChunkDigestIndex(input.batch, policy);
  const chunks = [];
  const sourcePlans = [];
  let globalOrdinal = 1;
  let plannedBytes = 0;
  for (const item of items) {
    if (item.declaredBytes === null || !isNonEmptyString(item.contentRef)) continue;
    const sourceChunks = [];
    for (let offsetBytes = 0, sourceOrdinal = 1; offsetBytes < item.declaredBytes; sourceOrdinal += 1) {
      const lengthBytes = Math.min(maxBatchBytes, item.declaredBytes - offsetBytes);
      const chunk = {
        ordinal: globalOrdinal,
        batchIndex: globalOrdinal - 1,
        sourceOrdinal,
        sourceArtifactId: item.id,
        sourceRef: item.contentRef,
        sourceInputDigest: item.inputDigest,
        offsetBytes,
        lengthBytes,
        residualAfterBytes: item.declaredBytes - offsetBytes - lengthBytes,
        digestRef: digestIndex.get(`${item.contentRef}\u0000${sourceOrdinal}`) ?? null,
        inlinePayloadIncluded: false
      };
      chunks.push(chunk);
      sourceChunks.push(chunk);
      plannedBytes += lengthBytes;
      offsetBytes += lengthBytes;
      globalOrdinal += 1;
    }
    sourcePlans.push({
      sourceArtifactId: item.id,
      contentRef: item.contentRef,
      declaredBytes: item.declaredBytes,
      batchCount: sourceChunks.length,
      plannedBytes: sourceChunks.reduce((sum, chunk) => sum + chunk.lengthBytes, 0),
      residualBytes: item.declaredBytes - sourceChunks.reduce((sum, chunk) => sum + chunk.lengthBytes, 0)
    });
  }
  const nextBatchIndex = input.batch?.nextBatchIndex ?? 0;
  const resumeFromCheckpoint = input.batch?.resumeFromCheckpoint ?? false;
  const checkpointDigest = input.batch?.checkpointDigest?.toLowerCase() ?? null;
  const completedPrefix = chunks.filter((chunk) => chunk.batchIndex < nextBatchIndex);
  const chunkManifestCompleteForPrefix = completedPrefix.length > 0 && completedPrefix.every((chunk) => chunk.digestRef !== null);
  const hashResumeMode = !resumeFromCheckpoint
    ? 'not_requested'
    : chunkManifestCompleteForPrefix ? 'chunk_manifest' : 'full_restart';
  const unboundChunkDigestRefs = [...digestIndex.keys()].filter((key) => !chunks.some((chunk) => `${chunk.sourceRef}\u0000${chunk.sourceOrdinal}` === key));
  const totalDeclaredBytes = sourcePlans.reduce((sum, plan) => sum + plan.declaredBytes, 0);
  const residualBytes = totalDeclaredBytes - plannedBytes;
  const reasonCodes = [];
  if (maxBatchBytes > policy.byteBudget.maxBatchBytes) reasonCodes.push('batch_byte_budget_exceeded');
  if (residualBytes !== 0) reasonCodes.push('batch_plan_byte_conservation_failed');
  if (unboundChunkDigestRefs.length > 0) reasonCodes.push('chunk_digest_ref_unbound');
  if (nextBatchIndex > chunks.length) reasonCodes.push('checkpoint_batch_index_out_of_range');
  const planPayload = {
    maxBatchBytes,
    sourcePlans,
    chunks,
    totalBatchCount: chunks.length,
    totalDeclaredBytes,
    plannedBytes,
    residualBytes,
    byteConserved: residualBytes === 0,
    metadataOnly: true,
    allocatedPayloadBytes: 0
  };
  const batchPlan = { ...planPayload, planDigest: sha256(stableJson(planPayload)) };
  const payload = {
    maxBatchBytes,
    nextBatchIndex,
    checkpointDigest,
    resumeFromCheckpoint,
    hashResumeMode,
    hashState: resumeFromCheckpoint && hashResumeMode === 'full_restart' ? 'hash_pending' : 'hash_complete',
    standardFileShaInternalStateResumed: false,
    checkpointResumeExecutable: resumeFromCheckpoint && hashResumeMode === 'chunk_manifest',
    chunkManifestDigest: digestIndex.size > 0
      ? sha256(stableJson([...digestIndex.entries()].map(([key, digest]) => ({ key, digest }))))
      : null,
    unboundChunkDigestRefCount: unboundChunkDigestRefs.length,
    batchPlan,
    reasonCodes: uniqueSorted(reasonCodes)
  };
  return { ...payload, receiptDigest: sha256(stableJson(payload)) };
}

function normalizeFlowControl(input, policy) {
  const configured = input.flowControl !== undefined;
  const maxInFlightBatches = input.flowControl?.maxInFlightBatches ?? 1;
  const requestedInFlightBatches = input.flowControl?.requestedInFlightBatches ?? 1;
  const maxBatchBytes = input.flowControl?.maxBatchBytes ?? policy.byteBudget.maxBatchBytes;
  const backpressureRequired = requestedInFlightBatches > maxInFlightBatches;
  const reasonCodes = [];
  if (backpressureRequired) reasonCodes.push('backpressure_required');
  if (maxBatchBytes > policy.byteBudget.maxBatchBytes) reasonCodes.push('batch_byte_budget_exceeded');
  const payload = {
    configured,
    maxInFlightBatches,
    requestedInFlightBatches,
    acceptedInFlightBatches: Math.min(maxInFlightBatches, requestedInFlightBatches),
    maxBatchBytes,
    backpressureRequired,
    payloadBufferedBytes: 0,
    metadataOnly: true,
    reasonCodes: uniqueSorted(reasonCodes)
  };
  return { ...payload, receiptDigest: sha256(stableJson(payload)) };
}

export function runMaterialIntake(input = {}) {
  const capacityErrors = cardinalityErrors(input);
  if (capacityErrors.length) return invalidResult(null, capacityErrors);
  const validationErrors = validateRequest(input);
  if (validationErrors.length > 0) return invalidResult(input?.requestId, validationErrors);

  const policy = {
    lowConfidenceThreshold: input.policy?.lowConfidenceThreshold ?? 0.7,
    stopOnUnknown: input.policy?.stopOnUnknown ?? true,
    sourceRefDisclosure: input.policy?.sourceRefDisclosure ?? 'opaque_digest',
    byteBudget: {
      maxTotalDeclaredBytes: input.policy?.byteBudget?.maxTotalDeclaredBytes ?? DEFAULT_MAX_TOTAL_DECLARED_BYTES,
      maxInlineBytes: input.policy?.byteBudget?.maxInlineBytes ?? DEFAULT_MAX_INLINE_BYTES,
      maxBatchBytes: input.policy?.byteBudget?.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES
    }
  };
  const host = normalizeHost(input.host);
  let items = [...input.items]
    .sort((left, right) => left.order - right.order)
    .map((item) => normalizeItem(item, host, policy));
  const expertUseReceipt = normalizeExpertUse(input.expertUse, host, items);
  items = promoteExpertUseMaturity(items, expertUseReceipt);
  const capacityReceipt = normalizeCapacity(input, items, policy);
  const batchReceipt = normalizeBatch(input, items, policy);
  const flowControlReceipt = normalizeFlowControl(input, policy);
  const counts = {
    observedCount: items.filter((item) => item.status === 'observed').length,
    partialCount: items.filter((item) => item.status === 'partial').length,
    notObservedCount: items.filter((item) => item.status === 'not_observed').length,
    degradedCount: items.filter((item) => item.status === 'degraded').length,
    humanReviewRequiredCount: items.filter((item) => item.status === 'human_review_required').length
  };
  const stopReasons = uniqueSorted([
    ...items.flatMap((item) => item.stop.reasonCodes),
    ...(expertUseReceipt.state === 'rejected' ? expertUseReceipt.reasonCodes : []),
    ...capacityReceipt.reasonCodes,
    ...batchReceipt.reasonCodes,
    ...flowControlReceipt.reasonCodes
  ]);
  const stopRequired = stopReasons.length > 0;
  const consumptionReady = !stopRequired && items.length > 0
    && items.every((item) => ['observed', 'partial'].includes(item.status) && !item.stop.required);
  let status;
  if (stopRequired) status = 'blocked';
  else if (counts.observedCount === items.length) status = 'observed';
  else if (counts.notObservedCount === items.length) status = 'not_observed';
  else if (counts.degradedCount > 0) status = 'degraded';
  else status = 'partial';

  const warnings = uniqueSorted([
    ...items.flatMap((item) => item.observations.flatMap((observation) => observation.warnings)),
    ...(input.modelDeclaration.state === 'model_badge_only' ? ['model_badge_is_declaration_only'] : []),
    ...(input.items.some((item) => item.presentation.state === 'attachment_card_observed')
      ? ['attachment_card_does_not_prove_content_observation']
      : [])
  ]);

  return sealResult({
    schemaVersion: resultSchemaVersion,
    capabilityId,
    requestId: input.requestId,
    ok: consumptionReady && !stopRequired,
    status,
    host,
    modelDeclarationReceipt: modelReceipt(input.modelDeclaration),
    items,
    expertUseReceipt,
    capacityReceipt,
    batchReceipt,
    flowControlReceipt,
    summary: {
      itemCount: items.length,
      ...counts,
      consumptionReady,
      stopRequired,
      stopReasons
    },
    errors: [],
    warnings,
    executionBoundary: executionBoundary()
  });
}

export const run = runMaterialIntake;

export function evaluate(result) {
  if (!isObject(result) || !HASH.test(String(result.resultDigest ?? ''))) {
    return { ok: false, status: 'invalid_result', issues: ['result_digest_required'] };
  }
  const { resultDigest, ...payload } = result;
  const integrityOk = sha256(stableJson(payload)) === resultDigest;
  const boundaryOk = payload.executionBoundary?.networkUsed === false
    && payload.executionBoundary?.hostInteractionPerformed === false
    && payload.executionBoundary?.originalMutationCount === 0;
  const issues = [];
  if (!integrityOk) issues.push('result_digest_mismatch');
  if (!boundaryOk) issues.push('execution_boundary_invalid');
  if (payload.status === 'invalid_input') issues.push('invalid_input');
  return {
    ok: integrityOk && boundaryOk && payload.status !== 'invalid_input',
    status: integrityOk && boundaryOk ? 'evaluated' : 'rejected',
    issues: uniqueSorted(issues)
  };
}

async function readBoundedStdin() {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;
    if (totalBytes > MAX_STDIN_JSON_BYTES) {
      process.stdin.destroy();
      return { ok: false, raw: null };
    }
    chunks.push(bytes);
  }
  return { ok: true, raw: Buffer.concat(chunks, totalBytes).toString('utf8') };
}

async function runCli() {
  let input;
  try {
    const read = await readBoundedStdin();
    if (!read.ok) {
      const result = invalidResult(null, ['stdin:control_envelope_too_large']);
      process.stdout.write(`${stableJson(result)}\n`);
      process.exitCode = 2;
      return;
    }
    input = JSON.parse(read.raw);
  } catch {
    const result = invalidResult(null, ['stdin:valid_json_required']);
    process.stdout.write(`${stableJson(result)}\n`);
    process.exitCode = 2;
    return;
  }
  const result = runMaterialIntake(input);
  process.stdout.write(`${stableJson(result)}\n`);
  process.exitCode = result.status === 'invalid_input' ? 2 : 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) await runCli();
