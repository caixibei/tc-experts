import crypto from 'node:crypto';
import { TextDecoder } from 'node:util';

export const PACKAGE_TEXT_DIGEST_ALGORITHM = 'sha256_utf8_lf_v1';

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export class PackageTextDigestError extends Error {
  constructor(code, { sourceRef = null, cause = null } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = 'PackageTextDigestError';
    this.code = code;
    this.sourceRef = sourceRef;
  }
}

function asBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  throw new PackageTextDigestError('package_text_bytes_required');
}

export function decodePackageTextUtf8(value, { sourceRef = null } = {}) {
  const bytes = asBytes(value);
  if (bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)) {
    throw new PackageTextDigestError('package_text_bom_forbidden', { sourceRef });
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.startsWith('\ufeff')) throw new PackageTextDigestError('package_text_bom_forbidden', { sourceRef });
    return text;
  } catch (error) {
    if (error instanceof PackageTextDigestError) throw error;
    throw new PackageTextDigestError('package_text_invalid_utf8', { sourceRef, cause: error });
  }
}

export function normalizePackageTextV1(value, options = {}) {
  return decodePackageTextUtf8(value, options).replace(/\r\n?/gu, '\n');
}

export function packageTextSha256(value, options = {}) {
  const normalized = normalizePackageTextV1(value, options);
  return crypto.createHash('sha256').update(Buffer.from(normalized, 'utf8')).digest('hex');
}

export function inspectPackageTextDigest(value, expectedSha256, { sourceRef = null } = {}) {
  const bytes = (() => {
    try { return asBytes(value); }
    catch (error) {
      return error;
    }
  })();
  if (bytes instanceof Error) {
    return {
      ok: false,
      algorithm: PACKAGE_TEXT_DIGEST_ALGORITHM,
      expectedSha256: HASH_PATTERN.test(String(expectedSha256 ?? '')) ? expectedSha256 : null,
      observedSha256: null,
      rawSha256: null,
      lineEndingOnlyDifference: false,
      issue: { code: bytes.code ?? 'package_text_bytes_required', sourceRef },
    };
  }
  const rawSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (!HASH_PATTERN.test(String(expectedSha256 ?? ''))) {
    return {
      ok: false,
      algorithm: PACKAGE_TEXT_DIGEST_ALGORITHM,
      expectedSha256: null,
      observedSha256: null,
      rawSha256,
      lineEndingOnlyDifference: false,
      issue: { code: 'package_text_expected_digest_invalid', sourceRef },
    };
  }
  try {
    const observedSha256 = packageTextSha256(bytes, { sourceRef });
    return {
      ok: observedSha256 === expectedSha256,
      algorithm: PACKAGE_TEXT_DIGEST_ALGORITHM,
      expectedSha256,
      observedSha256,
      rawSha256,
      lineEndingOnlyDifference: observedSha256 === expectedSha256 && rawSha256 !== expectedSha256,
      issue: observedSha256 === expectedSha256 ? null : { code: 'package_text_digest_mismatch', sourceRef },
    };
  } catch (error) {
    return {
      ok: false,
      algorithm: PACKAGE_TEXT_DIGEST_ALGORITHM,
      expectedSha256,
      observedSha256: null,
      rawSha256,
      lineEndingOnlyDifference: false,
      issue: { code: error.code ?? 'package_text_digest_failed', sourceRef },
    };
  }
}

export function parsePackageJson(value, { sourceRef = null } = {}) {
  let text;
  try {
    text = decodePackageTextUtf8(value, { sourceRef });
  } catch (error) {
    return { ok: false, value: null, issue: { code: error.code ?? 'package_text_invalid_utf8', sourceRef } };
  }
  try {
    return { ok: true, value: JSON.parse(text), issue: null };
  } catch {
    return { ok: false, value: null, issue: { code: 'package_json_invalid', sourceRef } };
  }
}
