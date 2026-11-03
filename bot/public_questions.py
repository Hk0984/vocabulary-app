"""Safe publication of approved questions to a separate public spreadsheet."""

from __future__ import annotations

from collections.abc import Callable
from threading import Lock
from typing import Any

from sheets_write import ReconciliationError, is_ambiguous_write_error, delete_with_reconciliation
from history_classification import HEADERS, validate

PUBLIC_HEADERS = HEADERS.copy()
_PUBLIC_PUBLISH_LOCK = Lock()


def make_public_rows(
    rows: list[dict[str, Any]], *, expected_status: str = "draft"
) -> list[dict[str, str]]:
    """Validate source rows and return only the thirteen public data fields."""
    result = []
    for row in rows:
        if row.get("status") != expected_status:
            raise ReconciliationError(f"公開対象に{expected_status}以外の状態が含まれています。")
        item = {key: str(row.get(key, "")) for key in PUBLIC_HEADERS}
        if any(not item[key] for key in PUBLIC_HEADERS if key not in {"explanation","century_codes","time_ranges"}):
            raise ReconciliationError("公開対象に必須項目の欠落があります。")
        if item["answer"] not in {"1", "2", "3", "4"}:
            raise ReconciliationError("公開対象の正答番号が不正です。")
        if len({item[f"choice{i}"].strip() for i in range(1, 5)}) != 4:
            raise ReconciliationError("公開対象の選択肢が不正です。")
        try:
            validate(item)
        except ValueError as error:
            raise ReconciliationError('公開対象の分類が不正です。') from error
        result.append(item)
    if len({row["id"] for row in result}) != len(result):
        raise ReconciliationError("公開対象内で問題IDが重複しています。")
    return result


def _missing(existing: list[dict[str, Any]], expected: list[dict[str, str]]) -> list[dict[str, str]]:
    wanted = {row["id"]: row for row in expected}
    if len(wanted) != len(expected):
        raise ReconciliationError("公開対象内で問題IDが重複しています。")
    found: dict[str, list[dict[str, Any]]] = {}
    for row in existing:
        question_id = str(row.get("id", ""))
        if question_id in wanted:
            found.setdefault(question_id, []).append(row)
    missing = []
    for question_id, expected_row in wanted.items():
        matches = found.get(question_id, [])
        if not matches:
            missing.append(expected_row)
        elif len(matches) != 1 or any(
            str(matches[0].get(field, "")) != expected_row[field] for field in PUBLIC_HEADERS
        ):
            raise ReconciliationError(f"公開先の問題ID {question_id} と内容が一致しません。")
    return missing


def _read_missing(
    rows: list[dict[str, str]],
    read_rows: Callable[[], list[dict[str, Any]]],
) -> list[dict[str, str]]:
    try:
        return _missing(read_rows(), rows)
    except ReconciliationError:
        raise
    except Exception as error:
        raise ReconciliationError("公開先を読み戻して状態を確認できません。自動処理を中止しました。") from error


def _publish_with_reconciliation(
    rows: list[dict[str, str]],
    read_rows: Callable[[], list[dict[str, Any]]],
    append_rows: Callable[[list[dict[str, str]]], None],
) -> None:
    """Idempotently append public rows; only retry after an ambiguous write is reconciled."""
    if not rows:
        return
    missing = _read_missing(rows, read_rows)
    if not missing:
        return
    try:
        append_rows(missing)
    except Exception as error:
        if not is_ambiguous_write_error(error):
            raise
        missing = _read_missing(rows, read_rows)
        if not missing:
            return
        try:
            append_rows(missing)
        except Exception as retry_error:
            if not is_ambiguous_write_error(retry_error):
                raise
            missing = _read_missing(rows, read_rows)
            if not missing:
                return
            raise ReconciliationError("公開先への再転記後も全件の登録を確認できません。") from retry_error

    # Verify normal and repaired writes before reporting success or changing source status.
    missing = _read_missing(rows, read_rows)
    if missing:
        raise ReconciliationError("書き込み後の読み戻しで全件を確認できません。元データの状態は変更していません。")


def publish_with_reconciliation(
    rows: list[dict[str, str]],
    read_rows: Callable[[], list[dict[str, Any]]],
    append_rows: Callable[[list[dict[str, str]]], None],
) -> None:
    """Serialize Bot publication attempts so concurrent commands cannot duplicate IDs."""
    with _PUBLIC_PUBLISH_LOCK:
        _publish_with_reconciliation(rows, read_rows, append_rows)


def publish_drafts_safely(
    source_rows: list[dict[str, Any]],
    read_public: Callable[[], list[dict[str, Any]]],
    append_public: Callable[[list[dict[str, str]]], None],
    mark_source_published: Callable[[], None],
) -> int:
    """Publish to the public destination first, then update source status."""
    public_rows = make_public_rows(source_rows)
    publish_with_reconciliation(public_rows, read_public, append_public)
    mark_source_published()
    return len(public_rows)


def repair_published_rows(
    source_rows: list[dict[str, Any]],
    read_public: Callable[[], list[dict[str, Any]]],
    append_public: Callable[[list[dict[str, str]]], None],
) -> int:
    """Idempotently restore already-published rows missing from the public sheet."""
    public_rows = make_public_rows(source_rows, expected_status="published")
    publish_with_reconciliation(public_rows, read_public, append_public)
    return len(public_rows)


def revoke_public_rows(question_ids, read_rows, clear_rows):
    """Remove public cells first; verify absence before deleting private source rows.

    read_rows must retain blank rows so spreadsheet row numbers stay correct.
    Clearing A:M preserves row positions and headers, including after a timeout.
    """
    with _PUBLIC_PUBLISH_LOCK:
        targets = {question_id: "" for question_id in question_ids}
        delete_with_reconciliation(targets, read_rows, clear_rows)
        if any(str(row.get("id", "")) in targets for row in read_rows()):
            raise ReconciliationError("公開先からの削除を確認できません。管理用データは保持しています。")
