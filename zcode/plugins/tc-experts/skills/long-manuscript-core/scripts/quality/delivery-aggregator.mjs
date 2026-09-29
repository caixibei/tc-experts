import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PACKAGE_TEXT_DIGEST_ALGORITHM, parsePackageJson, sha256, stableJson, unique } from '../lib/kernel-utils.mjs';
import { inspectEvaluatorIntegrity, loadActiveEvaluatorRegistryResult } from '../gate-planner.mjs';
import { loadScenePackResult } from '../scene-runtime.mjs';
import { createGateInvocation, evaluateGateResult } from './quality-gate-runtime.mjs';
import { validateHumanGateReceipt } from './human-receipt-validator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '../..');
const readResult = (relative) => {
  const target = path.join(skillRoot, ...relative.split('/'));
  if (!fs.existsSync(target)) return { ok: false, value: null, failure: { code: 'package_text_file_missing', sourceRef: relative } };
  try {
    const parsed = parsePackageJson(fs.readFileSync(target), { sourceRef: relative });
    return parsed.ok ? { ok: true, value: parsed.value, failure: null } : { ok: false, value: null, failure: parsed.issue };
  } catch { return { ok: false, value: null, failure: { code: 'package_text_read_failed', sourceRef: relative } }; }
};
const sha = (value) => sha256(stableJson(value));
const setEqual = (left, right) => stableJson([...new Set(left)].sort()) === stableJson([...new Set(right)].sort());
const gateKey = (gateId, profile) => `${gateId}::${profile ?? 'core'}`;
const CORE_GATE_KEYS = new Set([
  'artifact.openability::core.default', 'delivery-manifest.integrity::core.default',
  'encoding.valid::core.default', 'external-action.authorized::core.default',
  'input.required::core.default', 'schema.valid::core.default', 'scope.lock::core.default',
]);
const safeEvaluatorRef = (value) => {
  const prefix = '../scripts/quality/evaluators/';
  if (typeof value !== 'string' || !value.startsWith(prefix) || value.includes('\\')) return false;
  const tail = value.slice(prefix.length);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*\.mjs$/u.test(tail);
};

