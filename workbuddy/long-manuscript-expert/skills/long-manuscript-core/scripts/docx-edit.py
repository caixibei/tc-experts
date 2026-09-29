"""Bounded DOCX inspection/editing using Python's standard library.

CLI: send one UTF-8 JSON object on stdin; stdout is one JSON result.
inspect: {operation, root:absolute, source:relative.docx, expectedSourceSha256?}
edit: {operation, root, source, output:new-relative.docx, expectedSourceSha256,
       edits:[{textAnchor, replacement, paragraphAnchor?:exact-paragraph-text}]}
No extraction, network, runtime installation, original overwrite, or rendering.
Only direct body paragraphs with a supported shape are editable. Offsets are
derived from parsed XML; only affected w:t payload bytes are replaced.
"""
from __future__ import annotations

import copy
import hashlib
import io
import json
import os
from pathlib import Path
import posixpath
import re
import stat
import struct
import sys
import tempfile
import urllib.parse
import xml.etree.ElementTree as ET
import xml.parsers.expat as expat
import zipfile
import zlib

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
M = "http://schemas.openxmlformats.org/officeDocument/2006/math"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
DOC_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
REL_TYPE = "application/vnd.openxmlformats-package.relationships+xml"
WORD_TYPES = {name: "application/vnd.openxmlformats-officedocument.wordprocessingml." + name + "+xml"
              for name in ("styles", "settings", "webSettings", "numbering", "fontTable",
                           "footnotes", "endnotes", "comments", "header", "footer")}
CORE_TYPE = "application/vnd.openxmlformats-package.core-properties+xml"
EXTENDED_TYPE = "application/vnd.openxmlformats-officedocument.extended-properties+xml"
CUSTOM_TYPE = "application/vnd.openxmlformats-officedocument.custom-properties+xml"
THEME_TYPE = "application/vnd.openxmlformats-officedocument.theme+xml"
CUSTOM_XML_TYPE = "application/vnd.openxmlformats-officedocument.customXmlProperties+xml"
STYLES_EFFECTS_TYPE = "application/vnd.ms-word.stylesWithEffects+xml"
IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/bmp", "image/tiff",
               "image/x-emf", "image/x-wmf", "image/emf", "image/wmf"}
PASSIVE_TYPES = {DOC_TYPE, REL_TYPE, CORE_TYPE, EXTENDED_TYPE, CUSTOM_TYPE, THEME_TYPE,
                 CUSTOM_XML_TYPE, STYLES_EFFECTS_TYPE, "application/xml", "text/xml"} | set(WORD_TYPES.values()) | IMAGE_TYPES
PASSIVE_RELATIONSHIPS = {OFFICE_REL + name: {ctype} for name, ctype in WORD_TYPES.items()}
PASSIVE_RELATIONSHIPS.update({
    OFFICE_REL + "officeDocument": {DOC_TYPE},
    OFFICE_REL + "image": IMAGE_TYPES,
    OFFICE_REL + "theme": {THEME_TYPE},
    OFFICE_REL + "extended-properties": {EXTENDED_TYPE},
    OFFICE_REL + "custom-properties": {CUSTOM_TYPE},
    OFFICE_REL + "customXml": {"application/xml", "text/xml"},
    OFFICE_REL + "customXmlProps": {CUSTOM_XML_TYPE},
    "http://schemas.microsoft.com/office/2007/relationships/stylesWithEffects": {STYLES_EFFECTS_TYPE},
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail": IMAGE_TYPES,
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties": {CORE_TYPE},
})
MAX_ARCHIVE = 32 * 1024 * 1024
MAX_EXPANDED = 64 * 1024 * 1024
MAX_XML = 16 * 1024 * 1024
MAX_ENTRIES = 3000
HASH = re.compile(r"^[a-fA-F0-9]{64}$")
RUN_PROPS = {"rStyle", "rFonts", "b", "bCs", "i", "iCs", "color", "sz",
             "szCs", "lang", "highlight", "u", "vertAlign", "noProof",
             "rtl", "cs", "kern", "spacing", "position", "snapToGrid"}
