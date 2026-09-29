import crypto from 'node:crypto';
import fs from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import {
  PACKAGE_TEXT_DIGEST_ALGORITHM,
  decodePackageTextUtf8,
  inspectPackageTextDigest,
  packageTextSha256,
  parsePackageJson,
} from './lib/package-text-digest.mjs';

export const ARCHIVE_PHYSICAL_MANIFEST_SCHEMA = 'long_manuscript.archive_physical_manifest.v1';
export const INSTALLED_CONTENT_TREE_ALGORITHM = 'sha256_content_tree_v1';
export const PLUGIN_JSON_CANONICALIZATION_ALGORITHM = 'canonical_json_utf8_v1';
export const RAW_HASH_ALGORITHM = 'sha256_raw_bytes';
export const TARGET_VERSION = '26.9.10';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptRoot, '..');
const defaultPackageRoot = path.resolve(scriptRoot, '..', '..', '..');
const expectedArchiveRoot = 'long-manuscript-expert-26.9.10';
const manifestName = 'FILE-MANIFEST.sha256.json';
const pluginPath = '.codebuddy-plugin/plugin.json';
const ignoredHostMetadataPolicies = new Map([
  ['.downloaded_at', { minBytes: 0, maxBytes: 4096 }],
  ['.created-by-session', { minBytes: 1, maxBytes: 256 }],
]);
const HASH = /^[a-f0-9]{64}$/u;
const STREAM_CHUNK_BYTES = 64 * 1024;
const MAX_CONTROL_JSON_BYTES = 32 * 1024 * 1024;
const MAX_RUNTIME_SOURCE_BYTES = 8 * 1024 * 1024;
const binaryExtensions = new Set([
  '.7z', '.avif', '.doc', '.docx', '.gif', '.gz', '.ico', '.jpeg', '.jpg',
  '.mov', '.mp3', '.mp4', '.pdf', '.png', '.ppt', '.pptx', '.tar', '.tif',
  '.tiff', '.wav', '.webm', '.webp', '.woff', '.woff2', '.xls', '.xlsx', '.zip',
]);
const textExtensions = new Set(['.json', '.md', '.mjs', '.js', '.txt', '.yaml', '.yml', '.jsonl', '.out', '.py']);
const extensionlessTextNames = new Set(['LICENSE']);

const rawSha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const posix = (value) => value.split(path.sep).join('/');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function parsePluginJsonCanonical(bytes, sourceRef = pluginPath) {
  let text;
  try { text = decodePackageTextUtf8(bytes, { sourceRef }); }
  catch (error) { return { ok: false, value: null, canonical: null, sha256: null, issue: { code: error.code ?? 'package_text_invalid_utf8', sourceRef } }; }
  let cursor = 0;
  const skipWhitespace = () => { while (/[\u0009\u000a\u000d\u0020]/u.test(text[cursor] ?? '')) cursor += 1; };
  const fail = (code) => { const error = new Error(code); error.code = code; throw error; };
  const parseStringToken = () => {
    if (text[cursor] !== '"') fail('plugin_json_invalid');
    const start = cursor++;
    let escaped = false;
    while (cursor < text.length) {
      const character = text[cursor++];
      if (!escaped && character === '"') {
        const raw = text.slice(start, cursor);
        try { return { raw, value: JSON.parse(raw) }; }
        catch { fail('plugin_json_invalid'); }
      }
      if (!escaped && character === '\\') escaped = true;
      else escaped = false;
    }
    fail('plugin_json_invalid');
  };
  const parseValue = () => {
    skipWhitespace();
    if (text[cursor] === '{') {
      cursor += 1;
      skipWhitespace();
      const members = [];
      const keys = new Set();
      if (text[cursor] !== '}') {
        while (true) {
          skipWhitespace();
          const key = parseStringToken();
          if (keys.has(key.value)) fail('plugin_json_duplicate_key');
          keys.add(key.value);
          skipWhitespace();
          if (text[cursor++] !== ':') fail('plugin_json_invalid');
          const value = parseValue();
          members.push({ key, value });
          skipWhitespace();
          if (text[cursor] === '}') break;
          if (text[cursor++] !== ',') fail('plugin_json_invalid');
        }
      }
      cursor += 1;
      members.sort((left, right) => left.key.value < right.key.value ? -1 : left.key.value > right.key.value ? 1 : 0);
      return { value: Object.fromEntries(members.map((item) => [item.key.value, item.value.value])), canonical: `{${members.map((item) => `${item.key.raw}:${item.value.canonical}`).join(',')}}` };
    }
    if (text[cursor] === '[') {
      cursor += 1;
      skipWhitespace();
      const items = [];
      if (text[cursor] !== ']') {
        while (true) {
          items.push(parseValue());
          skipWhitespace();
          if (text[cursor] === ']') break;
          if (text[cursor++] !== ',') fail('plugin_json_invalid');
        }
      }
      cursor += 1;
      return { value: items.map((item) => item.value), canonical: `[${items.map((item) => item.canonical).join(',')}]` };
    }
    if (text[cursor] === '"') {
      const token = parseStringToken();
      return { value: token.value, canonical: token.raw };
    }
    const remainder = text.slice(cursor);
    const literal = /^(?:true|false|null)/u.exec(remainder)?.[0];
    if (literal) {
      cursor += literal.length;
      return { value: JSON.parse(literal), canonical: literal };
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(remainder)?.[0];
    if (number) {
      cursor += number.length;
      return { value: JSON.parse(number), canonical: number };
    }
    fail('plugin_json_invalid');
  };
  try {
    skipWhitespace();
    const parsed = parseValue();
    skipWhitespace();
    if (cursor !== text.length || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) fail('plugin_json_invalid');
    return { ok: true, value: parsed.value, canonical: parsed.canonical, sha256: rawSha256(Buffer.from(parsed.canonical, 'utf8')), issue: null };
  } catch (error) {
    return { ok: false, value: null, canonical: null, sha256: null, issue: { code: error.code ?? 'plugin_json_invalid', sourceRef } };
  }
}

function canonicalJsonDigest(bytes, sourceRef = pluginPath) {
  const parsed = parsePluginJsonCanonical(bytes, sourceRef);
  return parsed.ok
    ? { ok: true, sha256: parsed.sha256, value: parsed.value, issue: null }
    : { ok: false, sha256: null, value: null, issue: parsed.issue };
}

function isSafeRelativePath(relative) {
  return typeof relative === 'string'
    && relative.length > 0
    && !relative.includes('\\')
    && !relative.includes('\0')
    && !path.posix.isAbsolute(relative)
    && !/^[A-Za-z]:/u.test(relative)
    && relative.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function isPackageText(relative) {
  const extension = path.posix.extname(relative).toLowerCase();
  return textExtensions.has(extension) || (!extension && extensionlessTextNames.has(path.posix.basename(relative)));
}

function contentProjection(relative, bytes) {
  if (relative === pluginPath) {
    const canonical = canonicalJsonDigest(bytes, relative);
    return canonical.ok
      ? { ok: true, kind: 'canonical_json', algorithm: PLUGIN_JSON_CANONICALIZATION_ALGORITHM, sha256: canonical.sha256, issue: null }
      : { ok: false, kind: 'canonical_json', algorithm: PLUGIN_JSON_CANONICALIZATION_ALGORITHM, sha256: null, issue: canonical.issue };
  }
  if (isPackageText(relative)) {
    try {
      return { ok: true, kind: 'package_text', algorithm: PACKAGE_TEXT_DIGEST_ALGORITHM, sha256: packageTextSha256(bytes, { sourceRef: relative }), issue: null };
    } catch (error) {
      return { ok: false, kind: 'package_text', algorithm: PACKAGE_TEXT_DIGEST_ALGORITHM, sha256: null, issue: { code: error.code ?? 'package_text_digest_failed', sourceRef: relative } };
    }
  }
  if (binaryExtensions.has(path.posix.extname(relative).toLowerCase())) return { ok: true, kind: 'binary', algorithm: RAW_HASH_ALGORITHM, sha256: rawSha256(bytes), issue: null };
  return { ok: false, kind: 'unknown', algorithm: null, sha256: null, issue: { code: 'package_content_type_unclassified', sourceRef: relative } };
}

function walkPayload(root) {
  const rows = [];
  const issues = [];
  const hostMetadata = [];
  const visit = (directory, prefix = '') => {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch {
      issues.push({ code: 'package_directory_read_failed', surface: 'archive_manifest', relativePath: prefix || '.' });
      return;
    }
    entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (ignoredHostMetadataPolicies.has(entry.name)) {
        const absolute = path.join(directory, entry.name);
        if (prefix !== '' || !entry.isFile()) issues.push({ code: 'host_metadata_location_invalid', surface: 'archive_manifest', relativePath: relative });
        else {
          try {
            const bytes = fs.statSync(absolute).size;
            const policy = ignoredHostMetadataPolicies.get(entry.name);
            if (bytes < policy.minBytes || bytes > policy.maxBytes) issues.push({ code: 'host_metadata_size_invalid', surface: 'archive_manifest', relativePath: relative });
            else hostMetadata.push({ name: entry.name, bytes });
          }
          catch { issues.push({ code: 'host_metadata_stat_failed', surface: 'archive_manifest', relativePath: relative }); }
        }
        continue;
      }
      if (!isSafeRelativePath(relative)) {
        issues.push({ code: 'package_path_invalid', surface: 'archive_manifest' });
        continue;
      }
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        issues.push({ code: 'package_symbolic_link_forbidden', surface: 'archive_manifest', relativePath: relative });
      } else if (entry.isDirectory()) {
        visit(absolute, relative);
      } else if (entry.isFile() && relative !== manifestName) {
        rows.push({ absolute, path: relative });
      } else if (!entry.isFile()) {
        issues.push({ code: 'package_entry_type_forbidden', surface: 'archive_manifest', relativePath: relative });
      }
    }
  };
  visit(root);
  rows.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  return { rows, issues, hostMetadata };
}

