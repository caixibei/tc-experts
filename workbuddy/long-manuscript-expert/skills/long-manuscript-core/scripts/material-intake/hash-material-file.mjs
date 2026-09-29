import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit one-file read only. This proves byte inventory, never content comprehension.
export async function hashMaterialFile(file, { maxBytes = 16 * 1024 ** 3, timeoutMs = 120000, signal } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('invalid_budget');
  const source = path.resolve(file);
  const start = performance.now();
  const initial = await fs.promises.lstat(source);
  if (!initial.isFile() || initial.isSymbolicLink()) throw new Error('regular_file_required');
  if (initial.size > maxBytes) throw new Error('file_byte_budget_exceeded');
  const handle = await fs.promises.open(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 ** 2);
  let readBytes = 0;
  let status = 'complete';
  let before;
  try {
    before = await handle.stat();
    if (!before.isFile() || before.dev !== initial.dev || before.ino !== initial.ino || before.size !== initial.size || before.mtimeMs !== initial.mtimeMs) throw new Error('source_changed_before_read');
    while (true) {
      if (signal?.aborted) { status = 'cancelled'; break; }
      if (performance.now() - start > timeoutMs) { status = 'deadline_exceeded'; break; }
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      readBytes += bytesRead;
      if (readBytes > maxBytes || readBytes > before.size) { status = 'source_changed_during_read'; break; }
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    const namedAfter = await fs.promises.lstat(source);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || namedAfter.isSymbolicLink() || namedAfter.ino !== before.ino || namedAfter.dev !== before.dev
      || namedAfter.size !== before.size || namedAfter.mtimeMs !== before.mtimeMs) status = 'source_changed_during_read';
    if (status === 'complete' && readBytes !== before.size) status = 'source_changed_during_read';
    return {
      schemaVersion: 'manuscriptos.material-file-hash/v1', status,
      sourceRef: 'source-ref:sha256:' + crypto.createHash('sha256').update(source).digest('hex'),
      declaredBytes: before.size, readBytes, residualBytes: Math.max(0, before.size - readBytes),
      sha256: status === 'complete' ? hash.digest('hex') : null,
      bufferBytes: buffer.length, elapsedMs: Math.round(performance.now() - start),
      reportedMaxRssKiB: process.resourceUsage().maxRSS,
      inventoryState: status === 'complete' ? 'hash_complete' : 'hash_pending',
      hashResumeMode: 'full_restart', contentObservationState: 'not_observed',
      originalMutationCount: 0, networkUsed: false
    };
  } finally { await handle.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--file') throw new Error('usage: --file <explicitly-authorized-file>');
    const r = await hashMaterialFile(args[1]);
    process.stdout.write(JSON.stringify(r) + '\n');
    process.exitCode = r.status === 'complete' ? 0 : 2;
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: 'blocked', code: error.code ?? error.message, sha256: null, originalMutationCount: 0 }) + '\n');
    process.exitCode = 2;
  }
}
