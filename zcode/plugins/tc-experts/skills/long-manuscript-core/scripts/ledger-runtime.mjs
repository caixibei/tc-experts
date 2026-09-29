#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

const scriptPath = fileURLToPath(import.meta.url);
const SHA256_RE = /^[a-f0-9]{64}$/;
const ENTRY_HASH_ALGORITHM = "sha256_canonical_json_without_entry_hash_v1";
const VALID_STATUSES = new Set(["started", "completed", "partial", "failed", "blocked", "degraded"]);
const MAX_JOURNAL_LINE_BYTES = 64 * 1024;
const MAX_DIGESTS_PER_DIRECTION = 256;
const EVENT_KEYS = [
  "schemaVersion", "eventId", "idempotencyKey", "projectId", "action", "actor",
  "inputDigests", "outputDigests", "startedAt", "completedAt", "status", "error",
  "receiptRef", "previousHash", "currentReceipt", "entryHashAlgorithm", "entryHash",
];

function parseArgs(argv) {
  const out = { "input-digest": [], "output-digest": [] };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    if (key === "input-digest" || key === "output-digest") out[key].push(String(value));
    else out[key] = value;
  }
  return out;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function digestObject(value, omittedKeys = []) {
  const clone = { ...value };
  for (const key of omittedKeys) delete clone[key];
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(clone))).digest("hex");
}

function isWithin(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

function nearestExistingAncestor(candidate) {
  let cursor = path.resolve(candidate);
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
  return cursor;
}

function resolveBoundedPath(projectRoot, candidate, label, { mustExist = false } = {}) {
  const root = fs.realpathSync(path.resolve(projectRoot));
  const absolute = path.resolve(root, String(candidate));
  if (!isWithin(root, absolute)) throw new Error(`${label} escapes project root: ${absolute}`);
  const ancestor = nearestExistingAncestor(absolute);
  if (!ancestor) throw new Error(`${label} has no resolvable ancestor: ${absolute}`);
  if (!isWithin(root, fs.realpathSync(ancestor))) throw new Error(`${label} resolves outside project root: ${absolute}`);
  if (mustExist && !fs.existsSync(absolute)) throw new Error(`${label} does not exist: ${absolute}`);
  if (fs.existsSync(absolute)) {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a physical regular file: ${absolute}`);
  }
  return { root, absolute };
}

function normalizeDigests(values, label, { required = false } = {}) {
  const normalized = [...new Set((values || []).map((value) => String(value).toLowerCase()))];
  if (required && normalized.length === 0) throw new Error(`${label} requires at least one SHA-256 digest`);
  if (normalized.length > MAX_DIGESTS_PER_DIRECTION) throw new Error(`${label} exceeds ${MAX_DIGESTS_PER_DIRECTION} digest references`);
  for (const digest of normalized) {
    if (!SHA256_RE.test(digest)) throw new Error(`${label} contains an invalid SHA-256 digest: ${digest}`);
  }
  return normalized;
}

function validateEntryShape(entry, index) {
  const label = `journal entry ${index + 1}`;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${label} must be an object`);
  if (Object.keys(entry).sort().join(",") !== [...EVENT_KEYS].sort().join(",")) throw new Error(`${label} shape is not canonical`);
  if (entry.schemaVersion !== "fbs.event-journal-entry/v2") throw new Error(`${label} has unsupported schemaVersion`);
  for (const field of ["eventId", "idempotencyKey", "projectId", "action", "actor", "startedAt", "completedAt"]) {
    if (!entry[field] || typeof entry[field] !== "string") throw new Error(`${label} is missing ${field}`);
  }
  if (!Array.isArray(entry.inputDigests) || entry.inputDigests.length === 0) throw new Error(`${label} has no inputDigests`);
  if (!Array.isArray(entry.outputDigests)) throw new Error(`${label} has invalid outputDigests`);
  normalizeDigests(entry.inputDigests, `${label}.inputDigests`, { required: true });
  normalizeDigests(entry.outputDigests, `${label}.outputDigests`);
  if (!VALID_STATUSES.has(entry.status)) throw new Error(`${label} has invalid status`);
  for (const [field, maximum] of [["eventId", 128], ["idempotencyKey", 256], ["projectId", 256], ["action", 256], ["actor", 256]]) {
    if (Buffer.byteLength(entry[field], "utf8") > maximum) throw new Error(`${label}.${field} exceeds ${maximum} bytes`);
  }
  if (entry.error !== null && (typeof entry.error !== "string" || Buffer.byteLength(entry.error, "utf8") > 4096)) throw new Error(`${label}.error is invalid or too large`);
  if (entry.receiptRef !== null && (typeof entry.receiptRef !== "string" || Buffer.byteLength(entry.receiptRef, "utf8") > 4096)) throw new Error(`${label}.receiptRef is invalid or too large`);
  if (entry.currentReceipt !== true) throw new Error(`${label} must declare currentReceipt=true`);
  if (entry.previousHash !== null && !SHA256_RE.test(String(entry.previousHash))) throw new Error(`${label} has invalid previousHash`);
  if (entry.entryHashAlgorithm !== ENTRY_HASH_ALGORITHM) throw new Error(`${label} has unsupported entryHashAlgorithm`);
  if (!SHA256_RE.test(String(entry.entryHash || ""))) throw new Error(`${label} has invalid entryHash`);
  const startedAtMs = Date.parse(entry.startedAt);
  const completedAtMs = Date.parse(entry.completedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs)) throw new Error(`${label} has invalid timestamps`);
  if (startedAtMs > completedAtMs) throw new Error(`${label} completedAt precedes startedAt`);
  const observedHash = digestObject(entry, ["entryHash"]);
  if (observedHash !== entry.entryHash) throw new Error(`${label} entryHash mismatch`);
}

