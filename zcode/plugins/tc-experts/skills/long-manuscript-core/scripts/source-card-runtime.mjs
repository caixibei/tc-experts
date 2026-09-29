import { sha256, stableJson } from './lib/kernel-utils.mjs';

const HASH = /^[a-f0-9]{64}$/iu;
const ID = /^[a-z][a-z0-9-]{0,127}$/u;
const MODALITIES = new Set(['text', 'pdf', 'image', 'audio', 'video']);
const OBSERVATIONS = new Set(['text_read', 'ocr', 'visual_observation', 'asr', 'subtitle', 'user_supplied_derivative']);
const ANCHORS = new Set(['character_range', 'page', 'page_bbox', 'bbox', 'time_range', 'frame_range', 'frame_bbox']);
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const validRange = (start, end) => Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start;
const validBbox = box => isObject(box) && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(box[key])) && box.width > 0 && box.height > 0;
const exactKeys = (value, keys) => Object.keys(value).every(key => keys.has(key));

export function buildSourceCard(input = {}) {
  const issues = [];
  if (!isObject(input) || !exactKeys(input, new Set(['source', 'derivatives', 'anchors', 'observations', 'claims']))) return { ok: false, issues: ['source_card_shape_invalid'] };
  const { source, derivatives = [], anchors = [], observations = [], claims = [] } = input;
  if (!isObject(source) || !exactKeys(source, new Set(['sourceId', 'modality', 'sourceDigest', 'declaredBytes', 'originKind', 'hostBinding', 'parentSourceDigest', 'parentBinding']))) return { ok: false, issues: ['source_shape_invalid'] };
  if (!ID.test(String(source.sourceId ?? ''))) issues.push('source_id_invalid');
  if (!MODALITIES.has(source.modality)) issues.push('source_modality_invalid');
  if (!HASH.test(String(source.sourceDigest ?? ''))) issues.push('source_digest_invalid');
  if (!Number.isSafeInteger(source.declaredBytes) || source.declaredBytes < 0) issues.push('source_declared_bytes_invalid');
  if (!['original', 'current_host_derived', 'user_supplied_derivative'].includes(source.originKind)) issues.push('source_origin_kind_invalid');
  const hostDerived = source.originKind === 'current_host_derived';
  const supplied = source.originKind === 'user_supplied_derivative';
  if (hostDerived) {
    const host = source.hostBinding;
    if (!isObject(host) || host.product !== 'WorkBuddy' || !ID.test(String(host.instanceId ?? '')) || !String(host.version ?? '').trim()) issues.push('current_host_binding_required');
  } else if (source.hostBinding != null) issues.push('unexpected_host_binding');
  if (supplied) {
    if (!HASH.test(String(source.parentSourceDigest ?? '')) || !['verified', 'unverified'].includes(source.parentBinding)) issues.push('supplied_derivative_parent_binding_invalid');
  } else if (source.parentSourceDigest != null || source.parentBinding != null) issues.push('unexpected_parent_binding');
  if (!Array.isArray(derivatives) || !Array.isArray(anchors) || !Array.isArray(observations) || !Array.isArray(claims)) return { ok: false, issues: ['source_card_collections_invalid'], writingReady: false };
  if (anchors.length > 512 || observations.length > 1024 || claims.length > 1024) issues.push('source_card_cardinality_invalid');
  const derivativeIds = new Set();
  for (const derivative of derivatives) {
    if (!isObject(derivative) || !exactKeys(derivative, new Set(['artifactId', 'kind', 'digest', 'originKind', 'hostBinding', 'parentSourceDigest', 'parentBinding']))) { issues.push('derivative_shape_invalid'); continue; }
    if (!ID.test(String(derivative.artifactId ?? '')) || derivativeIds.has(derivative.artifactId)) issues.push('derivative_id_invalid');
    derivativeIds.add(derivative.artifactId);
    if (!['keyframe', 'transcript', 'subtitle', 'ocr', 'image_crop'].includes(derivative.kind) || !HASH.test(String(derivative.digest ?? ''))) issues.push('derivative_identity_invalid');
    if (derivative.parentSourceDigest !== source.sourceDigest) issues.push('derivative_parent_mismatch');
    if (hostDerived && (!isObject(derivative.hostBinding) || derivative.hostBinding.instanceId !== source.hostBinding?.instanceId || derivative.hostBinding.version !== source.hostBinding?.version || derivative.hostBinding.product !== source.hostBinding?.product || derivative.originKind !== 'current_host_derived')) issues.push('host_derivative_binding_invalid');
    if (supplied && (derivative.originKind !== 'user_supplied_derivative' || derivative.parentBinding !== source.parentBinding)) issues.push('supplied_derivative_binding_invalid');
  }
  const anchorIds = new Set();
  for (const anchor of anchors) {
    if (!isObject(anchor) || !exactKeys(anchor, new Set(['anchorId', 'kind', 'startMs', 'endMs', 'startFrame', 'endFrame', 'frame', 'bbox', 'page', 'start', 'end']))) { issues.push('anchor_shape_invalid'); continue; }
    if (!ID.test(String(anchor.anchorId ?? '')) || anchorIds.has(anchor.anchorId)) issues.push('anchor_id_invalid');
    anchorIds.add(anchor.anchorId);
    if (!ANCHORS.has(anchor.kind)) issues.push('anchor_kind_invalid');
    if (['time_range', 'frame_range'].includes(anchor.kind) && !validRange(anchor.kind === 'time_range' ? anchor.startMs : anchor.startFrame, anchor.kind === 'time_range' ? anchor.endMs : anchor.endFrame)) issues.push('anchor_range_invalid');
    if (anchor.kind === 'frame_bbox' && (!Number.isSafeInteger(anchor.frame) || anchor.frame < 0 || !validBbox(anchor.bbox))) issues.push('anchor_frame_bbox_invalid');
    if (anchor.kind === 'bbox' && !validBbox(anchor.bbox)) issues.push('anchor_bbox_invalid');
    if (anchor.kind === 'character_range' && !validRange(anchor.start, anchor.end)) issues.push('anchor_character_range_invalid');
    if (anchor.kind === 'page' && (!Number.isSafeInteger(anchor.page) || anchor.page < 1)) issues.push('anchor_page_invalid');
    if (anchor.kind === 'page_bbox' && (!Number.isSafeInteger(anchor.page) || anchor.page < 1 || !validBbox(anchor.bbox))) issues.push('anchor_page_bbox_invalid');
    if (source.modality === 'video' && !['time_range', 'frame_range', 'frame_bbox'].includes(anchor.kind)) issues.push('video_anchor_required');
  }
  const observationIds = new Set();
  for (const observation of observations) {
    if (!isObject(observation) || !exactKeys(observation, new Set(['observationId', 'kind', 'anchorId', 'derivativeId', 'contentDigest', 'state', 'unknowns']))) { issues.push('observation_shape_invalid'); continue; }
    if (!ID.test(String(observation.observationId ?? '')) || observationIds.has(observation.observationId)) issues.push('observation_id_invalid');
    observationIds.add(observation.observationId);
    const directText = source.originKind === 'original' && source.modality === 'text' && observation.kind === 'text_read' && observation.derivativeId == null;
    if (!OBSERVATIONS.has(observation.kind) || !anchorIds.has(observation.anchorId) || (!directText && !derivativeIds.has(observation.derivativeId)) || !HASH.test(String(observation.contentDigest ?? ''))) issues.push('observation_binding_invalid');
    if (!['observed', 'partial', 'unknown', 'human_review_required'].includes(observation.state) || !Array.isArray(observation.unknowns)) issues.push('observation_state_invalid');
  }
  const claimIds = new Set();
  for (const claim of claims) {
    if (!isObject(claim) || !exactKeys(claim, new Set(['claimId', 'textDigest', 'observationIds', 'state']))) { issues.push('claim_shape_invalid'); continue; }
    if (!ID.test(String(claim.claimId ?? '')) || !HASH.test(String(claim.textDigest ?? '')) || !Array.isArray(claim.observationIds) || claim.observationIds.length === 0 || claim.observationIds.some(id => !observationIds.has(id))) issues.push('claim_binding_invalid');
    if (!['supported', 'attributed', 'unverified', 'contradicted'].includes(claim.state)) issues.push('claim_state_invalid');
    if (claimIds.has(claim.claimId)) issues.push('claim_id_duplicate');
    claimIds.add(claim.claimId);
  }
  const observedStates = observations.map(item => item?.state);
  const claimStates = claims.map(item => item?.state);
  const usableObservations = observations.length > 0 && observedStates.every(state => state === 'observed' || state === 'partial');
  const usableClaims = claims.length > 0 && claimStates.every(state => state === 'supported' || state === 'attributed');
  const hostOrVerifiedParent = source.originKind !== 'user_supplied_derivative' || source.parentBinding === 'verified';
  const structureReady = issues.length === 0 && (derivatives.length > 0 || (source.originKind === 'original' && source.modality === 'text')) && anchors.length > 0 && observations.length > 0 && claims.length > 0;
  const attributedUseReady = structureReady && usableObservations && usableClaims;
  const factualClaimReady = attributedUseReady && hostOrVerifiedParent && claimStates.every(state => state === 'supported');
  const card = { schemaVersion: 'manuscriptos.source-card/v1', source, derivatives, anchors, observations, claims,
    originalReadOnly: true, hostInteractionPerformed: false, externalActionCount: 0, semanticTruthVerified: false };
  return { ok: issues.length === 0, issues: [...new Set(issues)], card,
    sourceReadiness: { structureReady, attributedUseReady, factualClaimReady, parentBinding: source.parentBinding ?? 'not_applicable' },
    writingReady: attributedUseReady,
    cardDigest: sha256(stableJson(card)) };
}
