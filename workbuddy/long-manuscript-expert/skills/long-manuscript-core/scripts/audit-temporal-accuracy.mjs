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

function targetFiles(bookRoot, options) {
  const root = path.resolve(bookRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => {
      if (options.scanBookS3) return /^\[S3.*\.md$/iu.test(name);
      if (options.chapterId) return name.endsWith('.md') && name.includes(options.chapterId);
      return name.endsWith('.md');
    })
    .map((name) => path.join(root, name));
}

function main() {
  let options;
  try { options = parseArgs(process.argv); }
  catch (error) { console.error(error.message); process.exit(2); }
  if (!options.bookRoot) {
    console.error('usage: audit-temporal-accuracy.mjs --book-root <root> [--scan-book-s3] [--chapter-id <id>] [--enforce]');
    process.exit(2);
  }

  const root = path.resolve(options.bookRoot);
  const files = targetFiles(root, options);
  const yearPattern = /\b(?:19|20)\d{2}\b/u;
  const sourcePattern = /(?:MAT-\d+|\[[0-9]+\]|https?:\/\/|来源|出处|\[\[时间:[^\]]+\]\])/u;
  const violations = [];
  const skipped = [];
  for (const filePath of files) {
    const stat = fs.statSync(filePath);
    const relativePath = path.relative(root, filePath).split(path.sep).join('/');
    if (stat.size > MAX_TEXT_BYTES) { skipped.push({ relativePath, reasonCode: 'text_byte_limit_exceeded' }); continue; }
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);
    lines.forEach((line, index) => {
      if (yearPattern.test(line) && !sourcePattern.test(line)) violations.push({ relativePath, line: index + 1, reasonCode: 'year_without_source_anchor' });
    });
  }
  console.log(JSON.stringify({ checkedFileCount: files.length, violationCount: violations.length, skippedCount: skipped.length, violations: violations.slice(0, 30), skipped: skipped.slice(0, 30), contentExcerptCount: 0 }));
  process.exit(options.enforce && (violations.length > 0 || skipped.length > 0) ? 1 : 0);
}

main();