PARA_PROPS = {"pStyle", "keepNext", "keepLines", "widowControl", "spacing",
              "ind", "jc", "textAlignment", "outlineLvl", "contextualSpacing",
              "bidi", "suppressAutoHyphens", "snapToGrid", "rPr"} | RUN_PROPS


class DocxError(Exception):
    def __init__(self, code, details=None):
        super().__init__(code)
        self.code = code
        self.details = details or {}


def need(condition, code):
    if not condition:
        raise DocxError(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def tag(local):
    return "{" + W + "}" + local


def xml_text(value, allow_breaks=False):
    need(isinstance(value, str), "docx_edit_text_invalid")
    for char in value:
        cp = ord(char)
        need((cp >= 32 or (allow_breaks and cp in (9, 10)))
             and not 0xD800 <= cp <= 0xDFFF and cp not in (0xFFFE, 0xFFFF),
             "docx_edit_text_invalid")
    need(len(value) <= 262144, "docx_edit_text_over_budget")
    return value


def linked(st):
    return stat.S_ISLNK(st.st_mode) or bool(getattr(st, "st_file_attributes", 0) & 0x400)


def identity(st):
    # On this bundled Windows Python, lstat and fstat expose different ctime
    # meanings for the same file. Use shared identity/mtime fields plus actual
    # byte hashes; never weaken the expected-source-digest comparison.
    return (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns)


def same_file_identity(a, b):
    return (a.st_dev, a.st_ino) == (b.st_dev, b.st_ino)


def check_chain(path, final_missing=False):
    current = Path(path.anchor)
    for index, part in enumerate(path.parts[1:]):
        current /= part
        final = index == len(path.parts) - 2
        try:
            info = current.lstat()
        except FileNotFoundError:
            need(final and final_missing, "docx_path_missing")
            return
        need(not linked(info), "docx_path_link_rejected")
        need(stat.S_ISDIR(info.st_mode) if not final else
             stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode), "docx_path_type_invalid")


def root_path(value):
    need(isinstance(value, str) and value and "\x00" not in value, "docx_root_invalid")
    path = Path(value)
    need(path.is_absolute() and ".." not in path.parts, "docx_root_invalid")
    need(not str(path).startswith(("\\\\", "//")), "docx_network_root_unsupported")
    check_chain(path)
    need(path.is_dir(), "docx_root_invalid")
    return path


def child_path(root, relative, output=False):
    need(isinstance(relative, str) and 0 < len(relative) <= 4096
         and not relative.startswith("/") and "\\" not in relative and ":" not in relative
         and "%" not in relative and not any(ord(c) < 32 for c in relative), "docx_path_invalid")
    pieces = relative.split("/")
    for part in pieces:
        need(part not in ("", ".", "..") and not part.endswith((" ", ".")), "docx_path_invalid")
        need(not re.fullmatch(r"(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])",
                              part.split(".")[0]), "docx_path_invalid")
    need(relative.lower().endswith(".docx"), "docx_extension_unsupported")
    result = root.joinpath(*pieces)
    check_chain(result, final_missing=output)
    if not output:
        info = result.lstat()
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "docx_source_not_regular")
    return result


def read_stable(root, relative, expected=None):
    path = child_path(root, relative)
    before = path.lstat()
    need(before.st_size <= MAX_ARCHIVE, "docx_archive_over_budget")
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    with os.fdopen(fd, "rb") as handle:
        opened = os.fstat(handle.fileno())
        need(identity(before) == identity(opened) and not linked(opened),
             "docx_source_changed")
        data = handle.read(MAX_ARCHIVE + 1)
        after = os.fstat(handle.fileno())
    named = path.lstat()
    need(identity(before) == identity(after) == identity(named) and
         len(data) == before.st_size and not linked(named), "docx_source_changed")
    if expected is not None:
        need(sha(data) == expected, "docx_source_digest_mismatch")
    return data, before


