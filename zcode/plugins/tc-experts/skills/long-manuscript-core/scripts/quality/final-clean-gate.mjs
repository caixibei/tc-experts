#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const input = process.argv[2];
if (!input) {
  console.error("Usage: final-clean-gate.mjs <manuscript-file>");
  process.exit(2);
}
const file = path.resolve(input);
const text = fs.readFileSync(file, "utf8");
const forbidden = ["待核实-MAT", "[DISCARDED-", "MAT-", "TODO", "内部标注"];
const hits = forbidden.filter((token) => text.includes(token));
const result = {
  status: hits.length ? "blocked" : "passed",
  file,
  forbiddenHits: hits,
  currentReceipt: true,
  checkedAt: new Date().toISOString()
};
console.log(JSON.stringify(result, null, 2));
process.exit(hits.length ? 1 : 0);
