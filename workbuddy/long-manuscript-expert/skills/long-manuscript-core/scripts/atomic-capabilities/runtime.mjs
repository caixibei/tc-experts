import { measuredWords, sha256, stableJson, unique } from '../lib/kernel-utils.mjs';
import { validateProject } from '../project-state.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const OBSERVATION_STATES = new Set(['bytes_observed', 'summary_observed', 'digest_supplied_not_observed', 'descriptor_only']);
const DERIVATION_KINDS = new Set(['source_bound', 'inference', 'mixed']);
const CROSS_VALIDATION = new Set(['none', 'single', 'double', 'triple']);
const CHAPTER_STATES = new Set(['planned', 'drafting', 'reviewing', 'complete', 'blocked']);
const GATE_STATES = new Set(['passed', 'failed', 'human_review_pending', 'not_run', 'unknown']);
const OBJECTIVE_STATES = new Set(['planned', 'active', 'blocked', 'complete']);
const TRANSITIONS = {
  null: new Set(['planned', 'drafting']),
  planned: new Set(['planned', 'drafting', 'blocked']),
  drafting: new Set(['drafting', 'reviewing', 'complete', 'blocked']),
  reviewing: new Set(['reviewing', 'drafting', 'complete', 'blocked']),
  complete: new Set(['complete', 'reviewing']),
  blocked: new Set(['blocked', 'planned', 'drafting']),
};

export const ATOMIC_VERBS = Object.freeze([
  'observe', 'inventory', 'bind', 'normalize', 'route', 'compose', 'plan', 'measure', 'compare', 'adjudicate',
  'patch', 'merge', 'project', 'checkpoint', 'brief', 'derive', 'render', 'gate', 'persist-plan',
]);

export const ATOMIC_RUNTIME_POLICY = Object.freeze({
  schemaVersion: '1.0.0',
  executionMode: 'projection_only',
  hostMutationAllowed: false,
  filesystemWriteAllowed: false,
  binaryRenderingAllowed: false,
  externalActionAllowed: false,
  connectorRequired: false,
});

const asObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const digestObject = (value, digestKey) => {
  const copy = structuredClone(value);
  delete copy[digestKey];
  return sha256(stableJson(copy));
};
const digestValid = (value, key) => asObject(value) && HASH.test(String(value[key] ?? '')) && value[key] === digestObject(value, key);
const stringList = (value) => unique((Array.isArray(value) ? value : []).map((item) => String(item).trim()).filter(Boolean));
const validHashList = (value) => Array.isArray(value) && value.every((item) => HASH.test(String(item)));
const safeRelativePath = (value) => {
  const text = String(value ?? '');
  if (!text || text.normalize('NFC') !== text || text.includes('\\') || text.startsWith('/') || /^[A-Za-z]:/u.test(text) || Buffer.byteLength(text, 'utf8') > 220) return false;
  const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
  return text.split('/').every((segment) => segment && segment !== '.' && segment !== '..'
    && !/[<>:"|?*\u0000-\u001f]/u.test(segment) && !/[. ]$/u.test(segment) && !reserved.test(segment));
};
const errorCode = (error, fallback = 'atomic_runtime_invalid_input') => {
  const candidate = String(error?.code ?? error?.message ?? fallback);
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(candidate) ? candidate : fallback;
};

export function createAtomicVerbProjection({
  verb, projectId, objectiveBindingDigest = null, inputObjectRefs = [], outputObjectTypes = [], constraints = [],
} = {}) {
  const issues = [];
  if (!ATOMIC_VERBS.includes(verb)) issues.push('atomic_verb_invalid');
  if (!String(projectId ?? '').trim()) issues.push('project_id_required');
  if (objectiveBindingDigest !== null && !HASH.test(String(objectiveBindingDigest))) issues.push('objective_binding_digest_invalid');
  const outputs = stringList(outputObjectTypes);
  if (outputs.some((item) => !/^[A-Z][A-Za-z0-9]+$/u.test(item))) issues.push('output_object_type_invalid');
  const projection = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_atomic_verb_projection',
    verb: ATOMIC_VERBS.includes(verb) ? verb : String(verb ?? ''), projectId: String(projectId ?? '').trim(),
    objectiveBindingDigest: objectiveBindingDigest === null ? null : String(objectiveBindingDigest),
    inputObjectRefs: stringList(inputObjectRefs), outputObjectTypes: outputs, constraints: stringList(constraints),
    status: issues.length ? 'rejected' : 'planned', issues: unique(issues), executionMode: 'projection_only',
    hostMutationAllowed: false, executionPerformed: false, externalActionCount: 0,
  };
  return { ...projection, projectionDigest: digestObject(projection, 'projectionDigest') };
}

export function createAtomicVerbReceipt(projection) {
  const issues = [];
  if (!digestValid(projection, 'projectionDigest')) issues.push('atomic_projection_digest_invalid');
  if (!ATOMIC_VERBS.includes(projection?.verb)) issues.push('atomic_projection_verb_invalid');
  if (projection?.status !== 'planned' || projection?.hostMutationAllowed !== false || projection?.executionPerformed !== false) issues.push('atomic_projection_not_plannable');
  const receipt = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_atomic_verb_receipt',
    verb: String(projection?.verb ?? ''), projectId: String(projection?.projectId ?? ''),
    projectionDigest: String(projection?.projectionDigest ?? ''), status: issues.length ? 'rejected' : 'validated',
    executionPerformed: false, hostMutationCount: 0, externalActionCount: 0, issues: unique(issues),
  };
  return { ...receipt, receiptDigest: digestObject(receipt, 'receiptDigest') };
}

