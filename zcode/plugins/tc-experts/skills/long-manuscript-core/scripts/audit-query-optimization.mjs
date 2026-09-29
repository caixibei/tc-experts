#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const MAX_LEDGER_BYTES = 16 * 1024 * 1024;

function parseArgs(argv) {
  const options = { bookRoot: null, enforce: false, requireLedger: false };
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--skill-root') index += 1;
    else if (argument === '--book-root') options.bookRoot = argv[++index] ?? null;
    else if (argument === '--enforce') options.enforce = true;
    else if (argument === '--require-ledger') options.requireLedger = true;
    else throw new Error(`unknown_argument:${argument}`);
  }
  return options;
}

function main() {
  let options;
  try { options = parseArgs(process.argv); }
  catch (error) { console.error(error.message); process.exit(2); }
  if (!options.bookRoot) {
    console.error('usage: audit-query-optimization.mjs --book-root <root> [--enforce] [--require-ledger]');
    process.exit(2);
  }
  const root = path.resolve(options.bookRoot);
  const ledgerPath = path.join(root, '.fbs', 'search-ledger.jsonl');
  if (!fs.existsSync(ledgerPath)) {
    console.log(JSON.stringify({ status: 'not_applicable', reasonCode: 'search_ledger_missing', searchedRowCount: 0, missingOptimizationCount: 0, queryTextEmitted: false }));
    process.exit(options.requireLedger || options.enforce ? 1 : 0);
  }
  if (fs.statSync(ledgerPath).size > MAX_LEDGER_BYTES) {
    console.error(JSON.stringify({ status: 'blocked', reasonCode: 'search_ledger_byte_limit_exceeded', queryTextEmitted: false }));
    process.exit(1);
  }
  let searchedRowCount = 0;
  const missing = [];
  fs.readFileSync(ledgerPath, 'utf8').split(/\r?\n/u).filter(Boolean).forEach((line, index) => {
    try {
      const row = JSON.parse(line);
      if (row.kind !== 'search' || row.ok === false) return;
      searchedRowCount += 1;
      if (!row.queryOptimization || (typeof row.queryOptimization === 'string' && !row.queryOptimization.trim())) missing.push({ line: index + 1, stage: String(row.stage || row.workflowStage || 'unknown'), reasonCode: 'query_optimization_missing' });
    } catch { missing.push({ line: index + 1, stage: 'unknown', reasonCode: 'ledger_row_invalid_json' }); }
  });
  console.log(JSON.stringify({ status: missing.length ? 'degraded' : 'passed', searchedRowCount, missingOptimizationCount: missing.length, missing: missing.slice(0, 30), queryTextEmitted: false }));
  process.exit(options.enforce && missing.length > 0 ? 1 : 0);
}

main();
