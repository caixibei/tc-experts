import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateCapability, runCapability } from './capability-runtime.mjs';
import {
  PACKAGE_TEXT_DIGEST_ALGORITHM,
  capabilityContextInputValid,
  capabilityResult,
  DEFAULT_CAPABILITY_CONTEXT,
  inspectPackageTextDigest,
  normalizeCapabilityContext,
  parsePackageJson,
  sealCapabilityResult,
  sha256,
  stableJson,
} from './lib/kernel-utils.mjs';
import { validateHumanReviewReceipt } from './gate-planner.mjs';
import { scoreIntent } from './scene-intent-signals.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sceneRoot = path.join(skillRoot, 'scenes');
const legacyPath = path.join(skillRoot, 'resources', 'legacy-scene-migrations.json');
const registryPath = path.join(skillRoot, 'resources', 'scene-registry.json');
const routeIndexPath = path.join(skillRoot, 'resources', 'scene-route-index.json');
const sceneLabels = new Map([
  ['academic-monograph','学术专著'],['annual-chronicle','年度纪事'],['biography-memorial','人物传记或纪念文集'],
  ['brand-story-longform','品牌故事长文'],['casebook','案例集'],['collection-album','图文专辑'],
  ['conference-proceedings','会议文集'],['consulting-decision-report','咨询决策报告'],['cultural-heritage','文化遗产记录'],
  ['expert-book','专家著作'],['genealogy','家谱或宗谱'],['investigative-report-restricted','受限调查报告'],
  ['memoir-oral-history','回忆录或口述史'],['operation-manual','操作或维修手册'],['organization-history','组织史'],
  ['policy-standard-guide','政策标准指南'],['proposal-rfp','方案或投标响应'],['technical-documentation','技术文档'],
  ['training-course','培训课程或教材'],['whitepaper-research','研究白皮书'],
]);
const clarification = (reason,candidates) => ({
  reason,
  question:reason==='domain_scene_tie'
    ? '这项任务涉及多个文稿目标，请确认这次主要交付哪一种。'
    : '现有信息还不足以确定文稿目标，请确认主要交付物。',
  options:candidates.slice(0,3).map(({sceneId,score})=>({sceneId,label:sceneLabels.get(sceneId)??sceneId,score})),
  userAnswerRequired:true,
});
const dualIntentSpecs = [
  {
    sceneIds:['genealogy','memoir-oral-history'],
    matches:text=>/(?:世系|家谱|宗谱|各房)/u.test(text)&&/(?:口述|长辈|访谈|回忆|经历)/u.test(text),
  },
  {
    sceneIds:['brand-story-longform','casebook'],
    matches:text=>/(?:品牌|成长历程|打拼)/u.test(text)&&/(?:客户|案例|合作)/u.test(text),
  },
];
const dualIntentCandidates = (normalized, scored) => {
  const spec=dualIntentSpecs.find(item=>item.matches(normalized));
  if(!spec)return null;
  return spec.sceneIds.map(sceneId=>scored.find(item=>item.sceneId===sceneId)??{
    sceneId,score:0.86,evidence:{lexical:0,compositional:0,dualIntent:true},
  });
};

const sceneFailure = (status, code, details = {}) => ({
  ok: false,
  status,
  sceneId: details.sceneId ?? null,
  pack: null,
  integrity: details.integrity ?? null,
  failure: {
    code,
    sceneId: details.sceneId ?? null,
    sourceRef: details.sourceRef ?? null,
    algorithm: details.algorithm ?? PACKAGE_TEXT_DIGEST_ALGORITHM,
  },
});

function readPackageJsonFile(target, sourceRef) {
  if (!fs.existsSync(target)) return { ok: false, value: null, issue: { code: 'package_text_file_missing', sourceRef } };
  try { return parsePackageJson(fs.readFileSync(target), { sourceRef }); }
  catch { return { ok: false, value: null, issue: { code: 'package_text_read_failed', sourceRef } }; }
}