export function validateAtomicVerbReceipt(receipt, projection) {
  const issues = [];
  if (!digestValid(receipt, 'receiptDigest')) issues.push('atomic_receipt_digest_invalid');
  if (!digestValid(projection, 'projectionDigest')) issues.push('atomic_projection_digest_invalid');
  if (receipt?.projectionDigest !== projection?.projectionDigest || receipt?.verb !== projection?.verb || receipt?.projectId !== projection?.projectId) issues.push('atomic_receipt_binding_mismatch');
  if (receipt?.executionPerformed !== false || receipt?.hostMutationCount !== 0 || receipt?.externalActionCount !== 0) issues.push('atomic_receipt_effect_boundary_invalid');
  return { ok: issues.length === 0, issues: unique(issues) };
}

export function createCapabilitySnapshot({
  taskId, requiredCapabilities = [], optionalCapabilities = [], availableCapabilities = [], rejectionSignals = [], allowedDegradations = [],
} = {}) {
  if (!String(taskId ?? '').trim()) throw new Error('task_id_required');
  const required = stringList(requiredCapabilities);
  const optional = stringList(optionalCapabilities).filter((item) => !required.includes(item));
  const available = stringList(availableCapabilities);
  const rejected = (Array.isArray(rejectionSignals) ? rejectionSignals : []).map((item) => ({
    capability: String(item?.capability ?? '').trim(), signal: String(item?.signal ?? '').trim(), source: String(item?.source ?? 'runtime_observation').trim(),
  })).filter((item) => item.capability && item.signal);
  const degradationRules = (Array.isArray(allowedDegradations) ? allowedDegradations : []).map((item) => ({
    capability: String(item?.capability ?? '').trim(), fallback: String(item?.fallback ?? '').trim(), acceptedByUser: item?.acceptedByUser === true,
  })).filter((item) => item.capability && item.fallback);
  const rejectedCapabilities = new Set(rejected.map((item) => item.capability));
  const missingRequired = required.filter((item) => !available.includes(item) || rejectedCapabilities.has(item));
  const missingOptional = optional.filter((item) => !available.includes(item) || rejectedCapabilities.has(item));
  const activeDegradations = missingRequired.map((capability) => degradationRules.find((item) => item.capability === capability && item.acceptedByUser && available.includes(item.fallback)))
    .filter(Boolean).map(({ capability, fallback }) => ({ capability, fallback }));
  const unresolvedRequired = missingRequired.filter((item) => !activeDegradations.some((entry) => entry.capability === item));
  const cannotClaim = unique([...missingOptional, ...missingRequired, ...rejectedCapabilities]);
  const claimsAllowed = available.filter((item) => !rejectedCapabilities.has(item));
  const status = unresolvedRequired.length ? 'blocked' : activeDegradations.length || missingOptional.length ? 'degraded' : 'ready';
  const snapshot = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_capability_snapshot', taskId: String(taskId).trim(),
    requiredCapabilities: required, optionalCapabilities: optional, availableCapabilities: available,
    rejectionSignals: rejected, allowedDegradations: degradationRules, missingRequired, missingOptional,
    activeDegradations, claimsAllowed, cannotClaim, status, hostMutationAllowed: false, externalActionCount: 0,
  };
  return { ...snapshot, snapshotDigest: digestObject(snapshot, 'snapshotDigest') };
}

