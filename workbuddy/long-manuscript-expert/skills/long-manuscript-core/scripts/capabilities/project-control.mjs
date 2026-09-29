import { capabilityResult, DEFAULT_CAPABILITY_CONTEXT, evaluateSealedCapabilityResult, runCapabilityHandler, unexpectedCapabilityInputKeys } from '../lib/kernel-utils.mjs';
import {
  createAtomicVerbProjection,
  createChapterCheckpoint,
  createFactDelta,
  createManuscriptObjectiveBinding,
  createProjectStatus,
  createWorkspaceTransactionPlan,
  createWorkspaceTransactionReceipt,
} from '../atomic-capabilities/runtime.mjs';

export const capabilityId = 'project-control';
const ALLOWED_INPUT_KEYS = ['action', 'payload'];

const handlers = Object.freeze({
  atomic_projection: createAtomicVerbProjection,
  chapter_checkpoint: createChapterCheckpoint,
  fact_delta: createFactDelta,
  objective_binding: createManuscriptObjectiveBinding,
  project_status: createProjectStatus,
  workspace_transaction_plan: createWorkspaceTransactionPlan,
  workspace_transaction_receipt: ({ plan }) => createWorkspaceTransactionReceipt(plan),
});

export function handle(input = {}) {
  const inputIssues = unexpectedCapabilityInputKeys(input, ALLOWED_INPUT_KEYS);
  if (inputIssues.length) return capabilityResult(capabilityId, input, { ok: false, status: 'invalid_invocation', issues: inputIssues });
  const action = String(input?.action ?? 'project_status');
  let result;
  if (!Object.hasOwn(handlers, action)) {
    result = capabilityResult(capabilityId, input, { ok: false, status: 'invalid_invocation', issues: ['project_control_action_invalid'] });
  } else {
    try {
      const projection = handlers[action](input?.payload ?? {});
      const rejected = projection?.status === 'rejected' || projection?.status === 'blocked'
        || (Array.isArray(projection?.issues) && projection.issues.some((item) => !String(item).includes('downgraded')))
        || (Array.isArray(projection?.blockers) && projection.blockers.length > 0);
      result = capabilityResult(capabilityId, input, {
        ok: !rejected, status: rejected ? 'rejected' : 'planned',
        output: { action, projection, hostMutationAllowed: false, executionPerformed: false, externalActionCount: 0 },
        issues: rejected ? projection.issues ?? ['project_control_projection_rejected'] : [],
      });
    } catch {
      result = capabilityResult(capabilityId, input, { ok: false, status: 'invalid_invocation', issues: ['project_control_input_invalid'] });
    }
  }
  return result;
}

export const run = (input = {}, context = DEFAULT_CAPABILITY_CONTEXT) => runCapabilityHandler(capabilityId, handle, input, context);
export const evaluate = (result, input = {}, context = DEFAULT_CAPABILITY_CONTEXT) => evaluateSealedCapabilityResult(capabilityId, result, input, context);
