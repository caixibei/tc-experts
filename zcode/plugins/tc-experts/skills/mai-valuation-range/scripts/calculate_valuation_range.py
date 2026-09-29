#!/usr/bin/env python3
"""使用用户确认的结构化输入，在本地计算倍数法估值区间。"""

from __future__ import annotations

import argparse
from decimal import Decimal, InvalidOperation
import sys


METHODS = {
    "ev_revenue": {
        "label": "EV/Revenue",
        "metric_label": "收入",
        "value_basis": "enterprise_value",
    },
    "ev_ebitda": {
        "label": "EV/EBITDA",
        "metric_label": "息税折旧摊销前利润",
        "value_basis": "enterprise_value",
    },
    "pe": {
        "label": "P/E",
        "metric_label": "正常化净利润",
        "value_basis": "equity_value",
    },
    "pb": {
        "label": "P/B",
        "metric_label": "净资产",
        "value_basis": "equity_value",
    },
}

BRIDGE_FIELDS = (
    "gross_debt",
    "cash",
    "lease_liabilities",
    "preferred_equity",
    "minority_interests",
    "non_operating_investments",
)
REQUIRED_BRIDGE_FIELDS = ("gross_debt", "cash")
OPTIONAL_BRIDGE_FIELDS = BRIDGE_FIELDS[2:]
BRIDGE_LABELS = {
    "gross_debt": "有息债务",
    "cash": "现金及现金等价物",
    "lease_liabilities": "租赁负债",
    "preferred_equity": "优先权益",
    "minority_interests": "少数股东权益",
    "non_operating_investments": "非经营性投资",
}


class InputError(ValueError):
    """表示输入不足、非法或与所选方法不兼容。"""


def as_decimal(value, label):
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise InputError(f"{label}必须是有限数值") from None
    if not number.is_finite():
        raise InputError(f"{label}必须是有限数值")
    return number


def validate_metric_scenarios(method, metric_low, metric_base, metric_high):
    low = as_decimal(metric_base if metric_low is None else metric_low, "财务指标低情景")
    base = as_decimal(metric_base, "财务指标中情景")
    high = as_decimal(metric_base if metric_high is None else metric_high, "财务指标高情景")
    if not low <= base <= high:
        raise InputError("财务指标情景必须满足低值小于等于中值小于等于高值")
    if low <= 0:
        raise InputError("当前财务指标与所选方法不兼容，不能按该方法生成数值区间")
    return low, base, high


def validate_multiples(multiple_low, multiple_high):
    low = as_decimal(multiple_low, "倍数低端")
    high = as_decimal(multiple_high, "倍数高端")
    if low <= 0 or high <= 0 or low > high:
        raise InputError("倍数区间必须为正数，且低端不得高于高端")
    return low, (low + high) / Decimal("2"), high


def normalize_bridge(bridge):
    supplied = {} if bridge is None else dict(bridge)
    unknown = sorted(set(supplied) - set(BRIDGE_FIELDS))
    if unknown:
        raise InputError("企业价值桥接包含不支持的调整项")

    missing = [field for field in REQUIRED_BRIDGE_FIELDS if supplied.get(field) is None]
    if missing:
        return None, missing

    normalized = {}
    for field in BRIDGE_FIELDS:
        raw = supplied.get(field, "0")
        if raw is None:
            if field in OPTIONAL_BRIDGE_FIELDS:
                raw = "0"
            else:
                continue
        value = as_decimal(raw, BRIDGE_LABELS[field])
        if value < 0:
            raise InputError(f"{BRIDGE_LABELS[field]}不得为负数")
        normalized[field] = value
    return normalized, []