export function loadSceneRegistryResult() {
  const parsed = readPackageJsonFile(registryPath, 'resources/scene-registry.json');
  if (!parsed.ok) return sceneFailure('scene_registry_unavailable', parsed.issue.code, { sourceRef: parsed.issue.sourceRef });
  const registry = parsed.value;
  const entries = Array.isArray(registry?.entries) ? registry.entries : [];
  const valid = registry?.artifactType === 'manuscriptos_scene_registry'
    && registry?.packDigestAlgorithm === PACKAGE_TEXT_DIGEST_ALGORITHM
    && registry?.routeIndexRef === 'scene-route-index.json'
    && registry?.routeIndexDigestAlgorithm === PACKAGE_TEXT_DIGEST_ALGORITHM
    && /^[a-f0-9]{64}$/u.test(String(registry?.routeIndexSha256 ?? ''))
    && registry?.entryCount === entries.length
    && entries.length === 21
    && new Set(entries.map((item) => item.sceneId)).size === entries.length
    && entries.every((item) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(String(item.sceneId ?? ''))
      && item.packRef === `../scenes/${item.sceneId}.json`
      && /^[a-f0-9]{64}$/u.test(String(item.packSha256 ?? '')));
  if (!valid) return sceneFailure('scene_registry_unavailable', 'scene_registry_integrity_failed', { sourceRef: 'resources/scene-registry.json' });
  return { ok: true, status: 'scene_registry_ready', registry, failure: null };
}

function loadSceneRouteIndexResult(registry) {
  const sourceRef = 'resources/scene-route-index.json';
  if (!fs.existsSync(routeIndexPath)) return sceneFailure('scene_route_index_unavailable', 'package_text_file_missing', { sourceRef });
  let bytes;
  try { bytes = fs.readFileSync(routeIndexPath); }
  catch { return sceneFailure('scene_route_index_unavailable', 'package_text_read_failed', { sourceRef }); }
  const integrity = inspectPackageTextDigest(bytes, registry.routeIndexSha256, { sourceRef });
  if (!integrity.ok) return sceneFailure('scene_route_index_unavailable', integrity.issue.code, { sourceRef, integrity });
  const parsed = parsePackageJson(bytes, { sourceRef });
  if (!parsed.ok) return sceneFailure('scene_route_index_unavailable', parsed.issue.code, { sourceRef: parsed.issue.sourceRef });
  const routeIndex = parsed.value;
  const registryById = new Map(registry.entries.map((item) => [item.sceneId, item]));
  const entries = Array.isArray(routeIndex?.entries) ? routeIndex.entries : [];
  const valid = routeIndex?.packDigestAlgorithm === PACKAGE_TEXT_DIGEST_ALGORITHM
    && entries.length === registry.entries.length
    && new Set(entries.map((item) => item.sceneId)).size === entries.length
    && entries.every((item) => registryById.get(item.sceneId)?.packSha256 === item.packSha256
      && Array.isArray(item.triggers)
      && item.triggers.every((trigger) => trigger && typeof trigger.signal === 'string' && Number.isFinite(trigger.weight) && trigger.weight >= 0 && trigger.weight <= 1));
  if (!valid) return sceneFailure('scene_route_index_unavailable', 'scene_route_index_integrity_failed', { sourceRef: 'resources/scene-route-index.json' });
  return { ok: true, status: 'scene_route_index_ready', routeIndex, integrity, failure: null };
}

