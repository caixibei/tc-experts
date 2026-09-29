import crypto from 'node:crypto';

export {
  PACKAGE_TEXT_DIGEST_ALGORITHM,
  PackageTextDigestError,
  decodePackageTextUtf8,
  inspectPackageTextDigest,
  normalizePackageTextV1,
  packageTextSha256,
  parsePackageJson,
} from './package-text-digest.mjs';

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
    return output;
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Raw(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8')).digest('hex');
}

// Backward-compatible alias. Package-owned text self-bindings must use
// packageTextSha256; user material, binary artifacts, receipts and ZIP bytes
// continue to use this raw-byte digest.
export function sha256(value) {
  return sha256Raw(value);
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function unique(values) {
  return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b), 'en'));
}

export function riskMax(values) {
  const order = ['low', 'medium', 'high', 'restricted'];
  return asArray(values).reduce((current, value) => order.indexOf(value) > order.indexOf(current) ? value : current, 'low');
}

export function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function measuredWords(value) {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const latin = text.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/gu) ?? [];
  const han = text.match(/[\p{Script=Han}]/gu) ?? [];
  return latin.length + han.length;
}

export function capabilityResult(capabilityId, input, { status = 'completed', ok = true, output = {}, issues = [], warnings = [] } = {}) {
  const normalizedIssues = unique(asArray(issues).map(String));
  const normalizedWarnings = unique(asArray(warnings).map(String));
  const payload = {
    capabilityId,
    status,
    ok: Boolean(ok),
    output,
    issues: normalizedIssues,
    warnings: normalizedWarnings
  };
  return payload;
}

export const CAPABILITY_RECEIPT_SCHEMA_VERSION = '1.2.0';
export const DEFAULT_CAPABILITY_CONTEXT = Object.freeze({ connectorAvailable: false, externalWriteAuthorized: false, externalToolsAvailable: false });

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function capabilityContextInputValid(context) {
  if (!isPlainObject(context)) return false;
  const keys = Object.keys(context).sort().join(',');
  if (!['connectorAvailable,externalWriteAuthorized', 'connectorAvailable,externalToolsAvailable,externalWriteAuthorized'].includes(keys)) return false;
  return typeof context.connectorAvailable === 'boolean'
    && typeof context.externalWriteAuthorized === 'boolean'
    && (context.externalToolsAvailable === undefined || typeof context.externalToolsAvailable === 'boolean');
}

export function unexpectedCapabilityInputKeys(input, allowedKeys) {
  if (!isPlainObject(input)) return ['input_object_required'];
  const allowed = new Set(allowedKeys);
  return unique(Object.keys(input).filter((key) => !allowed.has(key)).map((key) => `input_key_unexpected:${key}`));
}

export function normalizeCapabilityContext(context = {}) {
  return {
    connectorAvailable: context?.connectorAvailable === true,
    externalWriteAuthorized: context?.externalWriteAuthorized === true,
    externalToolsAvailable: context?.externalToolsAvailable === true,
  };
}

export const capabilityRuntimePolicyDigest = sha256(stableJson({
  schemaVersion: '1.1.0',
  capabilityReceiptSchemaVersion: CAPABILITY_RECEIPT_SCHEMA_VERSION,
  runtimeSelfContained: true,
  connectorRequired: false,
  donorSkillRequired: false,
  externalRuntimeUsed: false,
  externalActionCount: 0,
}));

export function sealCapabilityResult(capabilityId, input, context, result) {
  const normalizedContext = normalizeCapabilityContext(context);
  const payload = {
    capabilityId: result?.capabilityId,
    status: result?.status,
    ok: result?.ok,
    output: result?.output,
    issues: unique(asArray(result?.issues).map(String)),
    warnings: unique(asArray(result?.warnings).map(String)),
    context: normalizedContext
  };
  return {
    ...payload,
    receipt: {
      schemaVersion: CAPABILITY_RECEIPT_SCHEMA_VERSION,
      capabilityId,
      inputDigest: sha256(stableJson(input ?? {})),
      contextDigest: sha256(stableJson(normalizedContext)),
      invocationDigest: sha256(stableJson({ capabilityId, input: input ?? {}, context: normalizedContext })),
      policyDigest: capabilityRuntimePolicyDigest,
      resultDigest: sha256(stableJson(payload)),
      externalActionCount: 0,
      connectorRequired: false,
      donorSkillUsed: false,
      externalRuntimeUsed: false,
    }
  };
}