export function createArtifactProvenance({
  artifactId, contentDigest = null, observationState = 'descriptor_only', derivationKind = 'source_bound',
  sourceRefs = [], inferenceRefs = [], parentArtifactDigests = [], crossValidation = 'single', generatedByCapability,
} = {}) {
  if (!String(artifactId ?? '').trim() || !OBSERVATION_STATES.has(observationState) || !DERIVATION_KINDS.has(derivationKind)
    || !CROSS_VALIDATION.has(crossValidation) || !String(generatedByCapability ?? '').trim()) throw new Error('artifact_provenance_identity_invalid');
  if (contentDigest !== null && !HASH.test(String(contentDigest))) throw new Error('artifact_content_digest_invalid');
  if (!validHashList(parentArtifactDigests)) throw new Error('parent_artifact_digest_invalid');
  const sources = stringList(sourceRefs);
  const inferences = stringList(inferenceRefs);
  if (['bytes_observed', 'summary_observed'].includes(observationState) && sources.length === 0) throw new Error('observed_provenance_requires_source_ref');
  if (['bytes_observed', 'digest_supplied_not_observed'].includes(observationState) && !HASH.test(String(contentDigest ?? ''))) throw new Error('observation_state_requires_content_digest');
  if (['inference', 'mixed'].includes(derivationKind) && inferences.length === 0) throw new Error('inference_provenance_requires_inference_ref');
  const confidence = observationState === 'bytes_observed' && crossValidation === 'triple' ? 'high'
    : observationState === 'bytes_observed' && crossValidation === 'double' ? 'medium'
      : observationState === 'bytes_observed' ? 'low' : 'unknown';
  const evidenceState = observationState === 'bytes_observed' ? 'source_observed'
    : observationState === 'digest_supplied_not_observed' ? 'digest_bound_not_observed'
      : observationState === 'summary_observed' ? 'summary_only' : 'advisory';
  const claimBoundary = observationState === 'bytes_observed' ? 'supplied_bytes_observed'
    : observationState === 'summary_observed' ? 'summary_only_full_content_not_observed'
      : observationState === 'digest_supplied_not_observed' ? 'digest_not_independently_observed' : 'descriptor_only';
  const provenance = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_artifact_provenance', artifactId: String(artifactId).trim(),
    contentDigest: contentDigest === null ? null : String(contentDigest), observationState, derivationKind,
    sourceRefs: sources, inferenceRefs: inferences, parentArtifactDigests: unique(parentArtifactDigests.map(String)),
    crossValidation, generatedByCapability: String(generatedByCapability).trim(), evidenceState, confidence, claimBoundary,
    contentReadClaimAllowed: observationState === 'bytes_observed', externalActionCount: 0,
  };
  return { ...provenance, provenanceDigest: digestObject(provenance, 'provenanceDigest') };
}