export function loadScenePackResult(sceneId) {
  const normalizedSceneId = String(sceneId ?? '');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalizedSceneId)) return sceneFailure('unknown_scene', 'scene_id_invalid', { sceneId: normalizedSceneId || null });
  const registryResult = loadSceneRegistryResult();
  if (!registryResult.ok) return { ...registryResult, sceneId: normalizedSceneId, failure: { ...registryResult.failure, sceneId: normalizedSceneId } };
  const entry = registryResult.registry.entries.find((item) => item.sceneId === normalizedSceneId);
  if (!entry) return sceneFailure('unknown_scene', 'scene_not_registered', { sceneId: normalizedSceneId });
  const target = path.resolve(path.join(skillRoot, 'resources'), ...entry.packRef.split('/'));
  const sourceRef = `scenes/${normalizedSceneId}.json`;
  if (!target.startsWith(`${sceneRoot}${path.sep}`)) return sceneFailure('scene_pack_integrity_failed', 'scene_pack_ref_invalid', { sceneId: normalizedSceneId, sourceRef });
  if (!fs.existsSync(target)) return sceneFailure('scene_pack_integrity_failed', 'scene_pack_missing', { sceneId: normalizedSceneId, sourceRef });
  let bytes;
  try { bytes = fs.readFileSync(target); }
  catch { return sceneFailure('scene_pack_integrity_failed', 'scene_pack_read_failed', { sceneId: normalizedSceneId, sourceRef }); }
  const integrity = inspectPackageTextDigest(bytes, entry.packSha256, { sourceRef });
  if (!integrity.ok) return sceneFailure('scene_pack_integrity_failed', integrity.issue.code, { sceneId: normalizedSceneId, sourceRef, integrity });
  const parsed = parsePackageJson(bytes, { sourceRef });
  if (!parsed.ok || parsed.value?.sceneId !== normalizedSceneId) return sceneFailure('scene_pack_integrity_failed', parsed.ok ? 'scene_pack_identity_mismatch' : parsed.issue.code, { sceneId: normalizedSceneId, sourceRef, integrity });
  return { ok: true, status: 'scene_pack_loaded', sceneId: normalizedSceneId, pack: parsed.value, entry, integrity, failure: null };
}

export function loadScenePack(sceneId) {
  const result = loadScenePackResult(sceneId);
  return result.ok ? result.pack : null;
}

const normalizeSignal = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
const removeNumericQualifiers = (value) => value.replace(/[0-9０-９零〇一二三四五六七八九十百千万两]+/gu, '');
const routeSignalMatches = (normalizedText, normalizedTrigger) => normalizedText.includes(normalizedTrigger)
  || (normalizedTrigger.length >= 2 && removeNumericQualifiers(normalizedText).includes(removeNumericQualifiers(normalizedTrigger)));
