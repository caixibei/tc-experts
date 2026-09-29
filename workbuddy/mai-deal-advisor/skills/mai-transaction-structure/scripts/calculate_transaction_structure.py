#!/usr/bin/env python3
"""在本地机械复算交易结构，不联网、不保存项目内容。"""

from __future__ import annotations

import argparse
from decimal import Decimal, InvalidOperation
import sys


MODE_LABELS = {
    "capital_increase": "增资",
    "secondary_transfer": "老股转让",
    "mixed_primary_secondary": "增资加老股转让",
    "cash_and_share_payment": "现金加股份支付",
    "share_payment": "纯股份支付",
}


class InputError(ValueError):
    """表示输入不足、冲突或不适合继续计算。"""


def _decimal(value, label, *, required=False, positive=False):
    if value is None or value == "":
        if required:
            raise InputError(f"缺少必要输入：{label}")
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise InputError(f"{label}必须是有效数字") from None
    if not number.is_finite():
        raise InputError(f"{label}必须是有限数字")
    if number < 0:
        raise InputError(f"金额不得小于零：{label}")
    if positive and number <= 0:
        raise InputError(f"{label}必须大于零")
    return number


def _shares(value, label, *, required=False, positive=False):
    if value is None or value == "":
        if required:
            raise InputError(f"缺少必要输入：{label}")
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise InputError(f"{label}必须是有效数字") from None
    if not number.is_finite():
        raise InputError(f"{label}必须是有限数字")
    if number < 0:
        raise InputError(f"股份数量不得小于零：{label}")
    if positive and number <= 0:
        raise InputError(f"{label}必须大于零")
    return number


def _ratio(value, label, *, required=False, positive=False):
    number = _decimal(value, label, required=required)
    if number is None:
        return None
    if number > 1:
        raise InputError(f"{label}必须在0%至100%之间")
    if positive and number <= 0:
        raise InputError(f"{label}必须大于0%")
    return number


def _funding_result(cash_need, values):
    supplied = [value for value in values if value is not None and value != ""]
    if not supplied:
        return {
            "confirmed_funding": None,
            "funding_gap": None,
            "funding_surplus": None,
            "funding_status": "资金来源待补",
        }
    confirmed = sum(
        (_decimal(value, "已确认资金来源") for value in supplied),
        Decimal("0"),
    )
    return {
        "confirmed_funding": confirmed,
        "funding_gap": max(Decimal("0"), cash_need - confirmed),
        "funding_surplus": max(Decimal("0"), confirmed - cash_need),
        "funding_status": "按已确认资金来源测算",
    }


def _base_result(mode, transaction_fees, funding_values):
    fees_missing = transaction_fees is None or transaction_fees == ""
    fees = _decimal(transaction_fees, "交易费用") if not fees_missing else Decimal("0")
    result = {
        "status": "partial" if fees_missing else "complete",
        "mode": mode,
        "mode_label": MODE_LABELS[mode],
        "transaction_fees": fees,
        "unresolved": ["交易费用未提供，本次现金总需求暂未计入费用"] if fees_missing else [],
    }
    result["_funding_values"] = funding_values
    return result


def _finish(result):
    funding_values = result.pop("_funding_values")
    result.update(_funding_result(result["cash_need"], funding_values))
    if result["funding_status"] == "资金来源待补":
        result["status"] = "partial"
        result["unresolved"].append("资金来源待补")
    return result


