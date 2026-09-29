import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, stableJson } from '../lib/kernel-utils.mjs';

const LIMIT = 1024 * 1024;
const DIGEST = /^[a-f0-9]{64}$/i;
const ROLES = new Set(['event', 'document', 'record']);
const KINDS = new Set(['fact', 'inference', 'example', 'unknown', 'editorial']);
const LABELS = { inference: /推断|推测|inference/i, example: /假设|示例|hypothetical|example/i, unknown: /待核|未知|未见|unknown|unverified/i };

// Structural consumption gate: source review is caller-provided evidence.
// Never turn this result into machine proof of the source's semantic truth.
export function auditProse(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result(['input_invalid'], null, 0);
  const issues = [];
  const facts = Array.isArray(input.facts) ? input.facts : [];
  const segments = Array.isArray(input.segments) ? input.segments : [];
  if (input.schemaVersion !== 'manuscriptos.source-prose-request/v1') issues.push('schema_version_invalid');
  if (!segments.length || segments.length > 128 || facts.length > 256) issues.push('input_cardinality_invalid');
  if (segments.some((s) => !s || typeof s.text !== 'string' || s.text.length > 4096)
    || facts.some((f) => !f || typeof f.value !== 'string' || !f.value || f.value.length > 4096)) issues.push('text_size_invalid');
  if (issues.length) return result(issues, null, 0);
  const byId = new Map();
  for (const fact of facts) {
    if (typeof fact.id !== 'string' || !fact.id || fact.id.length > 256 || byId.has(fact.id)) issues.push('fact_id_invalid_or_duplicate');
    byId.set(fact.id, fact);
    if (!['token', 'date', 'quote', 'quantity'].includes(fact.type)) issues.push('fact_type_invalid');
    if (fact.type === 'date' && !ROLES.has(fact.temporalRole)) issues.push('date_role_required');
  }
  for (const segment of segments) {
    if (!KINDS.has(segment.kind)) { issues.push('segment_kind_invalid'); continue; }
    if (LABELS[segment.kind] && !LABELS[segment.kind].test(segment.text)) issues.push('point_of_use_label_required');
    if (/\bpwsh(?:\.exe)?\b[^\r\n]*\s-File\s+[^\r\n]*\s-NoExit\b/i.test(segment.text)) issues.push('powershell_host_option_after_file');
    const forbiddenRuntimePairLabel = ['双', '宿主'].join('');
    if (segment.text.includes(forbiddenRuntimePairLabel) && /Windows PowerShell|\bpwsh\b/iu.test(segment.text)) issues.push('runtime_misclassified_as_product_host');
    const refs = segment.factRefs;
    if (!Array.isArray(refs) || refs.length > 256 || refs.some((id) => typeof id !== 'string')) { issues.push('fact_refs_required'); continue; }
    if (segment.kind === 'fact' && refs.length === 0) issues.push('factual_segment_unbound');
    for (const id of refs) {
      const fact = byId.get(id);
      if (!fact) { issues.push('fact_ref_missing'); continue; }
      if (!segment.text.includes(fact.value)) issues.push('fact_value_not_preserved');
      if (segment.kind === 'fact') {
        if (fact.reviewState !== 'source_verified' || !['source_reread', 'user_confirmed'].includes(fact.reviewBasis?.kind)
          || typeof fact.reviewBasis?.reference !== 'string' || !fact.reviewBasis.reference.trim()
          || typeof fact.sourceRef !== 'string' || !fact.sourceRef.trim() || !DIGEST.test(fact.sourceDigest ?? '')
          || !Array.isArray(fact.unknowns) || fact.unknowns.length) issues.push('unverified_fact_in_prose');
        if (fact.type === 'date' && (fact.temporalRole !== segment.temporalRole || !ROLES.has(segment.temporalRole))) issues.push('date_role_mismatch');
      }
    }
    if (segment.kind === 'fact' || segment.kind === 'editorial') {
      const sensitive = [...segment.text.matchAll(/[A-Za-z]:\\[^`"\r\n]*?\.[a-z0-9]+|\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\b\d{4}-\d{2}-\d{2}\b|\b(?:v)?\d+\.(?:\d+|x)(?:\.\d+)?\b/gi)].map((m) => m[0]);
      if (sensitive.some((token) => !refs.some((id) => byId.get(id)?.value === token))) issues.push('critical_token_unbound');
      if (segment.kind === 'editorial' && sensitive.length) issues.push('critical_token_in_editorial_segment');
    }
  }
  const prose = segments.map((s) => s.text).join('\n');
  const count = Array.from(prose).length;
  if (input.maxCharacters !== undefined && (!Number.isSafeInteger(input.maxCharacters) || input.maxCharacters < 1 || count > input.maxCharacters)) issues.push('character_budget_exceeded');
  return result(issues, sha256(prose), count);
}

function result(issues, proseDigest, characterCount) {
  const payload = {
    schemaVersion: 'manuscriptos.source-prose-result/v1',
    status: issues.length ? 'blocked' : 'structural_bindings_passed',
    issues: [...new Set(issues)].sort(), proseDigest, characterCount,
    evidenceState: 'caller_supplied_source_review_only',
    semanticTruthVerified: false, hostInvocationProven: false,
    originalMutationCount: 0, externalActionCount: 0
  };
  return { ...payload, resultDigest: sha256(stableJson(payload)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let size = 0;
  const parts = [];
  try {
    if (process.argv.length > 2) throw new Error('arguments_not_supported');
    for await (const part of process.stdin) {
      size += part.length;
      if (size > LIMIT) throw new Error('control_envelope_too_large');
      parts.push(part);
    }
    const output = auditProse(JSON.parse(Buffer.concat(parts).toString('utf8')));
    process.stdout.write(JSON.stringify(output) + '\n');
    process.exitCode = output.status === 'blocked' ? 2 : 0;
  } catch (error) {
    process.stdout.write(JSON.stringify(result([error.message === 'control_envelope_too_large' ? error.message : 'input_invalid'], null, 0)) + '\n');
    process.exitCode = 2;
  }
}