const rawTreeSha256 = (entries) => rawSha256(Buffer.from(stableJson(entries.map((entry) => ({ path: entry.path, bytes: entry.bytes, sha256: entry.sha256 }))), 'utf8'));
const contentTreeSha256 = (entries) => rawSha256(Buffer.from(stableJson(entries.map((entry) => ({ path: entry.path, kind: entry.contentKind, algorithm: entry.contentAlgorithm, sha256: entry.contentSha256 }))), 'utf8'));

function manifestSealProjection(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    artifactType: manifest.artifactType,
    evidenceClass: manifest.evidenceClass,
    observationBoundary: manifest.observationBoundary,
    targetReleaseVersion: manifest.targetReleaseVersion,
    observedPackageVersion: manifest.observedPackageVersion,
    packageName: manifest.packageName,
    rawHashAlgorithm: manifest.rawHashAlgorithm,
    normalizedContentTreeAlgorithm: manifest.normalizedContentTreeAlgorithm,
    packageTextDigestAlgorithm: manifest.packageTextDigestAlgorithm,
    pluginJsonCanonicalizationAlgorithm: manifest.pluginJsonCanonicalizationAlgorithm,
    archiveZip: manifest.archiveZip,
    fileManifest: manifest.fileManifest,
    fileCount: manifest.fileCount,
    rawTreeSha256: manifest.rawTreeSha256,
    normalizedContentTreeSha256: manifest.normalizedContentTreeSha256,
    pluginJsonCanonicalSha256: manifest.pluginJsonCanonicalSha256,
    files: manifest.files,
  };
}

function readObservedPlugin(packageRoot) {
  const target = path.join(packageRoot, ...pluginPath.split('/'));
  if (!fs.existsSync(target)) return { ok: false, version: null, canonicalSha256: null, issue: { code: 'plugin_json_missing', surface: 'plugin_json', relativePath: pluginPath } };
  let bytes;
  try { bytes = readBoundedBytes(target, MAX_CONTROL_JSON_BYTES, 'plugin_json_too_large'); }
  catch (error) { return { ok: false, version: null, canonicalSha256: null, issue: { code: error.code ?? 'plugin_json_read_failed', surface: 'plugin_json', relativePath: pluginPath } }; }
  const parsed = parsePluginJsonCanonical(bytes, pluginPath);
  if (!parsed.ok) return { ok: false, version: null, canonicalSha256: null, issue: { code: parsed.issue.code, surface: 'plugin_json', relativePath: pluginPath } };
  const version = typeof parsed.value?.version === 'string' ? parsed.value.version : null;
  return version ? { ok: true, version, canonicalSha256: parsed.sha256, issue: null } : { ok: false, version: null, canonicalSha256: parsed.sha256, issue: { code: 'plugin_json_version_missing', surface: 'plugin_json', relativePath: pluginPath } };
}

function fileManifestPayloadBindingFailures(manifest, files, observedPackageVersion) {
  if (!manifest || !Array.isArray(manifest.files)) return ['package_manifest_files_missing'];
  const failures = [];
  const expected = files.map((entry) => ({ bytes: entry.bytes, path: entry.path, sha256: entry.sha256 }));
  if (stableJson(manifest.files) !== stableJson(expected)) failures.push('package_manifest_file_rows_mismatch');
  const legacyContract = manifest.hashScope === 'raw_package_entry_bytes'
    && manifest.coverage?.totalPackageFiles === files.length + 1
    && manifest.coverage?.unlistedPayloadFiles === 0;
  const manifestV6Contract = manifest.schemaVersion === 'long_manuscript.file_hash_manifest.v6'
    && manifest.hashScope === 'raw_public_entry_bytes_excluding_manifest_self_reference'
    && manifest.coverage?.selfEntry === manifestName
    && manifest.coverage?.selfEntryExcludedForSelfReference === true;
  if (!legacyContract && !manifestV6Contract) failures.push('package_manifest_scope_contract_mismatch');
  if (manifest.textNormalization !== 'none') failures.push('package_manifest_text_normalization_mismatch');
  if (manifest.packageName !== 'long-manuscript-expert') failures.push('package_manifest_name_mismatch');
  if (manifest.packageVersion !== observedPackageVersion) failures.push('package_manifest_version_mismatch');
  if (manifest.coverage?.hashedFileCount !== files.length) failures.push('package_manifest_file_count_mismatch');
  return failures;
}

function fileManifestMatchesPayload(manifest, files, observedPackageVersion) {
  return fileManifestPayloadBindingFailures(manifest, files, observedPackageVersion).length === 0;
}

export function createArchivePhysicalManifest(packageRoot = defaultPackageRoot, { archiveZip = null } = {}) {
  const resolvedRoot = path.resolve(packageRoot);
  const walked = walkPayload(resolvedRoot);
  const issues = [...walked.issues];
  const files = [];
  for (const row of walked.rows) {
    let inspected;
    try { inspected = inspectFileProjection(row.path, row.absolute); }
    catch {
      issues.push({ code: 'package_file_read_failed', surface: 'archive_manifest', relativePath: row.path });
      continue;
    }
    const content = inspected.content;
    if (!content.ok) issues.push({ code: content.issue?.code ?? 'package_content_digest_failed', surface: row.path === pluginPath ? 'plugin_json' : 'archive_manifest', relativePath: row.path });
    files.push({
      path: row.path,
      bytes: inspected.bytes,
      sha256: inspected.sha256,
      contentKind: content.kind,
      contentAlgorithm: content.algorithm,
      contentSha256: content.sha256,
    });
  }
  const plugin = files.find((entry) => entry.path === pluginPath);
  const observedPlugin = readObservedPlugin(resolvedRoot);
  if (!observedPlugin.ok) issues.push(observedPlugin.issue);
  if (observedPlugin.version !== TARGET_VERSION) issues.push({ code: 'package_version_not_target_release', surface: 'plugin_json', relativePath: pluginPath });
  const embedded = readEmbeddedManifest(resolvedRoot);
  issues.push(...embedded.issues);
  if (embedded.ok) {
    for (const code of fileManifestPayloadBindingFailures(embedded.manifest, files, observedPlugin.version)) issues.push({ code, surface: 'package_manifest', relativePath: manifestName });
  }
  const archiveZipValid = archiveZip
    && HASH.test(String(archiveZip.sha256 ?? ''))
    && Number.isInteger(archiveZip.bytes) && archiveZip.bytes > 0
    && archiveZip.root === expectedArchiveRoot
    && Number.isInteger(archiveZip.entryCount) && archiveZip.entryCount === files.length + 1;
  if (!archiveZipValid) issues.push({ code: 'archive_zip_identity_required', surface: 'archive_manifest' });
  const fileManifestBytes = embedded.bytes ?? null;
  const fileManifestContent = fileManifestBytes ? contentProjection(manifestName, fileManifestBytes) : null;
  if (fileManifestContent && !fileManifestContent.ok) issues.push({ code: fileManifestContent.issue?.code ?? 'package_manifest_content_digest_failed', surface: 'package_manifest', relativePath: manifestName });
  const manifest = {
    schemaVersion: ARCHIVE_PHYSICAL_MANIFEST_SCHEMA,
    artifactType: 'archivePhysicalManifest',
    evidenceClass: 'local_deterministic_candidate_archive_projection',
    observationBoundary: 'temporary_candidate_zip_and_strict_extract_only_no_host_no_service',
    ok: issues.length === 0 && Boolean(plugin?.contentSha256) && archiveZipValid,
    targetReleaseVersion: TARGET_VERSION,
    observedPackageVersion: observedPlugin.version,
    packageName: 'long-manuscript-expert',
    rawHashAlgorithm: RAW_HASH_ALGORITHM,
    normalizedContentTreeAlgorithm: INSTALLED_CONTENT_TREE_ALGORITHM,
    packageTextDigestAlgorithm: PACKAGE_TEXT_DIGEST_ALGORITHM,
    pluginJsonCanonicalizationAlgorithm: PLUGIN_JSON_CANONICALIZATION_ALGORITHM,
    archiveZip: archiveZipValid ? { sha256: archiveZip.sha256, bytes: archiveZip.bytes, root: archiveZip.root, entryCount: archiveZip.entryCount } : null,
    fileManifest: fileManifestBytes ? {
      path: manifestName,
      bytes: fileManifestBytes.length,
      sha256: rawSha256(fileManifestBytes),
      contentSha256: fileManifestContent?.sha256 ?? null,
      schemaVersion: embedded.manifest?.schemaVersion ?? null,
    } : null,
    fileCount: files.length,
    rawTreeSha256: rawTreeSha256(files),
    normalizedContentTreeSha256: contentTreeSha256(files),
    pluginJsonCanonicalSha256: plugin?.contentSha256 ?? null,
    files,
    issues,
    safety: {
      contentExcerptCount: 0,
      credentialReadCount: 0,
      serviceTrafficAccessCount: 0,
      writeCount: 0,
      officialPackageWriteCount: 0,
    },
  };
  manifest.receiptDigest = rawSha256(Buffer.from(stableJson(manifestSealProjection(manifest)), 'utf8'));
  return manifest;
}

