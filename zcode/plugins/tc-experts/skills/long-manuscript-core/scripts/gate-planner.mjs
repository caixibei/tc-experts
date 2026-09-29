import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PACKAGE_TEXT_DIGEST_ALGORITHM,
  inspectPackageTextDigest,
  parsePackageJson,
  sha256,
  stableJson,
} from './lib/kernel-utils.mjs';
import {
  createApprovalLedgerRequest,
  createHumanGateRequest,
  createOwnerResolutionRequest,
  validateHumanGateReceipt,
} from './quality/human-receipt-validator.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evaluatorRegistryPath = path.join(skillRoot, 'resources', 'gates', 'evaluator-registry.json');
const HASH = /^[a-f0-9]{64}$/u;
const BUNDLE_KEYS = ['approvalLedgerReceipt', 'asOf', 'binding', 'ownerResolutionReceipt', 'receipt'];
const BINDING_KEYS = [
  'artifactSetDigest', 'evidenceSnapshotDigest', 'gateId', 'gateInvocationDigest',
  'humanOwner', 'machineGateResultDigest', 'parameterProfile', 'projectStateDigest',
  'reviewMandate', 'reviewScopeDigest', 'sceneId', 'scenePackDigest',
];
const CONTEXT_KEYS = [
  'artifactSetDigest', 'evidenceSnapshotDigest', 'gateInvocationDigest',
  'machineGateResultDigest', 'projectStateDigest', 'reviewScopeDigest', 'scenePackDigest',
];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

const registryFailure = (code, sourceRef, integrity = null) => ({
  ok: false,
  status: 'quality_evaluator_registry_unavailable',
  registry: null,
  failure: { code, sourceRef, algorithm: PACKAGE_TEXT_DIGEST_ALGORITHM },
  integrity,
});

export function loadActiveEvaluatorRegistryResult() {
  if (!fs.existsSync(evaluatorRegistryPath)) return registryFailure('quality_evaluator_registry_missing', 'resources/gates/evaluator-registry.json');
  let bytes;
  try { bytes = fs.readFileSync(evaluatorRegistryPath); }
  catch { return registryFailure('quality_evaluator_registry_read_failed', 'resources/gates/evaluator-registry.json'); }
  const parsed = parsePackageJson(bytes, { sourceRef: 'resources/gates/evaluator-registry.json' });
  if (!parsed.ok) return registryFailure(parsed.issue.code, parsed.issue.sourceRef);
  const registry = parsed.value;
  const seedPath = path.resolve(path.dirname(evaluatorRegistryPath), String(registry?.seedRegistryPath ?? ''));
  const expectedSeedPath = path.join(skillRoot, 'resources', 'scene-quality-gate-registry.json');
  if (seedPath !== expectedSeedPath) return registryFailure('quality_seed_registry_path_invalid', 'resources/gates/evaluator-registry.json');
  if (!fs.existsSync(seedPath)) return registryFailure('quality_seed_registry_missing', 'resources/scene-quality-gate-registry.json');
  let seedBytes;
  try { seedBytes = fs.readFileSync(seedPath); }
  catch { return registryFailure('quality_seed_registry_read_failed', 'resources/scene-quality-gate-registry.json'); }
  const inspection = inspectEvaluatorRegistryBinding(registry, seedBytes);
  if (!inspection.ok) return registryFailure(inspection.issue.code, inspection.issue.sourceRef, inspection.seedIntegrity);
  return { ok: true, status: 'quality_evaluator_registry_ready', registry, failure: null, integrity: inspection.seedIntegrity };
}

export function inspectEvaluatorRegistryBinding(registry, seedRegistryBytes) {
  const registryShapeValid = registry?.artifactType === 'active_quality_evaluator_registry'
    && registry?.seedRegistryPath === '../scene-quality-gate-registry.json'
    && registry?.seedRegistryDigestAlgorithm === PACKAGE_TEXT_DIGEST_ALGORITHM
    && registry?.evaluatorDigestAlgorithm === PACKAGE_TEXT_DIGEST_ALGORITHM
    && registry?.activeEvaluatorCount === 32
    && registry?.pendingEvaluatorCount === 0
    && registry?.entryCount === 32
    && Array.isArray(registry.entries)
    && registry.entries.length === 32
    && new Set(registry.entries.map((item) => item.gateId)).size === 32
    && registry.entries.every((item) => item.lifecycle === 'active')
    && HASH.test(String(registry.seedRegistrySha256 ?? ''));
  if (!registryShapeValid) return { ok: false, issue: { code: 'quality_evaluator_registry_shape_invalid', sourceRef: 'resources/gates/evaluator-registry.json' }, seedIntegrity: null };
  const seedIntegrity = inspectPackageTextDigest(seedRegistryBytes, registry.seedRegistrySha256, { sourceRef: 'resources/scene-quality-gate-registry.json' });
  return seedIntegrity.ok
    ? { ok: true, issue: null, seedIntegrity }
    : { ok: false, issue: { code: seedIntegrity.issue.code, sourceRef: seedIntegrity.issue.sourceRef }, seedIntegrity };
}

export function validateEvaluatorRegistryBinding(registry, seedRegistryBytes) {
  return inspectEvaluatorRegistryBinding(registry, seedRegistryBytes).ok;
}