export function routeDomainScene(input = {}, context = DEFAULT_CAPABILITY_CONTEXT) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {ok:false,status:'invalid_invocation',issues:['route_input_invalid'],candidates:[],connectorInfluencedRoute:false};
  const { explicitSceneId = null, text = '' } = input;
  if (!capabilityContextInputValid(context)) return { ok: false, status: 'invalid_invocation', issues: ['context_shape_invalid'], candidates: [] };
  if (typeof text !== 'string' || text.length > 8192) return { ok: false, status: 'invalid_invocation', issues: ['route_text_invalid_or_over_budget'], candidates: [], connectorInfluencedRoute: false };
  const registryResult = loadSceneRegistryResult();
  if (!registryResult.ok) return { ok: false, status: registryResult.status, issues: [registryResult.failure.code], candidates: [], connectorInfluencedRoute: false, runtimeFailure: registryResult.failure };
  const registry = registryResult.registry;
  if (explicitSceneId !== null) {
    const explicit = registry.entries.find((item) => item.sceneId === explicitSceneId);
    if (!explicit) return { ok: false, status: 'rejected', issues: ['unknown_explicit_scene'], candidates: [], connectorInfluencedRoute: false };
    const loaded = loadScenePackResult(explicit.sceneId);
    return loaded.ok
      ? { ok: true, status: 'routed', sceneId: explicit.sceneId, routeSource: 'explicit', candidates: [{ sceneId: explicit.sceneId, score: 1 }], connectorInfluencedRoute: false }
      : { ok: false, status: loaded.status, issues: [loaded.failure.code], candidates: [{ sceneId: explicit.sceneId, score: 1 }], connectorInfluencedRoute: false, runtimeFailure: loaded.failure };
  }
  const routeIndexResult = loadSceneRouteIndexResult(registry);
  if (!routeIndexResult.ok) return { ok: false, status: routeIndexResult.status, issues: [routeIndexResult.failure.code], candidates: [], connectorInfluencedRoute: false, runtimeFailure: routeIndexResult.failure };
  const intent = scoreIntent(text);
  const normalized = intent.normalized;
  const compositional = new Map(intent.scores.map(r => [r.sceneId,r]));
  const registryById = new Map(registry.entries.map((item) => [item.sceneId, item]));
  const scored = routeIndexResult.routeIndex.entries.filter((entry) => registryById.get(entry.sceneId)?.kind === 'vertical_scene').map((entry) => {
    const lexical = intent.shortTask ? 0 : Math.max(0, ...entry.triggers.map((trigger) => routeSignalMatches(normalized, normalizeSignal(trigger.signal)) ? trigger.weight : 0));
    const composed = compositional.get(entry.sceneId);
    const score = Math.max(lexical, composed?.score ?? 0);
    return { sceneId: entry.sceneId, score, evidence: { lexical, compositional: composed?.score ?? 0, ...composed?.evidence } };
  }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score || Buffer.from(left.sceneId).compare(Buffer.from(right.sceneId)));
  const dualCandidates=dualIntentCandidates(normalized,scored);
  if(dualCandidates){
    const failures=dualCandidates.map(item=>loadScenePackResult(item.sceneId)).filter(item=>!item.ok);
    if(failures.length)return {ok:false,status:'scene_runtime_degraded',issues:[...new Set(failures.map(item=>item.failure.code))],candidates:dualCandidates,connectorInfluencedRoute:false,runtimeFailures:failures.map(item=>item.failure)};
    return {ok:false,status:'needs_clarification',issues:['domain_scene_dual_intent'],candidates:dualCandidates,clarification:clarification('domain_scene_dual_intent',dualCandidates),connectorInfluencedRoute:false};
  }
  const selectedSceneId = scored.length === 0 || scored[0].score < Number(routeIndexResult.routeIndex.threshold ?? 0.8) ? 'general' : scored[0].sceneId;
  if (selectedSceneId !== 'general' && scored.length > 1 && scored[1].score >= 0.8 && scored[0].score - scored[1].score < 0.03) {
    const tied = scored.filter((item) => scored[0].score - item.score < 0.03);
    const failures = tied.map((item) => loadScenePackResult(item.sceneId)).filter((item) => !item.ok);
    if (failures.length) return { ok: false, status: 'scene_runtime_degraded', issues: [...new Set(failures.map((item) => item.failure.code))], candidates: tied, connectorInfluencedRoute: false, runtimeFailures: failures.map((item) => item.failure) };
    return { ok: false, status: 'needs_clarification', issues: ['domain_scene_tie'], candidates: tied, clarification:clarification('domain_scene_tie',tied), connectorInfluencedRoute: false };
  }
  const longFormRequested = /写|整理|编|汇|成书|出书|出版|装订|手册|报告|文集|指南|册|文档|材料|记录|改写|重写/u.test(normalized);
  if (selectedSceneId === 'general' && !intent.shortTask && longFormRequested && scored[0]?.score >= 0.35) {
    const weak = scored.filter(item=>scored[0].score-item.score<0.03);
    const failures = weak.map(item=>loadScenePackResult(item.sceneId)).filter(item=>!item.ok);
    if (failures.length) return {ok:false,status:'scene_runtime_degraded',issues:[...new Set(failures.map(item=>item.failure.code))],candidates:weak,connectorInfluencedRoute:false,runtimeFailures:failures.map(item=>item.failure)};
    return {ok:false,status:'needs_clarification',issues:['low_confidence_domain_scene'],candidates:weak,clarification:clarification('low_confidence_domain_scene',weak),connectorInfluencedRoute:false};
  }
  const loaded = loadScenePackResult(selectedSceneId);
  if (!loaded.ok) return { ok: false, status: loaded.status, issues: [loaded.failure.code], candidates: scored, connectorInfluencedRoute: false, runtimeFailure: loaded.failure };
  return { ok: true, status: 'routed', sceneId: selectedSceneId, routeSource: selectedSceneId === 'general' ? 'fallback' : 'trigger', candidates: scored, connectorInfluencedRoute: false };
}

