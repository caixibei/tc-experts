#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const MAX_TEXT_BYTES = 8 * 1024 * 1024;

function parseArgs(argv) {
  const options = { bookRoot: null, chapterId: null, scanBookS3: false, enforce: false };
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--book-root') options.bookRoot = argv[++index] ?? null;
    else if (argument === '--chapter-id') options.chapterId = argv[++index] ?? null;
    else if (argument === '--scan-book-s3') options.scanBookS3 = true;
    else if (argument === '--enforce') options.enforce = true;
    else throw new Error(`unknown_argument:${argument}`);
  }
  return options;
}

function parseVariantMap(text) {
  const rules = [];
  for (const line of text.split(/\r?\n/u)) {
    const arrow = line.match(/([^\s|`“”"']+)\s*(?:->|→|=>|替换为)\s*([^\s|`“”"']+)/u);
    if (arrow) rules.push({ from: arrow[1].trim(), to: arrow[2].trim() });
  }
  return [...new Map(rules.map((rule) => [`${rule.from}=>${rule.to}`, rule])).values()];
}

function main() {
  let options;
  try { options = parseArgs(process.argv); }
  catch (error) { console.error(error.message); process.exit(2); }
  if (!options.bookRoot) {
    console.error('usage: audit-term-consistency.mjs --book-root <root> [--scan-book-s3] [--chapter-id <id>] [--enforce]');
    process.exit(2);
  }
  const root = path.resolve(options.bookRoot);
  const lockPath = path.join(root, '.fbs', '术语锁定记录.md');
  if (!fs.existsSync(lockPath)) {
    console.log(JSON.stringify({ status: 'not_applicable', reasonCode: 'term_lock_missing', violationCount: 0, contentExcerptCount: 0 }));
    process.exit(0);
  }
  const rules = parseVariantMap(fs.readFileSync(lockPath, 'utf8'));
  const files = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => options.scanBookS3 ? /^\[S3.*\.md$/iu.test(name) : options.chapterId ? name.endsWith('.md') && name.includes(options.chapterId) : name.endsWith('.md'))
    .map((name) => path.join(root, name));
  const violations = [];
  const skipped = [];
  files.forEach((filePath) => {
    const relativePath = path.relative(root, filePath).split(path.sep).join('/');
    if (fs.statSync(filePath).size > MAX_TEXT_BYTES) { skipped.push({ relativePath, reasonCode: 'text_byte_limit_exceeded' }); return; }
    const text = fs.readFileSync(filePath, 'utf8');
    rules.forEach((rule, ruleIndex) => { if (text.includes(rule.from)) violations.push({ relativePath, ruleIndex, reasonCode: 'forbidden_term_variant_present' }); });
  });
  console.log(JSON.stringify({ checkedFileCount: files.length, ruleCount: rules.length, violationCount: violations.length, skippedCount: skipped.length, violations: violations.slice(0, 30), skipped: skipped.slice(0, 30), termValueEmitted: false, contentExcerptCount: 0 }));
  process.exit(options.enforce && (violations.length > 0 || skipped.length > 0) ? 1 : 0);
}

main();