export function inspectEvaluatorIntegrity(entry, evaluatorDigestAlgorithm = PACKAGE_TEXT_DIGEST_ALGORITHM) {
  if (evaluatorDigestAlgorithm !== PACKAGE_TEXT_DIGEST_ALGORITHM || entry?.lifecycle !== 'active' || !/^\.\.\/scripts\/quality\/evaluators\/[a-z0-9]+(?:-[a-z0-9]+)*\.mjs$/u.test(String(entry.evaluatorRef ?? '')) || !HASH.test(String(entry.evaluatorSha256 ?? ''))) return { ok: false, issue: { code: 'quality_evaluator_entry_invalid', sourceRef: entry?.evaluatorRef ?? null }, integrity: null };
  const target = path.resolve(path.join(skillRoot, 'resources'), ...entry.evaluatorRef.split('/'));
  const evaluatorRoot = `${path.join(skillRoot, 'scripts', 'quality', 'evaluators')}${path.sep}`;
  if (!target.startsWith(evaluatorRoot)) return { ok: false, issue: { code: 'quality_evaluator_ref_invalid', sourceRef: entry.evaluatorRef }, integrity: null };
  if (!fs.existsSync(target)) return { ok: false, issue: { code: 'quality_evaluator_missing', sourceRef: entry.evaluatorRef }, integrity: null };
  let bytes;
  try { bytes = fs.readFileSync(target); }
  catch { return { ok: false, issue: { code: 'quality_evaluator_read_failed', sourceRef: entry.evaluatorRef }, integrity: null }; }
  const integrity = inspectPackageTextDigest(bytes, entry.evaluatorSha256, { sourceRef: entry.evaluatorRef });
  return integrity.ok ? { ok: true, issue: null, integrity } : { ok: false, issue: integrity.issue, integrity };
}

export function planGates(scenePack) {
  if (!isObject(scenePack) || typeof scenePack.sceneId !== 'string' || !Array.isArray(scenePack.qualityGateRefs)) return [];
  const loadedRegistry = loadActiveEvaluatorRegistryResult();
  const registry = loadedRegistry.registry;
  return scenePack.qualityGateRefs.map((item) => {
    const human = item.registryId === 'human-review.receipt';
    const evaluator = human || !registry ? null : registry.entries.find((entry) => entry.gateId === item.registryId);
    const evaluatorInspection = human ? null : registry ? inspectEvaluatorIntegrity(evaluator, registry.evaluatorDigestAlgorithm) : { ok: false, issue: loadedRegistry.failure, integrity: null };
    const evaluatorReady = evaluatorInspection?.ok === true;
    const projection = {
      sceneId: scenePack.sceneId,
      registryId: item.registryId,
      parameterProfile: item.parameterProfile ?? null,
      humanOwner: item.humanOwner ?? null,
      reviewMandate: item.reviewMandate ?? null,
      evaluatorSha256: evaluatorReady ? evaluator.evaluatorSha256 : null,
      evaluatorDigestAlgorithm: human ? null : PACKAGE_TEXT_DIGEST_ALGORITHM,
    };
    return {
      ...projection,
      state: human ? 'trusted_human_receipt_required' : evaluatorReady ? 'active_evaluator_required' : 'evaluator_unavailable',
      passed: false,
      evaluatorRef: evaluatorReady ? evaluator.evaluatorRef : null,
      integrityFailure: human || evaluatorReady ? null : evaluatorInspection.issue,
      planDigest: sha256(stableJson(projection)),
    };
  });
}

// Package code can construct authority requests, but it never owns the private
// key and therefore cannot issue an acceptable human-review receipt.
export { createApprovalLedgerRequest, createOwnerResolutionRequest };
export function createHumanReviewRequest(binding, evidence, options = {}) {
  return createHumanGateRequest(binding, evidence, options);
}

export function validateHumanReviewReceipt(sceneGateBinding, bundle, sceneId, currentContext) {
  if (!exactKeys(bundle, BUNDLE_KEYS) || !exactKeys(bundle.binding, BINDING_KEYS) || !exactKeys(currentContext, CONTEXT_KEYS)) return { ok: false, issues: ['trusted_human_review_bundle_invalid'] };
  const binding = bundle.binding;
  const sceneBindingValid = sceneGateBinding?.registryId === 'human-review.receipt'
    && binding.gateId === 'human-review.receipt'
    && binding.sceneId === sceneId
    && binding.parameterProfile === sceneGateBinding.parameterProfile
    && binding.humanOwner === sceneGateBinding.humanOwner
    && binding.reviewMandate === sceneGateBinding.reviewMandate;
  const digestFieldsValid = BINDING_KEYS.filter((key) => key.endsWith('Digest')).every((key) => HASH.test(String(binding[key] ?? '')));
  const currentContextValid = CONTEXT_KEYS.every((key) => HASH.test(String(currentContext[key] ?? '')) && currentContext[key] === binding[key]);
  if (!sceneBindingValid || !digestFieldsValid || !currentContextValid) return { ok: false, issues: ['human_review_binding_invalid'] };
  return validateHumanGateReceipt(
    bundle.receipt,
    binding,
    { ownerResolutionReceipt: bundle.ownerResolutionReceipt, approvalLedgerReceipt: bundle.approvalLedgerReceipt },
    bundle.asOf,
  );
}