def safe_xml(data):
    need(len(data) <= MAX_XML, "docx_xml_over_budget")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeError as exc:
        raise DocxError("docx_xml_encoding_unsupported") from exc
    declared = re.match(r'\s*<\?xml\b[^?]*\bencoding\s*=\s*["\']([^"\']+)', text, re.I)
    need(not declared or declared.group(1).lower().replace("_", "-") in ("utf-8", "us-ascii"),
         "docx_xml_encoding_unsupported")
    need(not re.search(r"<!\s*(?:DOCTYPE|ENTITY)\b", text, re.I), "docx_xml_dtd_forbidden")
    try:
        return ET.fromstring(data)
    except (ET.ParseError, ValueError) as exc:
        raise DocxError("docx_xml_invalid") from exc


def package_content_types(root, parts):
    """Validate package semantics independently of a part's filename."""
    need(root.tag == "{" + CT + "}Types", "docx_content_types_invalid")
    defaults, overrides = {}, {}
    for item in root:
        content_type = item.get("ContentType", "")
        lower = content_type.lower()
        need(not any(mark in lower for mark in ("vba", "macro", "activex", "oleobject",
             "ole-storage", "digital-signature", "webextension", "javascript", "html")),
             "docx_active_or_signed_unsupported")
        need(content_type in PASSIVE_TYPES, "docx_content_type_unsupported")
        if item.tag == "{" + CT + "}Default":
            extension = item.get("Extension", "")
            need(re.fullmatch(r"[A-Za-z0-9]+", extension) and extension.lower() not in defaults,
                 "docx_content_types_invalid")
            defaults[extension.lower()] = content_type
        elif item.tag == "{" + CT + "}Override":
            name = item.get("PartName", "")
            need(name.startswith("/") and name[1:] in parts and name not in overrides,
                 "docx_content_types_invalid")
            overrides[name] = content_type
        else:
            raise DocxError("docx_content_types_invalid")
    result = {}
    for name in parts:
        if name == "[Content_Types].xml" or name.endswith("/"):
            continue
        content_type = overrides.get("/" + name, defaults.get(name.rsplit(".", 1)[-1].lower()))
        need(content_type in PASSIVE_TYPES, "docx_content_type_unsupported")
        if name.lower().endswith(".rels"):
            need(content_type == REL_TYPE, "docx_relationship_content_type_invalid")
        result[name] = content_type
    need(result.get("word/document.xml") == DOC_TYPE
         and [name for name, ctype in result.items() if ctype == DOC_TYPE] == ["word/document.xml"],
         "docx_main_content_type_invalid")
    return result


