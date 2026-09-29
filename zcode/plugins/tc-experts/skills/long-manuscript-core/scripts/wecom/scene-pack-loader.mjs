#!/usr/bin/env node
/**
 * Legacy compatibility import path for the package-local WorkBuddy scene catalog.
 *
 * This module performs no network call, entitlement lookup, host mutation, cache
 * write, or hidden audit write. The authoritative scene bytes and integrity
 * checks live in ../scene-runtime.mjs.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadScenePackResult, loadSceneRegistryResult } from "../scene-runtime.mjs";

const scriptPath = fileURLToPath(import.meta.url);

const LEGACY_ALIASES = new Map(Object.entries({
  general: "general",
  "通用": "general",
  whitepaper: "whitepaper-research",
  "白皮书": "whitepaper-research",
  report: "consulting-decision-report",
  "报告": "consulting-decision-report",
  "深度报道": "investigative-report-restricted",
  consultant: "consulting-decision-report",
  "顾问": "consulting-decision-report",
  training: "training-course",
  "培训": "training-course",
  genealogy: "genealogy",
  "家谱": "genealogy",
  ghostwriter: "expert-book",
  "代撰": "expert-book",
  "代写": "expert-book",
  "代笔": "expert-book",
  "personal-book": "expert-book",
  personal_book: "expert-book",
  personalbook: "expert-book",
  "个人书": "expert-book",
}));

export function normalizeScenePackGenreAlias(input) {
  const raw = String(input || "").normalize("NFKC").trim();
  if (!raw) return "general";
  return LEGACY_ALIASES.get(raw) || LEGACY_ALIASES.get(raw.toLowerCase()) || raw.toLowerCase();
}

function toLegacyData(pack, stage) {
  const stageLabel = stage || "ALL";
  return {
    quality: (pack.qualityGateRefs || []).map((gate) => ({
      rule_id: gate.registryId,
      level: gate.humanOwner ? "human" : "must",
      content: gate.reviewMandate || gate.seedGate || gate.registryId,
      stage: stageLabel,
      parameterProfile: gate.parameterProfile ?? null,
      humanOwner: gate.humanOwner ?? null,
      sceneId: pack.sceneId,
    })),
    outline: (pack.workflowStages || []).map((workflowStage, index) => ({
      seq: String(index + 1),
      title: workflowStage.id,
      operationModes: workflowStage.operationModes || [],
      exitGateRefs: workflowStage.exitGateRefs || [],
      sceneId: pack.sceneId,
    })),
    search: (pack.capabilityBindings || [])
      .filter((binding) => (binding.capabilityIds || []).includes("research-verification"))
      .map((binding, index) => ({
        strategy_id: `${pack.sceneId}-research-${index + 1}`,
        content: `Use ${binding.capabilityIds.join(", ")} for ${binding.operationMode}`,
        sceneId: pack.sceneId,
      })),
    init: (pack.requiredInputs || []).map((input) => ({
      question_id: input.id,
      text: input.id,
      required: input.required === true,
      sensitivity: input.sensitivity || "standard",
      sceneId: pack.sceneId,
    })),
    visual: (pack.artifactRefs || [])
      .filter((artifact) => /media|visual|image|album|manifest/i.test(`${artifact.archetypeId} ${artifact.artifactId}`))
      .map((artifact) => ({
        chart_type: artifact.archetypeId,
        trigger: artifact.artifactId,
        note: "package-local scene artifact",
        sceneId: pack.sceneId,
      })),
  };
}

function noPackResult(requestedGenre, failure) {
  return {
    data: { quality: [], outline: [], search: [], init: [], visual: [] },
    meta: {
      requestedGenre,
      genre: requestedGenre,
      sceneId: null,
      label: requestedGenre,
      version: null,
      cachedAt: null,
      source: "package_local_scene_catalog",
      host: "WorkBuddy",
      connectorAvailable: false,
      writePerformed: false,
      degraded: true,
      degradeReason: "no_pack",
      failure,
    },
  };
}

/**
 * Load a verified package-local scene pack. bookRoot is accepted for legacy API
 * compatibility but is intentionally never written.
 */
