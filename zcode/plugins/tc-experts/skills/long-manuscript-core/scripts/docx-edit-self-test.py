"""docx-edit.py 端到端自检（26.9.18 写入安全回归）。

用法：
    python scripts/docx-edit-self-test.py [--work-dir <目录>]

行为：在临时目录内构造最小 DOCX 夹具，逐项执行合同用例，输出 JSON 结果。
默认在系统临时目录内工作并在结束后清理；指定 --work-dir 时保留现场便于排查。

边界：本自检只验证合同行为（拒绝条件、回读断言、链接数不变量、原子提交残留）。
它不证明文字真实性、不证明版式正确，也不替代宿主或 Word 界面的打开验收。
"""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "docx-edit.py"

CT = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    "</Types>"
)
RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    "</Relationships>"
)
DOCRELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
)


def build_docx(path, paragraphs):
    body = "".join(
        f'<w:p><w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>' for text in paragraphs
    )
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body></w:document>"
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", CT)
        archive.writestr("_rels/.rels", RELS)
        archive.writestr("word/_rels/document.xml.rels", DOCRELS)
        archive.writestr("word/document.xml", document)


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run_edit(request):
    completed = subprocess.run(
        [sys.executable, str(SCRIPT)],
        input=json.dumps(request).encode("utf-8"),
        capture_output=True,
    )
    raw = completed.stdout.decode("utf-8", "replace").strip()
    try:
        return completed.returncode, json.loads(raw)
    except ValueError:
        return completed.returncode, {"ok": False, "issues": ["unparsable_output"], "raw": raw}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--work-dir", default=None)
    args = parser.parse_args()

    if not SCRIPT.exists():
        print(json.dumps({"ok": False, "issues": ["docx_edit_script_missing"], "path": str(SCRIPT)}))
        return 2

    temporary = args.work_dir is None
    root = Path(args.work_dir) if args.work_dir else Path(tempfile.mkdtemp(prefix="fbs-docx-selftest-"))
    root.mkdir(parents=True, exist_ok=True)

    results = []

    def check(case_id, condition, detail=None):
        results.append({"caseId": case_id, "passed": bool(condition), **({"detail": detail} if detail and not condition else {})})

    try:
        source = root / "src.docx"
        build_docx(source, ["第一章 起步", "这段文字需要修改。", "结尾段。"])
        base_digest = sha256(source)

        rc, result = run_edit({"operation": "inspect", "root": str(root), "source": "src.docx"})
        check("inspect-ok", rc == 0 and result.get("ok") is True, result)
        check("inspect-no-write", result.get("outputWritten") is False, result)

        rc, result = run_edit({
            "operation": "edit", "root": str(root), "source": "src.docx", "output": "out.docx",
            "expectedSourceSha256": base_digest,
            "edits": [{"textAnchor": "需要修改", "replacement": "已经修改", "reason": "统一时态"}],
        })
        check("edit-ok", rc == 0 and result.get("ok") is True, result)
        check("edit-readback-verified", result.get("physicalReadbackVerified") is True, result)
        check("edit-source-unchanged", sha256(source) == base_digest, "source mutated")
        check("edit-reason-recorded",
              (result.get("edits") or [{}])[0].get("reason") == "统一时态", result)

        rc, result = run_edit({
            "operation": "edit", "root": str(root), "source": "src.docx", "output": "dup.docx",
            "expectedSourceSha256": base_digest,
            "edits": [{"textAnchor": "段", "replacement": "节", "reason": "x"}],
        })
        check("anchor-not-unique-rejected", rc != 0 and result.get("ok") is False, result)

        rc, result = run_edit({
            "operation": "edit", "root": str(root), "source": "src.docx", "output": "out.docx",
            "expectedSourceSha256": base_digest,
            "edits": [{"textAnchor": "需要修改", "replacement": "再次修改", "reason": "x"}],
        })
        check("existing-output-rejected", rc != 0 and result.get("ok") is False, result)

        rc, result = run_edit({
            "operation": "edit", "root": str(root), "source": "src.docx", "output": "stale.docx",
            "expectedSourceSha256": "0" * 64,
            "edits": [{"textAnchor": "需要修改", "replacement": "改", "reason": "x"}],
        })
        check("stale-source-rejected", rc != 0 and result.get("ok") is False, result)

        rc, result = run_edit({
            "operation": "edit", "root": str(root), "source": "src.docx", "output": "../escape.docx",
            "expectedSourceSha256": base_digest,
            "edits": [{"textAnchor": "需要修改", "replacement": "改", "reason": "x"}],
        })
        check("path-escape-rejected", rc != 0 and result.get("ok") is False, result)

        rc, result = run_edit({
            "operation": "edit", "root": str(root), "source": "src.docx", "output": "noreason.docx",
            "expectedSourceSha256": base_digest,
            "edits": [{"textAnchor": "需要修改", "replacement": "改"}],
        })
        check("reason-missing-rejected", rc != 0 and "docx_edit_invalid" in (result.get("issues") or []), result)

        rc, result = run_edit({
            "operation": "edit", "root": str(root), "source": "src.docx", "output": "blankreason.docx",
            "expectedSourceSha256": base_digest,
            "edits": [{"textAnchor": "需要修改", "replacement": "改", "reason": "   "}],
        })
        check("reason-blank-rejected", rc != 0 and "docx_edit_reason_required" in (result.get("issues") or []), result)

        output = root / "out.docx"
        rc, result = run_edit({"operation": "inspect", "root": str(root), "source": "out.docx"})
        check("output-readable-as-source", rc == 0 and result.get("ok") is True, result)
        check("output-link-count-invariant", output.lstat().st_nlink == 1, output.lstat().st_nlink)

        rc, result = run_edit({
            "operation": "edit", "root": str(root), "source": "out.docx", "output": "round2.docx",
            "expectedSourceSha256": sha256(output),
            "edits": [{"textAnchor": "已经修改", "replacement": "二次修改", "reason": "第二轮"}],
        })
        check("output-reusable-as-source", rc == 0 and result.get("ok") is True, result)

        check("no-staging-leftover",
              not [p.name for p in root.iterdir() if p.name.startswith(".fbs-docx-")])
    finally:
        if temporary:
            shutil.rmtree(root, ignore_errors=True)

    passed = sum(1 for item in results if item["passed"])
    report = {
        "schema": "manuscriptos.docx-edit-self-test/v1",
        "ok": passed == len(results),
        "passed": passed,
        "total": len(results),
        "results": results,
        "workDir": None if temporary else str(root),
        "evidenceBoundary": "contract_behaviour_only_not_layout_truth_or_host_acceptance",
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