const exactKeys = (value, keys) => isPlainObject(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const receiptShapeValid = (receipt) => exactKeys(receipt, [
  'schemaVersion', 'capabilityId', 'inputDigest', 'contextDigest', 'invocationDigest', 'policyDigest',
  'resultDigest', 'externalActionCount', 'connectorRequired', 'donorSkillUsed', 'externalRuntimeUsed',
]);
const normalizedContextShapeValid = (context) => exactKeys(context, ['connectorAvailable', 'externalWriteAuthorized', 'externalToolsAvailable'])
  && typeof context.connectorAvailable === 'boolean' && typeof context.externalWriteAuthorized === 'boolean' && typeof context.externalToolsAvailable === 'boolean';
const resultShapeValid = (result) => exactKeys(result, ['capabilityId', 'status', 'ok', 'output', 'issues', 'warnings', 'context', 'receipt'])
  && typeof result.capabilityId === 'string' && result.capabilityId.length > 0
  && typeof result.status === 'string' && result.status.length > 0 && typeof result.ok === 'boolean'
  && isPlainObject(result.output) && Array.isArray(result.issues) && result.issues.every((item) => typeof item === 'string')
  && new Set(result.issues).size === result.issues.length && Array.isArray(result.warnings)
  && result.warnings.every((item) => typeof item === 'string') && new Set(result.warnings).size === result.warnings.length
  && normalizedContextShapeValid(result.context) && receiptShapeValid(result.receipt);

export function evaluateSealedCapabilityResult(capabilityId, result, input = {}, context = DEFAULT_CAPABILITY_CONTEXT) {
  const issues = [];
  const normalizedContext = normalizeCapabilityContext(context);
  if (!isPlainObject(input)) issues.push('input_shape_invalid');
  if (!capabilityContextInputValid(context)) issues.push('context_shape_invalid');
  if (result?.capabilityId !== capabilityId) issues.push('capability_id_mismatch');
  if (result?.receipt?.capabilityId !== capabilityId) issues.push('receipt_capability_id_mismatch');
  if (result?.receipt?.schemaVersion !== CAPABILITY_RECEIPT_SCHEMA_VERSION) issues.push('receipt_schema_version_mismatch');
  if (result?.receipt?.connectorRequired !== false) issues.push('connector_dependency_detected');
  if (result?.receipt?.donorSkillUsed !== false) issues.push('donor_skill_dependency_detected');
  if (result?.receipt?.externalRuntimeUsed !== false) issues.push('external_runtime_dependency_detected');
  if (result?.receipt?.externalActionCount !== 0) issues.push('unexpected_external_action');
  if (!resultShapeValid(result)) issues.push('result_schema_invalid');
  if (stableJson(result?.context) !== stableJson(normalizedContext)) issues.push('context_mismatch');
  if (result?.receipt?.inputDigest !== sha256(stableJson(input ?? {}))) issues.push('input_digest_mismatch');
  if (result?.receipt?.contextDigest !== sha256(stableJson(normalizedContext))) issues.push('context_digest_mismatch');
  if (result?.receipt?.invocationDigest !== sha256(stableJson({ capabilityId, input: input ?? {}, context: normalizedContext }))) issues.push('invocation_digest_mismatch');
  if (result?.receipt?.policyDigest !== capabilityRuntimePolicyDigest) issues.push('policy_digest_mismatch');
  const payload = { capabilityId: result?.capabilityId, status: result?.status, ok: result?.ok, output: result?.output, issues: result?.issues, warnings: result?.warnings, context: result?.context };
  if (result?.receipt?.resultDigest !== sha256(stableJson(payload))) issues.push('result_digest_mismatch');
  return { ok: issues.length === 0, issues: unique(issues) };
}

export function runCapabilityHandler(capabilityId, handler, input = {}, context = DEFAULT_CAPABILITY_CONTEXT) {
  const invocationIssues = [
    ...(!isPlainObject(input) ? ['input_object_required'] : []),
    ...(!capabilityContextInputValid(context) ? ['context_shape_invalid'] : []),
  ];
  let result;
  if (invocationIssues.length) result = capabilityResult(capabilityId, input, { ok: false, status: 'invalid_invocation', issues: invocationIssues });
  else if (typeof handler !== 'function') result = capabilityResult(capabilityId, input, { ok: false, status: 'runtime_internal_error', issues: ['capability_handler_missing'] });
  else {
    try {
      result = handler(input, normalizeCapabilityContext(context));
      if (!isPlainObject(result) || result.capabilityId !== capabilityId) result = capabilityResult(capabilityId, input, { ok: false, status: 'runtime_internal_error', issues: ['capability_handler_result_invalid'] });
    } catch {
      result = capabilityResult(capabilityId, input, { ok: false, status: 'runtime_internal_error', issues: ['runtime_internal_error'] });
    }
  }
  return sealCapabilityResult(capabilityId, input, context, result);
}
