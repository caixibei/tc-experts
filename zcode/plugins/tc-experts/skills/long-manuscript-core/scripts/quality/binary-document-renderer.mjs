import { sha256 } from '../lib/kernel-utils.mjs';
import { renderDocx as renderScopedDocx } from '../docx-runtime.mjs';

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const xmlEscape = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

function zipStore(entryMap) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const name of Object.keys(entryMap).sort()) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(entryMap[name]) ? entryMap[name] : Buffer.from(entryMap[name], 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(entryMap).length, 8);
  end.writeUInt16LE(Object.keys(entryMap).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function renderDocx({ title = 'Untitled', sections = [] } = {}) {
  return renderScopedDocx({title,paragraphs:sections.flatMap(section=>[
    {text:String(section.heading??'Section'),style:'Heading1'},
    {text:String(section.body??''),style:'Normal'}])});
}

const utf16Hex = (value) => {
  const littleEndian = Buffer.from(String(value), 'utf16le');
  const buffer = Buffer.alloc(littleEndian.length + 2);
  buffer.writeUInt16BE(0xfeff, 0);
  for (let offset = 0; offset < littleEndian.length; offset += 2) {
    buffer[offset + 2] = littleEndian[offset + 1];
    buffer[offset + 3] = littleEndian[offset];
  }
  return buffer.toString('hex').toUpperCase();
};

export function renderPdf({ title = 'Untitled', sections = [] } = {}) {
  const lines = [title, ...sections.flatMap((section) => [section.heading ?? 'Section', section.body ?? ''])].filter((line) => String(line).length > 0);
  if (lines.length > 28 || lines.some((line) => [...String(line)].length > 80)) throw new Error('pdf_single_page_layout_capacity_exceeded');
  const commands = ['BT', '/F1 16 Tf', '72 760 Td'];
  lines.forEach((line, index) => {
    if (index > 0) commands.push('0 -24 Td');
    commands.push(`<${utf16Hex(line)}> Tj`);
  });
  commands.push('ET');
  const stream = Buffer.from(`${commands.join('\n')}\n`, 'ascii');
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'ascii'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'ascii'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>', 'ascii'),
    Buffer.from('<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [5 0 R] >>', 'ascii'),
    Buffer.from('<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>', 'ascii'),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'ascii'), stream, Buffer.from('endstream', 'ascii')]),
  ];
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets = [0];
  let offset = parts[0].length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const wrapped = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'ascii'), object, Buffer.from('\nendobj\n', 'ascii')]);
    parts.push(wrapped);
    offset += wrapped.length;
  });
  const xrefOffset = offset;
  const xref = [`xref`, `0 ${objects.length + 1}`, '0000000000 65535 f '];
  for (let index = 1; index <= objects.length; index += 1) xref.push(`${String(offsets[index]).padStart(10, '0')} 00000 n `);
  xref.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>`, `startxref`, String(xrefOffset), '%%EOF', '');
  parts.push(Buffer.from(xref.join('\n'), 'ascii'));
  const bytes = Buffer.concat(parts);
  return { format: 'pdf', mimeType: 'application/pdf', bytes, byteLength: bytes.length, sha256: sha256(bytes) };
}

export function renderBinaryDocument(format, input) {
  if (format === 'docx') return renderDocx(input);
  if (format === 'pdf') return renderPdf(input);
  throw new Error(`unsupported_binary_format:${format}`);
}