def archive_parts(data):
    need(len(data) <= MAX_ARCHIVE and data.startswith(b"PK\x03\x04"), "docx_zip_invalid")
    # Reject appended/prepended archives, trailing junk, multi-disk and ZIP64.
    end = data.rfind(b"PK\x05\x06")
    need(end >= 0 and end + 22 <= len(data), "docx_zip_invalid")
    disk, central_disk, count_disk, count, central_size, central_offset, comment_size = struct.unpack_from("<HHHHIIH", data, end + 4)
    need(disk == central_disk == 0 and count_disk == count and count != 65535
         and central_offset + central_size == end and end + 22 + comment_size == len(data),
         "docx_zip_invalid")
    try:
        with zipfile.ZipFile(io.BytesIO(data), "r") as archive:
            infos = archive.infolist()
            need(0 < len(infos) <= MAX_ENTRIES and len(infos) == count, "docx_zip_entry_limit")
            need(all(getattr(info, "orig_filename", None) == info.filename
                     and "\x00" not in info.orig_filename for info in infos),
                 "docx_zip_path_invalid")
            names = [info.filename for info in infos]
            need(len({name.casefold() for name in names}) == len(names), "docx_zip_duplicate_entry")
            need(sum(info.file_size for info in infos) <= MAX_EXPANDED, "docx_zip_expanded_limit")
            parts = {}
            for info in infos:
                name = info.filename
                segments = name.rstrip("/").split("/")
                need(name and not name.startswith(("/", "\\")) and "\\" not in name
                     and ":" not in name and "%" not in name and "\x00" not in name
                     and not any(ord(char) < 32 for char in name)
                     and all(p not in ("", ".", "..") for p in segments), "docx_zip_path_invalid")
                need(not info.flag_bits & (1 | 0x40), "docx_zip_encrypted")
                mode = info.external_attr >> 16
                need(not stat.S_ISLNK(mode), "docx_zip_link_rejected")
                need(info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                     "docx_zip_compression_unsupported")
                need(info.file_size <= MAX_XML and info.file_size <= max(1, info.compress_size) * 1000,
                     "docx_zip_member_limit")
                lower = name.casefold()
                need(not any(x in lower for x in ("vbaproject", "activex/", "embeddings/",
                                                   "_xmlsignatures/")), "docx_active_or_signed_unsupported")
                parts[name] = archive.read(info)  # actual CRC-checked bytes, never extract()
            comment = archive.comment
        need({"[Content_Types].xml", "_rels/.rels", "word/document.xml"} <= set(parts),
             "docx_required_part_missing")
        types = safe_xml(parts["[Content_Types].xml"])
        content_types = package_content_types(types, parts)
        # A passive XML part renamed to .bin must still receive XML/DTD checks.
        parsed = {name: safe_xml(parts[name]) for name, ctype in content_types.items()
                  if ctype.endswith("+xml") or ctype in ("application/xml", "text/xml")}
        document = parsed["word/document.xml"]
        need(document.tag == tag("document") and document.find(tag("body")) is not None,
             "docx_word_namespace_unsupported")
        main_rels = parsed["_rels/.rels"]
        mains = [item for item in main_rels if item.get("Type", "").endswith("/officeDocument")]
        need(len(mains) == 1 and mains[0].tag == "{" + REL + "}Relationship"
             and mains[0].get("Type") == OFFICE_REL + "officeDocument"
             and mains[0].get("Target") in ("word/document.xml", "/word/document.xml")
             and mains[0].get("TargetMode") in (None, "Internal"),
             "docx_main_relationship_invalid")
        for name, relation in parsed.items():
            if content_types[name] != REL_TYPE:
                continue
            need(relation.tag == "{" + REL + "}Relationships", "docx_relationships_invalid")
            need(all(item.tag == "{" + REL + "}Relationship" for item in relation),
                 "docx_relationships_invalid")
            ids = [item.get("Id") for item in relation]
            need(all(ids) and len(ids) == len(set(ids)), "docx_relationship_id_invalid")
            need(name == "_rels/.rels" or "/_rels/" in name, "docx_relationship_path_invalid")
            base = "" if name == "_rels/.rels" else name.rsplit("/_rels/", 1)[0]
            for item in relation:
                relation_type = item.get("Type", "")
                need(not any(mark in relation_type.lower() for mark in
                     ("vba", "activex", "oleobject", "control", "attachedtemplate",
                      "digital-signature", "webextension", "afchunk"))
                     and relation_type.rsplit("/", 1)[-1].lower() != "package",
                     "docx_active_or_signed_unsupported")
                need(relation_type in PASSIVE_RELATIONSHIPS, "docx_relationship_type_unsupported")
                need(relation_type != OFFICE_REL + "officeDocument" or name == "_rels/.rels",
                     "docx_main_relationship_invalid")
                target = item.get("Target", "")
                need(target and item.get("TargetMode") in (None, "Internal", "External"),
                     "docx_relationship_target_invalid")
                need(item.get("TargetMode") != "External", "docx_external_relationship_unsupported")
                target = urllib.parse.unquote(target.split("#", 1)[0])
                need("\\" not in target and ":" not in target and "\x00" not in target,
                     "docx_relationship_escape")
                resolved = posixpath.normpath(target.lstrip("/") if target.startswith("/")
                                              else posixpath.join(base, target))
                need(resolved not in (".", "..") and not resolved.startswith("../"),
                     "docx_relationship_escape")
                need(resolved in parts, "docx_relationship_missing_part")
                need(content_types.get(resolved) in PASSIVE_RELATIONSHIPS[relation_type],
                     "docx_relationship_content_type_mismatch")
        return parts, infos, comment, document
    except (zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError, NotImplementedError,
            EOFError, OverflowError, zlib.error, struct.error) as exc:
        raise DocxError("docx_zip_invalid") from exc