def calculate_valuation(
    *,
    method,
    metric_base,
    multiple_low,
    multiple_high,
    metric_low=None,
    metric_high=None,
    bridge=None,
):
    method_key = str(method).strip().lower()
    if method_key not in METHODS:
        raise InputError("不支持的估值方法；首版仅支持EV/Revenue、EV/EBITDA、P/E和P/B")

    method_info = METHODS[method_key]
    metrics = validate_metric_scenarios(method_key, metric_low, metric_base, metric_high)
    multiples = validate_multiples(multiple_low, multiple_high)
    low_value = metrics[0] * multiples[0]
    mid_value = metrics[1] * multiples[1]
    high_value = metrics[2] * multiples[2]
    value_range = {"low": low_value, "mid": mid_value, "high": high_value}

    explicit_metric_scenarios = metric_low is not None or metric_high is not None
    sensitivity_metrics = list(metrics) if explicit_metric_scenarios else [metrics[1]]
    sensitivity = {
        "metrics": sensitivity_metrics,
        "multiples": list(multiples),
        "matrix": [
            [metric_value * multiple for multiple in multiples]
            for metric_value in sensitivity_metrics
        ],
    }

    result = {
        "status": "complete",
        "method": method_key,
        "method_label": method_info["label"],
        "metric_label": method_info["metric_label"],
        "value_basis": method_info["value_basis"],
        "metric_scenarios": {"low": metrics[0], "base": metrics[1], "high": metrics[2]},
        "multiple_range": {"low": multiples[0], "mid": multiples[1], "high": multiples[2]},
        "value_range": value_range,
        "enterprise_value": None,
        "equity_value": None,
        "bridge_values": None,
        "bridge_adjustment": None,
        "missing_bridge_fields": [],
        "sensitivity": sensitivity,
    }

    if method_info["value_basis"] == "equity_value":
        if bridge:
            raise InputError("P/E和P/B直接计算股权价值，不使用企业价值桥接")
        result["equity_value"] = value_range
        return result

    result["enterprise_value"] = value_range
    normalized_bridge, missing = normalize_bridge(bridge)
    if missing:
        result["status"] = "partial"
        result["missing_bridge_fields"] = missing
        return result

    adjustment = (
        -normalized_bridge["gross_debt"]
        - normalized_bridge["lease_liabilities"]
        - normalized_bridge["preferred_equity"]
        - normalized_bridge["minority_interests"]
        + normalized_bridge["cash"]
        + normalized_bridge["non_operating_investments"]
    )
    result["bridge_values"] = normalized_bridge
    result["bridge_adjustment"] = adjustment
    result["equity_value"] = {
        key: value + adjustment for key, value in value_range.items()
    }
    return result


def number_text(value):
    if value == value.to_integral():
        return format(value.quantize(Decimal("1")), "f")
    return format(value.normalize(), "f")


def range_table_row(label, values, currency, unit):
    suffix = f"{unit}{currency}"
    return (
        f"| {label} | {number_text(values['low'])}{suffix} | "
        f"{number_text(values['mid'])}{suffix} | {number_text(values['high'])}{suffix} |"
    )