def calculate_structure(
    *,
    mode,
    pre_money=None,
    primary_amount=None,
    fully_diluted_shares=None,
    seller_shares_before=None,
    transferred_shares=None,
    price_per_share=None,
    secondary_percentage=None,
    secondary_consideration=None,
    total_consideration=None,
    cash_percentage=None,
    buyer_shares_before=None,
    buyer_share_price=None,
    transaction_fees=None,
    available_cash=None,
    debt_financing=None,
    equity_financing=None,
    other_funding=None,
):
    """按用户明确输入复算一个交易情景。"""

    if mode not in MODE_LABELS:
        raise InputError(f"不支持的交易情景：{mode}")

    funding_values = (
        available_cash,
        debt_financing,
        equity_financing,
        other_funding,
    )
    result = _base_result(mode, transaction_fees, funding_values)
    fees = result["transaction_fees"]

    if mode == "capital_increase":
        pre = _decimal(pre_money, "投前估值", required=True, positive=True)
        primary = _decimal(primary_amount, "增资金额", required=True, positive=True)
        post = pre + primary
        investor_ownership = primary / post
        result.update({
            "pre_money": pre,
            "post_money": post,
            "company_proceeds": primary,
            "seller_cash_proceeds": Decimal("0"),
            "seller_share_proceeds": Decimal("0"),
            "cash_need": primary + fees,
            "new_investor_ownership": investor_ownership,
            "existing_shareholders_ownership": pre / post,
            "existing_shareholders_dilution": investor_ownership,
        })

    elif mode == "secondary_transfer":
        total_shares = _shares(
            fully_diluted_shares,
            "交易前完全稀释总股本",
            required=True,
            positive=True,
        )
        seller_before = _shares(
            seller_shares_before,
            "卖方交易前持股",
            required=True,
            positive=True,
        )
        transferred = _shares(
            transferred_shares,
            "受让股份",
            required=True,
            positive=True,
        )
        if seller_before > total_shares:
            raise InputError("卖方交易前持股不得超过完全稀释总股本")
        if transferred > seller_before:
            raise InputError("受让股份不得超过卖方交易前持股")
        if transferred > total_shares:
            raise InputError("受让股份不得超过完全稀释总股本")

        stated = _decimal(secondary_consideration, "老股总对价")
        unit_price = _decimal(price_per_share, "每股价格", positive=True)
        if stated is None and unit_price is None:
            raise InputError("缺少必要输入：每股价格或老股总对价")
        calculated = transferred * unit_price if unit_price is not None else stated
        if stated is not None and unit_price is not None and stated != calculated:
            raise InputError("每股价格、受让股份与老股总对价互相矛盾")
        consideration = calculated
        seller_after = seller_before - transferred
        result.update({
            "fully_diluted_shares": total_shares,
            "company_proceeds": Decimal("0"),
            "seller_cash_proceeds": consideration,
            "seller_share_proceeds": Decimal("0"),
            "cash_need": consideration + fees,
            "buyer_ownership": transferred / total_shares,
            "seller_shares_after": seller_after,
            "seller_ownership_after": seller_after / total_shares,
            "secondary_consideration": consideration,
        })

    elif mode == "mixed_primary_secondary":
        pre = _decimal(pre_money, "投前估值", required=True, positive=True)
        primary = _decimal(primary_amount, "增资金额", required=True, positive=True)
        old_ratio = _ratio(
            secondary_percentage,
            "受让老股比例",
            required=True,
            positive=True,
        )
        secondary_cash = _decimal(
            secondary_consideration,
            "老股总对价",
            required=True,
            positive=True,
        )
        post = pre + primary
        old_after = old_ratio * pre / post
        primary_ownership = primary / post
        result.update({
            "pre_money": pre,
            "post_money": post,
            "company_proceeds": primary,
            "seller_cash_proceeds": secondary_cash,
            "seller_share_proceeds": Decimal("0"),
            "cash_need": primary + secondary_cash + fees,
            "old_shares_acquired_after_dilution": old_after,
            "primary_ownership": primary_ownership,
            "buyer_ownership": old_after + primary_ownership,
        })

    else:
        total = _decimal(
            total_consideration,
            "交易总对价",
            required=True,
            positive=True,
        )
        shares_before = _shares(
            buyer_shares_before,
            "买方交易前总股本",
            required=True,
            positive=True,
        )
        share_price = _decimal(
            buyer_share_price,
            "买方参考股价",
            required=True,
            positive=True,
        )
        if mode == "cash_and_share_payment":
            cash_ratio = _ratio(
                cash_percentage,
                "现金支付比例",
                required=True,
            )
        else:
            cash_ratio = Decimal("0")
        cash_consideration = total * cash_ratio
        share_consideration = total - cash_consideration
        new_shares = share_consideration / share_price
        shares_after = shares_before + new_shares
        seller_ownership = new_shares / shares_after
        result.update({
            "company_proceeds": Decimal("0"),
            "seller_cash_proceeds": cash_consideration,
            "seller_share_proceeds": share_consideration,
            "cash_need": cash_consideration + fees,
            "total_consideration": total,
            "cash_consideration": cash_consideration,
            "share_consideration": share_consideration,
            "new_buyer_shares": new_shares,
            "buyer_shares_after": shares_after,
            "seller_ownership_in_buyer": seller_ownership,
            "existing_buyer_shareholders_ownership": shares_before / shares_after,
            "existing_buyer_shareholders_dilution": seller_ownership,
        })

    return _finish(result)


def _amount(value):
    if value is None:
        return "待补"
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def _percent(value):
    return f"{(value * Decimal('100')):.2f}%"


def _money(value, currency, unit):
    return f"{currency}{_amount(value)}{unit}"