export function compileDeliveryPlan(sceneId, operationMode, evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return { ok: false, status: 'needs_input', issues: ['delivery_evidence_required'], plan: null };
  const loadedScene = loadScenePackResult(sceneId);
  if (!loadedScene.ok) return { ok: false, status: loadedScene.status, issues: [loadedScene.failure.code], runtimeFailure: loadedScene.failure, plan: null };
  const scenePack = loadedScene.pack;
  if (!scenePack.operationModes.includes(operationMode)) return { ok: false, status: 'unsupported_operation_mode', issues: ['operation_mode_not_supported_by_scene'], plan: null };
  const loadedRegistry = loadActiveEvaluatorRegistryResult();
  if (!loadedRegistry.ok) return { ok: false, status: loadedRegistry.status, issues: [loadedRegistry.failure.code], runtimeFailure: loadedRegistry.failure, plan: null };
  const evaluatorRegistry = loadedRegistry.registry;
  const loadedHumanPolicy = readResult('resources/gates/human-review-gate.json');
  if (!loadedHumanPolicy.ok) return { ok: false, status: 'human_review_policy_unavailable', issues: [loadedHumanPolicy.failure.code], runtimeFailure: loadedHumanPolicy.failure, plan: null };
  const humanPolicy = loadedHumanPolicy.value;
  const machineBindings = scenePack.qualityGateRefs.filter((item) => item.registryId !== 'human-review.receipt').map((item) => {
    const evaluator = evaluatorRegistry.entries.find((entry) => entry.gateId === item.registryId);
    return { gateId: item.registryId, parameterProfile: item.parameterProfile ?? null, gateKey: gateKey(item.registryId, item.parameterProfile ?? null), evaluatorRef: evaluator?.evaluatorRef ?? null, evaluatorSha256: evaluator?.evaluatorSha256 ?? null, evaluatorDigestAlgorithm: evaluatorRegistry.evaluatorDigestAlgorithm, failureEffect: 'block' };
  });
  const explicitHumans = scenePack.qualityGateRefs.filter((item) => item.registryId === 'human-review.receipt').map((item) => ({ parameterProfile: item.parameterProfile, humanOwner: item.humanOwner, reviewMandate: item.reviewMandate }));
  const riskHuman = humanPolicy.scenes.find((item) => item.sceneId === sceneId);
  const humans = [...explicitHumans, ...(riskHuman ? [{ parameterProfile: riskHuman.parameterProfile, humanOwner: riskHuman.humanOwner, reviewMandate: riskHuman.reviewMandate }] : [])]
    .filter((item, index, all) => all.findIndex((other) => stableJson(other) === stableJson(item)) === index)
    .map((item) => ({ ...item, gateId: 'human-review.receipt', gateKey: gateKey('human-review.receipt', `${item.parameterProfile}:${item.humanOwner}`) }));
  const duplicateKeys = machineBindings.map((item) => item.gateKey).filter((key, index, all) => all.indexOf(key) !== index);
  const missingEvaluators = machineBindings.filter((item) => !safeEvaluatorRef(item.evaluatorRef) || !item.evaluatorSha256).map((item) => item.gateKey);
  const projection = { schemaVersion: '1.0.0', sceneId, operationMode, targetTransition: 'delivery_ready', contentRiskClass: scenePack.contentRiskClass, scenePackDigest: loadedScene.integrity.observedSha256, scenePackDigestAlgorithm: PACKAGE_TEXT_DIGEST_ALGORITHM, projectStateDigest: evidence.projectStateDigest, artifactSetDigest: evidence.artifactSetDigest, evidenceSnapshotDigest: sha(evidence), machineBindings, humanBindings: humans };
  const issues = [...duplicateKeys.map((key) => `duplicate_gate_key:${key}`), ...missingEvaluators.map((key) => `evaluator_missing:${key}`)];
  return { ok: issues.length === 0, status: issues.length ? 'plan_invalid' : 'planned', issues, plan: { ...projection, planDigest: sha(projection) } };
}

export function validateDeliveryPlan(plan, evidence) {
  if (!plan || !evidence) return { ok: false, issues: ['delivery_plan_required'] };
  const rebuilt = compileDeliveryPlan(plan.sceneId, plan.operationMode, evidence);
  if (!rebuilt.ok || !rebuilt.plan) return { ok: false, issues: rebuilt.issues.length ? rebuilt.issues : ['delivery_plan_rebuild_failed'] };
  const suppliedKeys = new Set((plan.machineBindings ?? []).map((item) => item.gateKey));
  const missingCore = [...CORE_GATE_KEYS].filter((key) => !suppliedKeys.has(key));
  const issues = [...missingCore.map((key) => `core_gate_missing:${key}`)];
  if (stableJson(rebuilt.plan) !== stableJson(plan)) issues.push('delivery_plan_authority_mismatch');
  return { ok: issues.length === 0, issues, expectedPlan: rebuilt.plan };
}