function readEmbeddedManifest(packageRoot) {
  const target = path.join(packageRoot, manifestName);
  if (!fs.existsSync(target)) return { ok: false, present: false, manifestSha256: null, bytes: null, manifest: null, issues: [{ code: 'package_manifest_missing', surface: 'package_manifest', relativePath: manifestName }] };
  let bytes;
  try { bytes = readBoundedBytes(target, MAX_CONTROL_JSON_BYTES, 'package_manifest_too_large'); }
  catch (error) { return { ok: false, present: true, manifestSha256: null, bytes: null, manifest: null, issues: [{ code: error.code ?? 'package_manifest_read_failed', surface: 'package_manifest', relativePath: manifestName }] }; }
  const parsed = parsePackageJson(bytes, { sourceRef: manifestName });
  if (!parsed.ok) return { ok: false, present: true, manifestSha256: rawSha256(bytes), bytes, manifest: null, issues: [{ code: parsed.issue.code, surface: 'package_manifest', relativePath: manifestName }] };
  const files = Array.isArray(parsed.value?.files) ? parsed.value.files : [];
  const valid = files.length > 0 && new Set(files.map((entry) => entry.path)).size === files.length && files.every((entry) => isSafeRelativePath(entry.path) && Number.isInteger(entry.bytes) && entry.bytes >= 0 && HASH.test(String(entry.sha256 ?? '')));
  return valid
    ? { ok: true, present: true, manifestSha256: rawSha256(bytes), bytes, manifest: parsed.value, issues: [] }
    : { ok: false, present: true, manifestSha256: rawSha256(bytes), bytes, manifest: parsed.value, issues: [{ code: 'package_manifest_shape_invalid', surface: 'package_manifest', relativePath: manifestName }] };
}

function validateArchiveProjection(archive) {
  const issues = [];
  if (!archive || typeof archive !== 'object' || !Array.isArray(archive.files) || archive.files.length === 0) {
    return [{ code: 'archive_manifest_invalid', surface: 'archive_manifest' }];
  }
  const seen = new Set();
  for (const entry of archive.files) {
    if (!isSafeRelativePath(entry?.path) || seen.has(entry.path) || !Number.isInteger(entry?.bytes) || entry.bytes < 0 || !HASH.test(String(entry?.sha256 ?? ''))) {
      issues.push({ code: 'archive_manifest_entry_invalid', surface: 'archive_manifest', ...(isSafeRelativePath(entry?.path) ? { relativePath: entry.path } : {}) });
      continue;
    }
    seen.add(entry.path);
    const expectedKind = entry.path === pluginPath ? 'canonical_json' : isPackageText(entry.path) ? 'package_text' : binaryExtensions.has(path.posix.extname(entry.path).toLowerCase()) ? 'binary' : null;
    const expectedAlgorithm = expectedKind === 'canonical_json' ? PLUGIN_JSON_CANONICALIZATION_ALGORITHM : expectedKind === 'package_text' ? PACKAGE_TEXT_DIGEST_ALGORITHM : expectedKind === 'binary' ? RAW_HASH_ALGORITHM : null;
    if (!expectedKind || entry.contentKind !== expectedKind || entry.contentAlgorithm !== expectedAlgorithm || !HASH.test(String(entry.contentSha256 ?? ''))) issues.push({ code: 'archive_content_digest_invalid', surface: 'archive_manifest', relativePath: entry.path });
  }
  if (archive.schemaVersion !== ARCHIVE_PHYSICAL_MANIFEST_SCHEMA || archive.artifactType !== 'archivePhysicalManifest' || archive.targetReleaseVersion !== TARGET_VERSION || archive.packageName !== 'long-manuscript-expert' || archive.rawHashAlgorithm !== RAW_HASH_ALGORITHM || archive.normalizedContentTreeAlgorithm !== INSTALLED_CONTENT_TREE_ALGORITHM || archive.packageTextDigestAlgorithm !== PACKAGE_TEXT_DIGEST_ALGORITHM || archive.pluginJsonCanonicalizationAlgorithm !== PLUGIN_JSON_CANONICALIZATION_ALGORITHM) issues.push({ code: 'archive_manifest_contract_invalid', surface: 'archive_manifest' });
  if (archive.observedPackageVersion !== TARGET_VERSION) issues.push({ code: 'archive_package_version_mismatch', surface: 'archive_manifest' });
  if (!archive.archiveZip || !HASH.test(String(archive.archiveZip.sha256 ?? '')) || !Number.isInteger(archive.archiveZip.bytes) || archive.archiveZip.bytes <= 0 || archive.archiveZip.root !== expectedArchiveRoot || archive.archiveZip.entryCount !== archive.files.length + 1) issues.push({ code: 'archive_zip_identity_invalid', surface: 'archive_manifest' });
  if (!archive.fileManifest || archive.fileManifest.path !== manifestName || !Number.isInteger(archive.fileManifest.bytes) || archive.fileManifest.bytes < 1 || !HASH.test(String(archive.fileManifest.sha256 ?? '')) || !HASH.test(String(archive.fileManifest.contentSha256 ?? ''))) issues.push({ code: 'archive_file_manifest_identity_invalid', surface: 'archive_manifest', relativePath: manifestName });
  if (archive.fileCount !== archive.files.length || archive.rawTreeSha256 !== rawTreeSha256(archive.files) || archive.normalizedContentTreeSha256 !== contentTreeSha256(archive.files) || archive.pluginJsonCanonicalSha256 !== archive.files.find((entry) => entry.path === pluginPath)?.contentSha256) issues.push({ code: 'archive_tree_seal_invalid', surface: 'archive_manifest' });
  if (!HASH.test(String(archive.receiptDigest ?? '')) || archive.receiptDigest !== rawSha256(Buffer.from(stableJson(manifestSealProjection(archive)), 'utf8'))) issues.push({ code: 'archive_receipt_digest_invalid', surface: 'archive_manifest' });
  if (archive.ok !== true || Array.isArray(archive.issues) && archive.issues.length !== 0) issues.push({ code: 'archive_manifest_not_ready', surface: 'archive_manifest' });
  return issues;
}

function detectLineEndingProfile(textRows, pluginSemanticOnly) {
  let sawLf = false;
  let sawCrlf = false;
  let sawCr = false;
  for (const row of textRows) {
    sawLf ||= row.lineEndings?.sawLf === true;
    sawCrlf ||= row.lineEndings?.sawCrlf === true;
    sawCr ||= row.lineEndings?.sawCr === true;
  }
  if (sawCrlf && !sawLf && !sawCr) return pluginSemanticOnly ? 'CRLF_PLUGIN_CANONICAL_JSON' : 'CRLF';
  if (sawLf && !sawCrlf && !sawCr) return 'LF';
  return 'MIXED';
}

