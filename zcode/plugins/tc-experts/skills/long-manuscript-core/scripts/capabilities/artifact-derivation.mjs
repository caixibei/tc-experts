import { capabilityResult, DEFAULT_CAPABILITY_CONTEXT, evaluateSealedCapabilityResult, runCapabilityHandler, unexpectedCapabilityInputKeys } from '../lib/kernel-utils.mjs';
import { deriveArtifactPlan } from '../atomic-capabilities/runtime.mjs';

export const capabilityId = 'artifact-derivation';
const ALLOWED_INPUT_KEYS = ['requests', 'sourceArtifactDigest', 'chapterPlan', 'entityTimeline', 'claimGraph'];

export function handle(input = {}) {
  const inputIssues = unexpectedCapabilityInputKeys(input, ALLOWED_INPUT_KEYS);
  if (inputIssues.length) return capabilityResult(capabilityId, input, { ok: false, status: 'invalid_invocation', issues: inputIssues });
  let result;
  try {
    const plan = deriveArtifactPlan(input);
    result = capabilityResult(capabilityId, input, {
      ok: plan.status !== 'unavailable', status: plan.status,
      output: { plan, hostMutationAllowed: false, binaryRenderingPerformed: false, writesPerformed: false, externalActionCount: 0 },
      issues: plan.status === 'unavailable' ? plan.unavailable.map((item) => `${item.kind}:${item.reason}`) : [],
      warnings: plan.status === 'partial' ? plan.unavailable.map((item) => `${item.kind}:${item.reason}`) : [],
    });
  } catch {
    result = capabilityResult(capabilityId, input, { ok: false, status: 'invalid_invocation', issues: ['artifact_derivation_input_invalid'] });
  }
  return result;
}

export const run = (input = {}, context = DEFAULT_CAPABILITY_CONTEXT) => runCapabilityHandler(capabilityId, handle, input, context);
export const evaluate = (result, input = {}, context = DEFAULT_CAPABILITY_CONTEXT) => evaluateSealedCapabilityResult(capabilityId, result, input, context);
