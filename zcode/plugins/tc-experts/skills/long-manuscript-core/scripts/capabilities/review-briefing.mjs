import { capabilityResult, DEFAULT_CAPABILITY_CONTEXT, evaluateSealedCapabilityResult, runCapabilityHandler, unexpectedCapabilityInputKeys } from '../lib/kernel-utils.mjs';
import { createReviewBrief } from '../atomic-capabilities/runtime.mjs';

export const capabilityId = 'review-briefing';
const ALLOWED_INPUT_KEYS = ['projectId', 'chapterId', 'chapterDigest', 'writingOwner', 'reviewFocus', 'standards', 'sourceRefs', 'contentRiskClass', 'humanOwnerRole'];

export function handle(input = {}) {
  const inputIssues = unexpectedCapabilityInputKeys(input, ALLOWED_INPUT_KEYS);
  if (inputIssues.length) return capabilityResult(capabilityId, input, { ok: false, status: 'invalid_invocation', issues: inputIssues });
  let result;
  try {
    const brief = createReviewBrief(input);
    result = capabilityResult(capabilityId, input, {
      ok: true, status: 'advisory',
      output: { brief, hostMutationAllowed: false, proseMutationPerformed: false, externalActionCount: 0 },
      warnings: ['review_brief_requires_separate_review_execution'],
    });
  } catch {
    result = capabilityResult(capabilityId, input, { ok: false, status: 'invalid_invocation', issues: ['review_brief_input_invalid'] });
  }
  return result;
}

export const run = (input = {}, context = DEFAULT_CAPABILITY_CONTEXT) => runCapabilityHandler(capabilityId, handle, input, context);
export const evaluate = (result, input = {}, context = DEFAULT_CAPABILITY_CONTEXT) => evaluateSealedCapabilityResult(capabilityId, result, input, context);