def paragraph_text(paragraph):
    pieces = []
    for node in paragraph.iter():
        if node.tag in (tag("t"), tag("delText"), "{" + M + "}t"):
            pieces.append(node.text or "")
        elif node.tag == tag("tab"):
            pieces.append("\t")
        elif node.tag in (tag("br"), tag("cr")):
            pieces.append("\n")
    return "".join(pieces)


def run_signature(run):
    properties = run.find(tag("rPr"))
    def canonical(node):
        return (node.tag, tuple(sorted(node.attrib.items())), node.text or "",
                tuple(canonical(child) for child in node))
    return None if properties is None else canonical(properties)


def editable_nodes(paragraph, direct):
    need(direct, "docx_target_not_direct_body_paragraph")
    children = list(paragraph)
    need(all(child.tag in (tag("pPr"), tag("r")) for child in children)
         and sum(child.tag == tag("pPr") for child in children) <= 1, "docx_target_complex")
    nodes = []
    for child in children:
        if child.tag == tag("pPr"):
            need(all(item.tag.startswith("{" + W + "}") and item.tag.split("}", 1)[1] in PARA_PROPS
                     for item in child.iter() if item is not child), "docx_target_complex")
            continue
        need(all(item.tag in (tag("rPr"), tag("t")) for item in child)
             and sum(item.tag == tag("rPr") for item in child) <= 1, "docx_target_complex")
        props = child.find(tag("rPr"))
        if props is not None:
            need(all(item.tag.startswith("{" + W + "}") and item.tag.split("}", 1)[1] in RUN_PROPS
                     and len(item) == 0 for item in props), "docx_target_complex")
        for item in child:
            if item.tag == tag("t"):
                need(len(item) == 0 and all(key == "{http://www.w3.org/XML/1998/namespace}space"
                                          for key in item.attrib), "docx_target_complex")
                nodes.append((item, child))
    need(nodes, "docx_target_has_no_text")
    return nodes


def inspection(parts, document):
    body = document.find(tag("body"))
    direct = set(body.findall(tag("p")))
    rows = []
    for index, paragraph in enumerate(body.iter(tag("p"))):
        reason = None
        try:
            editable_nodes(paragraph, paragraph in direct)
        except DocxError as exc:
            reason = exc.code
        style = paragraph.find("./" + tag("pPr") + "/" + tag("pStyle"))
        rows.append({"index": index, "text": paragraph_text(paragraph),
                     "style": style.get(tag("val")) if style is not None else "Normal",
                     "editableShape": reason is None, "blockedReason": reason,
                     "anchorSpecificValidationRequired": True})
    return {"paragraphs": rows, "textBasis": "main_story_xml_text_nodes_not_layout",
            "members": [{"path": name, "byteLength": len(payload), "sha256": sha(payload)}
                        for name, payload in sorted(parts.items())],
            "visualInspection": "not_performed", "hostValidated": False}


