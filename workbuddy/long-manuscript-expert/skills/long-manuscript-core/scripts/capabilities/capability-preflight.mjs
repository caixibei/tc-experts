import { capabilityResult, DEFAULT_CAPABILITY_CONTEXT, evaluateSealedCapabilityResult, runCapabilityHandler, unexpectedCapabilityInputKeys } from '../lib/kernel-utils.mjs';
import { createCapabilitySnapshot } from '../atomic-capabilities/runtime.mjs';

export const capabilityId = 'capability-preflight';
const ALLOWED_INPUT_KEYS = ['taskId', 'requiredCapabilities', 'optionalCapabilities', 'availableCapabilities', 'rejectionSignals', 'allowedDegradations'];

export function handle(input = {}) {
  const inputIssues = unexpectedCapabilityInputKeys(input, ALLOWED_INPUT_KEYS);
  if (inputIssues.length) return capabilityResult(capabilityId, input, { ok: false, status: 'invalid_invocation', issues: inputIssues });
  let result;
  try {
    const snapshot = createCapabilitySnapshot(input);
    result = capabilityResult(capabilityId, input, {
      ok: snapshot.status !== 'blocked', status: snapshot.status,
      output: { snapshot, hostMutationAllowed: false, executionPerformed: false, externalActionCount: 0 },
      issues: snapshot.missingRequired.map((item) => `${item}:required_capability_unavailable`),
      warnings: snapshot.missingOptional.map((item) => `${item}:optional_capability_unavailable`),
    });
  } catch {
    result = capabilityResult(capabilityId, input, { ok: false, status: 'invalid_invocation', issues: ['capability_preflight_input_invalid'] });
  }
  return result;
}

export const run = (input = {}, context = DEFAULT_CAPABILITY_CONTEXT) => runCapabilityHandler(capabilityId, handle, input, context);
export const evaluate = (result, input = {}, context = DEFAULT_CAPABILITY_CONTEXT) => evaluateSealedCapabilityResult(capabilityId, result, input, context);
