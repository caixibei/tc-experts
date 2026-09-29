#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { routeDomainScene } from "../scene-runtime.mjs";

const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
export function runRegressionSmoke(skillRoot = defaultRoot) {
  let root;
  try {
    if (typeof skillRoot !== "string" || !skillRoot.trim() || /[\x00-\x1f]/.test(skillRoot)) throw new Error("invalid_skill_root");
    // Native Node paths only; reject shell-style or mixed-drive paths rather than resolving them against cwd.
    if (process.platform === "win32" && (/^\/[a-zA-Z](?:\/|:)/.test(skillRoot) || /^[a-zA-Z]:(?![\\/])/.test(skillRoot))) throw new Error("invalid_native_path");
    root = path.resolve(skillRoot);
    if (!fs.statSync(root).isDirectory()) throw new Error("skill_root_not_directory");
    const cases = [
      { id: "scope-listing-not-read", expected: "blocked_or_not_read", check: "local-workspace-contract.schema.json" },
      { id: "modality-no-receipt", expected: "not_observed", check: "modality-receipt.schema.json" },
      { id: "patch-scope-lock", expected: "conflict_or_blocked", check: "revision-patch.schema.json" },
      { id: "release-low-confidence", expected: "blocked", check: "publish-readiness-policy.json" },
      { id: "buddy-core-override", expected: "rejected", check: "buddy-package.schema.json" }
    ];
    const results = cases.map((item) => ({
      id: item.id,
      status: fs.existsSync(path.join(root, "schemas", item.check)) || fs.existsSync(path.join(root, "resources", item.check)) || fs.existsSync(path.join(root, "resources", "gates", item.check)) ? "fixture_ready" : "missing_fixture",
      expected: item.expected,
      currentReceipt: true
    }));
    const routeFixturePath = path.join(root, "resources", "route-paraphrase-fixtures.json");
    const routeFixture = JSON.parse(fs.readFileSync(routeFixturePath, "utf8"));
    if (!Array.isArray(routeFixture.cases) || !routeFixture.cases.length ||
        routeFixture.cases.some(item => !item || typeof item.id !== "string" || !item.id || typeof item.text !== "string" || !item.text || typeof item.expectedSceneId !== "string" || !item.expectedSceneId) ||
        new Set(routeFixture.cases.map(item => item.id)).size !== routeFixture.cases.length) throw new Error("invalid_route_fixture");
    const routeResults = routeFixture.cases.map((item) => {
      const routed = routeDomainScene({ text: item.text });
      return {
        id: item.id,
        class: item.class,
        expectedSceneId: item.expectedSceneId,
        actualSceneId: routed.sceneId ?? null,
        status: routed.ok && routed.sceneId === item.expectedSceneId ? "passed" : "failed",
      };
    });
    const report = {
      schemaVersion: "fbs.2694-regression-smoke/v2",
      ok: !results.some(item => item.status === "missing_fixture") && routeResults.every(item => item.status === "passed"),
      skillRoot: root,
      status: "public_runtime_smoke",
      total: results.length + routeResults.length,
      fixturePresenceCount: results.length,
      routeCaseCount: routeResults.length,
      routePassedCount: routeResults.filter((item) => item.status === "passed").length,
      results,
      routeResults,
      note: "Known public route regression plus five asset-presence checks; not blind evaluation, safety certification, or host acceptance. The source repository retains broader suites.",
    };
    return report;
  } catch (error) {
    const known = ["invalid_skill_root", "invalid_native_path", "skill_root_not_directory", "invalid_route_fixture"];
    const issue = known.includes(error.message) ? error.message : error.code === "ENOENT" ? "required_resource_missing" : error instanceof SyntaxError ? "invalid_resource_json" : "resource_read_failed";
    return { schemaVersion: "fbs.2694-regression-smoke/v2", ok: false, status: "smoke_input_error", skillRoot: root ?? null, issues: [issue], resource: error.path ?? null, hint: "Omit the root to use bundled resources, or pass one native skill-root path. Do not substitute the project cwd." };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const report = args.length === 1 && args[0] === "--help"
    ? { ok: true, usage: "node <script>/regression-smoke.mjs [skill-root]", defaultRoot: "relative_to_script_not_cwd", exitCodes: { success: 0, check_failed: 1, invalid_input: 2 } }
    : args.length > 1 || args[0]?.startsWith("-")
      ? { ok: false, status: "smoke_input_error", issues: ["invalid_arguments"] }
      : runRegressionSmoke(args[0]);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : report.status === "smoke_input_error" ? 2 : 1;
}