function scanJournalFile(journalPath, soughtIdempotencyKey = null) {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const fd = fs.openSync(journalPath, "r");
  let carry = "";
  let lineNumber = 0;
  let entryCount = 0;
  let previousHash = null;
  let lastEntry = null;
  let matchingEntry = null;
  let matchingCount = 0;

  const processLine = (rawLine) => {
    lineNumber += 1;
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.trim()) return;
    if (Buffer.byteLength(line, "utf8") > MAX_JOURNAL_LINE_BYTES) {
      throw new Error(`journal line ${lineNumber} exceeds ${MAX_JOURNAL_LINE_BYTES} bytes`);
    }
    let entry;
    try { entry = JSON.parse(line); }
    catch (error) { throw new Error(`journal contains invalid JSON at line ${lineNumber}: ${journalPath}: ${error.message}`); }
    validateEntryShape(entry, entryCount);
    if (entry.previousHash !== previousHash) throw new Error(`journal entry ${entryCount + 1} previousHash mismatch`);
    previousHash = entry.entryHash;
    lastEntry = entry;
    entryCount += 1;
    if (soughtIdempotencyKey && entry.idempotencyKey === soughtIdempotencyKey) {
      matchingCount += 1;
      matchingEntry = entry;
    }
  };

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const decoded = decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
      const parts = `${carry}${decoded}`.split("\n");
      carry = parts.pop() || "";
      for (const line of parts) processLine(line);
      if (Buffer.byteLength(carry, "utf8") > MAX_JOURNAL_LINE_BYTES) {
        throw new Error(`journal line ${lineNumber + 1} exceeds ${MAX_JOURNAL_LINE_BYTES} bytes`);
      }
    }
    carry += decoder.decode();
    if (carry) processLine(carry);
  } catch (error) {
    if (error instanceof TypeError && /encoded data was not valid/u.test(error.message)) {
      throw new Error(`journal is not valid UTF-8: ${journalPath}`);
    }
    throw error;
  } finally {
    fs.closeSync(fd);
  }
  if (matchingCount > 1) throw new Error(`duplicate idempotencyKey: ${soughtIdempotencyKey}`);
  return { entryCount, headHash: previousHash, lastEntry, matchingEntry };
}

