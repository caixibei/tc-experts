#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const skillRoot = path.resolve(path.dirname(scriptPath), "..");
const registry = JSON.parse(
  fs.readFileSync(path.join(skillRoot, "resources", "stage-gate-registry.json"), "utf8"),
);
const SHA256_RE = /^[a-f0-9]{64}$/;
const RECEIPT_DIGEST_ALGORITHM = "sha256_canonical_json_without_receipt_digest_v1";
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_RECEIPT_BYTES = 1024 * 1024;

function parseArgs(argv) {
  const out = { "gate-receipt": [] };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    if (name === "gate-receipt") out[name].push(String(value));
    else out[name] = value;
  }
  return out;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function digestObject(value, omittedKeys = []) {
  const clone = { ...value };
  for (const key of omittedKeys) delete clone[key];
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(clone))).digest("hex");
}

function fail(message, code = 2, details = {}) {
  console.error(JSON.stringify({ status: "blocked", error: message, ...details }));
  process.exit(code);
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

function assertBoundedPath(projectRoot, candidate, label, { mustExist = true } = {}) {
  const absolute = path.resolve(projectRoot, candidate);
  if (!isWithin(projectRoot, absolute)) {
    throw new Error(`${label} escapes project root: ${absolute}`);
  }
  const ancestor = nearestExistingAncestor(absolute);
  if (!ancestor) throw new Error(`${label} has no resolvable ancestor: ${absolute}`);
  const realRoot = fs.realpathSync(projectRoot);
  const realAncestor = fs.realpathSync(ancestor);
  if (!isWithin(realRoot, realAncestor)) {
    throw new Error(`${label} resolves outside project root: ${absolute}`);
  }
  if (mustExist) {
    if (!fs.existsSync(absolute)) throw new Error(`${label} does not exist: ${absolute}`);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`${label} must be a physical regular JSON file: ${absolute}`);
    }
  }
  return absolute;
}