function missingInputIds(pack, inputs) {
  return pack.requiredInputs.filter((item) => item.required).map((item) => item.id).filter((id) => {
    const value = inputs?.[id];
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
  });
}

export function evaluateSceneRequest(sceneId, input = {}, context = DEFAULT_CAPABILITY_CONTEXT) {
  const loaded = loadScenePackResult(sceneId);
  if (!loaded.ok) return sealCapabilityResult('scene-pack-runtime', input, context, capabilityResult('scene-pack-runtime', input, { ok: false, status: loaded.status, issues: [loaded.failure.code], output: { sceneId: loaded.sceneId, runtimeFailure: loaded.failure } }));
  const pack = loaded.pack;
  if (!capabilityContextInputValid(context)) return sealCapabilityResult('scene-pack-runtime', input, DEFAULT_CAPABILITY_CONTEXT, capabilityResult('scene-pack-runtime', input, { ok: false, status: 'invalid_invocation', issues: ['context_shape_invalid'], output: { sceneId: pack.sceneId } }));
  const normalizedContext = normalizeCapabilityContext(context);
  const missing = missingInputIds(pack, input.inputs ?? {});
  const conflicts = Array.isArray(input.conflicts) ? input.conflicts : [];
  const externalAction = input.externalAction ?? null;
  const adversarialSignals = Array.isArray(input.adversarialSignals) ? input.adversarialSignals.map((item) => String(item).normalize('NFKC').trim()).filter(Boolean) : [];
  const adversarialPattern = /(?:ignore|bypass|override|skip).{0,40}(?:scene|scope|contract|gate|review)|(?:publish|release).{0,40}(?:unverified|without review)|fabricat(?:e|ed|ion)|force.{0,20}general|伪造|绕过|忽略.{0,20}(?:场景|范围|合同|门禁|审核)|未经核验.{0,20}(?:发布|交付)/iu;
  const rejectedAdversarialSignals = adversarialSignals.filter((signal) => adversarialPattern.test(signal));
  const unauthorized = Boolean(externalAction) && normalizedContext.externalWriteAuthorized !== true;
  const binding = externalAction ? pack.optionalPortBindings.find((item) => item.portId === externalAction.portId && item.operation === externalAction.operation && (!externalAction.legacyLabel || item.legacyLabel === externalAction.legacyLabel)) : null;
  const portIntentProjection = binding ? { sceneId: pack.sceneId, legacyLabel: binding.legacyLabel, portId: binding.portId, operation: binding.operation, minimumDataScope: binding.minimumDataScope, writeMode: binding.writeMode } : null;
  const portIntent = externalAction && binding ? { ...portIntentProjection, approvalRequired: binding.approvalRequired, readbackRequired: binding.readbackRequired, executionAllowed: false, adapterStatus: 'optional_adapter_registered_intent_only', fallback: binding.fallback, intentDigest: sha256(stableJson(portIntentProjection)) } : null;
  const undeclaredAction = Boolean(externalAction) && !binding;
  const authorizedIntentOnly = Boolean(externalAction) && !unauthorized && Boolean(binding);
  const unknownOperationMode = input.operationMode && !pack.operationModes.includes(input.operationMode);
  const riskOrder = ['low', 'medium', 'high', 'restricted'];
  const riskHint = riskOrder.includes(input.contentRiskClassHint) ? input.contentRiskClassHint : pack.contentRiskClass;
  const effectiveRisk = riskOrder.indexOf(riskHint) > riskOrder.indexOf(pack.contentRiskClass) ? riskHint : pack.contentRiskClass;
  const generalRiskConflict = pack.sceneId === 'general' && riskOrder.indexOf(effectiveRisk) > riskOrder.indexOf('medium');
  const status = missing.length ? 'needs_input' : conflicts.length || generalRiskConflict ? 'needs_clarification' : unknownOperationMode ? 'rejected' : unauthorized || undeclaredAction ? 'rejected' : authorizedIntentOnly ? 'port_intent_only' : 'draft_ready';
  const issues = [
    ...missing.map((id) => `${id}:required`),
    ...conflicts.map((item) => `${item.field ?? 'unknown'}:conflicting`),
    ...(unauthorized ? ['external_action_not_authorized'] : [])
    , ...(undeclaredAction ? ['port_intent_not_declared'] : [])
    , ...(authorizedIntentOnly ? ['external_adapter_execution_not_requested'] : [])
    , ...(unknownOperationMode ? ['operation_mode_not_supported_by_scene'] : [])
    , ...(generalRiskConflict ? ['risk_class_requires_explicit_vertical_scene'] : [])
  ];
  return sealCapabilityResult('scene-pack-runtime', input, normalizedContext, capabilityResult('scene-pack-runtime', input, {
    ok: status === 'draft_ready', status,
    output: {
      sceneId: pack.sceneId,
      operationMode: input.operationMode ?? pack.operationModes[0],
      routePreserved: true,
      connectorInfluencedRoute: false,
      localOfflineAvailable: true,
      connectorUnavailableFallbackUsed: normalizedContext.connectorAvailable === false && pack.optionalPortBindings.length > 0,
      missingInputIds: missing,
      conflictFields: conflicts.map((item) => item.field ?? 'unknown'),
      unauthorizedExternalAction: unauthorized,
      portIntent,
      adversarialSignalsRejected: rejectedAdversarialSignals,
      contentRiskClass: effectiveRisk,
      qualityGateRegistryIds: [...new Set(pack.qualityGateRefs.map((item) => item.registryId))].sort(),
      artifactArchetypeIds: [...new Set(pack.artifactRefs.map((item) => item.archetypeId))].sort(),
      optionalPortOperations: [...new Set(pack.optionalPortBindings.map((item) => `${item.portId}.${item.operation}`))].sort(),
      allowGeneralSubstitution: generalRiskConflict ? false : pack.fallback.allowGeneralSubstitution,
      externalActionCount: 0,
      qualityEvaluationState: 'not_run_for_this_request',
      deliveryBlockedPendingGateEvaluation: true,
      packSemanticDigest: sha256(stableJson(pack)),
      packTextSha256: loaded.integrity.observedSha256,
      packTextDigestAlgorithm: loaded.integrity.algorithm,
      packPhysicalSha256: loaded.integrity.rawSha256,
      packLineEndingOnlyDifference: loaded.integrity.lineEndingOnlyDifference
    }, issues
  }));
}