export function verifyJournalFile({ projectRoot, journalPath, idempotencyKey = null }) {
  const bounded = resolveBoundedPath(projectRoot, journalPath, "journal-path");
  if (path.extname(bounded.absolute).toLowerCase() !== ".jsonl") throw new Error("journal-path must end in .jsonl");
  if (!fs.existsSync(bounded.absolute)) {
    return { ok: true, journalPath: bounded.absolute, entryCount: 0, headHash: null, lastEntry: null, matchingEntry: null };
  }
  return { ok: true, journalPath: bounded.absolute, ...scanJournalFile(bounded.absolute, idempotencyKey) };
}

function eventIdentity(entry) {
  return {
    projectId: entry.projectId,
    action: entry.action,
    actor: entry.actor,
    inputDigests: entry.inputDigests,
    outputDigests: entry.outputDigests,
    status: entry.status,
    error: entry.error,
    receiptRef: entry.receiptRef,
  };
}

function buildEntry(options, previousHash, nowIso) {
  const inputDigests = normalizeDigests(options.inputDigests, "input-digest", { required: true });
  const outputDigests = normalizeDigests(options.outputDigests, "output-digest");
  const status = String(options.status || "completed");
  if (!VALID_STATUSES.has(status)) throw new Error(`invalid status: ${status}`);
  const projectId = String(options.projectId || "").trim();
  const action = String(options.action || "").trim();
  const actor = String(options.actor || "").trim();
  if (!projectId) throw new Error("--project-id is required");
  if (!action) throw new Error("--action is required");
  if (!actor) throw new Error("--actor is required");
  const identitySeed = {
    projectId,
    action,
    actor,
    inputDigests,
    outputDigests,
    status,
    error: options.error ? String(options.error) : null,
    receiptRef: options.receiptRef || null,
  };
  const idempotencyKey = String(options.idempotencyKey || digestObject(identitySeed)).trim();
  if (!idempotencyKey) throw new Error("idempotency key cannot be empty");
  for (const [field, value, maximum] of [["projectId", projectId, 256], ["action", action, 256], ["actor", actor, 256], ["idempotencyKey", idempotencyKey, 256]]) {
    if (Buffer.byteLength(value, "utf8") > maximum) throw new Error(`${field} exceeds ${maximum} bytes`);
  }
  if (identitySeed.error !== null && Buffer.byteLength(identitySeed.error, "utf8") > 4096) throw new Error("error exceeds 4096 bytes");
  const entry = {
    schemaVersion: "fbs.event-journal-entry/v2",
    eventId: crypto.randomUUID(),
    idempotencyKey,
    projectId,
    action,
    actor,
    inputDigests,
    outputDigests,
    startedAt: String(options.startedAt || nowIso),
    completedAt: String(options.completedAt || nowIso),
    status,
    error: options.error ? String(options.error) : null,
    receiptRef: options.receiptRef || null,
    previousHash,
    currentReceipt: true,
    entryHashAlgorithm: ENTRY_HASH_ALGORITHM,
    entryHash: null,
  };
  if (!Number.isFinite(Date.parse(entry.startedAt)) || !Number.isFinite(Date.parse(entry.completedAt))) {
    throw new Error("startedAt and completedAt must be ISO date-time values");
  }
  entry.entryHash = digestObject(entry, ["entryHash"]);
  return entry;
}

