// Pure evidence checks. Caller-supplied events never prove semantic truth.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export function auditDelivery(input = {}) {
  if (!object(input)) return {ok:false,issues:['invalid_input'],semanticTruthVerified:false};
  const { events = [], target, lineCount, finalDigest } = input;
  if (!Array.isArray(events) || events.length > 10000 || typeof target !== 'string' || !target || !Number.isSafeInteger(lineCount) || lineCount < 1 || !/^[a-f0-9]{64}$/i.test(finalDigest ?? ''))
    return { ok: false, issues: ['invalid_input'], semanticTruthVerified: false };
  if (events.some((e,i)=>!object(e)||!Number.isSafeInteger(e.sequence)||e.sequence<0||(i>0&&e.sequence<=events[i-1].sequence)||!['read','write'].includes(e.kind)||typeof e.target!=='string')) return {ok:false,issues:['invalid_event_sequence'],semanticTruthVerified:false};
  const writes = events.filter(e => e.target === target && e.kind === 'write' && e.success === true);
  const lastWrite = writes.at(-1);
  if (!lastWrite || !Number.isSafeInteger(lastWrite.sequence)) return { ok: false, issues: ['write_receipt_missing'], semanticTruthVerified: false };
  const reads = events.filter(e => e.target === target && e.kind === 'read' && e.success === true && e.sequence > lastWrite.sequence && e.digest === finalDigest);
  const intervals = reads.filter(e => Number.isSafeInteger(e.start) && Number.isSafeInteger(e.end) && e.start >= 1 && e.end >= e.start && e.end <= lineCount).sort((a,b) => a.start-b.start);
  let covered = 0;
  for (const r of intervals) { if (r.start > covered + 1) break; covered = Math.max(covered, r.end); }
  const eof = intervals.some(r => r.end === lineCount && r.eof === true);
  const issues = [];
  if (covered !== lineCount) issues.push('final_version_readback_incomplete');
  if (!eof) issues.push('final_version_eof_unproven');
  return { ok: issues.length === 0, issues, lastWriteSequence: lastWrite.sequence, coveredThrough: covered, lineCount, semanticTruthVerified: false };
}

export function auditCounts(input = {}) {
  if (!object(input)) return {ok:false,issues:['invalid_input']};
  const { rows = [], declaredCount, declaredBytes } = input;
  const issues = [];
  if (!Array.isArray(rows) || rows.length > 100000) return { ok: false, issues: ['invalid_rows'] };
  const ids = new Set(); let bytes = 0;
  for (const row of rows) {
    if (typeof row?.id !== 'string' || !row.id || ids.has(row.id)) issues.push('missing_or_duplicate_id');
    ids.add(row?.id);
    if (row?.kind !== 'file') issues.push('non_file_in_file_denominator');
    if (!Number.isSafeInteger(row?.bytes) || row.bytes < 0) issues.push('invalid_bytes');
    else bytes += row.bytes;
  }
  if (!Number.isSafeInteger(bytes)) issues.push('byte_sum_overflow');
  if (declaredCount !== rows.length) issues.push('count_mismatch');
  if (declaredBytes !== bytes) issues.push('byte_sum_mismatch');
  return { ok: issues.length === 0, issues: [...new Set(issues)], count: rows.length, bytes };
}

export function auditCitations(claims = []) {
  const issues = [];
  if (!Array.isArray(claims) || claims.length > 10000) return { ok: false, issues: ['invalid_claims'], semanticTruthVerified: false };
  for (const c of claims) {
    if (!object(c) || typeof c.id !== 'string' || !c.id) { issues.push('invalid_claim'); continue; }
    const refs = Array.isArray(c.references) ? c.references : [];
    if (!refs.length) issues.push(`${c.id}:source_missing`);
    for (const r of refs) {
      if (!object(r)) { issues.push(`${c.id}:invalid_reference`); continue; }
      let url;
      let decoded = '';
      try { url = new URL(r?.url); decoded = decodeURI(url.href); } catch { url = null; }
      if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || /\.\.\.|…|<|>/.test(decoded)) issues.push(`${c.id}:url_invalid_or_placeholder`);
      if (c.status === 'verified' && (r.opened !== true || typeof r.anchor !== 'string' || !r.anchor.trim() || !/^[a-f0-9]{64}$/i.test(r.contentDigest ?? ''))) issues.push(`${c.id}:verification_receipt_missing`);
    }
    if (c.dualEvidence === true && new Set(refs.map(r => r?.sourceId).filter(v=>typeof v==='string'&&v)).size < 2) issues.push(`${c.id}:dual_evidence_missing`);
    if (c.independentEvidence === true && new Set(refs.map(r => r?.originId).filter(v=>typeof v==='string'&&v)).size < 2) issues.push(`${c.id}:independent_origins_missing`);
  }
  return { ok: issues.length === 0, issues, semanticTruthVerified: false };
}

export function auditConcurrency(tasks = []) {
  if (!Array.isArray(tasks) || tasks.length > 10000 || tasks.some(t => !Number.isFinite(t?.start) || !Number.isFinite(t?.end) || t.end <= t.start)) return { ok: false, mode: 'unknown' };
  const points = tasks.flatMap(t => [[t.start, 1], [t.end, -1]]).sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  let active = 0, maxActive = 0;
  for (const [,delta] of points) { active += delta; maxActive = Math.max(maxActive, active); }
  return { ok: true, taskCount: tasks.length, maxActive, mode: maxActive > 1 ? 'parallel_observed' : tasks.length ? 'sequential_observed' : 'not_observed' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify({ok:false,status:'library_only',entrypoint:'scripts/expert-tools.mjs',hint:'Use --describe, --example or --self-test at the unified entrypoint.'})+'\n');
  process.exitCode=2;
}