function readJsonReceipt(projectRoot, candidate, label) {
  const absolute = assertBoundedPath(projectRoot, candidate, label);
  if (path.extname(absolute).toLowerCase() !== ".json") {
    throw new Error(`${label} must use a .json path: ${absolute}`);
  }
  if (fs.statSync(absolute).size > MAX_RECEIPT_BYTES) {
    throw new Error(`${label} exceeds ${MAX_RECEIPT_BYTES} bytes`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${absolute}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must contain a JSON object: ${absolute}`);
  }
  return { absolute, parsed };
}

function validateFreshness(receipt, nowMs, maxAgeMs, label) {
  const issuedAtMs = Date.parse(receipt.issuedAt);
  if (!Number.isFinite(issuedAtMs)) throw new Error(`${label} has invalid issuedAt`);
  if (issuedAtMs > nowMs + FUTURE_SKEW_MS) throw new Error(`${label} issuedAt is in the future`);
  if (nowMs - issuedAtMs > maxAgeMs) throw new Error(`${label} is stale`);
  if (receipt.expiresAt != null) {
    const expiresAtMs = Date.parse(receipt.expiresAt);
    if (!Number.isFinite(expiresAtMs)) throw new Error(`${label} has invalid expiresAt`);
    if (expiresAtMs <= nowMs) throw new Error(`${label} is expired`);
    if (expiresAtMs < issuedAtMs) throw new Error(`${label} expires before it was issued`);
  }
}

function validateReceiptDigest(receipt, label) {
  if (receipt.receiptDigestAlgorithm !== RECEIPT_DIGEST_ALGORITHM) {
    throw new Error(`${label} has unsupported receiptDigestAlgorithm`);
  }
  if (!SHA256_RE.test(String(receipt.receiptDigest || ""))) {
    throw new Error(`${label} has invalid receiptDigest`);
  }
  const observed = digestObject(receipt, ["receiptDigest"]);
  if (observed !== receipt.receiptDigest) throw new Error(`${label} receiptDigest mismatch`);
}

function validateGateReceipt({ receipt, expectedProjectId, expectedInputDigest, nowMs, maxAgeMs, label }) {
  if (receipt.schemaVersion !== "fbs.stage-gate-receipt/v1") {
    throw new Error(`${label} has unsupported schemaVersion`);
  }
  if (!receipt.receiptId || typeof receipt.receiptId !== "string") throw new Error(`${label} is missing receiptId`);
  if (!receipt.gateId || typeof receipt.gateId !== "string") throw new Error(`${label} is missing gateId`);
  if (receipt.status !== "passed") throw new Error(`${label} status must be passed`);
  if (receipt.currentReceipt !== true) throw new Error(`${label} must declare currentReceipt=true`);
  if (receipt.projectId !== expectedProjectId) throw new Error(`${label} projectId mismatch`);
  if (receipt.inputDigest !== expectedInputDigest) throw new Error(`${label} inputDigest mismatch`);
  validateFreshness(receipt, nowMs, maxAgeMs, label);
  validateReceiptDigest(receipt, label);
}

function validateOverrideReceipt({ receipt, missingGates, expectedProjectId, expectedInputDigest, nowMs, maxAgeMs, label }) {
  if (receipt.schemaVersion !== "fbs.stage-override-receipt/v1") {
    throw new Error(`${label} has unsupported schemaVersion`);
  }
  if (receipt.status !== "approved") throw new Error(`${label} status must be approved`);
  if (receipt.currentReceipt !== true) throw new Error(`${label} must declare currentReceipt=true`);
  if (receipt.projectId !== expectedProjectId) throw new Error(`${label} projectId mismatch`);
  if (receipt.inputDigest !== expectedInputDigest) throw new Error(`${label} inputDigest mismatch`);
  if (!Array.isArray(receipt.gateIds) || receipt.gateIds.length === 0) {
    throw new Error(`${label} must list gateIds`);
  }
  const authorized = new Set(receipt.gateIds.map(String));
  const uncovered = missingGates.filter((gateId) => !authorized.has(gateId));
  if (uncovered.length > 0) throw new Error(`${label} does not cover: ${uncovered.join(", ")}`);
  validateFreshness(receipt, nowMs, maxAgeMs, label);
  validateReceiptDigest(receipt, label);
}

function resolveStage(stageId) {
  return registry.stages?.[stageId] || registry.optionalStageOverlays?.[stageId] || null;
}

function transitionTargets(stage) {
  if (Array.isArray(stage.transitionTo)) return stage.transitionTo;
  if (typeof stage.transitionTo === "string") return [stage.transitionTo];
  return [];
}

function isNonOverridable(gateId) {
  const policy = registry.receiptPolicy || {};
  const exact = new Set(policy.nonOverridableGates || []);
  if (exact.has(gateId)) return true;
  return (policy.nonOverridableGatePatterns || []).some((pattern) => {
    try {
      return new RegExp(pattern, "i").test(gateId);
    } catch {
      return false;
    }
  });
}

function writeReceipt(filePath, payload, replace) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath) && !replace) throw new Error(`receipt-out already exists: ${filePath}`);
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    if (replace && fs.existsSync(filePath)) fs.rmSync(filePath);
    fs.renameSync(tempPath, filePath);
    const readback = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (readback.receiptDigest !== payload.receiptDigest) throw new Error("receipt-out readback mismatch");
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath);
  }
}

export function runStageTransition(options = {}) {
  const fromStage = String(options.from || "");
  const toStage = String(options.to || "");
  const projectId = String(options.projectId || "");
  const projectState = String(options.projectState || "active");
  const inputDigest = String(options.inputDigest || "").toLowerCase();
  const projectRoot = fs.realpathSync(path.resolve(options.projectRoot || process.cwd()));
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeSeconds = Number(options.maxAgeSeconds ?? registry.receiptPolicy?.maxAgeSeconds ?? 86400);

  if (!fromStage || !toStage) throw new Error("--from and --to are required");
  if (!projectId) throw new Error("--project-id is required");
  if (!SHA256_RE.test(inputDigest)) throw new Error("--input-digest must be a lowercase SHA-256 digest");
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) throw new Error("--max-age-seconds must be positive");

  const source = resolveStage(fromStage);
  const target = resolveStage(toStage);
  if (!source) throw new Error(`unknown source stage: ${fromStage}`);
  if (!target) throw new Error(`unknown target stage: ${toStage}`);
  const allowedTargets = transitionTargets(source);
  if (!allowedTargets.includes(toStage)) throw new Error(`illegal transition: ${fromStage} -> ${toStage}`);

  const requiredGates = [...new Set(source.requiredGates || [])];
  const validated = [];
  const byGateId = new Map();
  for (const candidate of [...new Set(options.gateReceiptPaths || [])]) {
    const loaded = readJsonReceipt(projectRoot, candidate, "gate receipt");
    validateGateReceipt({
      receipt: loaded.parsed,
      expectedProjectId: projectId,
      expectedInputDigest: inputDigest,
      nowMs,
      maxAgeMs: maxAgeSeconds * 1000,
      label: `gate receipt ${loaded.absolute}`,
    });
    if (byGateId.has(loaded.parsed.gateId)) throw new Error(`duplicate gate receipt: ${loaded.parsed.gateId}`);
    const item = {
      gateId: loaded.parsed.gateId,
      path: loaded.absolute,
      receiptDigest: loaded.parsed.receiptDigest,
      issuedAt: loaded.parsed.issuedAt,
      expiresAt: loaded.parsed.expiresAt ?? null,
    };
    byGateId.set(item.gateId, item);
    validated.push(item);
  }

  const missingGates = requiredGates.filter((gateId) => !byGateId.has(gateId));
  const protectedMissingGates = missingGates.filter(isNonOverridable);
  if (protectedMissingGates.length > 0) {
    const error = new Error("non-overridable safety, rights, or human gates are missing");
    error.details = { requiredGates, missingGates, protectedMissingGates };
    throw error;
  }

  let override = null;
  if (missingGates.length > 0) {
    if (!options.overrideReceiptPath) {
      const error = new Error(`missing current gate receipts for ${fromStage} -> ${toStage}`);
      error.details = { requiredGates, missingGates };
      throw error;
    }
    const loaded = readJsonReceipt(projectRoot, options.overrideReceiptPath, "override receipt");
    validateOverrideReceipt({
      receipt: loaded.parsed,
      missingGates,
      expectedProjectId: projectId,
      expectedInputDigest: inputDigest,
      nowMs,
      maxAgeMs: maxAgeSeconds * 1000,
      label: `override receipt ${loaded.absolute}`,
    });
    override = {
      path: loaded.absolute,
      gateIds: [...new Set(loaded.parsed.gateIds.map(String))],
      receiptDigest: loaded.parsed.receiptDigest,
      issuedAt: loaded.parsed.issuedAt,
      expiresAt: loaded.parsed.expiresAt ?? null,
    };
  } else if (options.overrideReceiptPath) {
    throw new Error("override receipt supplied but no gates are missing");
  }

  const generatedAt = new Date(nowMs).toISOString();
  const receipt = {
    schemaVersion: "fbs.stage-transition-receipt/v2",
    receiptId: crypto.randomUUID(),
    projectId,
    projectState,
    inputDigest,
    fromStage,
    toStage,
    requiredGates,
    gateReceipts: validated.map((item) => item.path),
    validatedGateReceipts: validated,
    override,
    status: missingGates.length > 0 ? "degraded" : "advanced",
    reason: missingGates.length > 0 ? "physical_override_receipt_validated" : null,
    currentReceipt: true,
    generatedAt,
    receiptDigestAlgorithm: RECEIPT_DIGEST_ALGORITHM,
    receiptDigest: null,
  };
  receipt.receiptDigest = digestObject(receipt, ["receiptDigest"]);
  return receipt;
}

function main() {
  const args = parseArgs(process.argv);
  try {
    const projectRoot = path.resolve(String(args["project-root"] || process.cwd()));
    if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
      fail(`project root does not exist: ${projectRoot}`);
    }
    const receipt = runStageTransition({
      from: args.from,
      to: args.to,
      projectId: args["project-id"],
      projectState: args["project-state"],
      inputDigest: args["input-digest"],
      projectRoot,
      gateReceiptPaths: args["gate-receipt"],
      overrideReceiptPath: args["override-receipt"] ? String(args["override-receipt"]) : null,
      maxAgeSeconds: args["max-age-seconds"],
    });
    if (args["receipt-out"]) {
      const receiptPath = assertBoundedPath(
        fs.realpathSync(projectRoot),
        path.resolve(projectRoot, String(args["receipt-out"])),
        "receipt-out",
        { mustExist: false },
      );
      writeReceipt(receiptPath, receipt, args.replace === true);
    }
    console.log(JSON.stringify(receipt, null, 2));
  } catch (error) {
    fail(error.message, 3, error.details || {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) main();
