"""Minimal local JSONL operation audit; never stores CSV cell contents or secrets."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

AUDIT_ACTIONS = {
    "csv_import", "draft_register", "publish", "publication_repair", "question_delete", "batch_delete", "operation_failure",
}
MAX_AUDIT_BYTES = 5 * 1024 * 1024
AUDIT_RETENTION_DAYS = 90


def with_audit_warning(message: str, saved: bool) -> str:
    if saved:
        return message
    return message + "\nAudit log write failed. Check the Bot host log path and free disk space."


def record_operation(
    path: Path,
    *,
    user_id: int | str,
    action: str,
    success: bool,
    batch_id: str | None = None,
    question_ids: list[str] | None = None,
    now: datetime | None = None,
) -> None:
    if action not in AUDIT_ACTIONS:
        raise ValueError("Unsupported audit action")
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    event = {
        "timestamp": now.astimezone(timezone.utc).isoformat(),
        "discord_user_id": str(user_id),
        "action": action,
        "batch_id": batch_id,
        "question_ids": question_ids or [],
        "success": bool(success),
    }
    new_line = (json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    if len(new_line) > MAX_AUDIT_BYTES:
        raise OSError("Audit event exceeds configured log capacity")

    path.parent.mkdir(parents=True, exist_ok=True)
    cutoff = now.astimezone(timezone.utc).timestamp() - AUDIT_RETENTION_DAYS * 86400
    records: list[tuple[float | None, bytes]] = []
    if path.exists():
        for line in path.read_bytes().splitlines(keepends=True):
            try:
                record = json.loads(line.decode("utf-8"))
                timestamp = datetime.fromisoformat(record["timestamp"])
                if timestamp.tzinfo is None:
                    timestamp = timestamp.replace(tzinfo=timezone.utc)
                epoch = timestamp.timestamp()
            except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError, ValueError):
                epoch = None
            if epoch is None or epoch >= cutoff:
                records.append((epoch, line if line.endswith(b"\n") else line + b"\n"))
    records.append((now.timestamp(), new_line))
    total_size = sum(len(line) for _, line in records)
    while total_size > MAX_AUDIT_BYTES and len(records) > 1:
        _, removed = records.pop(0)
        total_size -= len(removed)

    temp_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        with temp_path.open("wb") as stream:
            for _, line in records:
                stream.write(line)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()
