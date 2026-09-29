import './lib/suppress-node-sqlite-experimental-warning.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { sha256, stableJson } from './lib/kernel-utils.mjs';
import { chapterImpact } from './chapter-workflow.mjs';

const require = createRequire(import.meta.url);
const validId = v => typeof v === 'string' && /^[a-z][a-z0-9-]{0,127}$/u.test(v);
const validHash = v => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const MAX_HISTORY_BYTES = 64 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 1024 * 1024;
const APPLICATION_ID = 0x4d534350;

function assertPhysicalPath(target) {
  const parsed = path.parse(target);
  let current = parsed.root;
  for (const part of target.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink !== 1)) throw new Error('checkpoint_path_not_physical');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function validateSnapshot(snapshot) {
  if (!object(snapshot) || snapshot.schemaVersion !== 'manuscriptos.project-snapshot/v1'
    || !object(snapshot.ProjectStatus) || !validId(snapshot.ProjectStatus.projectId)
    || !Array.isArray(snapshot.chapters) || snapshot.chapters.length > 512 || !object(snapshot.sourceDigests)
    || Object.entries(snapshot.sourceDigests).some(([id, digest]) => !validId(id) || !validHash(digest))
    || !Array.isArray(snapshot.decisions)) throw new Error('checkpoint_snapshot_invalid');
  if (snapshot.decisions.some(d => !object(d) || !['user_confirmed', 'model_proposed', 'unknown'].includes(d.state)
    || typeof d.text !== 'string' || !d.text.trim() || (d.state === 'user_confirmed' && (typeof d.userMessageRef !== 'string' || !d.userMessageRef.trim())))) throw new Error('checkpoint_decision_evidence_missing');
  if (snapshot.chapters.some(c => !object(c) || !validId(c.id) || typeof c.text !== 'string' || sha256(c.text) !== c.digest
    || !Array.isArray(c.dependencies) || c.dependencies.some(d => !object(d) || !validId(d.id) || !validHash(d.digest)))
    || new Set(snapshot.chapters.map(c => c.id)).size !== snapshot.chapters.length
    || snapshot.chapters.some(c => Object.hasOwn(snapshot.sourceDigests, c.id))) throw new Error('checkpoint_chapter_invalid');
  const encoded = stableJson(snapshot);
  if (Buffer.byteLength(encoded) > MAX_SNAPSHOT_BYTES) throw new Error('checkpoint_snapshot_over_budget');
  return encoded;
}

function readHistory(db) {
  let head = null, totalBytes = 0, count = 0; const sourceTransitions=[];
  for (const row of db.prepare('SELECT * FROM manuscript_revisions ORDER BY version').iterate()) {
    totalBytes += Buffer.byteLength(row.payload);
    if (++count > 256 || totalBytes > MAX_HISTORY_BYTES) throw new Error('checkpoint_history_over_budget');
    if (row.version !== count || row.parent !== (head?.digest ?? null) || row.digest !== sha256(row.payload)) throw new Error('checkpoint_history_corrupt');
    const snapshot = JSON.parse(row.payload);
    if (validateSnapshot(snapshot) !== row.payload || (head && snapshot.ProjectStatus.projectId !== head.snapshot.ProjectStatus.projectId)) throw new Error('checkpoint_snapshot_identity_mismatch');
    const expectedRequest = sha256(stableJson({ mode: count === 1 ? 'initialize' : 'commit', expectedDigest: row.parent, expectedVersion: count - 1, snapshot }));
    if (!validId(row.idempotency_key) || row.request_digest !== expectedRequest) throw new Error('checkpoint_request_history_corrupt');
    if(head)for(const key of new Set([...Object.keys(head.snapshot.sourceDigests),...Object.keys(snapshot.sourceDigests)]))if(head.snapshot.sourceDigests[key]!==snapshot.sourceDigests[key])sourceTransitions.push({version:row.version,sourceId:key,before:head.snapshot.sourceDigests[key]??null,after:snapshot.sourceDigests[key]??null});
    head = { version: row.version, digest: row.digest, snapshot };
  }
  return { head, totalBytes, count, sourceTransitions };
}