export function inspectInstalledRuntime(packageRoot = defaultPackageRoot, archivePhysicalManifest = null) {
  const resolvedRoot = path.resolve(packageRoot);
  const embedded = readEmbeddedManifest(resolvedRoot);
  const archive = archivePhysicalManifest;
  const issues = [
    ...(archive ? validateArchiveProjection(archive) : [{ code: 'external_archive_anchor_required', surface: 'archive_manifest' }]),
    ...embedded.issues,
  ];
  const walked = walkPayload(resolvedRoot);
  issues.push(...walked.issues.map((issue) => ({ ...issue, surface: 'installed_tree' })));
  const installedByPath = new Map();
  const textRows = [];
  for (const row of walked.rows) {
    let inspected;
    try { inspected = inspectFileProjection(row.path, row.absolute); }
    catch {
      issues.push({ code: 'installed_file_read_failed', surface: 'installed_tree', relativePath: row.path });
      continue;
    }
    const content = inspected.content;
    if (!content.ok) issues.push({ code: content.issue?.code ?? 'installed_content_digest_failed', surface: row.path === pluginPath ? 'plugin_json' : 'installed_tree', relativePath: row.path });
    const installed = {
      path: row.path,
      bytes: inspected.bytes,
      sha256: inspected.sha256,
      contentKind: content.kind,
      contentAlgorithm: content.algorithm,
      contentSha256: content.sha256,
      normalizedTextSha256: inspected.normalizedTextSha256,
      lineEndings: inspected.lineEndings,
    };
    installedByPath.set(row.path, installed);
    if (content.kind === 'package_text' || content.kind === 'canonical_json') textRows.push(installed);
  }

  let rawMatchedFileCount = 0;
  let rawMismatchedFileCount = 0;
  let lineEndingOnlyDifferenceCount = 0;
  let normalizedTextMatchedFileCount = 0;
  let pluginJsonSemanticMatchCount = 0;
  let missingFileCount = 0;
  let substantiveMismatchCount = 0;
  let pluginSemanticOnly = false;
  const archivePaths = new Set((archive?.files ?? []).map((entry) => entry.path));
  const installedEntries = [];
  for (const expected of archive?.files ?? []) {
    const observed = installedByPath.get(expected.path);
    if (!observed) {
      missingFileCount += 1;
      issues.push({ code: 'installed_file_missing', surface: 'installed_tree', relativePath: expected.path });
      continue;
    }
    const rawMatch = observed.bytes === expected.bytes && observed.sha256 === expected.sha256;
    if (rawMatch) rawMatchedFileCount += 1;
    else rawMismatchedFileCount += 1;

    let contentMatch = rawMatch;
    if (expected.path === pluginPath) {
      if (expected.contentSha256 && observed.contentSha256 === expected.contentSha256) contentMatch = true;
      if (contentMatch) pluginJsonSemanticMatchCount = 1;
      if (!rawMatch && contentMatch) {
        pluginSemanticOnly = observed.normalizedTextSha256 !== expected.sha256;
      }
    } else if (expected.contentKind === 'package_text') {
      if (expected.contentSha256 && observed.contentSha256 === expected.contentSha256) contentMatch = true;
      if (!expected.contentSha256 && observed.contentSha256 === expected.sha256) contentMatch = true;
      if (contentMatch) normalizedTextMatchedFileCount += 1;
      if (!rawMatch && contentMatch) lineEndingOnlyDifferenceCount += 1;
    } else if (expected.contentKind === 'binary') {
      contentMatch = rawMatch;
    }
    if (!contentMatch) {
      substantiveMismatchCount += 1;
      issues.push({ code: 'installed_content_mismatch', surface: expected.path === pluginPath ? 'plugin_json' : 'installed_tree', relativePath: expected.path });
    }
    installedEntries.push({
      path: observed.path,
      bytes: observed.bytes,
      sha256: observed.sha256,
      contentKind: observed.contentKind,
      contentAlgorithm: observed.contentAlgorithm,
      contentSha256: observed.contentSha256,
    });
  }
  const unexpectedPaths = [...installedByPath.keys()].filter((relative) => !archivePaths.has(relative)).sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  for (const relative of unexpectedPaths) issues.push({ code: 'installed_file_unexpected', surface: 'installed_tree', relativePath: relative });
  const unexpectedFileCount = unexpectedPaths.length;
  const sortedInstalledEntries = installedEntries.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  const installedRawTreeSha256 = rawTreeSha256(sortedInstalledEntries);
  const installedNormalizedContentTreeSha256 = contentTreeSha256(sortedInstalledEntries);
  const normalizedContentTreePass = Boolean(archive)
    && missingFileCount === 0
    && unexpectedFileCount === 0
    && substantiveMismatchCount === 0
    && archive.files.length === sortedInstalledEntries.length
    && (archive.normalizedContentTreeSha256 ? installedNormalizedContentTreeSha256 === archive.normalizedContentTreeSha256 : true);
  const pluginInstalled = installedByPath.get(pluginPath);
  const rawManifestMatch = Boolean(archive)
    && missingFileCount === 0
    && unexpectedFileCount === 0
    && rawMismatchedFileCount === 0
    && archive.files.length === sortedInstalledEntries.length
    && installedRawTreeSha256 === archive.rawTreeSha256;
  const observedPlugin = readObservedPlugin(resolvedRoot);
  if (!observedPlugin.ok) issues.push(observedPlugin.issue);
  if (observedPlugin.version !== TARGET_VERSION) issues.push({ code: 'package_version_not_target_release', surface: 'plugin_json', relativePath: pluginPath });
  let embeddedManifestRawMatch = false;
  let embeddedManifestNormalizedMatch = false;
  let embeddedManifestPayloadBindingPass = false;
  if (embedded.ok && archive?.fileManifest) {
    embeddedManifestRawMatch = embedded.bytes.length === archive.fileManifest.bytes && embedded.manifestSha256 === archive.fileManifest.sha256;
    try { embeddedManifestNormalizedMatch = packageTextSha256(embedded.bytes, { sourceRef: manifestName }) === archive.fileManifest.contentSha256; }
    catch { embeddedManifestNormalizedMatch = false; }
    embeddedManifestPayloadBindingPass = fileManifestMatchesPayload(embedded.manifest, archive.files, observedPlugin.version);
    if (!embeddedManifestNormalizedMatch) issues.push({ code: 'package_manifest_content_mismatch', surface: 'package_manifest', relativePath: manifestName });
    if (!embeddedManifestPayloadBindingPass) {
      for (const code of fileManifestPayloadBindingFailures(embedded.manifest, archive.files, observedPlugin.version)) issues.push({ code, surface: 'package_manifest', relativePath: manifestName });
    }
  }
  const comparison = {
    rawManifestMatch,
    normalizedContentTreePass,
    rawMatchedFileCount,
    rawMismatchedFileCount,
    lineEndingOnlyDifferenceCount,
    normalizedTextMatchedFileCount,
    pluginJsonSemanticMatchCount,
    missingFileCount,
    unexpectedFileCount,
    substantiveMismatchCount,
  };
  const uniqueIssues = [...new Map(issues.map((issue) => [stableJson(issue), issue])).values()];
  return {
    ok: Boolean(archive?.ok)
      && validateArchiveProjection(archive).length === 0
      && normalizedContentTreePass
      && embedded.ok
      && embeddedManifestNormalizedMatch
      && embeddedManifestPayloadBindingPass
      && observedPlugin.version === TARGET_VERSION
      && uniqueIssues.length === 0,
    archive,
    observedPackageVersion: observedPlugin.version,
    embeddedManifest: {
      present: embedded.present,
      parseOk: embedded.ok,
      manifestSha256: embedded.manifestSha256,
      schemaVersion: embedded.manifest?.schemaVersion ?? null,
      declaredFileCount: Array.isArray(embedded.manifest?.files) ? embedded.manifest.files.length : 0,
      rawMatch: embeddedManifestRawMatch,
      normalizedContentMatch: embeddedManifestNormalizedMatch,
      payloadBindingPass: embeddedManifestPayloadBindingPass,
    },
    hostMetadata: {
      count: walked.hostMetadata.length,
      totalBytes: walked.hostMetadata.reduce((sum, item) => sum + item.bytes, 0),
      contentReadCount: 0,
    },
    installedBinding: {
      physicalFileCount: installedByPath.size,
      rawTreeSha256: installedRawTreeSha256,
      normalizedContentTreeSha256: installedNormalizedContentTreeSha256,
      normalizedContentTreeAlgorithm: INSTALLED_CONTENT_TREE_ALGORITHM,
      packageTextDigestAlgorithm: PACKAGE_TEXT_DIGEST_ALGORITHM,
      textNormalization: 'CRLF_and_CR_to_LF_only',
      lineEndingProfile: detectLineEndingProfile(textRows, pluginSemanticOnly),
      pluginJsonCanonicalSha256: pluginInstalled?.contentSha256 ?? '0'.repeat(64),
      pluginJsonCanonicalization: {
        scope: pluginPath,
        algorithm: PLUGIN_JSON_CANONICALIZATION_ALGORITHM,
        objectKeyOrder: 'recursive_utf16_code_unit_ascending',
        arrayOrder: 'preserve',
        duplicateKeyPolicy: 'reject',
        bomPolicy: 'reject',
        invalidUtf8Policy: 'reject',
        unicodeNormalization: 'none',
        numberNormalization: 'none',
        stringNormalization: 'none',
      },
      strictUtf8: true,
      bomAllowed: false,
    },
    comparison,
    issues: uniqueIssues,
    safety: {
      contentExcerptCount: 0,
      credentialReadCount: 0,
      serviceTrafficAccessCount: 0,
      writeCount: 0,
      officialPackageWriteCount: 0,
    },
  };
}