export function createChapterCheckpoint({
  checkpointId, checkpointIndex, projectStateDigest, chapterId, previousCheckpoint = null, status,
  contentText = null, contentDigest = null, targetWordCount = null, sourceProvenanceDigest = null, nextObjective = null,
} = {}) {
  const previousStatus = previousCheckpoint?.status ?? null;
  const issues = [];
  if (!String(checkpointId ?? '').trim() || !Number.isInteger(checkpointIndex) || checkpointIndex < 1
    || !HASH.test(String(projectStateDigest ?? '')) || !String(chapterId ?? '').trim() || !CHAPTER_STATES.has(status)) issues.push('checkpoint_identity_invalid');
  if (previousCheckpoint && (!digestValid(previousCheckpoint, 'checkpointDigest') || previousCheckpoint.checkpointIndex >= checkpointIndex || previousCheckpoint.chapterId !== chapterId)) issues.push('previous_checkpoint_invalid');
  if (!TRANSITIONS[String(previousStatus)]?.has(status)) issues.push('chapter_transition_invalid');
  const text = contentText == null ? null : String(contentText);
  const computedDigest = text === null ? null : sha256(Buffer.from(text, 'utf8'));
  if (contentDigest !== null && !HASH.test(String(contentDigest))) issues.push('content_digest_invalid');
  if (computedDigest && contentDigest && computedDigest !== contentDigest) issues.push('content_digest_mismatch');
  const effectiveDigest = contentDigest ?? computedDigest;
  const wordCount = text === null ? 0 : measuredWords(text);
  if (status === 'complete' && (!HASH.test(String(effectiveDigest ?? '')) || !HASH.test(String(sourceProvenanceDigest ?? '')))) issues.push('complete_checkpoint_requires_content_and_provenance');
  if (targetWordCount !== null && (!Number.isInteger(targetWordCount) || targetWordCount < 1)) issues.push('target_word_count_invalid');
  const checkpoint = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_chapter_checkpoint', checkpointId: String(checkpointId ?? '').trim(), checkpointIndex: Number(checkpointIndex),
    projectStateDigest: String(projectStateDigest ?? ''), chapterId: String(chapterId ?? '').trim(),
    previousCheckpointDigest: previousCheckpoint?.checkpointDigest ?? null, previousStatus, status,
    contentDigest: effectiveDigest ?? null, measuredWordCount: wordCount, targetWordCount,
    sourceProvenanceDigest: sourceProvenanceDigest == null ? null : String(sourceProvenanceDigest), nextObjective: nextObjective == null ? null : String(nextObjective),
    issues: unique(issues), externalActionCount: 0,
  };
  return { ...checkpoint, checkpointDigest: digestObject(checkpoint, 'checkpointDigest') };
}

export function createFactDelta({ baseGraph = { schemaVersion: '1.1.0', claims: [], edges: [] }, expectedGraphDigest, changes = [] } = {}) {
  const baseGraphDigest = sha256(stableJson(baseGraph));
  const issues = [];
  if (!HASH.test(String(expectedGraphDigest ?? '')) || expectedGraphDigest !== baseGraphDigest) issues.push('fact_graph_preimage_mismatch');
  const claims = new Map((Array.isArray(baseGraph?.claims) ? baseGraph.claims : []).map((item) => [item.id, structuredClone(item)]));
  const edges = new Map((Array.isArray(baseGraph?.edges) ? baseGraph.edges : []).map((item) => [`${item.claimId}|${item.sourceId}|${item.relation}`, structuredClone(item)]));
  const normalizedChanges = [];
  for (const input of Array.isArray(changes) ? changes : []) {
    const id = String(input?.id ?? '').trim();
    const text = String(input?.text ?? '').trim();
    if (!id || !text) { issues.push('fact_change_identity_invalid'); continue; }
    const sourceRefs = (Array.isArray(input.sourceRefs) ? input.sourceRefs : []).map((item) => ({ sourceId: String(item?.sourceId ?? '').trim(), relation: item?.relation }))
      .filter((item) => item.sourceId && ['supported_by', 'contradicted_by', 'derived_from'].includes(item.relation));
    let state = ['supported', 'unverified', 'contradicted', 'working_assumption'].includes(input.status) ? input.status : 'unverified';
    if (state === 'supported' && !sourceRefs.some((item) => item.relation === 'supported_by')) { state = 'unverified'; issues.push(`${id}:supported_without_source_downgraded`); }
    if (state === 'contradicted' && !sourceRefs.some((item) => item.relation === 'contradicted_by')) { state = 'unverified'; issues.push(`${id}:contradicted_without_source_downgraded`); }
    const claim = { id, text, status: state, chapterRefs: stringList(input.chapterRefs) };
    claims.set(id, claim);
    for (const ref of sourceRefs) edges.set(`${id}|${ref.sourceId}|${ref.relation}`, { claimId: id, sourceId: ref.sourceId, relation: ref.relation });
    normalizedChanges.push({ ...claim, sourceRefs });
  }
  if (normalizedChanges.length === 0) issues.push('fact_delta_empty');
  const projectedGraph = {
    schemaVersion: '1.1.0',
    claims: [...claims.values()].sort((a, b) => a.id.localeCompare(b.id, 'en')),
    edges: [...edges.values()].sort((a, b) => `${a.claimId}|${a.sourceId}|${a.relation}`.localeCompare(`${b.claimId}|${b.sourceId}|${b.relation}`, 'en')),
  };
  const newGraphDigest = sha256(stableJson(projectedGraph));
  const rejected = issues.includes('fact_graph_preimage_mismatch') || issues.includes('fact_delta_empty');
  const delta = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_fact_delta', baseGraphDigest,
    expectedGraphDigest: String(expectedGraphDigest ?? ''), changes: normalizedChanges, projectedGraph, newGraphDigest,
    status: rejected ? 'rejected' : 'ready', issues: unique(issues), writesPerformed: false, externalActionCount: 0,
  };
  return { ...delta, deltaDigest: digestObject(delta, 'deltaDigest') };
}

