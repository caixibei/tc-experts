import {
  buildPageManifest,
  createOcrObservation,
  createSampleValidation,
  createSourceFidelityContinuation,
  createTranscriptSnapshot,
  validateOcrObservation,
  validatePageManifest,
  verifySourceFidelity,
} from '../source-fidelity/runtime.mjs';
import {
  capabilityResult,
  DEFAULT_CAPABILITY_CONTEXT,
  evaluateSealedCapabilityResult,
  runCapabilityHandler,
  unexpectedCapabilityInputKeys,
} from '../lib/kernel-utils.mjs';

export const capabilityId = 'source-transcription';
export const hostMutationAllowed = false;
const ALLOWED_INPUT_KEYS = ['sources', 'expectedPages', 'observations', 'rawPages', 'rawSnapshotId', 'rawVersion', 'observedAt', 'reviewedPages', 'snapshotId', 'deliveryReady', 'version', 'samples', 'requiredSampleCategories', 'issues', 'patchProofs', 'probableFragments', 'rareTermWhitelist'];

export function handle(input = {}) {
  const inputIssues = unexpectedCapabilityInputKeys(input, ALLOWED_INPUT_KEYS);
  if (inputIssues.length) return capabilityResult(capabilityId, input, { ok: false, status: 'invalid_invocation', output: { actualOcrExecutionPerformed: false, hostMutationAllowed: false, externalActionCount: 0 }, issues: inputIssues });
  try {
    const manifest = buildPageManifest({ sources: Array.isArray(input.sources) ? input.sources : [], expectedPages: input.expectedPages });
    const manifestValidation = validatePageManifest(manifest);
    const observations = (Array.isArray(input.observations) ? input.observations : []).map((observation) => createOcrObservation(observation));
    const observationIssues = observations.flatMap((observation) => validateOcrObservation(observation).issues);
    const plan = {
      operationMode: 'source_transcription',
      steps: ['map_pages', 'accept_supplied_observations', 'preserve_raw_snapshot', 'review_against_source', 'sample_validate', 'run_source_fidelity_gates', 'prepare_host_delivery'],
      actualOcrExecutionAllowed: false,
      suppliedObservationRequired: true,
      hostMutationAllowed: false,
      externalActionCount: 0,
    };
    let rawSnapshot = null;
    if (Array.isArray(input.rawPages) && input.rawPages.length) {
      rawSnapshot = createTranscriptSnapshot({
        snapshotId: input.rawSnapshotId ?? 'raw-snapshot', layer: 'ocr_raw', sourceManifestDigest: manifest.manifestDigest,
        binding: { ref: null, evidenceClass: 'in_memory_content_observed', version: input.rawVersion ?? null, current: false },
        ocrObservationDigests: observations.map((item) => item.observationDigest), pages: input.rawPages, observedAt: input.observedAt ?? null,
      });
    }
    let snapshot = null;
    if (Array.isArray(input.reviewedPages) && input.reviewedPages.length) {
      snapshot = createTranscriptSnapshot({
        snapshotId: input.snapshotId ?? 'reviewed-snapshot', layer: input.deliveryReady === true ? 'delivery' : 'reviewed', sourceManifestDigest: manifest.manifestDigest,
        binding: { ref: null, evidenceClass: 'in_memory_content_observed', version: input.version ?? null, current: true },
        ocrObservationDigests: observations.map((item) => item.observationDigest), supersedesSnapshotIds: rawSnapshot ? [rawSnapshot.snapshotId] : [],
        pages: input.reviewedPages, observedAt: input.observedAt ?? null,
      });
    }
    let sampleValidation = null;
    if (snapshot && Array.isArray(input.samples) && input.samples.length) {
      sampleValidation = createSampleValidation({
        manifest,
        requiredCategories: input.requiredSampleCategories ?? ['sparse', 'dense', 'layout_risk'],
        samples: input.samples.map((sample) => ({ ...sample, snapshotDigest: sample.snapshotDigest ?? snapshot.snapshotDigest })),
      });
    }
    let sourceFidelityStatus = null;
    let continuation = null;
    if (snapshot) {
      sourceFidelityStatus = verifySourceFidelity({
        mode: { operationMode: 'source_transcription', reviewSubmode: null }, manifest, snapshot, rawSnapshot,
        ocrObservations: observations, sampleValidation, sampleSnapshots: sampleValidation ? [snapshot] : [],
        issues: Array.isArray(input.issues) ? input.issues : [], patchProofs: Array.isArray(input.patchProofs) ? input.patchProofs : [],
        deliverySnapshotDigest: input.deliveryReady === true ? snapshot.snapshotDigest : null,
        probableFragments: input.probableFragments, rareTermWhitelist: input.rareTermWhitelist,
      });
      continuation = createSourceFidelityContinuation({ manifest, rawSnapshot, sampleValidation, snapshot, sourceFidelityStatus, issues: input.issues ?? [] });
    }
    const issues = [...manifestValidation.issues, ...observationIssues];
    const completed = sourceFidelityStatus?.lifecycleState === 'delivery_ready';
    const status = completed ? 'completed' : issues.length ? 'needs_input' : 'plan_ready';
    const result = capabilityResult(capabilityId, input, {
      ok: issues.length === 0,
      status,
      output: {
        plan, manifest, observations, rawSnapshot, snapshot, sampleValidation, sourceFidelityStatus, continuation,
        actualOcrExecutionPerformed: false, hostMutationAllowed: false, externalActionCount: 0,
      },
      issues,
      warnings: completed ? [] : ['source_fidelity_delivery_not_yet_ready'],
    });
    return result;
  } catch {
    return capabilityResult(capabilityId, input, {
      ok: false, status: 'needs_input', output: { actualOcrExecutionPerformed: false, hostMutationAllowed: false, externalActionCount: 0 }, issues: ['source_transcription_input_invalid'],
    });
  }
}

export const run = (input = {}, context = DEFAULT_CAPABILITY_CONTEXT) => runCapabilityHandler(capabilityId, handle, input, context);
export const evaluate = (result, input = {}, context = DEFAULT_CAPABILITY_CONTEXT) => evaluateSealedCapabilityResult(capabilityId, result, input, context);
