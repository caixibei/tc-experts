import { createHash } from 'node:crypto';

// Package-local, deterministic OOXML creation; no host, network, or file writes.
// ZIP store framing follows the existing MIT-licensed binary-document-renderer.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const STYLES = new Set(['Normal', 'Title', 'Heading1', 'Heading2']);
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const requireValue = (condition, code) => { if (!condition) throw new Error(code); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

function checkText(text, code, allowBreaks = true) {
  requireValue(typeof text === 'string', code);
  // Reject XML 1.0-invalid controls, unpaired surrogates, and CR normalization.
  for (const char of text) {
    const cp = char.codePointAt(0);
    requireValue((cp === 9 || cp === 10 || cp >= 32) && cp !== 13
      && !(cp >= 0xd800 && cp <= 0xdfff) && cp !== 0xfffe && cp !== 0xffff, code);
    if (!allowBreaks) requireValue(cp !== 9 && cp !== 10, code);
  }
  return text;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) crc = CRC_TABLE[(crc ^ value) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zipStore(parts) {
  const locals = [], directory = [];
  let offset = 0;
  const names = Object.keys(parts).sort();
  for (const name of names) {
    const encoded = Buffer.from(name), bytes = Buffer.from(parts[name], 'utf8'), crc = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0x0021, 12); // fixed 1980-01-01; never a claimed creation timestamp
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(encoded.length, 26);
    locals.push(local, encoded, bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(encoded.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, encoded);
    offset += local.length + encoded.length + bytes.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

function textNodes(text) {
  return text.split(/(\n|\t)/u).map(piece => piece === '\n' ? '<w:br/>' : piece === '\t'
    ? '<w:tab/>' : '<w:t xml:space="preserve">' + escape(piece) + '</w:t>').join('');
}
function runXml(run) {
  let properties = '';
  for (const [key, tags] of [['bold', ['b', 'bCs']], ['italic', ['i', 'iCs']]]) {
    if (run[key] !== undefined) {
      requireValue(typeof run[key] === 'boolean', 'docx_run_emphasis_invalid');
      properties += tags.map(tag => '<w:' + tag + (run[key] ? '/>' : ' w:val="0"/>')).join('');
    }
  }
  return '<w:r>' + (properties ? '<w:rPr>' + properties + '</w:rPr>' : '') + textNodes(run.text) + '</w:r>';
}
function paragraphXml(paragraph) {
  return '<w:p><w:pPr><w:pStyle w:val="' + paragraph.style + '"/></w:pPr>'
    + paragraph.runs.map(runXml).join('') + '</w:p>';
}
function stylesXml() {
  const font = '<w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:cs="Arial"/>';
  const black = '<w:color w:val="000000"/>';
  const normal = '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>'
    + '<w:pPr><w:widowControl/><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr>'
    + '<w:rPr>' + font + black + '<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:style>';
  const headings = [['Title', 40, null], ['Heading1', 30, 0], ['Heading2', 26, 1]].map(([id, size, level]) =>
    '<w:style w:type="paragraph" w:styleId="' + id + '"><w:name w:val="' + (id.startsWith('Heading') ? 'heading ' + id.slice(-1) : id)
    + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
    + '<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="' + (id === 'Title' ? 0 : 240) + '" w:after="160"/>'
    + (level === null ? '<w:jc w:val="center"/>' : '<w:outlineLvl w:val="' + level + '"/>')
    + '</w:pPr><w:rPr>' + font + '<w:b/><w:bCs/>' + black + '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/></w:rPr></w:style>'
  ).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="' + W + '"><w:docDefaults><w:rPrDefault><w:rPr>'
    + font + black + '<w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>'
    + normal + headings + '</w:styles>';
}

/**
 * Render a bounded editable DOCX synchronously. This is structure generation,
 * not Word/host/render validation. Text is literal, never Markdown.
 * Optional paragraph.runs [{text,bold?,italic?}] must concatenate to paragraph.text.
 * A title paragraph is added only when an identical Title paragraph is absent.
 * Throws an Error with a docx_* code on invalid or over-budget input.
 */
export function renderDocx(input) {
  requireValue(object(input) && Object.keys(input).every(key => ['title', 'paragraphs'].includes(key)), 'docx_input_invalid');
  requireValue(typeof input.title === 'string' && input.title.length <= 1000, 'docx_title_invalid');
  const title = checkText(input.title, 'docx_title_invalid', false);
  requireValue(title.trim().length > 0 && title.length <= 1000, 'docx_title_invalid');
  requireValue(Array.isArray(input.paragraphs) && input.paragraphs.length <= 4096, 'docx_paragraphs_invalid');
  let totalBytes = Buffer.byteLength(title), runCount = 0;
  const paragraphs = input.paragraphs.map(p => {
    requireValue(object(p) && Object.keys(p).every(key => ['text', 'style', 'runs'].includes(key)), 'docx_paragraph_invalid');
    requireValue(typeof p.text === 'string' && p.text.length <= 1024 * 1024, 'docx_paragraph_over_budget');
    const text = checkText(p.text, 'docx_text_invalid');
    const style = p.style ?? 'Normal';
    requireValue(STYLES.has(style), 'docx_style_unsupported');
    requireValue(text.length <= 1024 * 1024, 'docx_paragraph_over_budget');
    totalBytes += Buffer.byteLength(text);
    requireValue(totalBytes <= MAX_TEXT_BYTES, 'docx_text_over_budget');
    const runs = p.runs === undefined ? [{ text }] : p.runs;
    requireValue(Array.isArray(runs) && runs.length > 0 && runs.length <= 4096, 'docx_runs_invalid');
    runCount += runs.length;
    requireValue(runCount <= 16384, 'docx_runs_over_budget');
    let runTextLength = 0;
    for (const run of runs) {
      requireValue(object(run) && Object.keys(run).every(key => ['text', 'bold', 'italic'].includes(key)), 'docx_run_invalid');
      requireValue(typeof run.text === 'string' && run.text.length <= text.length, 'docx_runs_text_mismatch');
      runTextLength += run.text.length;
      requireValue(runTextLength <= text.length, 'docx_runs_text_mismatch');
      checkText(run.text, 'docx_run_text_invalid');
      for (const key of ['bold', 'italic']) requireValue(run[key] === undefined || typeof run[key] === 'boolean', 'docx_run_emphasis_invalid');
    }
    requireValue(runs.map(run => run.text).join('') === text, 'docx_runs_text_mismatch');
    return { text, style, runs };
  });
  if (!paragraphs.some(p => p.style === 'Title' && p.text === title)) paragraphs.unshift({ text: title, style: 'Title', runs: [{ text: title }] });
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const parts = {
    '[Content_Types].xml': declaration + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    '_rels/.rels': declaration + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="officeDocument" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="coreProperties" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    'docProps/core.xml': declaration + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + escape(title) + '</dc:title><dc:language>zh-CN</dc:language></cp:coreProperties>',
    'word/_rels/document.xml.rels': declaration + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/styles.xml': stylesXml(),
    'word/document.xml': declaration + '<w:document xmlns:w="' + W + '"><w:body>' + paragraphs.map(paragraphXml).join('')
      + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>',
  };
  const bytes = zipStore(parts);
  requireValue(bytes.length <= 32 * 1024 * 1024, 'docx_output_over_budget');
  return { bytes, byteLength: bytes.length, sha256: digest(bytes), mimeType: MIME, format: 'docx' };
}