export function createReviewBrief({
  projectId, chapterId, chapterDigest, writingOwner = 'primary_author', reviewFocus = ['structure', 'continuity', 'readability', 'evidence'],
  standards = [], sourceRefs = [], contentRiskClass = 'low', humanOwnerRole = 'editorial_reviewer',
} = {}) {
  if (!String(projectId ?? '').trim() || !String(chapterId ?? '').trim() || !HASH.test(String(chapterDigest ?? ''))
    || !String(writingOwner ?? '').trim() || !['low', 'medium', 'high', 'restricted'].includes(contentRiskClass)) throw new Error('review_brief_identity_invalid');
  const focus = unique((Array.isArray(reviewFocus) ? reviewFocus : []).filter((item) => ['structure', 'continuity', 'readability', 'evidence', 'rights', 'delivery', 'source_fidelity'].includes(item)));
  if (focus.length === 0) throw new Error('review_focus_required');
  const defaultStandards = focus.map((item) => `${item}:report_anchored_findings_without_prose_mutation`);
  const brief = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_review_brief', projectId: String(projectId).trim(), chapterId: String(chapterId).trim(), chapterDigest: String(chapterDigest),
    role: 'read_only_reviewer', writingOwner: String(writingOwner).trim(), reviewFocus: focus,
    standards: stringList(standards.length ? standards : defaultStandards), sourceRefs: stringList(sourceRefs),
    contentRiskClass, humanOwnerRole: String(humanOwnerRole),
    outputContract: { findingFields: ['location', 'severity', 'finding', 'evidenceRef'], noProseChanges: true, receiptRequiredForMachineClaims: true },
    advisoryOnly: true, hostMutationAllowed: false, externalActionCount: 0,
  };
  return { ...brief, briefDigest: digestObject(brief, 'briefDigest') };
}

export function deriveArtifactPlan({ requests = [], sourceArtifactDigest = null, chapterPlan = null, entityTimeline = null, claimGraph = null } = {}) {
  const sourceDigest = HASH.test(String(sourceArtifactDigest ?? '')) ? String(sourceArtifactDigest) : null;
  if (sourceArtifactDigest !== null && sourceDigest === null) throw new Error('source_artifact_digest_invalid');
  const artifacts = [];
  const unavailable = [];
  for (const request of stringList(requests)) {
    if (request === 'glossary') {
      if (!Array.isArray(entityTimeline?.entities)) { unavailable.push({ kind: request, reason: 'entity_timeline_missing' }); continue; }
      for (const entity of entityTimeline.entities) artifacts.push({
        id: `glossary-${entity.id}`, kind: 'glossary', format: 'json', sourceObjectRefs: [`EntityTimeline:${entity.id}`],
        contentProjection: { front: entity.name, back: entity.aliases?.length ? `别名：${entity.aliases.join('、')}` : '', entityType: entity.type }, state: 'planned',
      });
    } else if (request === 'chapter_cards') {
      if (!Array.isArray(chapterPlan?.chapters)) { unavailable.push({ kind: request, reason: 'chapter_plan_missing' }); continue; }
      for (const chapter of chapterPlan.chapters) artifacts.push({
        id: `chapter-card-${chapter.id}`, kind: 'chapter_card', format: 'json', sourceObjectRefs: [`ChapterPlan:${chapter.id}`],
        contentProjection: { title: chapter.title, promise: chapter.promise, status: chapter.status, targetWordCount: chapter.targetWordCount }, state: 'planned',
      });
    } else if (request === 'claim_appendix') {
      if (!Array.isArray(claimGraph?.claims)) { unavailable.push({ kind: request, reason: 'claim_graph_missing' }); continue; }
      artifacts.push({ id: 'claim-appendix', kind: 'claim_appendix', format: 'json', sourceObjectRefs: ['ClaimGraph'], contentProjection: { claims: claimGraph.claims, edges: claimGraph.edges ?? [] }, state: 'planned' });
    } else if (['docx', 'pdf'].includes(request)) {
      if (!sourceDigest) { unavailable.push({ kind: request, reason: 'source_artifact_digest_missing' }); continue; }
      artifacts.push({
        id: `binary-${request}`, kind: 'binary_render_plan', format: request, sourceObjectRefs: [`Artifact:${sourceDigest}`],
        contentProjection: { rendererRequired: true, authorizedRendererRequired: true, structureInspectionRequired: true, visualQaRequired: true }, state: 'planned',
      });
    } else if (request === 'epub') unavailable.push({ kind: request, reason: 'renderer_unavailable' });
    else unavailable.push({ kind: request, reason: 'unknown_derivation' });
  }
  const status = artifacts.length > 0 && unavailable.length > 0 ? 'partial' : artifacts.length > 0 ? 'ready' : 'unavailable';
  const plan = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_derived_artifact_plan', sourceArtifactDigest: sourceDigest,
    artifacts, unavailable, status, factGraphReused: Boolean(claimGraph), writesPerformed: false,
    binaryRenderingPerformed: false, hostMutationAllowed: false, externalActionCount: 0,
  };
  return { ...plan, planDigest: digestObject(plan, 'planDigest') };
}