function packageHealthFromInspection(inspection) {
  return {
    present: inspection.embeddedManifest.present,
    declaredFileCount: inspection.embeddedManifest.declaredFileCount,
    physicalFileCount: inspection.installedBinding.physicalFileCount,
    rawMatchedFileCount: inspection.comparison.rawMatchedFileCount,
    rawMismatchedFileCount: inspection.comparison.rawMismatchedFileCount,
    lineEndingOnlyDifferenceCount: inspection.comparison.lineEndingOnlyDifferenceCount,
    normalizedTextMatchedFileCount: inspection.comparison.normalizedTextMatchedFileCount,
    pluginJsonSemanticMatchCount: inspection.comparison.pluginJsonSemanticMatchCount,
    missingFileCount: inspection.comparison.missingFileCount,
    unexpectedFileCount: inspection.comparison.unexpectedFileCount,
    substantiveMismatchCount: inspection.comparison.substantiveMismatchCount,
  };
}

const runtimeIssue = (code, surface, id = null, relativePath = null) => ({
  code: String(code || 'runtime_health_failed').replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 120),
  surface,
  ...(id ? { id: String(id).replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 160) } : {}),
  ...(relativePath && isSafeRelativePath(relativePath) ? { relativePath } : {}),
});

const builtinModuleNames = new Set(builtinModules.map((name) => name.replace(/^node:/u, '')));

function discoverScriptFiles(packageRoot) {
  const scriptsRoot = path.join(path.resolve(packageRoot), 'skills', 'long-manuscript-core', 'scripts');
  const files = [];
  const issues = [];
  const stack = [scriptsRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch {
      issues.push({ code: 'core_runtime_directory_read_failed', surface: 'installed_tree', relativePath: posix(path.relative(packageRoot, current)) });
      continue;
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      const relativePath = posix(path.relative(packageRoot, target));
      if (entry.isSymbolicLink()) {
        issues.push({ code: 'core_runtime_symbolic_link_forbidden', surface: 'installed_tree', relativePath });
      } else if (entry.isDirectory()) {
        stack.push(target);
      } else if (entry.isFile() && /\.(?:mjs|js)$/iu.test(entry.name)) {
        files.push(target);
      }
    }
  }
  return { files: files.sort((left, right) => Buffer.from(left).compare(Buffer.from(right))), issues };
}

function readBoundedBytes(filePath, maximumBytes, errorCode = 'control_file_too_large') {
  const fd = fs.openSync(filePath, 'r');
  const chunks = [];
  const buffer = Buffer.allocUnsafe(Math.min(STREAM_CHUNK_BYTES, maximumBytes + 1));
  let total = 0;
  try {
    const stat = fs.fstatSync(fd);
    if (stat.size > maximumBytes) {
      const error = new Error(errorCode);
      error.code = errorCode;
      throw error;
    }
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maximumBytes) {
        const error = new Error(errorCode);
        error.code = errorCode;
        throw error;
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, total);
  } finally {
    fs.closeSync(fd);
  }
}

function updateLineEndings(state, bytes) {
  for (const byte of bytes) {
    if (state.pendingCr) {
      if (byte === 10) {
        state.sawCrlf = true;
        state.pendingCr = false;
        continue;
      }
      state.sawCr = true;
      state.pendingCr = false;
    }
    if (byte === 13) state.pendingCr = true;
    else if (byte === 10) state.sawLf = true;
  }
}

function finalizeLineEndings(state) {
  if (state.pendingCr) state.sawCr = true;
  return { sawLf: state.sawLf, sawCrlf: state.sawCrlf, sawCr: state.sawCr };
}

function streamRawFile(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(STREAM_CHUNK_BYTES);
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      bytes += bytesRead;
      hash.update(chunk);
    }
  } finally {
    fs.closeSync(fd);
  }
  return { bytes, sha256: hash.digest('hex') };
}

function streamPackageTextFile(filePath, sourceRef) {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(STREAM_CHUNK_BYTES);
  const rawHash = crypto.createHash('sha256');
  const contentHash = crypto.createHash('sha256');
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const lineEndings = { sawLf: false, sawCrlf: false, sawCr: false, pendingCr: false };
  let firstChunk = true;
  let pendingTextCr = false;
  let bytes = 0;
  const updateNormalized = (decoded) => {
    let text = decoded;
    if (pendingTextCr && text.length > 0) {
      if (text.startsWith('\n')) text = text.slice(1);
      contentHash.update(Buffer.from('\n', 'utf8'));
      pendingTextCr = false;
    }
    if (text.endsWith('\r')) {
      text = text.slice(0, -1);
      pendingTextCr = true;
    }
    if (text) contentHash.update(Buffer.from(text.replace(/\r\n?/gu, '\n'), 'utf8'));
  };
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      if (firstChunk) {
        firstChunk = false;
        if (chunk.length >= 3 && chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf) {
          const error = new Error('package_text_bom_forbidden');
          error.code = 'package_text_bom_forbidden';
          throw error;
        }
      }
      bytes += bytesRead;
      rawHash.update(chunk);
      updateLineEndings(lineEndings, chunk);
      updateNormalized(decoder.decode(chunk, { stream: true }));
    }
    updateNormalized(decoder.decode());
    if (pendingTextCr) contentHash.update(Buffer.from('\n', 'utf8'));
  } catch (error) {
    if (error instanceof TypeError) {
      const wrapped = new Error('package_text_invalid_utf8');
      wrapped.code = 'package_text_invalid_utf8';
      wrapped.sourceRef = sourceRef;
      throw wrapped;
    }
    throw error;
  } finally {
    fs.closeSync(fd);
  }
  return {
    bytes,
    sha256: rawHash.digest('hex'),
    contentSha256: contentHash.digest('hex'),
    lineEndings: finalizeLineEndings(lineEndings),
  };
}

function inspectFileProjection(relative, filePath) {
  if (relative === pluginPath) {
    const bytes = readBoundedBytes(filePath, MAX_CONTROL_JSON_BYTES, 'plugin_json_too_large');
    const content = contentProjection(relative, bytes);
    let normalizedTextSha256 = null;
    try { normalizedTextSha256 = packageTextSha256(bytes, { sourceRef: relative }); } catch { /* canonical parser reports the authoritative issue */ }
    const lineEndings = { sawLf: false, sawCrlf: false, sawCr: false, pendingCr: false };
    updateLineEndings(lineEndings, bytes);
    return {
      bytes: bytes.length,
      sha256: rawSha256(bytes),
      content,
      normalizedTextSha256,
      lineEndings: finalizeLineEndings(lineEndings),
    };
  }
  if (isPackageText(relative)) {
    try {
      const streamed = streamPackageTextFile(filePath, relative);
      return {
        bytes: streamed.bytes,
        sha256: streamed.sha256,
        content: { ok: true, kind: 'package_text', algorithm: PACKAGE_TEXT_DIGEST_ALGORITHM, sha256: streamed.contentSha256, issue: null },
        normalizedTextSha256: streamed.contentSha256,
        lineEndings: streamed.lineEndings,
      };
    } catch (error) {
      const raw = streamRawFile(filePath);
      return {
        bytes: raw.bytes,
        sha256: raw.sha256,
        content: { ok: false, kind: 'package_text', algorithm: PACKAGE_TEXT_DIGEST_ALGORITHM, sha256: null, issue: { code: error.code ?? 'package_text_digest_failed', sourceRef: relative } },
        normalizedTextSha256: null,
        lineEndings: null,
      };
    }
  }
  const raw = streamRawFile(filePath);
  if (binaryExtensions.has(path.posix.extname(relative).toLowerCase())) {
    return {
      bytes: raw.bytes,
      sha256: raw.sha256,
      content: { ok: true, kind: 'binary', algorithm: RAW_HASH_ALGORITHM, sha256: raw.sha256, issue: null },
      normalizedTextSha256: null,
      lineEndings: null,
    };
  }
  return {
    bytes: raw.bytes,
    sha256: raw.sha256,
    content: { ok: false, kind: 'unknown', algorithm: null, sha256: null, issue: { code: 'package_content_type_unclassified', sourceRef: relative } },
    normalizedTextSha256: null,
    lineEndings: null,
  };
}

function staticModuleSpecifiers(sourceText) {
  const specifiers = [];
  const pattern = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;
  for (const match of String(sourceText).matchAll(pattern)) specifiers.push(match[1] ?? match[2]);
  return [...new Set(specifiers.filter(Boolean))];
}