def text_spans(data, document):
    parser = expat.ParserCreate(namespace_separator="}")
    records, active = [], []
    def start(name, attrs):
        if name != W + "}t":
            return
        begin = parser.CurrentByteIndex
        quote, cursor = None, begin
        while cursor < len(data):
            char = data[cursor]
            if quote is not None:
                if char == quote:
                    quote = None
            elif char in (34, 39):
                quote = char
            elif char == 62:
                break
            cursor += 1
        need(cursor < len(data), "docx_xml_span_invalid")
        record = {"start": cursor + 1, "end": None, "empty": data[cursor - 1:cursor] == b"/"}
        records.append(record)
        active.append(record)
    def end(name):
        if name == W + "}t":
            record = active.pop()
            record["end"] = record["start"] if record["empty"] else parser.CurrentByteIndex
    parser.StartElementHandler = start
    parser.EndElementHandler = end
    try:
        parser.Parse(data, True)
    except expat.ExpatError as exc:
        raise DocxError("docx_xml_span_invalid") from exc
    elements = list(document.iter(tag("t")))
    need(len(elements) == len(records) and not active, "docx_xml_span_invalid")
    return dict(zip(elements, records))


def occurrences(text, anchor):
    positions, start = [], 0
    while True:
        pos = text.find(anchor, start)
        if pos < 0:
            return positions
        positions.append(pos)
        if len(positions) > 1:
            return positions
        start = pos + 1


def edited_package(parts, infos, comment, document, edits):
    need(isinstance(edits, list) and 1 <= len(edits) <= 32, "docx_edits_invalid")
    body = document.find(tag("body"))
    paragraphs = list(body.iter(tag("p")))
    direct = set(body.findall(tag("p")))
    original_texts = [paragraph_text(p) for p in paragraphs]
    expected = original_texts.copy()
    spans = text_spans(parts["word/document.xml"], document)
    patches, changes, used = [], [], set()
    for edit in edits:
        need(isinstance(edit, dict) and set(edit) <= {"textAnchor", "replacement", "paragraphAnchor", "reason"}
             and {"textAnchor", "replacement", "reason"} <= set(edit), "docx_edit_invalid")
        # 26.9.18: reason 强制非空 —— 改稿必须留痕，说明为什么改。
        need(isinstance(edit["reason"], str) and edit["reason"].strip() != "",
             "docx_edit_reason_required")
        anchor = xml_text(edit["textAnchor"])
        replacement = xml_text(edit["replacement"])
        need(anchor and anchor != replacement, "docx_edit_no_change_or_empty")
        candidates = list(range(len(paragraphs)))
        if "paragraphAnchor" in edit:
            exact = xml_text(edit["paragraphAnchor"], allow_breaks=True)
            candidates = [i for i in candidates if original_texts[i] == exact]
            need(len(candidates) == 1, "docx_paragraph_anchor_not_unique")
        matches = [(i, pos) for i in candidates for pos in occurrences(original_texts[i], anchor)]
        need(len(matches) == 1, "docx_text_anchor_not_unique")
        index, start = matches[0]
        need(index not in used, "docx_edit_target_reused")
        used.add(index)
        paragraph = paragraphs[index]
        nodes = editable_nodes(paragraph, paragraph in direct)
        end = start + len(anchor)
        offset, touched = 0, []
        for node, run in nodes:
            text = node.text or ""
            right = offset + len(text)
            if offset < end and right > start:
                touched.append((node, run, offset, right))
            offset = right
        need(touched and all(run_signature(run) == run_signature(touched[0][1])
                             for _, run, _, _ in touched), "docx_cross_run_style_unsupported")
        for ordinal, (node, run, left, right) in enumerate(touched):
            span = spans[node]
            need(not span["empty"] and b"<" not in parts["word/document.xml"][span["start"]:span["end"]],
                 "docx_text_node_markup_unsupported")
            previous = node.text or ""
            updated = previous[:max(0, start - left)] + (replacement if ordinal == 0 else "") + previous[max(0, end - left):]
            need(updated == updated.strip(" ") or node.get("{http://www.w3.org/XML/1998/namespace}space") == "preserve",
                 "docx_text_space_preservation_required")
            payload = updated.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").encode("utf-8")
            patches.append((span["start"], span["end"], payload))
        expected[index] = original_texts[index][:start] + replacement + original_texts[index][end:]
        changes.append({"paragraphIndex": index, "anchorSha256": sha(anchor.encode("utf-8")),
                        "replacementSha256": sha(replacement.encode("utf-8")), "touchedTextNodes": len(touched),
                        "reason": edit["reason"].strip()})
    original = parts["word/document.xml"]
    patches.sort()
    need(all(patches[i - 1][1] <= patches[i][0] for i in range(1, len(patches))), "docx_patch_overlap")
    chunks, cursor = [], 0
    for left, right, payload in patches:
        chunks.extend((original[cursor:left], payload))
        cursor = right
    chunks.append(original[cursor:])
    modified = b"".join(chunks)
    new_doc = safe_xml(modified)
    need([paragraph_text(p) for p in new_doc.find(tag("body")).iter(tag("p"))] == expected,
         "docx_outside_text_changed")
    output_parts = dict(parts)
    output_parts["word/document.xml"] = modified
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", allowZip64=False) as archive:
        archive.comment = comment
        for info in infos:
            archive.writestr(copy.copy(info), output_parts[info.filename])
    result = buffer.getvalue()
    actual, _, _, _ = archive_parts(result)
    need(set(actual) == set(parts) and all(actual[name] == payload for name, payload in parts.items()
                                         if name != "word/document.xml"), "docx_untargeted_part_changed")
    return result, changes, {"changedPart": "word/document.xml",
        "documentXmlOutsideTextPayloadsPreserved": True, "preservation": "uncompressed_part_bytes",
        "unmodifiedMembersSha256": {name: sha(payload) for name, payload in sorted(parts.items())
                                   if name != "word/document.xml"}}