def render_markdown(result, *, currency, unit, calculation_date, input_source):
    """把计算结果整理为可直接阅读的中文底稿。"""

    lines = [
        "# 交易结构算盘",
        "",
        "> 同一笔交易，换一种付法，资金、股权和稀释会怎么变？",
        "",
        "## 一句话结论",
        "",
        f"本次按“{result['mode_label']}”复算。下面把资金去了哪里、股份发给了谁、交割后各方还剩多少分开说明。",
        "",
        "## 资金去了哪里",
        "",
        f"- 公司取得的增资款：{_money(result['company_proceeds'], currency, unit)}",
        f"- 卖方取得的老股对价或现金对价：{_money(result['seller_cash_proceeds'], currency, unit)}",
        f"- 卖方取得的股份对价：{_money(result['seller_share_proceeds'], currency, unit)}",
        f"- 交易费用：{_money(result['transaction_fees'], currency, unit)}",
        f"- 现金总需求：{_money(result['cash_need'], currency, unit)}",
        "",
        "## 股权发生了什么变化",
        "",
    ]

    ownership_fields = [
        ("新投资人交割后持股", "new_investor_ownership"),
        ("原股东交割后合计持股", "existing_shareholders_ownership"),
        ("原股东稀释幅度", "existing_shareholders_dilution"),
        ("买方取得目标公司持股", "buyer_ownership"),
        ("增资形成的持股", "primary_ownership"),
        ("受让老股经增资稀释后的持股", "old_shares_acquired_after_dilution"),
        ("卖方取得买方持股", "seller_ownership_in_buyer"),
        ("买方原股东稀释幅度", "existing_buyer_shareholders_dilution"),
    ]
    for label, key in ownership_fields:
        if key in result:
            lines.append(f"- {label}：{_percent(result[key])}")
    if "new_buyer_shares" in result:
        lines.append(f"- 买方新发行股份：{_amount(result['new_buyer_shares'])} 股")
        lines.append(f"- 买方发行后总股本：{_amount(result['buyer_shares_after'])} 股")
    if "seller_shares_after" in result:
        lines.append(f"- 卖方交割后股份：{_amount(result['seller_shares_after'])} 股")
        lines.append(f"- 卖方交割后持股：{_percent(result['seller_ownership_after'])}")

    lines.extend([
        "",
        "## 资金来源与融资缺口",
        "",
    ])
    if result["funding_gap"] is None:
        lines.append("- 资金来源待补：当前只算出现金总需求，未把未知资金来源当作零。")
    else:
        lines.append(f"- 已确认资金来源：{_money(result['confirmed_funding'], currency, unit)}")
        lines.append(f"- 融资缺口：{_money(result['funding_gap'], currency, unit)}")
        lines.append(f"- 剩余资金：{_money(result['funding_surplus'], currency, unit)}")
        lines.append(f"- 口径：{result['funding_status']}")

    lines.extend([
        "",
        "## 依据、边界与下一步",
        "",
        f"- 测算日期：{calculation_date}",
        f"- 输入来源：{input_source}",
        "- 本地计算未联网；结果只反映用户输入下的机械复算。",
        "- 结果不表示交易能够取得控制权，也不表示交易能够完成审批、并表或获得法律、税务、会计认可。",
    ])
    for item in result["unresolved"]:
        lines.append(f"- 待补：{item}")
    lines.extend([
        "- 下一步一：补齐完全稀释股本、费用和资金来源，锁定同一口径。",
        "- 下一步二：选另一种支付方式做并列复算，比较现金压力和稀释幅度。",
        "",
        "## 反馈",
        "",
        "这次测算有没有帮你把交易结构想清楚？",
        "",
        "已经想清楚｜还要再算一种｜结果不对｜提交建议",
    ])
    return "\n".join(lines) + "\n"


def _parser():
    parser = argparse.ArgumentParser(description="本地复算交易结构中的资金、持股和稀释")
    parser.add_argument("--mode", required=True)
    parser.add_argument("--pre-money")
    parser.add_argument("--primary-amount")
    parser.add_argument("--fully-diluted-shares")
    parser.add_argument("--seller-shares-before")
    parser.add_argument("--transferred-shares")
    parser.add_argument("--price-per-share")
    parser.add_argument("--secondary-percentage")
    parser.add_argument("--secondary-consideration")
    parser.add_argument("--total-consideration")
    parser.add_argument("--cash-percentage")
    parser.add_argument("--buyer-shares-before")
    parser.add_argument("--buyer-share-price")
    parser.add_argument("--transaction-fees")
    parser.add_argument("--available-cash")
    parser.add_argument("--debt-financing")
    parser.add_argument("--equity-financing")
    parser.add_argument("--other-funding")
    parser.add_argument("--currency", default="人民币")
    parser.add_argument("--unit", default="百万元")
    parser.add_argument("--calculation-date", default="待确认")
    parser.add_argument("--input-source", default="用户提供，待核验")
    return parser


def main(argv=None):
    args = _parser().parse_args(argv)
    try:
        result = calculate_structure(
            mode=args.mode,
            pre_money=args.pre_money,
            primary_amount=args.primary_amount,
            fully_diluted_shares=args.fully_diluted_shares,
            seller_shares_before=args.seller_shares_before,
            transferred_shares=args.transferred_shares,
            price_per_share=args.price_per_share,
            secondary_percentage=args.secondary_percentage,
            secondary_consideration=args.secondary_consideration,
            total_consideration=args.total_consideration,
            cash_percentage=args.cash_percentage,
            buyer_shares_before=args.buyer_shares_before,
            buyer_share_price=args.buyer_share_price,
            transaction_fees=args.transaction_fees,
            available_cash=args.available_cash,
            debt_financing=args.debt_financing,
            equity_financing=args.equity_financing,
            other_funding=args.other_funding,
        )
    except InputError as error:
        print(f"测算未完成：{error}", file=sys.stderr)
        return 2

    print(render_markdown(
        result,
        currency=args.currency,
        unit=args.unit,
        calculation_date=args.calculation_date,
        input_source=args.input_source,
    ), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
