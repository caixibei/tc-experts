import {
  capabilityResultKinds,
  evaluateCapability,
  materialIntakeRequestSchemaVersion,
  resolveCapabilityInvocation,
  runCapability,
  workbuddyDirtyMaterialIntakeCapabilityId,
} from '../capability-runtime.mjs';

export const capabilityId = 'multimodal-normalizer';
export const structuredIntakeCapabilityId = workbuddyDirtyMaterialIntakeCapabilityId;
export const structuredIntakeSchemaVersion = materialIntakeRequestSchemaVersion;
export const structuredIntakeResultKind = capabilityResultKinds[structuredIntakeCapabilityId];
export const describeInvocation = (input = {}) => resolveCapabilityInvocation(capabilityId, input);
export const run = (input = {}, context = { connectorAvailable: false, externalWriteAuthorized: false }) => runCapability(capabilityId, input, context);
export const evaluate = (result, input = {}, context = { connectorAvailable: false, externalWriteAuthorized: false }) => evaluateCapability(capabilityId, result, input, context);