export function evaluateSceneResult(result, input = {}, context = DEFAULT_CAPABILITY_CONTEXT) {
  return evaluateCapability('scene-pack-runtime', result, input, context);
}

export function composeScenes(sceneIds, context = DEFAULT_CAPABILITY_CONTEXT) {
  const loaded = sceneIds.map(loadScenePackResult);
  const failures = loaded.filter((item) => !item.ok);
  if (failures.length) return sealCapabilityResult('scene-composer', { scenes: sceneIds }, context, capabilityResult('scene-composer', { scenes: sceneIds }, { ok: false, status: failures.some((item) => item.status === 'scene_pack_integrity_failed') ? 'scene_runtime_degraded' : 'rejected', output: { composedDomainScenes: [], contentRiskClass: 'low', qualityGateRefs: [], artifactRefs: [], runtimeFailures: failures.map((item) => item.failure) }, issues: [...new Set(failures.map((item) => item.failure.code))] }));
  const packs = loaded.map((item) => item.pack);
  const scenes = packs.map((pack) => ({ sceneId: pack.sceneId, contentRiskClass: pack.contentRiskClass, qualityGateRefs: pack.qualityGateRefs.map((item) => item.registryId), artifactRefs: pack.artifactRefs.map((item) => item.archetypeId) }));
  return runCapability('scene-composer', { scenes }, context);
}