function resolveStaticImport(sourcePath, specifier, packageRoot) {
  if (specifier.startsWith('node:') || builtinModuleNames.has(specifier)) return { kind: 'builtin', target: null };
  try {
    const target = specifier.startsWith('.')
      ? path.resolve(path.dirname(sourcePath), specifier)
      : createRequire(pathToFileURL(sourcePath).href).resolve(specifier);
    const root = path.resolve(packageRoot);
    const relative = path.relative(root, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return { kind: 'outside', target };
    }
    return { kind: specifier.startsWith('.') ? 'relative' : 'package_local_bare', target };
  } catch {
    return { kind: specifier.startsWith('.') ? 'relative_missing' : 'bare_missing', target: null };
  }
}

export function discoverCoreRuntimeClosure(packageRoot = defaultPackageRoot) {
  const root = path.resolve(packageRoot);
  const discovered = discoverScriptFiles(root);
  const issues = [...discovered.issues];
  const queue = [...discovered.files];
  const visited = new Set();
  let importEdgeCount = 0;
  while (queue.length > 0) {
    const sourcePath = queue.shift();
    if (visited.has(sourcePath)) continue;
    visited.add(sourcePath);
    const sourceRelative = posix(path.relative(root, sourcePath));
    let source;
    try { source = decodePackageTextUtf8(readBoundedBytes(sourcePath, MAX_RUNTIME_SOURCE_BYTES, 'core_runtime_source_too_large'), { sourceRef: sourceRelative }); }
    catch (error) {
      issues.push({ code: error.code ?? 'core_runtime_file_read_failed', surface: 'installed_tree', relativePath: sourceRelative });
      continue;
    }
    for (const specifier of staticModuleSpecifiers(source)) {
      const resolved = resolveStaticImport(sourcePath, specifier, root);
      if (resolved.kind === 'builtin') continue;
      importEdgeCount += 1;
      if (resolved.kind === 'relative_missing') {
        issues.push({ code: 'core_runtime_relative_import_missing', surface: 'installed_tree', relativePath: sourceRelative });
        continue;
      }
      if (resolved.kind === 'bare_missing') {
        issues.push({ code: 'core_runtime_bare_import_undeclared', surface: 'installed_tree', relativePath: sourceRelative });
        continue;
      }
      if (resolved.kind === 'outside') {
        issues.push({ code: 'core_runtime_import_escapes_package', surface: 'installed_tree', relativePath: sourceRelative });
        continue;
      }
      if (!fs.existsSync(resolved.target) || fs.lstatSync(resolved.target).isSymbolicLink() || !fs.statSync(resolved.target).isFile()) {
        issues.push({ code: 'core_runtime_import_target_invalid', surface: 'installed_tree', relativePath: sourceRelative });
        continue;
      }
      if (/\.(?:mjs|js)$/iu.test(resolved.target) && !visited.has(resolved.target)) queue.push(resolved.target);
    }
  }
  const paths = [...visited]
    .map((target) => posix(path.relative(root, target)))
    .filter(isSafeRelativePath)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  const uniqueIssues = [...new Map(issues.map((issue) => [stableJson(issue), issue])).values()];
  return {
    ok: uniqueIssues.length === 0,
    discoveryMode: 'all_package_scripts_plus_static_import_closure',
    entrypointCount: discovered.files.length,
    importEdgeCount,
    paths,
    issues: uniqueIssues,
  };
}

export function verifyStaticCoreRuntime(packageRoot = defaultPackageRoot, archivePhysicalManifest = null) {
  const archiveIssues = archivePhysicalManifest ? validateArchiveProjection(archivePhysicalManifest) : [{ code: 'external_archive_anchor_required', surface: 'archive_manifest' }];
  const closure = discoverCoreRuntimeClosure(packageRoot);
  const issues = [...archiveIssues, ...closure.issues];
  const expectedByPath = new Map((archivePhysicalManifest?.files ?? []).map((entry) => [entry.path, entry]));
  let verifiedCount = 0;
  for (const relative of closure.paths) {
    const expected = expectedByPath.get(relative);
    const target = path.join(path.resolve(packageRoot), ...relative.split('/'));
    if (!fs.existsSync(target)) {
      issues.push({ code: 'core_runtime_file_missing', surface: 'installed_tree', relativePath: relative });
      continue;
    }
    if (archivePhysicalManifest && !expected) {
      issues.push({ code: 'core_runtime_file_not_declared', surface: 'archive_manifest', relativePath: relative });
      continue;
    }
    if (!expected) continue;
    let bytes;
    try { bytes = readBoundedBytes(target, MAX_RUNTIME_SOURCE_BYTES, 'core_runtime_source_too_large'); }
    catch (error) {
      issues.push({ code: error.code ?? 'core_runtime_file_read_failed', surface: 'installed_tree', relativePath: relative });
      continue;
    }
    const observed = contentProjection(relative, bytes);
    if (!observed.ok || observed.sha256 === null || observed.sha256 !== expected.contentSha256) {
      issues.push({ code: observed.issue?.code ?? 'core_runtime_content_mismatch', surface: 'installed_tree', relativePath: relative });
      continue;
    }
    verifiedCount += 1;
  }
  const uniqueIssues = [...new Map(issues.map((issue) => [stableJson(issue), issue])).values()];
  return {
    ok: uniqueIssues.length === 0 && verifiedCount === closure.paths.length,
    discoveryMode: closure.discoveryMode,
    entrypointCount: closure.entrypointCount,
    importEdgeCount: closure.importEdgeCount,
    expectedCount: closure.paths.length,
    verifiedCount,
    issues: uniqueIssues,
    executionAttempted: false,
  };
}

function registrySnapshot(relative) {
  const target = path.join(skillRoot, ...relative.split('/'));
  if (!fs.existsSync(target)) return { ok: false, value: null, count: 0 };
  try {
    const parsed = parsePackageJson(readBoundedBytes(target, MAX_CONTROL_JSON_BYTES, 'registry_file_too_large'), { sourceRef: relative });
    const entries = parsed.ok && Array.isArray(parsed.value?.entries) ? parsed.value.entries : [];
    return { ok: parsed.ok, value: parsed.value, count: entries.length };
  } catch { return { ok: false, value: null, count: 0 }; }
}

async function inspectDynamicEvaluators(registry, baseHealth) {
  if (!registry || !Array.isArray(registry.entries)) return { availableCount: 0, failures: [{ gateId: 'quality-registry', code: 'quality_evaluator_registry_unavailable' }] };
  const registryFailure = (baseHealth.failures ?? []).find((failure) => !failure.gateId);
  if (registryFailure) return { availableCount: 0, failures: [{ gateId: 'quality-registry', code: registryFailure.code ?? 'quality_evaluator_registry_unavailable' }] };
  const baseFailures = new Map((baseHealth.failures ?? []).filter((failure) => failure.gateId).map((failure) => [failure.gateId, failure.code]));
  const failures = [];
  let availableCount = 0;
  for (const entry of registry.entries) {
    const gateId = typeof entry?.gateId === 'string' ? entry.gateId : 'invalid-gate';
    if (baseFailures.has(gateId)) {
      failures.push({ gateId, code: baseFailures.get(gateId) });
      continue;
    }
    if (!/^\.\.\/scripts\/quality\/evaluators\/[a-z0-9]+(?:-[a-z0-9]+)*\.mjs$/u.test(String(entry?.evaluatorRef ?? ''))) {
      failures.push({ gateId, code: 'quality_evaluator_ref_invalid' });
      continue;
    }
    const target = path.resolve(path.join(skillRoot, 'resources'), ...entry.evaluatorRef.split('/'));
    const evaluatorRoot = `${path.join(skillRoot, 'scripts', 'quality', 'evaluators')}${path.sep}`;
    if (!target.startsWith(evaluatorRoot)) {
      failures.push({ gateId, code: 'quality_evaluator_ref_invalid' });
      continue;
    }
    try {
      const evaluator = await import(pathToFileURL(target).href);
      if (evaluator.gateId !== gateId || typeof evaluator.evaluate !== 'function' || typeof evaluator.validate !== 'function') {
        failures.push({ gateId, code: 'quality_evaluator_exports_invalid' });
        continue;
      }
      const result = await evaluator.evaluate({}, { connectorAvailable: false, externalWriteAuthorized: false });
      if (!result || typeof result !== 'object') {
        failures.push({ gateId, code: 'quality_evaluator_call_invalid' });
        continue;
      }
      availableCount += 1;
    } catch {
      failures.push({ gateId, code: 'quality_evaluator_dynamic_import_failed' });
    }
  }
  return { availableCount, failures };
}

function normalizedFingerprint(fingerprint) {
  const producerSha256 = streamRawFile(fileURLToPath(import.meta.url)).sha256;
  if (fingerprint && HASH.test(String(fingerprint.verifierSha256 ?? '')) && HASH.test(String(fingerprint.testSha256 ?? ''))) {
    return { ok: true, value: { verifierSha256: fingerprint.verifierSha256, testSha256: fingerprint.testSha256, producerSha256 } };
  }
  return { ok: false, value: { verifierSha256: producerSha256, testSha256: producerSha256, producerSha256 } };
}

