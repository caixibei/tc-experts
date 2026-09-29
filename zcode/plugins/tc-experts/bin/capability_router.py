"""Deterministic, local-only capability and CTA routing policy."""

from __future__ import annotations


_TRANSACTION_STRUCTURE = "transaction-structure"
_CAP_TABLE_CHECK = "cap-table-check"
_VALUATION_REVIEW = "valuation-review"


def _state_value(state: dict, key: str, default: object = None) -> object:
    """Read one optional state value without accepting non-dict input."""
    if not isinstance(state, dict):
        return default
    return state.get(key, default)


def _recommended_capabilities(state: dict) -> set[str]:
    """Return only well-formed, previously recommended capability IDs."""
    raw = _state_value(state, "recommended_capabilities", ())
    if not isinstance(raw, (list, tuple, set, frozenset)):
        return set()
    return {capability for capability in raw if isinstance(capability, str)}


def _enabled(value: object) -> bool:
    """Accept only a real boolean flag; malformed values safely disable an action."""
    return value is True


def route_next_action(state: dict) -> str | None:
    """Select the sole next capability or contact action for ``state``.

    The helper is intentionally pure: callers supply the normalized conversation
    state and persist recommendation frequency outside this module.
    """
    explicit_intent = _state_value(state, "explicit_intent")
    if explicit_intent == _TRANSACTION_STRUCTURE:
        return _TRANSACTION_STRUCTURE
    if explicit_intent == _CAP_TABLE_CHECK:
        return _CAP_TABLE_CHECK
    if explicit_intent == _VALUATION_REVIEW:
        return _VALUATION_REVIEW

    if isinstance(explicit_intent, str) and explicit_intent.strip():
        return "expert_task"

    if _enabled(_state_value(state, "feedback_requested")):
        return "feedback"

    if _enabled(_state_value(state, "contact_requested")):
        return "high_intent_contact"

    if _enabled(_state_value(state, "answer_failed")) or not _enabled(
        _state_value(state, "value_delivered")
    ):
        return None

    if _enabled(_state_value(state, "high_intent")):
        return "high_intent_contact"

    if _enabled(_state_value(state, "post_value_contact")):
        return "post_value_contact"

    if _enabled(_state_value(state, "product_data_prompt_needed")):
        return "product_data_prompt"

    recommended = _recommended_capabilities(state)
    candidates = (
        (
            _enabled(_state_value(state, "post_value_transaction_structure")),
            _TRANSACTION_STRUCTURE,
        ),
        (
            _enabled(_state_value(state, "post_value_cap_table_check")),
            _CAP_TABLE_CHECK,
        ),
        (
            _enabled(_state_value(state, "post_value_valuation_review")),
            _VALUATION_REVIEW,
        ),
    )
    for relevant, capability in candidates:
        if relevant and capability not in recommended:
            return capability

    if _enabled(_state_value(state, "feedback_eligible")):
        return "feedback"

    return None