export function resolveLegacyRoute(legacyId, signals = {}, domainScene = 'general', evidence = {}) {
  if (['material_activation', 'continuation_or_revision', 'finished_draft_closure'].includes(legacyId)) {
    const input = { legacyId, signals, domainScene, evidence };
    const routed = runCapability('scene-router', input, { connectorAvailable: false, externalWriteAuthorized: false });
    const loaded = loadScenePackResult(domainScene);
    if (!loaded.ok) return { ok: false, status: loaded.status, issues: [loaded.failure.code], output: { domainScene, runtimeFailure: loaded.failure } };
    const pack = loaded.pack;
    const legalBinding = pack.qualityGateRefs.find((item) => item.registryId === 'human-review.receipt' && item.humanOwner === 'legal_reviewer');
    const legalBlocked = legacyId === 'finished_draft_closure' && pack.contentRiskClass === 'restricted' && (!legalBinding || !validateHumanReviewReceipt(legalBinding, evidence.legalReviewBundle, pack.sceneId, evidence.legalReviewContext).ok);
    const status = legalBlocked ? 'human_review_required' : routed.status;
    return {
      ok: routed.ok && !legalBlocked,
      status,
      issues: legalBlocked ? ['legal_review_receipt_required'] : routed.issues,
      output: {
        operationMode: routed.output.operationMode,
        domainScene,
        routeSource: routed.output.routeSource,
        ambiguity: routed.output.ambiguity,
        connectorInfluencedRoute: false,
        contentRiskClass: pack.contentRiskClass,
        qualityGateRegistryIds: [...new Set(pack.qualityGateRefs.map((item) => item.registryId))].sort(),
        artifactArchetypeIds: [...new Set(pack.artifactRefs.map((item) => item.archetypeId))].sort(),
        allowGeneralSubstitution: pack.fallback.allowGeneralSubstitution
      }
    };
  }
  const parsedLegacy = readPackageJsonFile(legacyPath, 'resources/legacy-scene-migrations.json');
  if (!parsedLegacy.ok) return { ok: false, status: 'legacy_registry_unavailable', issues: [parsedLegacy.issue.code], legacyId, domainScenes: [], runtimeFailure: parsedLegacy.issue };
  const registry = parsedLegacy.value;
  const migration = registry.legacySceneMigrations.find((item) => item.legacyId === legacyId);
  if (!migration) return { ok: false, status: 'unknown_legacy_route', legacyId, domainScenes: [] };
  const candidates = [...migration.domainScenes];
  const selected = evidence?.selectedDomainScene ?? (domainScene !== 'general' ? domainScene : null);
  if (candidates.length > 1 && !candidates.includes(selected)) {
    return { ok: false, status: 'needs_clarification', issues: ['legacy_scene_choice_required'], legacyId, domainScenes: candidates, selectedDomainScene: null, capabilityIds: migration.capabilityIds ?? [], mustNotMapTo: migration.mustNotMapTo ?? [] };
  }
  const resolved = candidates.length === 1 ? candidates[0] : selected;
  return { ok: true, status: 'resolved', legacyId, domainScenes: [resolved], selectedDomainScene: resolved, candidateDomainScenes: candidates, capabilityIds: migration.capabilityIds ?? [], mustNotMapTo: migration.mustNotMapTo ?? [] };
}