export async function loadScenePack(bookRoot, genre, stage = null) {
  void bookRoot;
  const requestedGenre = String(genre || "general");
  const sceneId = normalizeScenePackGenreAlias(requestedGenre);
  let loaded = loadScenePackResult(sceneId);
  let fallbackUsed = false;
  if (!loaded.ok && sceneId !== "general") {
    loaded = loadScenePackResult("general");
    fallbackUsed = loaded.ok;
  }
  if (!loaded.ok) return noPackResult(requestedGenre, loaded.failure || { code: loaded.status || "scene_load_failed" });
  const pack = loaded.pack;
  return {
    data: toLegacyData(pack, stage),
    meta: {
      requestedGenre,
      genre: pack.sceneId,
      sceneId: pack.sceneId,
      label: pack.displayName || pack.sceneId,
      version: pack.schemaVersion,
      cachedAt: null,
      source: "package_local_scene_catalog",
      sourceRef: loaded.entry?.packRef || `../scenes/${pack.sceneId}.json`,
      sourceDigest: loaded.integrity?.observedSha256 || null,
      host: "WorkBuddy",
      connectorAvailable: false,
      writePerformed: false,
      degraded: fallbackUsed,
      degradeReason: fallbackUsed ? "unknown_scene_fallback" : null,
      requestedStage: stage,
    },
  };
}

export function formatPackForContext(result) {
  if (!result?.data) return "";
  const sections = [
    ["Required inputs", result.data.init],
    ["Workflow outline", result.data.outline],
    ["Quality gates", result.data.quality],
    ["Research", result.data.search],
    ["Visual artifacts", result.data.visual],
  ];
  const lines = [`# Scene: ${result.meta?.label || result.meta?.sceneId || "unknown"}`];
  for (const [title, items] of sections) {
    if (!Array.isArray(items) || items.length === 0) continue;
    lines.push("", `## ${title}`);
    for (const item of items) lines.push(`- ${JSON.stringify(item)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** No host action is performed. Callers receive an explicit authorization plan. */
export function notifyBookEvent(bookRoot, event, options = {}) {
  return {
    status: "plan_only",
    host: "WorkBuddy",
    bookRoot: bookRoot ? path.resolve(bookRoot) : null,
    event: String(event || ""),
    options,
    externalActionCount: 0,
    writePerformed: false,
    reason: "host action requires a separately authorized WorkBuddy adapter",
  };
}

export async function pingScenePackTable() {
  const registry = loadSceneRegistryResult();
  return {
    ok: registry.ok,
    status: registry.ok ? "package_local_scene_catalog_ready" : registry.status,
    host: "WorkBuddy",
    connectorAvailable: false,
    externalActionCount: 0,
    entryCount: registry.ok ? registry.registry.entryCount : 0,
    failure: registry.failure || null,
  };
}

/** Read-only inventory; legacy --sync-all no longer mutates cache or host state. */
export async function syncAllPacks() {
  const registry = loadSceneRegistryResult();
  return {
    status: registry.ok ? "plan_ready" : "blocked",
    host: "WorkBuddy",
    mode: "read_only",
    writePerformed: false,
    externalActionCount: 0,
    sceneIds: registry.ok ? registry.registry.entries.map((entry) => entry.sceneId) : [],
    failure: registry.failure || null,
  };
}

export function loadLocalFallbackData(localRulesDir, genre) {
  void localRulesDir;
  const loaded = loadScenePackResult(normalizeScenePackGenreAlias(genre));
  if (!loaded.ok) return null;
  return {
    data: toLegacyData(loaded.pack, null),
    sourceFiles: [loaded.entry?.packRef || `../scenes/${loaded.pack.sceneId}.json`],
  };
}

async function main() {
  if (!process.argv.slice(2).includes("--sync-all")) {
    console.error("Usage: node scene-pack-loader.mjs --sync-all");
    process.exit(2);
  }
  const result = await syncAllPacks();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "blocked" ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "blocked", error: error.message }));
    process.exit(1);
  });
}