/** Opt-in snapshot persistence. Existing manuscript files, indexes and legacy project formats are never migrated. */
export function manuscriptCheckpoint(input) {
  let db, transaction = false;
  try {
    if (!object(input) || !['initialize', 'commit', 'read', 'recover'].includes(input.mode) || typeof input.root !== 'string'
      || !path.isAbsolute(input.root)) throw new Error('checkpoint_input_invalid');
    const write = input.mode !== 'read';
    // Validate every write payload before creating any directory or database.
    let encoded = null, requestDigest = null;
    if (['initialize', 'commit'].includes(input.mode)) {
      if (!validId(input.idempotencyKey) || !(input.expectedDigest === null || validHash(input.expectedDigest)) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new Error('checkpoint_write_contract_invalid');
      encoded = validateSnapshot(input.snapshot);
      requestDigest = sha256(stableJson({ mode: input.mode, expectedDigest: input.expectedDigest, expectedVersion: input.expectedVersion, snapshot: input.snapshot }));
    }
    const root = path.resolve(input.root);
    assertPhysicalPath(root);
    if (!fs.statSync(root).isDirectory()) throw new Error('checkpoint_root_missing');
    const directory = path.join(root, '.fbs'), file = path.join(directory, 'manuscript-checkpoints.sqlite');
    for (const candidate of [directory, file, file + '-journal', file + '-wal', file + '-shm']) assertPhysicalPath(candidate);
    if (input.mode !== 'initialize' && !fs.existsSync(file)) throw new Error('checkpoint_not_initialized');
    if (input.mode === 'initialize' && !fs.existsSync(directory)) fs.mkdirSync(directory);
    const previouslyExists = fs.existsSync(file);
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(file, { readOnly: !write });
    db.exec('PRAGMA busy_timeout = 1500');
    if (previouslyExists && db.prepare('PRAGMA application_id').get().application_id !== APPLICATION_ID) throw new Error('checkpoint_store_identity_mismatch');
    if (write) {
      db.exec('PRAGMA synchronous = FULL');
      db.exec('BEGIN IMMEDIATE'); transaction = true;
      if (input.mode === 'initialize') {
        db.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
        db.exec('CREATE TABLE IF NOT EXISTS manuscript_revisions (version INTEGER PRIMARY KEY, parent TEXT, digest TEXT NOT NULL, payload TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, request_digest TEXT NOT NULL)');
      }
    }
    const { head, totalBytes, count, sourceTransitions } = readHistory(db);
    const headImpact = head ? chapterImpact({ chapters: head.snapshot.chapters, currentDigests: { ...head.snapshot.sourceDigests, ...Object.fromEntries(head.snapshot.chapters.map(c => [c.id, c.digest])) } }) : null;
    if (input.mode === 'read' || input.mode === 'recover') {
      if (transaction) { db.exec('COMMIT'); transaction = false; }
      return { ok: true, status: input.mode === 'read' ? 'readback_verified' : 'sqlite_recovery_readback_verified', head,
        historyCount: count, sourceTransitions, impact: headImpact, resumeReviewRequired: (headImpact?.affected.length ?? 0) > 0, originalManuscriptFilesChanged: false, hostValidated: false };
    }
    const existing = db.prepare('SELECT version, digest, request_digest FROM manuscript_revisions WHERE idempotency_key = ?').get(input.idempotencyKey);
    if (existing) {
      if (existing.request_digest !== requestDigest) throw new Error('checkpoint_idempotency_conflict');
      db.exec('COMMIT'); transaction = false;
      return { ok: true, status: 'already_committed', committedVersion: existing.version, committedDigest: existing.digest, head,
        originalManuscriptFilesChanged: false, hostValidated: false };
    }
    if ((head?.digest ?? null) !== input.expectedDigest || (head?.version ?? 0) !== input.expectedVersion || (input.mode === 'initialize' && head) || (input.mode === 'commit' && !head)) throw new Error('checkpoint_base_conflict');
    if (head && input.snapshot.ProjectStatus.projectId !== head.snapshot.ProjectStatus.projectId) throw new Error('checkpoint_project_mismatch');
    if (count >= 256 || totalBytes + Buffer.byteLength(encoded) > MAX_HISTORY_BYTES) throw new Error('checkpoint_history_over_budget');
    const digest = sha256(encoded);
    const currentDigests = { ...input.snapshot.sourceDigests, ...Object.fromEntries(input.snapshot.chapters.map(c => [c.id, c.digest])) };
    const impact = chapterImpact({ chapters: input.snapshot.chapters, currentDigests });
    db.prepare('INSERT INTO manuscript_revisions VALUES (?, ?, ?, ?, ?, ?)').run(count + 1, head?.digest ?? null, digest, encoded, input.idempotencyKey, requestDigest);
    db.exec('COMMIT'); transaction = false;
    // Read back the exact committed row. A concurrent later writer does not change this receipt's version.
    const readback = db.prepare('SELECT payload, digest FROM manuscript_revisions WHERE version = ?').get(count + 1);
    if (readback.payload !== encoded || readback.digest !== digest || sha256(readback.payload) !== digest) throw new Error('checkpoint_readback_mismatch');
    return { ok: true, status: 'committed_and_readback_verified', committedVersion: count + 1, committedDigest: digest,
      parentDigest: head?.digest ?? null, impact, historyCount: count + 1, snapshotBytes: Buffer.byteLength(encoded),
      originalManuscriptFilesChanged: false, hostValidated: false, semanticTruthVerified: false };
  } catch (error) {
    return { ok: false, issues: [String(error.message).startsWith('checkpoint_') ? error.message : 'checkpoint_storage_unavailable_or_busy'],
      sqliteCode: error.code ?? null, originalManuscriptFilesChanged: false, hostValidated: false };
  } finally {
    if (transaction) { try { db.exec('ROLLBACK'); } catch {} }
    db?.close();
  }
}
