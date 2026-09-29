#!/usr/bin/env python3
"""MAI WorkBuddy 产品体验数据客户端：一次选择、无正文事件、尽力发送。"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from functools import wraps
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
from typing import Callable
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import uuid


API_BASE_URL = "https://1305255855-ijb3xyhcb8.ap-shanghai.tencentscf.com"
SCHEMA_VERSION = "mai-product-data-v1"
NOTICE_VERSION = "mai-product-data-notice-2026-09-03"
PROFILE_NOTICE_VERSION = "mai-project-context-notice-2026-09-07"
PROFILE_SCOPES = {"none", "summary", "identified"}
PROFILE_FILE_MAX_BYTES = 16384
STATE_FILE = "preferences.json"
EVENT_NAMES = {
    "skill_started",
    "first_value_completed",
    "project_context_recorded",
    "skill_failed",
    "recommendation_shown",
    "recommendation_clicked",
    "artifact_created",
    "project_save_offered",
    "project_saved",
    "feedback_opened",
}
ENTRY_POINTS = {"expert_pack", "standalone_skill", "cross_skill", "direct", "unknown"}
OUTCOMES = {"started", "success", "failure", "shown", "clicked", "saved", "unknown"}
ERROR_CATEGORIES = {"none", "network", "input", "service", "storage", "unknown"}
LATENCY_BUCKETS = {"unknown", "<1s", "1-3s", "3-10s", ">10s"}
ARTIFACT_TYPES = {
    "",
    "signal_brief",
    "buyer_shortlist",
    "target_shortlist",
    "transaction_structure",
    "cap_table_check",
    "valuation_range",
    "project_record",
    "other",
}
ARTIFACT_FORMATS = {"", "markdown", "docx", "pdf", "xlsx", "csv", "json", "svg", "png", "other"}
EXPERT_ID = "mai-deal-advisor"
EXPERT_VERSION = "1.3.7"
SKILL_VERSIONS = {
    "mai-deal-advisor": {"1.3.7"},
    "mai-deal-signal-radar": {"1.0.0"},
    "mai-buyer-matching": {"1.0.0"},
    "mai-target-screening": {"1.0.0"},
    "mai-transaction-structure": {"1.0.0"},
    "mai-cap-table-check": {"1.0.0"},
    "mai-valuation-range": {"1.0.0"},
    "mai-project-record": {"1.0.0", "1.0.1"},
}
HASHED_SESSION = re.compile(r"session:[0-9a-f]{64}\Z")
UUID_V4 = r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
PROJECT_ID = re.compile(rf"project-{UUID_V4}\Z", re.IGNORECASE)
PROFILE_ID = re.compile(rf"profile-{UUID_V4}\Z", re.IGNORECASE)
INDUSTRIES = {"未知", "制造业", "能源与矿业", "信息技术", "金融服务", "医疗健康", "消费与零售", "房地产", "建筑与基础设施", "物流与交通", "农业与食品", "教育", "文旅与酒店", "专业服务", "其他"}
INDUSTRY_BASES = {"user_stated", "inferred", "unknown", "declined", "not_applicable"}
BANDS = {"unknown", "lt_10m", "10m_50m", "50m_100m", "100m_500m", "500m_1b", "gte_1b"}
CURRENCIES = {"unknown", "CNY", "HKD", "USD", "EUR", "other"}
SIZE_BASES = {"user_stated", "unknown", "declined", "not_applicable"}


def default_state_dir() -> Path:
    configured = os.environ.get("MAI_PRODUCT_DATA_STATE_DIR", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".workbuddy" / "mai" / "product-data"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex}"


def _state_path(state_dir=None) -> Path:
    return Path(state_dir) / STATE_FILE if state_dir is not None else default_state_dir() / STATE_FILE


@contextmanager
def _preference_lock(state_dir=None):
    """Serialize shared-state changes and requests, including explicit revocation.

    Network calls inside the lock retain their two-second timeout. A revocation
    may wait for an already in-flight request, but once acknowledged no earlier
    request can overwrite it or send an event using stale consent.
    """
    path = _state_path(state_dir).with_suffix('.lock')
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(descriptor, 'r+b') as stream:
        if os.name == 'nt':
            import msvcrt
            if os.fstat(stream.fileno()).st_size == 0:
                stream.write(b'0')
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def _serialized(function):
    @wraps(function)
    def locked(*args, **kwargs):
        with _preference_lock(kwargs.get('state_dir')):
            return function(*args, **kwargs)
    return locked


def _read_state(state_dir=None) -> dict:
    path = _state_path(state_dir)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}
    if not isinstance(value, dict):
        return {}
    if value.get("status") not in {"unknown", "enabled", "disabled"}:
        return {}
    if not _valid_install_id(value.get("install_id")):
        return {}
    return value


def _valid_install_id(value) -> bool:
    if value == "SYNTHETIC_MAI_PRODUCT_DATA_20260903":
        return True
    if not isinstance(value, str):
        return False
    try:
        return str(uuid.UUID(value)) == value
    except (ValueError, AttributeError):
        return False


def _session_id(value: str) -> str:
    if not value:
        return ""
    if HASHED_SESSION.fullmatch(value):
        return value
    return "session:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def _validate_product_context(
    *, skill_id: str, skill_version: str, expert_id: str, expert_version: str,
    referral_skill_id: str = "",
) -> None:
    if skill_id not in SKILL_VERSIONS:
        raise ValueError("技能标识不受支持")
    if skill_version not in SKILL_VERSIONS[skill_id]:
        raise ValueError("技能版本不受支持")
    if expert_id != EXPERT_ID or expert_version != EXPERT_VERSION:
        raise ValueError("专家标识或版本不受支持")
    if referral_skill_id and referral_skill_id not in SKILL_VERSIONS:
        raise ValueError("推荐技能标识不受支持")


def _write_state(value: dict, state_dir=None) -> None:
    path = _state_path(state_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    descriptor, temporary_name = tempfile.mkstemp(prefix=".preferences-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        try:
            path.chmod(0o600)
        except OSError:
            pass
    finally:
        if temporary.exists():
            temporary.unlink()


def _ensure_state(state_dir=None, install_id=None) -> dict:
    value = _read_state(state_dir)
    if value:
        return value
    chosen_install_id = install_id or str(uuid.uuid4())
    value = {
        "install_id": chosen_install_id,
        "notice_version": NOTICE_VERSION,
        "notice_shown": False,
        "status": "unknown",
    }
    _write_state(value, state_dir)
    return value


def _effective_profile_scope(value: dict) -> str:
    """Return only profile consent granted by the current profile notice."""
    scope = value.get("profile_scope", "none")
    if (value.get("status") != "enabled"
            or value.get("notice_version") != PROFILE_NOTICE_VERSION
            or scope not in {"summary", "identified"}):
        return "none"
    return scope


def status(*, state_dir=None, install_id=None) -> dict:
    value = _read_state(state_dir)
    if not value:
        return {"status": "unknown", "notice_shown": False, "prompt_needed": True,
                "profile_scope": "none", "profile_prompt_needed": True}
    shown = bool(value.get("notice_shown"))
    profile_scope = _effective_profile_scope(value)
    return {
        "status": value["status"],
        "notice_shown": shown,
        "prompt_needed": value["status"] == "unknown" and not shown,
        "profile_scope": profile_scope,
        "profile_prompt_needed": (value["status"] != "disabled"
                                  and not bool(value.get("profile_notice_shown"))),
    }


@_serialized
def mark_shown(*, state_dir=None, install_id=None, project_context=False) -> dict:
    value = _ensure_state(state_dir, install_id)
    if project_context:
        value["profile_notice_shown"] = True
    else:
        value["notice_shown"] = True
        value["notice_version"] = NOTICE_VERSION
    _write_state(value, state_dir)
    return status(state_dir=state_dir)


def _post_json(path: str, payload: dict, timeout: float):
    request = Request(
        API_BASE_URL + path,
        data=json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": "WorkBuddy/mai-product-data/1.0.0",
        },
        method="POST",
    )
    with urlopen(request, timeout=timeout) as response:
        body = response.read(4096)
        if response.status not in {200, 201}:
            raise OSError("产品体验数据暂时不可用")
        try:
            receipt = json.loads(body)
        except (ValueError, TypeError) as error:
            raise OSError("产品体验数据回执无效") from error
        if receipt is None:
            raise OSError("产品体验数据回执无效")
        return receipt


@_serialized
def choose(
    decision: str,
    *,
    profile_scope: str = "none",
    state_dir=None,
    install_id=None,
    sender: Callable[[str, dict, float], None] = _post_json,
    now: Callable[[], str] = _utc_now,
    id_factory: Callable[[str], str] = _new_id,
) -> dict:
    if decision not in {"enabled", "disabled"}:
        raise ValueError("选择只能是 enabled 或 disabled")
    if profile_scope not in PROFILE_SCOPES:
        raise ValueError("项目概况范围不受支持")
    value = _ensure_state(state_dir, install_id)
    previous_status = value["status"]
    previous_scope = value.get("profile_scope", "none")
    chosen_scope = profile_scope if decision == "enabled" else "none"
    profile_wire = (chosen_scope != "none"
                    or (decision == "disabled" and previous_scope != "none"))
    value.update({
        "status": decision,
        "notice_shown": True,
        "profile_notice_shown": True,
        "profile_scope": chosen_scope,
        "notice_version": PROFILE_NOTICE_VERSION if profile_wire else NOTICE_VERSION,
    })
    _write_state(value, state_dir)
    should_sync = decision == "enabled" or previous_status == "enabled" or bool(value.get("pending_preference"))
    if not should_sync:
        result = status(state_dir=state_dir)
        result["sent"] = False
        return result
    payload = {
        "schema_version": SCHEMA_VERSION,
        "notice_version": PROFILE_NOTICE_VERSION if profile_wire else NOTICE_VERSION,
        "install_id": value["install_id"],
        "decision": decision,
        "occurred_at": now(),
        "idempotency_key": id_factory("pref"),
    }
    if profile_wire:
        payload["profile_scope"] = chosen_scope
    value["pending_preference"] = payload
    _write_state(value, state_dir)
    sent = _sync_preference(value, state_dir, sender)
    result = status(state_dir=state_dir)
    result["sent"] = sent
    return result


def _sync_preference(value, state_dir, sender) -> bool:
    """Retry only the latest explicit choice; no event is sent before it succeeds."""
    latest = _read_state(state_dir)
    value.clear()
    value.update(latest)
    payload = value.get("pending_preference")
    if not payload:
        return True
    expected_scope = _effective_profile_scope(value)
    matches_choice = (
        isinstance(payload, dict)
        and payload.get("decision") == value.get("status")
        and payload.get("notice_version") == value.get("notice_version")
        and payload.get("install_id") == value.get("install_id")
        and (
            (payload.get("notice_version") == PROFILE_NOTICE_VERSION
             and payload.get("profile_scope", "none") == expected_scope)
            or (payload.get("notice_version") == NOTICE_VERSION
                and "profile_scope" not in payload
                and expected_scope == "none")
        )
    )
    if not matches_choice:
        value.pop("pending_preference", None)
        _write_state(value, state_dir)
        return False
    try:
        receipt = sender("/v1/product-data/preferences", payload, 2)
    except Exception:
        return False
    if receipt is not None and (not isinstance(receipt, dict)
                                or receipt.get("success") is not True
                                or receipt.get("decision") != payload["decision"]):
        return False
    latest = _read_state(state_dir)
    if latest.get('pending_preference') != payload or latest.get('status') != payload['decision']:
        value.clear()
        value.update(latest)
        return False
    value.clear()
    value.update(latest)
    value.pop("pending_preference", None)
    _write_state(value, state_dir)
    return True


@_serialized
def sync_preferences(*, state_dir=None, sender=_post_json) -> dict:
    """Retry an existing explicit choice only; never creates or sends an event."""
    value = _read_state(state_dir)
    pending = bool(value.get('pending_preference'))
    sent = _sync_preference(value, state_dir, sender) if pending else False
    return {**status(state_dir=state_dir), 'sent': sent}


def _allowed(value: str, allowed: set[str], label: str) -> str:
    if value not in allowed:
        raise ValueError(f"{label}不受支持")
    return value


def _profile_invalid(message: str):
    raise ValueError(f"项目概况格式错误：{message}")


def _exact_object(value, fields, label):
    if not isinstance(value, dict):
        _profile_invalid(f"{label}必须是对象")
    unknown = set(value) - set(fields)
    if unknown:
        _profile_invalid(f"{label}包含未知字段：{sorted(unknown)[0]}")
    missing = set(fields) - set(value)
    if missing:
        _profile_invalid(f"{label}缺少字段：{sorted(missing)[0]}")


def _profile_selected(value, allowed, label):
    if not isinstance(value, str) or value not in allowed:
        _profile_invalid(f"{label}不受支持")
    return value


def _optional_text(value, label, maximum):
    if not isinstance(value, str):
        _profile_invalid(f"{label}必须是文字")
    normalized = value.strip()
    if len(normalized) > maximum:
        _profile_invalid(f"{label}过长")
    return normalized


def _normalize_size(value, label, metrics):
    fields = ("metric", "band", "currency", "period", "basis")
    _exact_object(value, fields, label)
    normalized = {
        "metric": _profile_selected(value["metric"], metrics, f"{label}指标"),
        "band": _profile_selected(value["band"], BANDS, f"{label}区间"),
        "currency": _profile_selected(value["currency"], CURRENCIES, f"{label}币种"),
        "period": value["period"],
        "basis": _profile_selected(value["basis"], SIZE_BASES, f"{label}依据"),
    }
    if not isinstance(normalized["period"], str) or (normalized["period"] != "unknown" and not re.fullmatch(r"\d{4}", normalized["period"])):
        _profile_invalid(f"{label}期间不受支持")
    if normalized["band"] != "unknown" and normalized["currency"] == "unknown":
        _profile_invalid(f"{label}已知区间必须提供币种")
    if normalized["basis"] != "user_stated" and normalized["band"] != "unknown":
        _profile_invalid(f"{label}非用户陈述依据不能使用已知区间")
    return normalized


def normalize_project_profile(value):
    fields = ("project_id", "profile_id", "context_kind", "industry", "industry_basis",
              "company_size", "deal_size", "target_company", "user_company", "user_name",
              "user_contact", "contact_followup")
    _exact_object(value, fields, "项目概况")
    if not isinstance(value["project_id"], str) or not PROJECT_ID.fullmatch(value["project_id"]):
        _profile_invalid("项目标识格式无效")
    if not isinstance(value["profile_id"], str) or not PROFILE_ID.fullmatch(value["profile_id"]):
        _profile_invalid("概况标识格式无效")
    industry = _profile_selected(value["industry"], INDUSTRIES, "行业")
    basis = _profile_selected(value["industry_basis"], INDUSTRY_BASES, "行业依据")
    if basis in {"unknown", "declined", "not_applicable"} and industry != "未知":
        _profile_invalid("未知、拒绝或不适用行业必须使用未知")
    if basis == "inferred" and industry == "未知":
        _profile_invalid("行业推断必须提供固定行业")
    if not isinstance(value["contact_followup"], bool):
        _profile_invalid("联系意向必须是布尔值")
    contact = _optional_text(value["user_contact"], "用户联系方式", 320)
    if value["contact_followup"] and not contact:
        _profile_invalid("希望联系时必须填写用户联系方式")
    return {
        "project_id": value["project_id"].lower(),
        "profile_id": value["profile_id"].lower(),
        "context_kind": _profile_selected(value["context_kind"], {"actual_project", "hypothetical"}, "项目类型"),
        "industry": industry,
        "industry_basis": basis,
        "company_size": _normalize_size(value["company_size"], "公司规模", {"annual_revenue", "total_assets", "unknown"}),
        "deal_size": _normalize_size(value["deal_size"], "交易规模", {"transaction_value", "financing_amount", "acquisition_budget", "unknown"}),
        "target_company": _optional_text(value["target_company"], "目标公司", 240),
        "user_company": _optional_text(value["user_company"], "用户公司", 240),
        "user_name": _optional_text(value["user_name"], "用户姓名", 160),
        "user_contact": contact,
        "contact_followup": value["contact_followup"],
    }


def _open_project_profile_windows(path, *, kernel32=None, msvcrt_module=None):
    """Open one local Windows disk file without traversing a reparse point."""
    import ctypes
    from ctypes import wintypes
    if msvcrt_module is None:
        import msvcrt as msvcrt_module

    raw_path = os.fspath(path)
    if not isinstance(raw_path, str) or raw_path.startswith(("\\\\", "//")):
        raise ValueError("项目概况文件必须是明确本地文件路径")
    if kernel32 is None:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    kernel32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                     ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD,
                                     wintypes.HANDLE]
    kernel32.CreateFileW.restype = wintypes.HANDLE
    kernel32.GetFileInformationByHandleEx.argtypes = [wintypes.HANDLE, ctypes.c_int,
                                                       ctypes.c_void_p, wintypes.DWORD]
    kernel32.GetFileInformationByHandleEx.restype = wintypes.BOOL
    kernel32.GetFileType.argtypes = [wintypes.HANDLE]
    kernel32.GetFileType.restype = wintypes.DWORD
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL

    class FileAttributeTagInfo(ctypes.Structure):
        _fields_ = [("FileAttributes", wintypes.DWORD), ("ReparseTag", wintypes.DWORD)]

    generic_read = 0x80000000
    file_share_read = 0x00000001
    open_existing = 3
    file_flag_open_reparse_point = 0x00200000
    invalid_handle = ctypes.c_void_p(-1).value
    handle = kernel32.CreateFileW(raw_path, generic_read, file_share_read, None,
                                  open_existing, file_flag_open_reparse_point, None)
    if handle in (None, invalid_handle):
        raise ValueError("项目概况文件必须是普通文件")
    transferred = False
    try:
        information = FileAttributeTagInfo()
        if not kernel32.GetFileInformationByHandleEx(
                handle, 9, ctypes.byref(information), ctypes.sizeof(information)):
            raise ValueError("项目概况文件必须是普通文件")
        if information.FileAttributes & (0x00000400 | 0x00000010):
            raise ValueError("项目概况文件必须是普通文件")
        if kernel32.GetFileType(handle) != 1:
            raise ValueError("项目概况文件必须是普通文件")
        flags = (os.O_RDONLY | getattr(os, "O_BINARY", 0x8000)
                 | getattr(os, "O_NOINHERIT", 0x0080))
        descriptor = msvcrt_module.open_osfhandle(handle, flags)
        transferred = True
        return descriptor
    except (OSError, ValueError) as error:
        if isinstance(error, ValueError):
            raise
        raise ValueError("项目概况文件必须是普通文件") from error
    finally:
        if not transferred:
            kernel32.CloseHandle(handle)


def _open_project_profile_descriptor(path):
    if os.name == "nt":
        return _open_project_profile_windows(path)
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    if not nofollow:
        raise ValueError("当前系统无法安全读取项目概况文件")
    flags = os.O_RDONLY | nofollow | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        return os.open(path, flags)
    except OSError as error:
        raise ValueError("项目概况文件必须是普通文件") from error


def _load_project_profile_file(path):
    path = Path(path)
    descriptor = _open_project_profile_descriptor(path)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError("项目概况文件必须是普通文件")
        chunks = []
        remaining = PROFILE_FILE_MAX_BYTES + 1
        while remaining:
            chunk = os.read(descriptor, remaining)
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
    finally:
        os.close(descriptor)
    if len(raw) > PROFILE_FILE_MAX_BYTES:
        raise ValueError("项目概况文件最多 16384 字节")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError("项目概况文件必须是 UTF-8") from error
    try:
        value = json.loads(text)
    except json.JSONDecodeError as error:
        raise ValueError("项目概况文件必须是 JSON 单对象") from error
    if not isinstance(value, dict):
        raise ValueError("项目概况文件必须是 JSON 单对象")
    return normalize_project_profile(value)


@_serialized
def emit_event(
    *,
    skill_id: str,
    skill_version: str,
    event_name: str,
    entry_point: str,
    outcome: str,
    session_id: str = "",
    expert_id: str = EXPERT_ID,
    expert_version: str = EXPERT_VERSION,
    referral_skill_id: str = "",
    error_category: str = "none",
    latency_bucket: str = "unknown",
    artifact_type: str = "",
    artifact_format: str = "",
    artifact_count: int = 0,
    project_profile=None,
    state_dir=None,
    install_id=None,
    sender: Callable[[str, dict, float], None] = _post_json,
    now: Callable[[], str] = _utc_now,
    id_factory: Callable[[str], str] = _new_id,
) -> dict:
    value = _ensure_state(state_dir, install_id)
    profile_scope = _effective_profile_scope(value)
    if event_name == "project_context_recorded":
        if value["status"] != "enabled":
            return {"sent": False, "reason": "not_enabled"}
        if profile_scope not in {"summary", "identified"}:
            return {"sent": False, "reason": "profile_not_enabled"}
        if project_profile is None:
            return {"sent": False, "reason": "profile_required"}
    validated_profile = normalize_project_profile(project_profile) if project_profile is not None else None
    preference_synced = _sync_preference(value, state_dir, sender)
    if value["status"] != "enabled":
        return {"sent": False, "reason": "not_enabled"}
    if not preference_synced:
        return {"sent": False, "reason": "unavailable"}
    profile_scope = _effective_profile_scope(value)
    if event_name == "project_context_recorded" and profile_scope == "none":
        return {"sent": False, "reason": "profile_not_enabled"}
    normalized_profile = validated_profile if profile_scope in {"summary", "identified"} else None
    if normalized_profile is not None and profile_scope == "summary":
        for key in ("target_company", "user_company", "user_name", "user_contact"):
            normalized_profile[key] = ""
        normalized_profile["contact_followup"] = False
    _validate_product_context(
        skill_id=skill_id,
        skill_version=skill_version,
        expert_id=expert_id,
        expert_version=expert_version,
        referral_skill_id=referral_skill_id,
    )
    _allowed(event_name, EVENT_NAMES, "事件类型")
    _allowed(entry_point, ENTRY_POINTS, "进入方式")
    _allowed(outcome, OUTCOMES, "结果状态")
    _allowed(error_category, ERROR_CATEGORIES, "错误类别")
    _allowed(latency_bucket, LATENCY_BUCKETS, "耗时区间")
    _allowed(artifact_type, ARTIFACT_TYPES, "产物类型")
    _allowed(artifact_format, ARTIFACT_FORMATS, "产物格式")
    if not isinstance(artifact_count, int) or not 0 <= artifact_count <= 1000:
        raise ValueError("产物数量必须是 0 至 1000 的整数")
    payload = {
        "schema_version": SCHEMA_VERSION,
        "notice_version": PROFILE_NOTICE_VERSION if profile_scope != "none" else NOTICE_VERSION,
        "event_id": id_factory("event"),
        "install_id": value["install_id"],
        "session_id": _session_id(session_id),
        "expert_id": expert_id,
        "expert_version": expert_version,
        "skill_id": skill_id,
        "skill_version": skill_version,
        "event_name": event_name,
        "entry_point": entry_point,
        "referral_skill_id": referral_skill_id,
        "outcome": outcome,
        "error_category": error_category,
        "latency_bucket": latency_bucket,
        "artifact_type": artifact_type,
        "artifact_format": artifact_format,
        "artifact_count": artifact_count,
        "occurred_at": now(),
    }
    if normalized_profile is not None:
        payload["project_profile"] = normalized_profile
    try:
        receipt = sender("/v1/product-data/events", payload, 2)
    except Exception:
        return {"sent": False, "reason": "unavailable"}
    if receipt is not None and (not isinstance(receipt, dict) or receipt.get("success") is not True):
        return {"sent": False, "reason": "not_confirmed_received"}
    return {"sent": True}


@_serialized
def feedback_link(
    *,
    skill_id: str,
    skill_version: str,
    artifact_type: str = "",
    session_id: str = "",
    expert_id: str = EXPERT_ID,
    expert_version: str = EXPERT_VERSION,
    state_dir=None,
    install_id=None,
) -> str:
    _allowed(artifact_type, ARTIFACT_TYPES, "产物类型")
    _validate_product_context(
        skill_id=skill_id,
        skill_version=skill_version,
        expert_id=expert_id,
        expert_version=expert_version,
    )
    value = _ensure_state(state_dir, install_id)
    query = urlencode({
        "install_id": value["install_id"],
        "session_id": _session_id(session_id),
        "expert_id": expert_id,
        "expert_version": expert_version,
        "skill_id": skill_id,
        "skill_version": skill_version,
        "artifact_type": artifact_type,
    })
    return f"{API_BASE_URL}/product-data/feedback?{query}"


def feedback_card(**context) -> str:
    """Invite an in-chat choice without sending data or creating an identity."""
    return (
        "> **这次分析帮到你了吗？**\n"
        "> 直接回复“有帮助”或“还差一点”，也可以补充一句。\n"
        "> 我会先给你确认要提交的内容；确认后才发给 MAI，不附带聊天记录或文件。"
    )


def submit_feedback(
    *, skill_id: str, skill_version: str, feedback_id: str, rating: str,
    confirmed: bool = False, reason_codes=(), comment: str = '',
    name: str = '', company: str = '', role: str = '', contact: str = '',
    contact_followup: bool = False, artifact_type: str = '', session_id: str = '',
    expert_id: str = EXPERT_ID, expert_version: str = EXPERT_VERSION,
    state_dir=None, install_id=None,
) -> dict:
    """Send only a separately confirmed feedback payload; do not enable events."""
    if confirmed is not True:
        return {'sent': False, 'reason': 'confirmation_required'}
    _validate_product_context(skill_id=skill_id, skill_version=skill_version,
                              expert_id=expert_id, expert_version=expert_version)
    _allowed(rating, {'useful', 'not_resolved'}, '评价')
    _allowed(artifact_type, ARTIFACT_TYPES, '产物类型')
    if not isinstance(feedback_id, str) or not re.fullmatch(r'feedback-[a-zA-Z0-9-]{8,100}', feedback_id):
        raise ValueError('反馈标识无效')
    reasons = {'clear', 'actionable', 'accurate', 'fast', 'missing_context', 'inaccurate',
               'too_generic', 'difficult_to_use', 'missing_data', 'too_long', 'table_error',
               'slow_export', 'unclear_priority', 'other'}
    if not isinstance(reason_codes, (list, tuple)) or len(reason_codes) > 5:
        raise ValueError('反馈原因最多五项')
    for reason in reason_codes:
        _allowed(reason, reasons, '反馈原因')
    if len(set(reason_codes)) != len(reason_codes):
        raise ValueError('反馈原因不能重复')
    for value, limit in ((comment, 1000), (name, 160), (company, 240), (role, 160), (contact, 320)):
        if not isinstance(value, str) or len(value) > limit:
            raise ValueError('反馈文字格式或长度不符')
    if not isinstance(contact_followup, bool) or (contact_followup and not contact.strip()):
        raise ValueError('希望联系时请填写联系方式')
    value = _ensure_state(state_dir, install_id)
    payload = {
        'schema_version': SCHEMA_VERSION, 'notice_version': NOTICE_VERSION, 'confirmed': True,
        'feedback_id': feedback_id, 'install_id': value['install_id'],
        'session_id': _session_id(session_id), 'expert_id': expert_id, 'expert_version': expert_version,
        'skill_id': skill_id, 'skill_version': skill_version, 'artifact_type': artifact_type,
        'rating': rating, 'reason_codes': list(reason_codes), 'comment': comment,
        'name': name, 'company': company, 'role': role, 'contact': contact,
        'contact_followup': contact_followup, 'occurred_at': _utc_now(),
    }
    request = Request(API_BASE_URL + '/product-data/feedback',
                      data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                      headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urlopen(request, timeout=8) as response:
            receipt = json.loads(response.read(4096))
            if (response.status not in {200, 201} or not isinstance(receipt, dict)
                    or receipt.get('success') is not True or receipt.get('feedback_id') != feedback_id):
                raise ValueError('没有匹配的保存回执')
    except Exception:
        return {'sent': False, 'reason': 'not_confirmed_received', 'feedback_id': feedback_id}
    return {'sent': True, 'feedback_id': feedback_id}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="管理 MAI 产品体验数据选择和反馈入口")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("status")
    subparsers.add_parser("sync-preferences")
    mark_parser = subparsers.add_parser("mark-shown")
    mark_parser.add_argument("--project-context", action="store_true")
    choose_parser = subparsers.add_parser("choose")
    choose_parser.add_argument("decision", choices=("enabled", "disabled"))
    choose_parser.add_argument("--profile-scope", default="none", choices=sorted(PROFILE_SCOPES))
    for name in ("event", "feedback-link", "feedback-card", "feedback-submit"):
        child = subparsers.add_parser(name)
        child.add_argument("--skill-id", required=True)
        child.add_argument("--skill-version", required=True)
        child.add_argument("--session-id", default=os.environ.get("CODEBUDDY_SESSION_ID", ""))
        child.add_argument("--expert-id", default="mai-deal-advisor")
        child.add_argument("--expert-version", default="1.3.7")
        child.add_argument("--artifact-type", default="", choices=sorted(ARTIFACT_TYPES))
        if name == 'feedback-submit':
            child.add_argument('--feedback-id', required=True)
            child.add_argument('--rating', required=True, choices=('useful', 'not_resolved'))
            child.add_argument('--confirmed', action='store_true', required=True)
            child.add_argument('--reason-code', action='append', default=[])
            for field in ('comment', 'name', 'company', 'role', 'contact'):
                child.add_argument('--' + field, default='')
            child.add_argument('--contact-followup', action='store_true')
        if name == "event":
            child.add_argument("--project-profile-file")
            child.add_argument("--event-name", required=True, choices=sorted(EVENT_NAMES))
            child.add_argument("--entry-point", required=True, choices=sorted(ENTRY_POINTS))
            child.add_argument("--outcome", required=True, choices=sorted(OUTCOMES))
            child.add_argument("--referral-skill-id", default="")
            child.add_argument("--error-category", default="none", choices=sorted(ERROR_CATEGORIES))
            child.add_argument("--latency-bucket", default="unknown", choices=sorted(LATENCY_BUCKETS))
            child.add_argument("--artifact-format", default="", choices=sorted(ARTIFACT_FORMATS))
            child.add_argument("--artifact-count", type=int, default=0)
    return parser


def main(argv=None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "status":
        result = status()
    elif args.command == "sync-preferences":
        result = sync_preferences()
    elif args.command == "mark-shown":
        result = mark_shown(project_context=args.project_context)
    elif args.command == "choose":
        result = choose(args.decision, profile_scope=args.profile_scope)
    elif args.command == 'feedback-submit':
        result = submit_feedback(skill_id=args.skill_id, skill_version=args.skill_version,
            feedback_id=args.feedback_id, rating=args.rating, confirmed=args.confirmed,
            reason_codes=args.reason_code, comment=args.comment, name=args.name,
            company=args.company, role=args.role, contact=args.contact,
            contact_followup=args.contact_followup, artifact_type=args.artifact_type,
            session_id=args.session_id, expert_id=args.expert_id, expert_version=args.expert_version)
    elif args.command in {"feedback-link", "feedback-card"}:
        render = feedback_card if args.command == "feedback-card" else feedback_link
        print(render(
            skill_id=args.skill_id,
            skill_version=args.skill_version,
            session_id=args.session_id,
            expert_id=args.expert_id,
            expert_version=args.expert_version,
            artifact_type=args.artifact_type,
        ))
        return 0
    else:
        result = emit_event(
            skill_id=args.skill_id,
            skill_version=args.skill_version,
            event_name=args.event_name,
            entry_point=args.entry_point,
            outcome=args.outcome,
            session_id=args.session_id,
            expert_id=args.expert_id,
            expert_version=args.expert_version,
            referral_skill_id=args.referral_skill_id,
            error_category=args.error_category,
            latency_bucket=args.latency_bucket,
            artifact_type=args.artifact_type,
            artifact_format=args.artifact_format,
            artifact_count=args.artifact_count,
            project_profile=(_load_project_profile_file(args.project_profile_file)
                             if args.project_profile_file else None),
        )
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
