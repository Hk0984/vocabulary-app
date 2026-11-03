"""Retry-safe reconciliation for ambiguous Google Sheets append failures."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

ROW_FIELDS = (
    "id", "source_id", "question", "choice1", "choice2", "choice3", "choice4",
    "answer", "explanation", "status", "batch_id", "created_at",
    "period_codes", "century_codes", "area_codes", "time_ranges",
)


class ReconciliationError(RuntimeError):
    """The write result could not be safely established; do not retry automatically."""


def validate_deletion_statuses(rows: list[dict[str, Any]]) -> None:
    if any(str(row.get("status", "")) not in {"draft", "published"} for row in rows):
        raise ReconciliationError("削除対象にdraft/published以外の状態があるため、削除を中止しました。")


def is_ambiguous_write_error(error: BaseException) -> bool:
    """Identify transport timeouts and server errors where a write may have committed."""
    if isinstance(error, (TimeoutError, ConnectionError)):
        return True
    if error.__class__.__name__ in {"TransportError", "HttpLib2Error", "ServerNotFoundError"}:
        return True
    status = getattr(getattr(error, "resp", None), "status", None)
    return status in {408, 500, 502, 503, 504}


def _same_row(actual: dict[str, Any], expected: dict[str, Any]) -> bool:
    return all(str(actual.get(field, "")) == str(expected.get(field, "")) for field in ROW_FIELDS)


def _find_missing(rows: list[dict[str, Any]], expected: list[dict[str, Any]]) -> list[dict[str, Any]]:
    batch_id = expected[0]["batch_id"]
    wanted = {str(row["id"]): row for row in expected}
    if len(wanted) != len(expected):
        raise ReconciliationError("登録予定データ内で問題IDが重複しています。")

    batch_rows = [row for row in rows if str(row.get("batch_id", "")) == batch_id]
    unexpected = [row for row in batch_rows if str(row.get("id", "")) not in wanted]
    if unexpected:
        raise ReconciliationError("同じbatch_idに想定外の行があり、安全に照合できません。")

    by_id: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        row_id = str(row.get("id", ""))
        if row_id in wanted:
            by_id.setdefault(row_id, []).append(row)

    missing = []
    for row_id, expected_row in wanted.items():
        matches = by_id.get(row_id, [])
        if not matches:
            missing.append(expected_row)
        elif len(matches) != 1 or not _same_row(matches[0], expected_row):
            raise ReconciliationError(f"問題ID {row_id} の登録内容が一致せず、安全に続行できません。")
    return missing


def register_with_reconciliation(
    expected_rows: list[dict[str, Any]],
    read_rows: Callable[[], list[dict[str, Any]]],
    append_rows: Callable[[list[dict[str, Any]]], None],
) -> None:
    """Append once; after an ambiguous failure, read back and append only confirmed gaps."""
    if not expected_rows:
        return
    try:
        append_rows(expected_rows)
        return
    except Exception as error:
        if not is_ambiguous_write_error(error):
            raise

    try:
        missing = _find_missing(read_rows(), expected_rows)
    except Exception as error:
        raise ReconciliationError("書き込み後の状態をSheetsから確認できません。自動再登録を中止しました。") from error

    if not missing:
        return

    try:
        append_rows(missing)
        return
    except Exception as error:
        if not is_ambiguous_write_error(error):
            raise

    try:
        still_missing = _find_missing(read_rows(), expected_rows)
    except Exception as error:
        raise ReconciliationError("補完書き込み後の状態を確認できません。自動再登録を中止しました。") from error
    if still_missing:
        raise ReconciliationError("一部の行の登録状態を確定できません。自動再登録を中止しました。")


def _status_rows(
    rows: list[dict[str, Any]], target_ids: list[str], batch_id: str, desired_status: str, previous_status: str,
) -> list[int]:
    if len(set(target_ids)) != len(target_ids):
        raise ReconciliationError("対象問題IDが重複しているため状態を照合できません。")
    indexed = {question_id: [] for question_id in target_ids}
    for row_number, row in enumerate(rows, start=2):
        question_id = str(row.get("id", ""))
        if question_id in indexed:
            indexed[question_id].append((row_number, row))
    retry_rows = []
    for question_id in target_ids:
        matches = indexed[question_id]
        if len(matches) != 1:
            raise ReconciliationError(f"問題ID {question_id} の行数が一致せず、状態を照合できません。")
        row_number, row = matches[0]
        if str(row.get("batch_id", "")) != batch_id:
            raise ReconciliationError(f"問題ID {question_id} のbatch_idが一致せず、状態を照合できません。")
        status = str(row.get("status", ""))
        if status == desired_status:
            continue
        if status != previous_status:
            raise ReconciliationError(f"問題ID {question_id} の状態が想定外で、安全に更新できません。")
        retry_rows.append(row_number)
    return retry_rows


def update_status_with_reconciliation(
    target_ids: list[str], initial_row_numbers: list[int], batch_id: str, desired_status: str, previous_status: str,
    read_rows: Callable[[], list[dict[str, Any]]], update_rows: Callable[[list[int]], None],
) -> None:
    if not target_ids:
        return
    try:
        update_rows(initial_row_numbers)
        return
    except Exception as error:
        if not is_ambiguous_write_error(error):
            raise

    def reconcile() -> list[int]:
        try:
            return _status_rows(read_rows(), target_ids, batch_id, desired_status, previous_status)
        except Exception as error:
            raise ReconciliationError("状態更新後の結果をSheetsから確認できません。自動再試行を中止しました。") from error

    retry_rows = reconcile()
    if not retry_rows:
        return
    try:
        update_rows(retry_rows)
        return
    except Exception as error:
        if not is_ambiguous_write_error(error):
            raise
    if reconcile():
        raise ReconciliationError("状態更新の結果を確定できません。自動再試行を中止しました。")


def delete_with_reconciliation(
    targets: dict[str, str], read_rows: Callable[[], list[dict[str, Any]]], delete_rows: Callable[[list[int]], None],
) -> None:
    """Delete rows by stable IDs, re-reading before any retry after an ambiguous result."""
    if not targets:
        return

    def locate() -> list[int]:
        try:
            rows = read_rows()
        except Exception as error:
            raise ReconciliationError("削除後の状態をSheetsから確認できません。自動再試行を中止しました。") from error
        indexed = {question_id: [] for question_id in targets}
        for row_number, row in enumerate(rows, start=2):
            question_id = str(row.get("id", ""))
            if question_id in indexed:
                indexed[question_id].append((row_number, row))
        row_numbers = []
        for question_id, expected_batch in targets.items():
            matches = indexed[question_id]
            if len(matches) > 1:
                raise ReconciliationError(f"問題ID {question_id} が複数あり、安全に削除できません。")
            if not matches:
                continue
            row_number, row = matches[0]
            if str(row.get("batch_id", "")) != expected_batch:
                raise ReconciliationError(f"問題ID {question_id} のbatch_idが一致せず、安全に削除できません。")
            row_numbers.append(row_number)
        return row_numbers

    try:
        delete_rows(locate())
        return
    except Exception as error:
        if isinstance(error, ReconciliationError) or not is_ambiguous_write_error(error):
            raise

    remaining = locate()
    if not remaining:
        return
    try:
        delete_rows(remaining)
        return
    except Exception as error:
        if isinstance(error, ReconciliationError) or not is_ambiguous_write_error(error):
            raise
    if locate():
        raise ReconciliationError("削除状態を確定できません。自動再試行を中止しました。")