export async function runMachineGatePlan(plan, evidence, context = { connectorAvailable: false, externalWriteAuthorized: false }) {
  const planValidation = validateDeliveryPlan(plan, evidence);
  if (!planValidation.ok) return [{ gateKey: '__delivery_plan__', invocation: null, result: { status: 'error', ok: false, issues: planValidation.issues } }];
  const runs = [];
  for (const binding of plan.machineBindings) {
    const made = createGateInvocation({ gateId: binding.gateId, parameterProfile: binding.parameterProfile, sceneId: plan.sceneId, operationMode: plan.operationMode, targetTransition: plan.targetTransition, contentRiskClass: plan.contentRiskClass, evidence });
    if (!made.ok) { runs.push({ gateKey: binding.gateKey, invocation: made.invocation, result: { status: made.status, ok: false, issues: made.issues } }); continue; }
    if (!safeEvaluatorRef(binding.evaluatorRef)) { runs.push({ gateKey: binding.gateKey, invocation: made.invocation, result: { status: 'error', ok: false, issues: ['evaluator_ref_unsafe'] } }); continue; }
    const modulePath = path.resolve(skillRoot, 'resources', ...binding.evaluatorRef.split('/'));
    const evaluatorRoot = `${path.resolve(skillRoot, 'scripts', 'quality', 'evaluators')}${path.sep}`;
    const inspection = modulePath.startsWith(evaluatorRoot) ? inspectEvaluatorIntegrity({ lifecycle: 'active', evaluatorRef: binding.evaluatorRef, evaluatorSha256: binding.evaluatorSha256 }, binding.evaluatorDigestAlgorithm) : { ok: false, issue: { code: 'quality_evaluator_ref_invalid' } };
    if (!inspection.ok) { runs.push({ gateKey: binding.gateKey, invocation: made.invocation, result: { status: 'error', ok: false, issues: [inspection.issue.code], runtimeFailure: inspection.issue } }); continue; }
    try {
      const loaded = await import(`${pathToFileURL(modulePath).href}?sha=${binding.evaluatorSha256}`);
      const result = typeof loaded.evaluate === 'function' ? loaded.evaluate(made.invocation, context) : { status: 'error', ok: false, issues: ['evaluator_export_missing'] };
      runs.push({ gateKey: binding.gateKey, invocation: made.invocation, result });
    } catch {
      runs.push({ gateKey: binding.gateKey, invocation: made.invocation, result: { status: 'error', ok: false, issues: ['evaluator_import_failed'] } });
    }
  }
  return runs;
}

export function buildHumanBinding(plan, machineRuns, humanPlan) {
  return {
    gateId: 'human-review.receipt',
    parameterProfile: humanPlan.parameterProfile,
    sceneId: plan.sceneId,
    humanOwner: humanPlan.humanOwner,
    reviewMandate: humanPlan.reviewMandate,
    gateInvocationDigest: plan.planDigest,
    machineGateResultDigest: sha(machineRuns.map((run) => ({ gateKey: run.gateKey, resultDigest: run.result.resultDigest ?? null })).sort((a, b) => a.gateKey.localeCompare(b.gateKey, 'en'))),
    scenePackDigest: plan.scenePackDigest,
    projectStateDigest: plan.projectStateDigest,
    artifactSetDigest: plan.artifactSetDigest,
    evidenceSnapshotDigest: plan.evidenceSnapshotDigest,
    reviewScopeDigest: sha({ sceneId: plan.sceneId, targetTransition: plan.targetTransition, artifactSetDigest: plan.artifactSetDigest }),
  };
}