def render_markdown(
    result,
    *,
    currency,
    unit,
    valuation_date,
    metric_period,
    metric_source,
    multiple_source,
):
    unverified_markers = ("待核验", "单一参照", "假设")
    evidence_text = f"{metric_source} {multiple_source}"
    conclusion_level = (
        "仅供方向判断"
        if any(marker in evidence_text for marker in unverified_markers)
        else "可用于内部讨论"
    )

    lines = [
        "# 估值区间快算",
        "",
        "> 本地计算未联网；结果完全基于本次明确提供的结构化输入。",
        "",
        "## 测算结论",
        "",
        f"- 方法：{result['method_label']}",
        f"- 估值时点：{valuation_date}",
        f"- 币种及金额单位：{unit}{currency}",
        f"- 结论等级：{conclusion_level}",
        "",
        "| 价值口径 | 低值 | 区间中点（仅用于阅读） | 高值 |",
        "|---|---:|---:|---:|",
    ]

    if result["enterprise_value"] is not None:
        lines.append(
            range_table_row("企业价值", result["enterprise_value"], currency, unit)
        )
    if result["equity_value"] is not None:
        lines.append(
            range_table_row("股权价值", result["equity_value"], currency, unit)
        )
    elif result["enterprise_value"] is not None:
        missing = "、".join(BRIDGE_LABELS[field] for field in result["missing_bridge_fields"])
        lines.extend([
            "",
            f"股权价值待补：仍缺少{missing}，未知项没有按零处理。",
        ])

    if result["bridge_values"] is not None:
        lines.extend(["", "## 企业价值桥接", ""])
        for field in BRIDGE_FIELDS:
            lines.append(
                f"- {BRIDGE_LABELS[field]}：{number_text(result['bridge_values'][field])}{unit}{currency}"
            )
        lines.append(
            f"- 桥接净调整：{number_text(result['bridge_adjustment'])}{unit}{currency}"
        )

    lines.extend([
        "",
        "## 敏感性",
        "",
        f"| {result['metric_label']}情景 | {number_text(result['sensitivity']['multiples'][0])}倍 | "
        f"{number_text(result['sensitivity']['multiples'][1])}倍 | "
        f"{number_text(result['sensitivity']['multiples'][2])}倍 |",
        "|---|---:|---:|---:|",
    ])
    for metric_value, row in zip(
        result["sensitivity"]["metrics"], result["sensitivity"]["matrix"]
    ):
        lines.append(
            f"| {number_text(metric_value)}{unit}{currency} | "
            + " | ".join(f"{number_text(value)}{unit}{currency}" for value in row)
            + " |"
        )

    lines.extend([
        "",
        "## 依据与假设",
        "",
        f"- 财务指标报告期：{metric_period}",
        f"- 财务指标来源：{metric_source}",
        f"- 倍数来源：{multiple_source}",
        "- 区间中点只用于阅读，不代表独立观察到的市场价格。",
        "",
        "## 适用边界",
        "",
        "本结果用于早期方向判断或内部讨论，不构成正式估值报告、公允价值意见、投资意见或交易价格承诺。",
        "",
        "## 反馈",
        "",
        "本次结果是否帮助你推进了工作？  ",
        "有帮助｜部分有帮助｜没有帮助｜提交建议",
    ])
    return "\n".join(lines) + "\n"


def parser():
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--method", required=True, choices=sorted(METHODS))
    value.add_argument("--metric-low")
    value.add_argument("--metric-base", required=True)
    value.add_argument("--metric-high")
    value.add_argument("--multiple-low", required=True)
    value.add_argument("--multiple-high", required=True)
    value.add_argument("--gross-debt")
    value.add_argument("--cash")
    value.add_argument("--lease-liabilities")
    value.add_argument("--preferred-equity")
    value.add_argument("--minority-interests")
    value.add_argument("--non-operating-investments")
    value.add_argument("--currency", required=True)
    value.add_argument("--unit", required=True)
    value.add_argument("--valuation-date", required=True)
    value.add_argument("--metric-period", required=True)
    value.add_argument("--metric-source", required=True)
    value.add_argument("--multiple-source", required=True)
    return value


def main(argv=None):
    args = parser().parse_args(argv)
    bridge = {
        "gross_debt": args.gross_debt,
        "cash": args.cash,
        "lease_liabilities": args.lease_liabilities,
        "preferred_equity": args.preferred_equity,
        "minority_interests": args.minority_interests,
        "non_operating_investments": args.non_operating_investments,
    }
    if all(item is None for item in bridge.values()):
        bridge = None

    try:
        result = calculate_valuation(
            method=args.method,
            metric_low=args.metric_low,
            metric_base=args.metric_base,
            metric_high=args.metric_high,
            multiple_low=args.multiple_low,
            multiple_high=args.multiple_high,
            bridge=bridge,
        )
    except InputError as exc:
        print(f"估值测算未完成：{exc} [INPUT_INVALID]", file=sys.stderr)
        return 2

    print(
        render_markdown(
            result,
            currency=args.currency,
            unit=args.unit,
            valuation_date=args.valuation_date,
            metric_period=args.metric_period,
            metric_source=args.metric_source,
            multiple_source=args.multiple_source,
        ),
        end="",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