const worstGate = (left = 'unknown', right = 'unknown') => {
  const order = ['passed', 'not_run', 'unknown', 'human_review_pending', 'failed'];
  return order.indexOf(right) > order.indexOf(left) ? right : left;
};

export function createProjectStatus({ project, chapterPlan, checkpoints = [], objectiveBinding = null, qualityGateStates = [] } = {}) {
  const issues = [];
  const warnings = [];
  const projectValidation = validateProject(project);
  if (!projectValidation.ok) issues.push(...projectValidation.issues.map((item) => `project:${item}`));
  const chapters = Array.isArray(chapterPlan?.chapters) ? chapterPlan.chapters : [];
  if (chapters.length === 0) issues.push('chapter_plan_missing');
  const chapterIds = new Set(chapters.map((item) => String(item?.id ?? '')).filter(Boolean));
  if (chapterIds.size !== chapters.length) issues.push('chapter_plan_identity_invalid');
  if (objectiveBinding && !digestValid(objectiveBinding, 'bindingDigest')) issues.push('objective_binding_digest_invalid');
  const knownProjectStateDigests = new Set([project?.stateDigest, ...(Array.isArray(project?.decisionLog) ? project.decisionLog.map((item) => item?.previousStateDigest) : [])].filter((item) => HASH.test(String(item ?? ''))));
  const latest = new Map();
  const checkpointIds = new Set();
  for (const checkpoint of Array.isArray(checkpoints) ? checkpoints : []) {
    if (!digestValid(checkpoint, 'checkpointDigest')) { issues.push(`${checkpoint?.checkpointId ?? 'unknown'}:checkpoint_digest_invalid`); continue; }
    if (checkpointIds.has(checkpoint.checkpointId)) issues.push(`${checkpoint.checkpointId}:checkpoint_id_duplicate`);
    checkpointIds.add(checkpoint.checkpointId);
    if (!chapterIds.has(checkpoint.chapterId)) issues.push(`${checkpoint.checkpointId}:checkpoint_chapter_unknown`);
    if (!knownProjectStateDigests.has(checkpoint.projectStateDigest)) issues.push(`${checkpoint.checkpointId}:checkpoint_project_state_unknown`);
    if (!CHAPTER_STATES.has(checkpoint.status) || checkpoint.issues?.length) issues.push(`${checkpoint.checkpointId}:checkpoint_not_acceptable`);
    const current = latest.get(checkpoint.chapterId);
    if (!current || checkpoint.checkpointIndex > current.checkpointIndex) latest.set(checkpoint.chapterId, checkpoint);
  }
  const effective = chapters.map((chapter) => {
    const checkpoint = latest.get(chapter.id);
    if (checkpoint && checkpoint.status !== chapter.status) warnings.push(`${chapter.id}:plan_checkpoint_state_mismatch`);
    return { ...chapter, effectiveStatus: checkpoint?.status ?? chapter.status, measuredWordCount: checkpoint?.measuredWordCount ?? 0, checkpointDigest: checkpoint?.checkpointDigest ?? null };
  });
  const total = effective.length;
  const complete = effective.filter((item) => item.effectiveStatus === 'complete').length;
  const blocked = effective.filter((item) => item.effectiveStatus === 'blocked').length;
  const reviewing = effective.filter((item) => item.effectiveStatus === 'reviewing').length;
  const target = effective.reduce((sum, item) => sum + (Number.isInteger(item.targetWordCount) ? item.targetWordCount : 0), 0);
  const measured = effective.reduce((sum, item) => sum + item.measuredWordCount, 0);
  const gateMap = new Map();
  for (const gate of Array.isArray(qualityGateStates) ? qualityGateStates : []) {
    const id = String(gate?.gateId ?? '').trim();
    if (id) gateMap.set(id, worstGate(gateMap.get(id) ?? 'passed', GATE_STATES.has(gate.status) ? gate.status : 'unknown'));
  }
  for (const [id, state] of gateMap) if (state !== 'passed') issues.push(`${id}:gate_${state}`);
  let objectiveVerdict = 'in_progress';
  if (blocked > 0 || [...gateMap.values()].some((state) => state !== 'passed')) objectiveVerdict = 'blocked';
  else if (!projectValidation.ok || issues.length > 0) objectiveVerdict = 'state_conflict';
  else if (total > 0 && complete === total) objectiveVerdict = 'review_required';
  if (objectiveBinding?.status === 'complete' && objectiveVerdict === 'review_required' && objectiveBinding.completionEvidenceDigests.length > 0) objectiveVerdict = 'complete';
  const status = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_project_status', projectId: String(project?.projectId ?? ''), projectState: project?.state ?? 'intake',
    projectStateDigest: String(project?.stateDigest ?? ''), chapterPlanDigest: sha256(stableJson(chapterPlan ?? {})),
    objectiveBindingDigest: objectiveBinding?.bindingDigest ?? null, latestCheckpointDigests: unique([...latest.values()].map((item) => item.checkpointDigest)),
    chapterProgress: { total, complete, blocked, reviewing, percent: total ? Math.round((complete / total) * 100) : 0 },
    words: { target, measured, deviationPercent: target ? Math.round(((measured - target) / target) * 100) : null },
    gateStates: Object.fromEntries([...gateMap.entries()].sort(([a], [b]) => a.localeCompare(b, 'en'))),
    objectiveVerdict, readyForObjectiveCompletion: objectiveVerdict === 'complete' && issues.length === 0,
    issues: unique(issues), warnings: unique(warnings), writesPerformed: false, externalActionCount: 0,
  };
  return { ...status, statusDigest: digestObject(status, 'statusDigest') };
}

