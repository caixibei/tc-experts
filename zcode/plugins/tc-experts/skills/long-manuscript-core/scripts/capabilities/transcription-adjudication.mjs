import {
  applyPatchSet,
  compareTranscriptSnapshots,
  createAdjudicationLedger,
  createPatchSet,
  validateAdjudicationLedger,
} from '../source-fidelity/runtime.mjs';
import {
  capabilityResult,
  DEFAULT_CAPABILITY_CONTEXT,
  evaluateSealedCapabilityResult,
  runCapabilityHandler,
  unexpectedCapabilityInputKeys,
} from '../lib/kernel-utils.mjs';

export const capabilityId = 'transcription-adjudication';
export const hostMutationAllowed = false;
const ALLOWED_INPUT_KEYS = ['snapshots', 'selectedId', 'expectedPages', 'probableFragments', 'rareTermWhitelist', 'adjudicationEntries', 'patchSnapshotId', 'patches'];

export function handle(input = {}) {
  const inputIssues = unexpectedCapabilityInputKeys(input, ALLOWED_INPUT_KEYS);
  if (inputIssues.length) return capabilityResult(capabilityId, input, { ok: false, status: 'invalid_invocation', output: { hostMutationAllowed: false, externalActionCount: 0 }, issues: inputIssues });
  try {
    const snapshots = Array.isArray(input.snapshots) ? input.snapshots : [];
    const comparison = compareTranscriptSnapshots({
      snapshots, selectedId: input.selectedId ?? null, expectedPages: input.expectedPages ?? null,
      probableFragments: input.probableFragments, rareTermWhitelist: input.rareTermWhitelist,
    });
    const differenceCount = comparison.comparisons.flatMap((item) => item.pageResults).filter((item) => item.difference !== null || item.missingInBase || item.missingInCandidate).length;
    const adjudication = Array.isArray(input.adjudicationEntries) && input.adjudicationEntries.length
      ? createAdjudicationLedger({ comparisonDigest: comparison.comparisonDigest, entries: input.adjudicationEntries })
      : null;
    const adjudicationValid = adjudication ? validateAdjudicationLedger(adjudication, comparison.comparisonDigest).ok : differenceCount === 0;
    const patchBase = snapshots.find((item) => item.snapshotId === (input.patchSnapshotId ?? comparison.preferredBase.effectiveComparisonBaseId)) ?? null;
    const patchSet = patchBase && Array.isArray(input.patches) && input.patches.length ? createPatchSet({ snapshot: patchBase, patches: input.patches }) : null;
    const applyReceipt = patchSet?.status === 'ready' ? applyPatchSet(patchBase, patchSet) : null;
    const issues = [
      ...comparison.issues,
      ...(differenceCount > 0 && !adjudicationValid ? ['source_adjudication_pending'] : []),
      ...(patchSet && patchSet.status !== 'ready' ? patchSet.issues : []),
      ...(applyReceipt && !applyReceipt.ok ? applyReceipt.issues : []),
    ];
    const result = capabilityResult(capabilityId, input, {
      ok: issues.length === 0,
      status: issues.includes('source_adjudication_pending') ? 'human_review_required' : issues.length ? 'needs_input' : 'completed',
      output: {
        comparison, adjudication, patchSet, applyReceipt,
        preferredSnapshotId: comparison.preferredBase.effectiveComparisonBaseId,
        sourceDecisionRequired: differenceCount > 0,
        hostMutationAllowed: false, externalActionCount: 0,
      },
      issues,
      warnings: differenceCount > 0 ? ['similarity_does_not_determine_source_truth'] : [],
    });
    return result;
  } catch {
    return capabilityResult(capabilityId, input, {
      ok: false, status: 'needs_input', output: { hostMutationAllowed: false, externalActionCount: 0 }, issues: ['transcription_adjudication_input_invalid'],
    });
  }
}

export const run = (input = {}, context = DEFAULT_CAPABILITY_CONTEXT) => runCapabilityHandler(capabilityId, handle, input, context);
export const evaluate = (result, input = {}, context = DEFAULT_CAPABILITY_CONTEXT) => evaluateSealedCapabilityResult(capabilityId, result, input, context);