function observationBoundary(mode) {
  return { mode, pathDisclosure: 'relative_paths_only', contentInspection: 'metadata_and_integrity_only', officialPackageMutable: false, externalInvocationPerformed: false };
}

function sealReport(report) {
  const projection = { ...report };
  delete projection.receiptDigest;
  return rawSha256(Buffer.from(stableJson(projection), 'utf8'));
}

export async function inspectRuntimeHealth({
  packageRoot = defaultPackageRoot,
  archivePhysicalManifest = null,
  evidenceClass = 'source_runtime_health',
  observationMode = 'source_tree_readonly',
  verificationFingerprint = null,
} = {}) {
  const resolvedRoot = path.resolve(packageRoot);
  const rootMatchesModule = resolvedRoot === defaultPackageRoot;
  const packageInspection = inspectInstalledRuntime(resolvedRoot, archivePhysicalManifest);
  const issues = [];
  if (!rootMatchesModule) issues.push(runtimeIssue('runtime_package_root_mismatch', 'runtime'));
  const fingerprint = normalizedFingerprint(verificationFingerprint);
  if (!fingerprint.ok) issues.push(runtimeIssue('verification_fingerprint_unbound', 'runtime'));
  if (!archivePhysicalManifest) issues.push(runtimeIssue('external_archive_anchor_required', 'package_manifest'));
  if (packageInspection.observedPackageVersion !== TARGET_VERSION) issues.push(runtimeIssue('package_version_not_target_release', 'version'));

  const sceneRegistrySnapshot = registrySnapshot('resources/scene-registry.json');
  const qualityRegistrySnapshot = registrySnapshot('resources/gates/evaluator-registry.json');
  const observedSceneCount = Math.min(21, sceneRegistrySnapshot.count);
  const observedEvaluatorCount = Math.min(32, qualityRegistrySnapshot.count);
  const sceneIds = (sceneRegistrySnapshot.value?.entries ?? []).map((entry) => entry.sceneId).filter((value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(String(value))).slice(0, 21);
  const corePreflight = verifyStaticCoreRuntime(resolvedRoot, archivePhysicalManifest);
  for (const issue of corePreflight.issues) issues.push(runtimeIssue(issue.code, issue.surface === 'archive_manifest' ? 'package_manifest' : 'runtime', null, issue.relativePath));

  let sceneModule = null;
  let qualityModule = null;
  if (rootMatchesModule && corePreflight.ok) {
    try {
      [sceneModule, qualityModule] = await Promise.all([
        import(pathToFileURL(path.join(skillRoot, 'scripts', 'scene-runtime.mjs')).href),
        import(pathToFileURL(path.join(skillRoot, 'scripts', 'quality', 'quality-gate-runtime.mjs')).href),
      ]);
    } catch { issues.push(runtimeIssue('core_runtime_dynamic_import_failed', 'runtime')); }
  }
  const registryResult = sceneModule ? sceneModule.loadSceneRegistryResult() : { ok: false, failure: { code: 'core_runtime_integrity_failed', sourceRef: 'scripts/scene-runtime.mjs' } };
  const sceneInspections = sceneModule && registryResult.ok ? sceneIds.map((sceneId) => sceneModule.loadScenePackResult(sceneId)) : [];
  const sceneFailures = sceneModule && registryResult.ok
    ? sceneInspections.filter((item) => !item.ok).map((item) => ({ sceneId: item.sceneId, code: item.failure?.code ?? 'scene_runtime_failed' }))
    : sceneIds.map((sceneId) => ({ sceneId, code: registryResult.failure?.code ?? 'scene_runtime_failed' }));
  if (!registryResult.ok) issues.push(runtimeIssue(registryResult.failure?.code, 'scene_registry', null, registryResult.failure?.sourceRef));
  for (const failure of sceneFailures) issues.push(runtimeIssue(failure.code, 'scene', failure.sceneId, `scenes/${failure.sceneId}.json`));

  let routeIndexIntegrityOk = false;
  if (registryResult.ok) {
    const routeRef = registryResult.registry.routeIndexRef;
    const routeTarget = path.join(skillRoot, 'resources', routeRef);
    if (routeRef === 'scene-route-index.json' && fs.existsSync(routeTarget)) {
      try {
        const routeBytes = readBoundedBytes(routeTarget, MAX_CONTROL_JSON_BYTES, 'scene_route_index_too_large');
        const integrity = inspectPackageTextDigest(routeBytes, registryResult.registry.routeIndexSha256, { sourceRef: `resources/${routeRef}` });
        const parsed = integrity.ok ? parsePackageJson(routeBytes, { sourceRef: `resources/${routeRef}` }) : { ok: false };
        const routeEntries = parsed.ok && Array.isArray(parsed.value?.entries) ? parsed.value.entries : [];
        routeIndexIntegrityOk = integrity.ok
          && parsed.ok
          && parsed.value?.packDigestAlgorithm === PACKAGE_TEXT_DIGEST_ALGORITHM
          && routeEntries.length === registryResult.registry.entries.length
          && routeEntries.every((entry) => registryResult.registry.entries.some((registered) => registered.sceneId === entry.sceneId && registered.packSha256 === entry.packSha256));
        if (!routeIndexIntegrityOk) issues.push(runtimeIssue(integrity.issue?.code ?? 'scene_route_index_integrity_failed', 'scene_registry', null, `resources/${routeRef}`));
      } catch {
        issues.push(runtimeIssue('scene_route_index_read_failed', 'scene_registry', null, `resources/${routeRef}`));
      }
    } else issues.push(runtimeIssue('scene_route_index_missing', 'scene_registry', null, 'resources/scene-route-index.json'));
  }

  let qualityHealth;
  try { qualityHealth = qualityModule ? qualityModule.inspectQualityRuntime() : { ok: false, machineGateCount: observedEvaluatorCount, availableEvaluatorCount: 0, unavailableEvaluatorCount: 32, failures: [{ code: 'core_runtime_integrity_failed' }] }; }
  catch { qualityHealth = { ok: false, machineGateCount: observedEvaluatorCount, availableEvaluatorCount: 0, unavailableEvaluatorCount: 32, failures: [{ code: 'quality_runtime_uncaught_error' }] }; }
  const dynamicEvaluators = qualityModule && corePreflight.ok
    ? await inspectDynamicEvaluators(qualityRegistrySnapshot.value, qualityHealth)
    : { availableCount: 0, failures: [{ gateId: 'quality-registry', code: 'core_runtime_integrity_failed' }] };
  const qualityFailures = dynamicEvaluators.failures.length
    ? dynamicEvaluators.failures
    : (qualityHealth.failures ?? []).map((failure) => ({ gateId: failure.gateId ?? 'quality-registry', code: failure.code ?? 'quality_runtime_failed' }));
  const seedRegistryIntegrityOk = qualityHealth.ok || !(qualityHealth.failures ?? []).some((failure) => String(failure.sourceRef ?? '').includes('scene-quality-gate-registry') || String(failure.code ?? '').includes('registry'));
  for (const failure of qualityFailures) issues.push(runtimeIssue(failure.code, failure.gateId === 'quality-registry' ? 'quality_registry' : 'evaluator', failure.gateId));
  for (const issue of packageInspection.issues) {
    const surface = issue.surface === 'plugin_json' ? 'plugin_json'
      : issue.surface === 'package_manifest' || issue.surface === 'archive_manifest' ? 'package_manifest'
        : issue.code === 'package_version_not_target_release' ? 'version'
          : 'installed_tree';
    issues.push(runtimeIssue(issue.code, surface, null, issue.relativePath));
  }

  const uniqueIssues = [...new Map(issues.map((issue) => [stableJson(issue), issue])).values()];
  const availableSceneCount = sceneInspections.filter((item) => item.ok).length;
  const availableEvaluatorCount = dynamicEvaluators.availableCount;
  const packageHealthy = packageInspection.comparison.normalizedContentTreePass
    && packageInspection.comparison.substantiveMismatchCount === 0
    && packageInspection.comparison.missingFileCount === 0
    && packageInspection.comparison.unexpectedFileCount === 0
    && packageInspection.comparison.pluginJsonSemanticMatchCount === 1;
  const healthy = rootMatchesModule
    && registryResult.ok
    && sceneIds.length === 21
    && availableSceneCount === 21
    && routeIndexIntegrityOk
    && qualityHealth.ok
    && availableEvaluatorCount === 32
    && packageHealthy
    && uniqueIssues.length === 0;
  const unavailable = availableSceneCount === 0 || availableEvaluatorCount === 0;
  const affectedSceneIds = sceneFailures.map((failure) => failure.sceneId).filter(Boolean).sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  const affectedGateIds = qualityFailures.filter((failure) => failure.gateId !== 'quality-registry').map((failure) => failure.gateId).sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  const report = {
    schemaVersion: '1.0.0',
    artifactType: 'long_manuscript_runtime_health',
    evidenceClass,
    ok: healthy,
    status: healthy ? 'healthy' : unavailable ? 'unavailable' : 'degraded',
    targetReleaseVersion: TARGET_VERSION,
    observedPackageVersion: packageInspection.observedPackageVersion ?? '0.0.0-invalid',
    packageTextDigestAlgorithm: PACKAGE_TEXT_DIGEST_ALGORITHM,
    observationBoundary: observationBoundary(observationMode),
    scenes: {
      expectedSceneCount: 21,
      observedRegisteredCount: observedSceneCount,
      observedAvailableCount: availableSceneCount,
      observedUnavailableCount: 21 - availableSceneCount,
      routeIndexIntegrityOk,
      failures: sceneFailures,
    },
    quality: {
      expectedEvaluatorCount: 32,
      observedRegisteredEvaluatorCount: observedEvaluatorCount,
      observedAvailableEvaluatorCount: availableEvaluatorCount,
      observedUnavailableEvaluatorCount: 32 - availableEvaluatorCount,
      seedRegistryIntegrityOk,
      failures: qualityFailures,
    },
    packageManifest: packageHealthFromInspection(packageInspection),
    runtimeClosure: {
      discoveryMode: corePreflight.discoveryMode,
      entrypointCount: corePreflight.entrypointCount,
      importEdgeCount: corePreflight.importEdgeCount,
      expectedCount: corePreflight.expectedCount,
      verifiedCount: corePreflight.verifiedCount,
    },
    degradation: {
      isolated: affectedSceneIds.length <= 1 && affectedGateIds.length <= 1,
      affectedSceneIds,
      affectedGateIds,
    },
    issues: uniqueIssues,
    safety: {
      contentExcerptCount: 0,
      credentialReadCount: 0,
      serviceTrafficAccessCount: 0,
      writeCount: 0,
      officialPackageWriteCount: 0,
    },
    verificationFingerprint: fingerprint.value,
    receiptDigestAlgorithm: 'sha256_canonical_json_without_receipt_digest_v1',
    receiptDigest: null,
    cannotProve: [
      'WorkBuddy host activation or frontstage invocation',
      'official listing review acceptance or publication',
      'service traffic business attribution or product credit',
    ],
  };
  report.receiptDigest = sealReport(report);
  return report;
}

export async function buildInstalledRuntimeReceipt({
  packageRoot = defaultPackageRoot,
  archivePhysicalManifest,
  observationMode = 'isolated_install_simulation_readonly',
  verificationFingerprint = null,
} = {}) {
  const inspection = inspectInstalledRuntime(packageRoot, archivePhysicalManifest);
  const runtimeHealth = await inspectRuntimeHealth({ packageRoot, archivePhysicalManifest, evidenceClass: observationMode === 'submission_zip_extract_readonly' ? 'submission_zip_runtime_health' : 'installed_runtime_health', observationMode, verificationFingerprint });
  const fingerprint = normalizedFingerprint(verificationFingerprint);
  const ready = Boolean(archivePhysicalManifest?.ok) && inspection.ok && runtimeHealth.ok && fingerprint.ok;
  const receiptIssues = ready ? [] : [
    ...inspection.issues.map((issue) => ({ code: issue.code, surface: issue.surface === 'plugin_json' ? 'plugin_json' : issue.surface === 'archive_manifest' ? 'archive_manifest' : 'installed_normalized_tree', ...(issue.relativePath ? { relativePath: issue.relativePath } : {}) })),
    ...runtimeHealth.issues.map((issue) => ({ code: issue.code, surface: issue.surface === 'version' ? 'version' : issue.surface === 'plugin_json' ? 'plugin_json' : 'runtime_health', ...(issue.id ? { id: issue.id } : {}), ...(issue.relativePath ? { relativePath: issue.relativePath } : {}) })),
  ];
  const uniqueReceiptIssues = [...new Map(receiptIssues.map((issue) => [stableJson(issue), issue])).values()];
  if (!ready && uniqueReceiptIssues.length === 0) uniqueReceiptIssues.push({ code: 'installed_runtime_receipt_not_ready', surface: 'runtime_health' });
  const receipt = {
    schemaVersion: '1.0.0',
    artifactType: 'long_manuscript_installed_runtime_receipt',
    evidenceClass: 'installed_runtime_integrity_receipt',
    ok: ready,
    status: ready ? 'ready' : 'rejected',
    targetReleaseVersion: TARGET_VERSION,
    observedPackageVersion: inspection.observedPackageVersion ?? '0.0.0-invalid',
    observationBoundary: observationBoundary(observationMode),
    archiveBinding: {
      zipSha256: archivePhysicalManifest?.archiveZip?.sha256 ?? '0'.repeat(64),
      zipBytes: archivePhysicalManifest?.archiveZip?.bytes ?? 1,
      root: archivePhysicalManifest?.archiveZip?.root ?? 'long-manuscript-expert',
      entryCount: archivePhysicalManifest?.archiveZip?.entryCount ?? 1,
      manifestSha256: archivePhysicalManifest?.fileManifest?.sha256 ?? '0'.repeat(64),
      manifestSchemaVersion: archivePhysicalManifest?.fileManifest?.schemaVersion ?? 'unknown',
      declaredFileCount: archivePhysicalManifest?.fileCount ?? 1,
      rawTreeSha256: archivePhysicalManifest?.rawTreeSha256 ?? '0'.repeat(64),
      rawHashAlgorithm: RAW_HASH_ALGORITHM,
    },
    installedBinding: inspection.installedBinding,
    comparison: inspection.comparison,
    runtimeHealth: {
      status: runtimeHealth.status,
      sceneAvailableCount: runtimeHealth.scenes.observedAvailableCount,
      evaluatorAvailableCount: runtimeHealth.quality.observedAvailableEvaluatorCount,
    },
    issues: uniqueReceiptIssues,
    safety: inspection.safety,
    verificationFingerprint: fingerprint.value,
    receiptDigestAlgorithm: 'sha256_canonical_json_without_receipt_digest_v1',
    receiptDigest: null,
    cannotProve: [
      'WorkBuddy host activation or frontstage invocation',
      'official listing review acceptance or publication',
      'service traffic business attribution or product credit',
    ],
  };
  receipt.receiptDigest = sealReport(receipt);
  return receipt;
}

function parseCli(argv) {
  const options = {
    packageRoot: defaultPackageRoot,
    archiveManifestPath: null,
    selfFingerprint: false,
    emitArchivePhysicalManifest: false,
    archiveZip: { sha256: null, bytes: null, root: null, entryCount: null },
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--package-root') options.packageRoot = path.resolve(argv[++index] ?? '');
    else if (argument === '--archive-physical-manifest') options.archiveManifestPath = path.resolve(argv[++index] ?? '');
    else if (argument === '--self-fingerprint') options.selfFingerprint = true;
    else if (argument === '--emit-archive-physical-manifest') options.emitArchivePhysicalManifest = true;
    else if (argument === '--archive-zip-sha256') options.archiveZip.sha256 = argv[++index] ?? null;
    else if (argument === '--archive-zip-bytes') options.archiveZip.bytes = Number(argv[++index]);
    else if (argument === '--archive-zip-root') options.archiveZip.root = argv[++index] ?? null;
    else if (argument === '--archive-zip-entry-count') options.archiveZip.entryCount = Number(argv[++index]);
    else throw new Error(`unknown_argument:${argument}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseCli(process.argv.slice(2));
  if (options.emitArchivePhysicalManifest) {
    if (options.archiveManifestPath || options.selfFingerprint) throw new Error('emit_archive_manifest_mode_conflict');
    const manifest = createArchivePhysicalManifest(options.packageRoot, { archiveZip: options.archiveZip });
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    if (!manifest.ok) process.exitCode = 1;
  } else {
    const archivePhysicalManifest = options.archiveManifestPath
      ? (() => {
        const parsed = parsePackageJson(
          readBoundedBytes(options.archiveManifestPath, MAX_CONTROL_JSON_BYTES, 'archive_manifest_too_large'),
          { sourceRef: 'archive-physical-manifest' },
        );
        if (!parsed.ok) throw new Error(parsed.issue.code);
        return parsed.value;
      })()
      : null;
    const verificationFingerprint = options.selfFingerprint ? {
      verifierSha256: streamRawFile(fileURLToPath(import.meta.url)).sha256,
      testSha256: streamRawFile(path.join(skillRoot, 'scripts', 'quality', 'regression-smoke.mjs')).sha256,
    } : null;
    const report = await inspectRuntimeHealth({ packageRoot: options.packageRoot, archivePhysicalManifest, verificationFingerprint });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  }
}