export function createWorkspaceTransactionPlan({ transactionId, writes = [] } = {}) {
  const issues = [];
  if (!String(transactionId ?? '').trim()) issues.push('transaction_id_required');
  if (!Array.isArray(writes) || writes.length === 0) issues.push('transaction_writes_required');
  const normalized = [];
  const paths = new Set();
  for (const item of Array.isArray(writes) ? writes : []) {
    const relativePath = String(item?.relativePath ?? '');
    const portableKey = relativePath.toLocaleLowerCase('en-US');
    if (!safeRelativePath(relativePath)) { issues.push(`${relativePath || 'unknown'}:transaction_path_invalid`); continue; }
    if (paths.has(portableKey)) { issues.push(`${relativePath}:transaction_path_duplicate`); continue; }
    paths.add(portableKey);
    if (!Number.isSafeInteger(item?.byteLength) || item.byteLength < 0 || !HASH.test(String(item?.sha256 ?? ''))) { issues.push(`${relativePath}:transaction_content_descriptor_invalid`); continue; }
    const mediaType = String(item?.mediaType ?? '').trim();
    if (!mediaType) { issues.push(`${relativePath}:transaction_media_type_invalid`); continue; }
    normalized.push({ relativePath, mediaType, byteLength: item.byteLength, sha256: String(item.sha256), intent: 'create_candidate' });
  }
  normalized.sort((a, b) => Buffer.from(a.relativePath).compare(Buffer.from(b.relativePath)));
  const plan = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_workspace_transaction_plan', transactionId: String(transactionId ?? '').trim(), writes: normalized,
    targetPolicy: 'plan_only_no_host_mutation', rollbackRequirement: 'required_if_promoted_to_authorized_executor',
    status: issues.length ? 'rejected' : 'ready', issues: unique(issues), executionAllowed: false,
    hostMutationAllowed: false, writesPerformed: false, externalActionCount: 0,
  };
  return { ...plan, planDigest: digestObject(plan, 'planDigest') };
}