export function aggregateDelivery(plan, machineRuns, humanBundles = [], asOf) {
  const evidence = machineRuns.find((item) => item?.invocation?.evidence)?.invocation?.evidence ?? null;
  const planValidation = validateDeliveryPlan(plan, evidence);
  if (!planValidation.ok) {
    const blockers = unique(planValidation.issues.length ? planValidation.issues : ['delivery_plan_invalid']).sort();
    const projection = { schemaVersion: '1.0.0', sceneId: plan?.sceneId ?? 'unknown', operationMode: plan?.operationMode ?? 'unknown', targetTransition: 'delivery_ready', contentRiskClass: plan?.contentRiskClass ?? 'restricted', planDigest: plan?.planDigest ?? null, requiredMachineGateCount: 0, requiredHumanGateCount: 0, machineResults: [], humanResults: [], blockers, deliveryReady: false, deliveryBlockedPendingGateEvaluation: true };
    const receiptPayload = { sceneId: projection.sceneId, scenePackDigest: plan?.scenePackDigest ?? null, projectStateDigest: plan?.projectStateDigest ?? null, artifactSetDigest: plan?.artifactSetDigest ?? null, evidenceSnapshotDigest: plan?.evidenceSnapshotDigest ?? null, planDigest: plan?.planDigest ?? null, machineReceiptDigests: [], humanReceiptDigests: [], decision: 'blocked' };
    return { ...projection, summaryDigest: sha(projection), receipt: { schemaVersion: '1.0.0', ...receiptPayload, receiptDigest: sha(receiptPayload) } };
  }
  const requiredMachine = plan.machineBindings.map((item) => item.gateKey);
  const actualMachine = machineRuns.map((item) => item.gateKey);
  const blockers = [];
  if (!setEqual(requiredMachine, actualMachine) || actualMachine.length !== new Set(actualMachine).size) blockers.push('machine_gate_set_mismatch');
  const resultRows = [];
  for (const binding of plan.machineBindings) {
    const run = machineRuns.find((item) => item.gateKey === binding.gateKey);
    const valid = run && evaluateGateResult(run.result, run.invocation).ok;
    const passed = valid && run.result.status === 'passed' && run.result.receipt?.decision === 'passed';
    if (!passed) blockers.push(`${binding.gateKey}:${valid ? run.result.status : 'invalid_receipt'}`);
    resultRows.push({ gateKey: binding.gateKey, status: valid ? run.result.status : 'error', receiptDigest: valid ? run.result.receipt.receiptDigest : null });
  }
  const requiredHumans = plan.humanBindings.map((item) => item.gateKey);
  const actualHumans = humanBundles.map((item) => item.gateKey);
  if (!setEqual(requiredHumans, actualHumans) || actualHumans.length !== new Set(actualHumans).size) blockers.push('human_gate_set_mismatch');
  const humanRows = [];
  for (const item of plan.humanBindings) {
    const bundle = humanBundles.find((candidate) => candidate.gateKey === item.gateKey);
    const binding = bundle ? buildHumanBinding(plan, machineRuns, item) : null;
    const valid = bundle && validateHumanGateReceipt(bundle.receipt, binding, { ownerResolutionReceipt: bundle.ownerResolutionReceipt, approvalLedgerReceipt: bundle.approvalLedgerReceipt }, asOf).ok;
    if (!valid) blockers.push(`${item.gateKey}:human_review_required`);
    humanRows.push({ gateKey: item.gateKey, status: valid ? 'passed' : 'needs_human_review', receiptDigest: valid ? bundle.receipt.receiptDigest : null });
  }
  const sortedBlockers = unique(blockers).sort();
  const projection = { schemaVersion: '1.0.0', sceneId: plan.sceneId, operationMode: plan.operationMode, targetTransition: plan.targetTransition, contentRiskClass: plan.contentRiskClass, planDigest: plan.planDigest, requiredMachineGateCount: requiredMachine.length, requiredHumanGateCount: requiredHumans.length, machineResults: resultRows.sort((a, b) => a.gateKey.localeCompare(b.gateKey, 'en')), humanResults: humanRows.sort((a, b) => a.gateKey.localeCompare(b.gateKey, 'en')), blockers: sortedBlockers, deliveryReady: sortedBlockers.length === 0, deliveryBlockedPendingGateEvaluation: sortedBlockers.length > 0 };
  const receiptPayload = { sceneId: plan.sceneId, scenePackDigest: plan.scenePackDigest, projectStateDigest: plan.projectStateDigest, artifactSetDigest: plan.artifactSetDigest, evidenceSnapshotDigest: plan.evidenceSnapshotDigest, planDigest: plan.planDigest, machineReceiptDigests: projection.machineResults.map((item) => item.receiptDigest).filter(Boolean).sort(), humanReceiptDigests: projection.humanResults.map((item) => item.receiptDigest).filter(Boolean).sort(), decision: projection.deliveryReady ? 'delivery_ready' : 'blocked' };
  return { ...projection, summaryDigest: sha(projection), receipt: { schemaVersion: '1.0.0', ...receiptPayload, receiptDigest: sha(receiptPayload) } };
}