export function planLedgerEntry(options = {}) {
  if (!options.journalPath) throw new Error("--journal-path is required");
  const bounded = resolveBoundedPath(options.projectRoot || process.cwd(), options.journalPath, "journal-path");
  if (path.extname(bounded.absolute).toLowerCase() !== ".jsonl") throw new Error("journal-path must end in .jsonl");
  let receiptRef = null;
  if (options.receiptRef) {
    receiptRef = resolveBoundedPath(bounded.root, options.receiptRef, "receipt-ref", { mustExist: true }).absolute;
  }
  const nowIso = new Date(options.nowMs ?? Date.now()).toISOString();
  const entry = buildEntry({ ...options, receiptRef }, null, nowIso);
  const verified = verifyJournalFile({ projectRoot: bounded.root, journalPath: bounded.absolute, idempotencyKey: entry.idempotencyKey });
  entry.previousHash = verified.headHash;
  entry.entryHash = digestObject(entry, ["entryHash"]);
  const existing = verified.matchingEntry;
  if (existing && JSON.stringify(stableValue(eventIdentity(existing))) !== JSON.stringify(stableValue(eventIdentity(entry)))) {
    const error = new Error(`idempotency conflict: ${entry.idempotencyKey}`);
    error.code = "IDEMPOTENCY_CONFLICT";
    throw error;
  }
  return {
    schemaVersion: "fbs.ledger-plan/v1",
    mode: "plan",
    writePerformed: false,
    journalPath: bounded.absolute,
    entryCountBefore: verified.entryCount,
    idempotentReplay: !!existing,
    wouldAppend: !existing,
    entry: existing || entry,
  };
}

export function appendLedgerEntry(options = {}) {
  if (!options.journalPath) throw new Error("--journal-path is required");
  const bounded = resolveBoundedPath(options.projectRoot || process.cwd(), options.journalPath, "journal-path");
  if (path.extname(bounded.absolute).toLowerCase() !== ".jsonl") throw new Error("journal-path must end in .jsonl");
  buildEntry(options, null, new Date(options.nowMs ?? Date.now()).toISOString());
  const lockPath = `${bounded.absolute}.lock`;
  fs.mkdirSync(path.dirname(bounded.absolute), { recursive: true });
  let lockFd;
  try {
    lockFd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    const freshPlan = planLedgerEntry(options);
    if (freshPlan.idempotentReplay) {
      return { ...freshPlan, mode: "write", writePerformed: false, readbackVerified: true };
    }
    const fd = fs.openSync(freshPlan.journalPath, "a");
    try {
      fs.writeSync(fd, `${JSON.stringify(freshPlan.entry)}\n`, null, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const readback = verifyJournalFile({ projectRoot: options.projectRoot || process.cwd(), journalPath: freshPlan.journalPath });
    const last = readback.lastEntry;
    if (!last || last.entryHash !== freshPlan.entry.entryHash) throw new Error("journal readback mismatch after append");
    return {
      schemaVersion: "fbs.ledger-write-receipt/v1",
      mode: "write",
      writePerformed: true,
      journalPath: freshPlan.journalPath,
      entryCountBefore: freshPlan.entryCountBefore,
      entryCountAfter: readback.entryCount,
      idempotentReplay: false,
      readbackVerified: true,
      headHash: readback.headHash,
      entry: last,
    };
  } finally {
    if (lockFd !== undefined) {
      fs.closeSync(lockFd);
      if (fs.existsSync(lockPath)) fs.rmSync(lockPath);
    }
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (!args["journal-path"]) {
    console.error("Usage: ledger-runtime.mjs --project-root <path> --journal-path <relative.jsonl> --project-id <id> --action <action> --actor <actor> --input-digest <sha256> [--output-digest <sha256>] [--write]");
    process.exit(2);
  }
  try {
    if (args.verify === true) {
      const result = verifyJournalFile({ projectRoot: args["project-root"] || process.cwd(), journalPath: args["journal-path"] });
      delete result.lastEntry;
      delete result.matchingEntry;
      console.log(JSON.stringify({ schemaVersion: "fbs.ledger-verification/v1", ...result }, null, 2));
      return;
    }
    const options = {
      projectRoot: args["project-root"] || process.cwd(),
      journalPath: args["journal-path"],
      projectId: args["project-id"],
      action: args.action,
      actor: args.actor,
      inputDigests: args["input-digest"],
      outputDigests: args["output-digest"],
      status: args.status,
      error: args.error,
      receiptRef: args["receipt-ref"],
      idempotencyKey: args["idempotency-key"],
    };
    const result = args.write === true ? appendLedgerEntry(options) : planLedgerEntry(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: "blocked", error: error.message }));
    process.exit(error.code === "IDEMPOTENCY_CONFLICT" ? 4 : 3);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) main();