def remove_owned(path, own, expected_digest=None):
    try:
        now = path.lstat()
        if not linked(now) and same_file_identity(now, own):
            if expected_digest is not None:
                with path.open("rb") as handle:
                    payload = handle.read(MAX_ARCHIVE + 1)
                if sha(payload) != expected_digest:
                    return False
            path.unlink()
            return True
    except FileNotFoundError:
        return True
    return False


def write_new(root, source, output, original, source_identity, data):
    target = child_path(root, output, output=True)
    need(os.path.normcase(str(target)) != os.path.normcase(str(child_path(root, source))),
         "docx_output_is_source")
    need(not target.exists(), "docx_output_exists")
    before, current = read_stable(root, source, sha(original))
    need(identity(current) == identity(source_identity), "docx_source_changed")
    own = None
    staging = None
    try:
        # 26.9.18: 先写同目录暂存文件并 fsync，再原子提交到目标路径。
        # 崩溃只可能留下暂存文件（前缀 .fbs-docx-），不会在目标路径留下半截的 DOCX。
        fd, staging_name = tempfile.mkstemp(prefix=".fbs-docx-", suffix=".tmp", dir=str(target.parent))
        staging = Path(staging_name)
        with os.fdopen(fd, "w+b") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
            handle.seek(0)
            need(handle.read(MAX_ARCHIVE + 1) == data, "docx_output_readback_failed")
            own = os.fstat(handle.fileno())
        # 26.9.18: 提交采用"先确认不存在 + 同目录 os.replace 原子替换"。
        #
        # 为什么不用 os.link：实测本平台在删除暂存名后 st_nlink 仍为 2，而
        # child_path() 对源文件强制要求 st_nlink == 1。硬链接会让产出的 DOCX
        # 反过来无法被本包自己的 inspect/edit 读取，代价高于它带来的收益。
        #
        # 已知边界：目标存在性检查与 os.replace 之间存在一个极小的 TOCTOU 窗口。
        # 本产品是单一写作负责人模型，不支持并发写同一输出路径；若未来支持并发，
        # 这里需要换成 O_EXCL 预留 + 原子替换的两步提交。
        need(not target.exists(), "docx_output_exists")
        os.replace(str(staging), str(target))
        staging = None
        after, current = read_stable(root, source, sha(original))
        need(identity(current) == identity(source_identity) and after == original, "docx_source_changed")
        check_chain(target)
        try:
            final_bytes, final_identity = read_stable(root, output)
        except (DocxError, OSError) as exc:
            raise DocxError("docx_output_changed") from exc
        need(same_file_identity(final_identity, own) and final_bytes == data,
             "docx_output_changed")
        need(identity(target.lstat()) == identity(final_identity), "docx_output_changed")
    except FileExistsError as exc:
        # 26.9.18: 保留为防御分支。当前提交路径（存在性检查 + os.replace）不会抛出它；
        # 若将来改回 O_EXCL 预留式提交，这里即是目标已存在时的统一出口。
        raise DocxError("docx_output_exists") from exc
    except Exception as exc:
        error = exc if isinstance(exc, DocxError) else DocxError("docx_output_write_failed")
        # 26.9.18: 失败时先清理暂存名（它是本函数自己创建的，删除不影响任何既有文件）。
        if staging is not None and own is not None:
            remove_owned(staging, own, None)
        # Once output identity/content is untrusted, preserve the path for its
        # current owner. Never delete a replacement file merely to tidy up.
        cleaned = False if error.code == "docx_output_changed" else (
            remove_owned(target, own, sha(data)) if own is not None else True)
        error.details["outputRetained"] = not cleaned
        raise error
    return {"output": output, "byteLength": len(final_bytes), "sha256": sha(final_bytes),
            "originalUnchanged": True, "outputWritten": True, "physicalReadbackVerified": True,
            "namedOutputIdentityVerified": True}


