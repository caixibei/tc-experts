#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

const scriptPath = fileURLToPath(import.meta.url);
const DEFAULT_MAX_RECEIPT_AGE_SECONDS = 86400;
const RECEIPT_DIGEST_ALGORITHM = "sha256_canonical_json_without_receipt_digest_v1";
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const STREAM_CHUNK_BYTES = 64 * 1024;
const MAX_RECEIPT_BYTES = 1024 * 1024;
const MAX_CONTROL_MARKDOWN_BYTES = 1024 * 1024;
const FORBIDDEN_FINAL_MARKERS = [
  /\[待核实-MAT-[^\]\r\n]+\]/i,
  /待核实-MAT-(?!XXX\b)[A-Za-z0-9-]+/i,
  /MAT-[A-Za-z0-9-]+（待补充）/i,
  /\[DISCARDED-[^\]\r\n]{1,300}\]/i,
  /\bTODO\b/i,
];

function parseArgs(argv) {
  const out = { bookRoot: null, projectId: null, strict: false, apply: false, dryRun: false, json: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--book-root") out.bookRoot = path.resolve(argv[++i] || "");
    else if (token === "--project-id") out.projectId = argv[++i] || null;
    else if (token === "--human-receipt") out.humanReceiptPath = argv[++i] || null;
    else if (token === "--quality-receipt") out.qualityReceiptPath = argv[++i] || null;
    else if (token === "--delivery-receipt") out.deliveryReceiptPath = argv[++i] || null;
    else if (token === "--max-receipt-age-seconds") out.maxReceiptAgeSeconds = Number(argv[++i]);
    else if (token === "--strict") out.strict = true;
    else if (token === "--apply") out.apply = true;
    else if (token === "--dry-run") out.dryRun = true;
    else if (token === "--json") out.json = true;
  }
  return out;
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

function resolveBoundedPath(bookRoot, candidate, label, { mustExist = true } = {}) {
  const root = fs.realpathSync(path.resolve(bookRoot));
  const absolute = path.resolve(root, String(candidate));
  if (!isWithin(root, absolute)) throw new Error(`${label} escapes book root`);
  const ancestor = nearestExistingAncestor(absolute);
  if (!ancestor || !isWithin(root, fs.realpathSync(ancestor))) throw new Error(`${label} resolves outside book root`);
  if (mustExist && !fs.existsSync(absolute)) throw new Error(`${label} does not exist: ${absolute}`);
  if (fs.existsSync(absolute)) {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a physical regular file`);
  }
  return absolute;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(STREAM_CHUNK_BYTES);
  const fd = fs.openSync(filePath, "r");
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function listFinalCandidates(releasesDir) {
  if (!fs.existsSync(releasesDir)) return [];
  return fs.readdirSync(releasesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.toLowerCase().endsWith(".md"))
    .filter((entry) => /(终稿|全稿|final)/i.test(entry.name))
    .map((entry) => {
      const absolute = path.join(releasesDir, entry.name);
      return { name: entry.name, path: absolute, mtimeMs: fs.statSync(absolute).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function resolveConfirmPinnedFile(releasesDir) {
  const files = fs.existsSync(releasesDir)
    ? fs.readdirSync(releasesDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && /^VERSION(?:-[\d.]+)?\.md$/i.test(entry.name))
        .map((entry) => entry.name)
        .sort()
    : [];
  for (const name of files) {
    const controlPath = path.join(releasesDir, name);
    if (fs.statSync(controlPath).size > MAX_CONTROL_MARKDOWN_BYTES) continue;
    const text = fs.readFileSync(controlPath, "utf8");
    const match = text.match(/([^\r\n"“”]+\.md)/);
    if (!match) continue;
    const candidateName = match[1].trim().replace(/[“”"]/g, "");
    const candidatePath = path.join(releasesDir, candidateName);
    if (path.dirname(candidatePath) === releasesDir && fs.existsSync(candidatePath)) {
      return { file: candidateName, source: name };
    }
  }
  return null;
}

function pickCanonicalFinal(releasesDir, candidates) {
  const pinned = resolveConfirmPinnedFile(releasesDir);
  if (pinned) {
    const match = candidates.find((candidate) => candidate.name === pinned.file);
    if (match) return { ...match, pickedBy: `version-confirm:${pinned.source}` };
  }
  const finalNamed = candidates.find((candidate) => /(终稿|final)/i.test(candidate.name));
  if (finalNamed) return { ...finalNamed, pickedBy: "name-priority:final" };
  return candidates[0] ? { ...candidates[0], pickedBy: "mtime-latest" } : null;
}

function inspectCanonicalFile(canonical) {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(STREAM_CHUNK_BYTES);
  const fd = fs.openSync(canonical.path, "r");
  const forbiddenHits = new Set();
  let overlap = "";
  let bytes = 0;
  const inspectText = (text) => {
    const window = `${overlap}${text}`;
    FORBIDDEN_FINAL_MARKERS.forEach((pattern) => {
      if (pattern.test(window)) forbiddenHits.add(pattern.source);
    });
    overlap = window.slice(-1024);
  };
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      bytes += bytesRead;
      hash.update(chunk);
      inspectText(decoder.decode(chunk, { stream: true }));
    }
    inspectText(decoder.decode());
  } catch (error) {
    if (error instanceof TypeError) throw new Error("canonical final is not valid UTF-8");
    throw error;
  } finally {
    fs.closeSync(fd);
  }
  return {
    status: forbiddenHits.size === 0 ? "passed" : "blocked",
    forbiddenHits: [...forbiddenHits],
    artifactDigest: hash.digest("hex"),
    bytes,
    contentEmbedded: false,
  };
}

function loadReceipt(bookRoot, receiptPath, label) {
  if (!receiptPath) return null;
  const absolute = resolveBoundedPath(bookRoot, receiptPath, label);
  if (path.extname(absolute).toLowerCase() !== ".json") throw new Error(`${label} must be a .json file`);
  if (fs.statSync(absolute).size > MAX_RECEIPT_BYTES) throw new Error(`${label} exceeds ${MAX_RECEIPT_BYTES} bytes`);
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error(`${label} must contain an object`);
  return { absolute, fileDigest: sha256File(absolute), receipt };
}

function validateFreshness(receipt, label, nowMs, maxAgeMs, { expiryRequired = false } = {}) {
  const issuedAtMs = Date.parse(receipt.issuedAt);
  if (!Number.isFinite(issuedAtMs)) throw new Error(`${label} has invalid issuedAt`);
  if (issuedAtMs > nowMs + FUTURE_SKEW_MS) throw new Error(`${label} issuedAt is in the future`);
  if (nowMs - issuedAtMs > maxAgeMs) throw new Error(`${label} is stale`);
  if (expiryRequired && !receipt.expiresAt) throw new Error(`${label} requires expiresAt`);
  if (receipt.expiresAt) {
    const expiresAtMs = Date.parse(receipt.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) throw new Error(`${label} is expired or malformed`);
  }
}

function validateBinding(receipt, label, { projectId, artifactDigest, kind }) {
  const expectedKeys = kind === "human"
    ? ["schemaVersion", "receiptId", "projectId", "artifactDigest", "issuedAt", "expiresAt", "currentReceipt", "status", "decision", "humanOwnerRole", "receiptDigestAlgorithm", "receiptDigest"]
    : ["schemaVersion", "receiptId", "projectId", "artifactDigest", "issuedAt", "currentReceipt", "status", "receiptDigestAlgorithm", "receiptDigest"];
  if (Object.keys(receipt).sort().join(",") !== expectedKeys.sort().join(",")) throw new Error(`${label} shape is not canonical`);
  if (receipt.schemaVersion !== `fbs.release-${kind}-receipt/v1`) throw new Error(`${label} has unsupported schemaVersion`);
  if (receipt.receiptDigestAlgorithm !== RECEIPT_DIGEST_ALGORITHM) throw new Error(`${label} has unsupported receiptDigestAlgorithm`);
  if (!receipt.receiptId || typeof receipt.receiptId !== "string") throw new Error(`${label} is missing receiptId`);
  if (!/^[a-f0-9]{64}$/.test(String(receipt.receiptDigest || ""))) throw new Error(`${label} has invalid receiptDigest`);
  if (receipt.receiptDigest !== digestPayload({ ...receipt, receiptDigest: undefined })) throw new Error(`${label} receiptDigest mismatch`);
  if (receipt.currentReceipt !== true) throw new Error(`${label} must declare currentReceipt=true`);
  if (receipt.projectId !== projectId) throw new Error(`${label} projectId mismatch`);
  if (receipt.artifactDigest !== artifactDigest) throw new Error(`${label} artifactDigest mismatch`);
}

function validateReleaseReceipts({ bookRoot, projectId, artifactDigest, paths, nowMs, maxAgeMs }) {
  const missing = Object.entries(paths).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) return { ready: false, missing, validated: [] };
  const loaded = {
    quality: loadReceipt(bookRoot, paths.quality, "quality receipt"),
    delivery: loadReceipt(bookRoot, paths.delivery, "delivery receipt"),
    human: loadReceipt(bookRoot, paths.human, "human receipt"),
  };
  for (const [kind, item] of Object.entries(loaded)) {
    validateBinding(item.receipt, `${kind} receipt`, { projectId, artifactDigest, kind });
    validateFreshness(item.receipt, `${kind} receipt`, nowMs, maxAgeMs, { expiryRequired: kind === "human" });
  }
  if (loaded.quality.receipt.status !== "passed") throw new Error("quality receipt is not passed");
  if (loaded.delivery.receipt.status !== "passed") throw new Error("delivery receipt is not passed");
  if (loaded.human.receipt.status !== "approved" || loaded.human.receipt.decision !== "approved") {
    throw new Error("human receipt is not approved");
  }
  if (!loaded.human.receipt.humanOwnerRole) throw new Error("human receipt is missing human owner role");
  return {
    ready: true,
    missing: [],
    validated: Object.entries(loaded).map(([kind, item]) => ({
      kind,
      path: item.absolute,
      fileDigest: item.fileDigest,
      receiptId: item.receipt.receiptId,
      receiptDigest: item.receipt.receiptDigest,
      issuedAt: item.receipt.issuedAt,
      expiresAt: item.receipt.expiresAt ?? null,
    })),
  };
}

function writeGovernanceReceipt(bookRoot, payload) {
  const outputPath = resolveBoundedPath(bookRoot, path.join(".fbs", "release-governor.json"), "governance output", { mustExist: false });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const readback = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  const observedDigest = digestPayload({ ...readback, governanceDigest: undefined });
  if (readback.governanceDigest !== payload.governanceDigest || observedDigest !== payload.governanceDigest) {
    throw new Error("governance receipt readback mismatch");
  }
  return outputPath;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function digestPayload(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

export function runReleaseGovernor({
  bookRoot,
  projectId,
  strict = false,
  apply = false,
  dryRun = false,
  humanReceiptPath = null,
  qualityReceiptPath = null,
  deliveryReceiptPath = null,
  maxReceiptAgeSeconds = DEFAULT_MAX_RECEIPT_AGE_SECONDS,
  nowMs = Date.now(),
} = {}) {
  if (!bookRoot) return { code: 2, message: "missing --book-root" };
  if (!fs.existsSync(bookRoot) || !fs.statSync(bookRoot).isDirectory()) return { code: 2, message: "book-root does not exist" };
  if (apply && dryRun) return { code: 2, message: "--apply and --dry-run are mutually exclusive" };
  const root = fs.realpathSync(path.resolve(bookRoot));
  const releasesDir = path.join(root, "releases");
  const candidates = listFinalCandidates(releasesDir);
  if (candidates.length === 0) {
    return {
      code: strict ? 1 : 0,
      schemaVersion: "fbs.release-governor-plan/v2",
      mode: "plan",
      message: strict ? "no final candidates" : "skip: no final candidates",
      canonical: null,
      moved: [],
      movedCount: 0,
      releaseEntryCreated: false,
      finalDraftState: null,
      releaseReady: false,
      publicationPerformed: false,
      mutations: { oldFinalsMoved: false, registryStatusChanged: false, finalDraftStateChanged: false, governanceReceiptWritten: false },
    };
  }
  const canonical = pickCanonicalFinal(releasesDir, candidates);
  let cleanGate;
  try { cleanGate = inspectCanonicalFile(canonical); }
  catch (error) {
    return {
      code: 1,
      schemaVersion: "fbs.release-governor-plan/v2",
      mode: "plan",
      message: error.message,
      canonical: { name: canonical.name, path: canonical.path, pickedBy: canonical.pickedBy },
      releaseReady: false,
      publicationPerformed: false,
      mutations: { oldFinalsMoved: false, registryStatusChanged: false, finalDraftStateChanged: false, governanceReceiptWritten: false },
    };
  }
  canonical.artifactDigest = cleanGate.artifactDigest;
  canonical.bytes = cleanGate.bytes;
  if (cleanGate.status !== "passed") {
    return {
      code: 1,
      schemaVersion: "fbs.release-governor-plan/v2",
      mode: "plan",
      message: "canonical final failed clean inspection",
      canonical,
      cleanGate,
      moved: [],
      movedCount: 0,
      releaseEntryCreated: false,
      finalDraftState: null,
      releaseReady: false,
      publicationPerformed: false,
      mutations: { oldFinalsMoved: false, registryStatusChanged: false, finalDraftStateChanged: false, governanceReceiptWritten: false },
    };
  }

  const effectiveProjectId = String(projectId || "").trim();
  const maxAge = Number(maxReceiptAgeSeconds);
  if (!Number.isFinite(maxAge) || maxAge <= 0) return { code: 2, message: "max receipt age must be positive" };
  let receiptValidation;
  try {
    receiptValidation = effectiveProjectId
      ? validateReleaseReceipts({
          bookRoot: root,
          projectId: effectiveProjectId,
          artifactDigest: canonical.artifactDigest,
          paths: { human: humanReceiptPath, quality: qualityReceiptPath, delivery: deliveryReceiptPath },
          nowMs,
          maxAgeMs: maxAge * 1000,
        })
      : { ready: false, missing: ["projectId"], validated: [] };
  } catch (error) {
    receiptValidation = { ready: false, missing: [], validated: [], error: error.message };
  }

  const mode = apply ? "apply" : "plan";
  const generatedAt = new Date(nowMs).toISOString();
  const out = {
    code: apply && !receiptValidation.ready ? 3 : 0,
    schemaVersion: "fbs.release-governor-plan/v2",
    mode,
    message: receiptValidation.ready
      ? "release evidence complete; manual publication remains required"
      : "release plan only; required receipts are missing or invalid",
    bookRoot: root,
    releasesDir,
    projectId: effectiveProjectId || null,
    canonical: { name: canonical.name, path: canonical.path, pickedBy: canonical.pickedBy, artifactDigest: canonical.artifactDigest },
    candidateCount: candidates.length,
    extraFinals: candidates.filter((item) => item.path !== canonical.path).map((item) => item.path),
    moved: [],
    movedCount: 0,
    releaseEntryCreated: false,
    finalDraftState: null,
    cleanGate,
    receiptValidation,
    releaseReady: receiptValidation.ready,
    publicationPerformed: false,
    mutations: {
      oldFinalsMoved: false,
      registryStatusChanged: false,
      finalDraftStateChanged: false,
      governanceReceiptWritten: false,
    },
    manualNextAction: receiptValidation.ready
      ? "A human owner may perform the separately authorized publication action."
      : "Provide current physical quality, delivery, and human approval receipts bound to this project and artifact digest.",
    generatedAt,
  };
  if (apply && receiptValidation.ready) {
    const expectedOutputPath = path.join(root, ".fbs", "release-governor.json");
    const persistable = {
      ...out,
      mutations: { ...out.mutations, governanceReceiptWritten: true },
      governanceReceiptPath: expectedOutputPath,
      governanceDigestAlgorithm: RECEIPT_DIGEST_ALGORITHM,
      governanceDigest: null,
    };
    persistable.governanceDigest = digestPayload({ ...persistable, governanceDigest: undefined });
    const outputPath = writeGovernanceReceipt(root, persistable);
    Object.assign(out, persistable, { governanceReceiptPath: outputPath });
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  let out;
  try { out = runReleaseGovernor(args); }
  catch (error) { out = { code: 3, mode: args.apply ? "apply" : "plan", message: error.message, releaseReady: false, publicationPerformed: false }; }
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`[release-governor] ${out.message}`);
    if (out.canonical?.name) console.log(`[release-governor] canonical: ${out.canonical.name}`);
    console.log(`[release-governor] mode=${out.mode || "plan"} releaseReady=${!!out.releaseReady} publicationPerformed=false`);
  }
  process.exit(out.code ?? 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) main();