export function validateWorkspaceTransactionPlan(plan) {
  const issues = [];
  if (plan?.schemaVersion !== '1.0.0' || plan?.artifactType !== 'manuscriptos_workspace_transaction_plan'
    || plan?.targetPolicy !== 'plan_only_no_host_mutation' || plan?.rollbackRequirement !== 'required_if_promoted_to_authorized_executor') issues.push('transaction_plan_identity_invalid');
  if (!digestValid(plan, 'planDigest')) issues.push('transaction_plan_digest_mismatch');
  if (plan?.status !== 'ready' || !Array.isArray(plan?.writes) || plan.writes.length === 0) issues.push('transaction_plan_not_ready');
  if (plan?.executionAllowed !== false || plan?.hostMutationAllowed !== false || plan?.writesPerformed !== false || plan?.externalActionCount !== 0) issues.push('transaction_plan_effect_boundary_invalid');
  const paths = new Set();
  for (const write of Array.isArray(plan?.writes) ? plan.writes : []) {
    const key = String(write?.relativePath ?? '').toLocaleLowerCase('en-US');
    if (!safeRelativePath(write?.relativePath) || paths.has(key)) issues.push(`${write?.relativePath ?? 'unknown'}:transaction_path_invalid`);
    paths.add(key);
    if (!Number.isSafeInteger(write?.byteLength) || write.byteLength < 0 || !HASH.test(String(write?.sha256 ?? '')) || write?.intent !== 'create_candidate') issues.push(`${write?.relativePath ?? 'unknown'}:transaction_descriptor_invalid`);
  }
  return { ok: issues.length === 0, issues: unique(issues) };
}

export function createWorkspaceTransactionReceipt(plan) {
  const validation = validateWorkspaceTransactionPlan(plan);
  const receipt = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_workspace_transaction_receipt',
    transactionId: String(plan?.transactionId ?? ''), planDigest: String(plan?.planDigest ?? ''),
    status: validation.ok ? 'validated' : 'rejected', plannedTargetDigests: validation.ok ? Object.fromEntries(plan.writes.map((item) => [item.relativePath, item.sha256])) : {},
    createdTargets: [], executionPerformed: false, hostMutationCount: 0, externalActionCount: 0, issues: validation.issues,
  };
  return { ...receipt, receiptDigest: digestObject(receipt, 'receiptDigest') };
}

export function createManuscriptObjectiveBinding({
  projectId, objective, acceptanceCriteria = [], projectStateDigest, ownerRole = 'manuscript_owner', status = 'planned',
  completionEvidenceDigests = [], blockers = [],
} = {}) {
  const issues = [];
  const criteria = stringList(acceptanceCriteria);
  const evidence = stringList(completionEvidenceDigests);
  if (!String(projectId ?? '').trim() || !String(objective ?? '').trim() || criteria.length === 0 || !HASH.test(String(projectStateDigest ?? '')) || !String(ownerRole ?? '').trim() || !OBJECTIVE_STATES.has(status)) issues.push('objective_binding_identity_invalid');
  if (!validHashList(evidence)) issues.push('objective_completion_evidence_invalid');
  if (status === 'complete' && evidence.length === 0) issues.push('objective_completion_evidence_required');
  const effectiveStatus = issues.length ? 'blocked' : OBJECTIVE_STATES.has(status) ? status : 'planned';
  const binding = {
    schemaVersion: '1.0.0', artifactType: 'manuscriptos_objective_binding', projectId: String(projectId ?? '').trim(),
    objective: String(objective ?? '').trim(), acceptanceCriteria: criteria, projectStateDigest: String(projectStateDigest ?? ''),
    ownerRole: String(ownerRole ?? '').trim(), status: effectiveStatus, completionEvidenceDigests: evidence,
    blockers: unique([...stringList(blockers), ...issues]), persistenceClaim: 'user_visible_object_only',
    hostMutationAllowed: false, externalActionCount: 0,
  };
  return { ...binding, bindingDigest: digestObject(binding, 'bindingDigest') };
}

export function validateDigestBoundObject(value, digestKey) {
  return { ok: digestValid(value, digestKey), issues: digestValid(value, digestKey) ? [] : [`${digestKey}_invalid`] };
}

export function safeAtomicCall(factory, input) {
  try { return { ok: true, value: factory(input), issue: null }; }
  catch (error) { return { ok: false, value: null, issue: errorCode(error) }; }
}