def process_request(request):
    need(isinstance(request, dict) and request.get("operation") in ("inspect", "edit"),
         "docx_request_invalid")
    operation = request["operation"]
    allowed = {"operation", "root", "source", "expectedSourceSha256"}
    if operation == "edit":
        allowed |= {"output", "edits"}
    need(set(request) <= allowed and {"root", "source"} <= set(request), "docx_request_invalid")
    root = root_path(request["root"])
    expected = request.get("expectedSourceSha256")
    need(expected is None or isinstance(expected, str) and HASH.fullmatch(expected),
         "docx_expected_digest_invalid")
    if operation == "edit":
        need(expected is not None and {"output", "edits"} <= set(request), "docx_edit_digest_and_output_required")
    expected = expected.lower() if expected is not None else None
    data, source_identity = read_stable(root, request["source"], expected)
    parts, infos, comment, document = archive_parts(data)
    base = {"ok": True, "format": "docx", "source": request["source"],
            "sourceSha256": sha(data), "sourceByteLength": len(data)}
    if operation == "inspect":
        again, current = read_stable(root, request["source"], sha(data))
        need(identity(current) == identity(source_identity) and again == data, "docx_source_changed")
        return {**base, "schemaVersion": "manuscriptos.docx-inspection/v1",
                **inspection(parts, document), "outputWritten": False}
    child_path(root, request["output"], output=True)  # reject escapes before building output
    result, edits, preservation = edited_package(parts, infos, comment, document, request["edits"])
    written = write_new(root, request["source"], request["output"], data, source_identity, result)
    return {**base, "schemaVersion": "manuscriptos.docx-edit/v1", **written,
            "edits": edits, **preservation, "visualInspection": "not_performed",
            "hostValidated": False, "semanticTruthVerified": False}


def main():
    try:
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        need(len(raw) <= 1024 * 1024, "docx_request_over_budget")
        try:
            request = json.loads(raw.decode("utf-8-sig"))
        except (ValueError, UnicodeError, RecursionError) as exc:
            raise DocxError("docx_request_json_invalid") from exc
        result = process_request(request)
    except DocxError as exc:
        result = {"ok": False, "issues": [exc.code], "outputWritten": False, **exc.details}
    except (OSError, ValueError, RecursionError, KeyError, TypeError) as exc:
        result = {"ok": False, "issues": ["docx_request_or_filesystem_error"], "outputWritten": False}
    sys.stdout.buffer.write((json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
