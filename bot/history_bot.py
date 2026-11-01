"""Discord CSV intake and draft/publish management for history questions."""

from __future__ import annotations

import os
import asyncio
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

import discord
from discord import app_commands
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

from csv_validation import CsvValidationError, HEADERS, parse_csv
from discord_display import escape_discord_text
from audit_log import record_operation, with_audit_warning
from sheets_write import (
    ReconciliationError, delete_with_reconciliation, register_with_reconciliation,
    update_status_with_reconciliation, validate_deletion_statuses,
)

load_dotenv(Path(__file__).with_name(".env"))

SHEET_HEADERS = HEADERS + ["status", "batch_id", "created_at"]
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def sheets_client():
    credential_file = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE", "service-account.json")
    credentials = Credentials.from_service_account_file(credential_file, scopes=SCOPES)
    return build("sheets", "v4", credentials=credentials, cache_discovery=False).spreadsheets()


def sheet_config() -> tuple[str, str]:
    spreadsheet_id = os.environ.get("GOOGLE_SHEETS_SPREADSHEET_ID")
    if not spreadsheet_id:
        raise RuntimeError("GOOGLE_SHEETS_SPREADSHEET_ID が設定されていません。")
    title = os.environ.get("HISTORY_SHEET_NAME", "history_questions")
    return spreadsheet_id, title


def read_rows():
    spreadsheet_id, title = sheet_config()
    result = sheets_client().values().get(spreadsheetId=spreadsheet_id, range=f"'{title}'!A:L").execute()
    values = result.get("values", [])
    if not values or values[0] != SHEET_HEADERS:
        raise RuntimeError(f"シート '{title}' の1行目に仕様の列ヘッダーを設定してください。")
    return [dict(zip(SHEET_HEADERS, row + [""] * (len(SHEET_HEADERS) - len(row)))) for row in values[1:]]


def append_batch(rows: list[dict[str, str]], batch_id: str | None = None) -> str:
    existing = read_rows()
    known_ids = {row["id"] for row in existing}
    collisions = sorted({row["id"] for row in rows} & known_ids)
    if collisions:
        raise CsvValidationError("シート内に既存の問題IDがあります: " + ", ".join(collisions[:20]))
    batch_id = batch_id or uuid.uuid4().hex[:12]
    created_at = datetime.now(timezone.utc).isoformat()
    planned_rows = [{**row, "status": "draft", "batch_id": batch_id, "created_at": created_at} for row in rows]
    spreadsheet_id, title = sheet_config()

    def append_rows(target_rows):
        values = [[row[key] for key in SHEET_HEADERS] for row in target_rows]
        sheets_client().values().append(
            spreadsheetId=spreadsheet_id, range=f"'{title}'!A:L", valueInputOption="RAW",
            insertDataOption="INSERT_ROWS", body={"values": values},
        ).execute()

    register_with_reconciliation(planned_rows, read_rows, append_rows)
    return batch_id


def update_status(row_numbers: list[int], status: str) -> None:
    spreadsheet_id, title = sheet_config()
    requests = [{"range": f"'{title}'!J{number}:J{number}", "values": [[status]]} for number in row_numbers]
    sheets_client().values().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={"valueInputOption": "RAW", "data": requests},
    ).execute()


def allowed_user(interaction: discord.Interaction) -> bool:
    admins = {value.strip() for value in os.environ.get("ADMIN_USER_IDS", "").split(",") if value.strip()}
    return str(interaction.user.id) in admins


def audit_path() -> Path:
    configured = Path(os.environ.get("AUDIT_LOG_FILE") or "history_bot.audit.jsonl")
    return configured if configured.is_absolute() else Path(__file__).parent / configured


_audit_warnings: set[int] = set()


def take_audit_warning(interaction: discord.Interaction) -> bool:
    key = id(interaction)
    if key in _audit_warnings:
        _audit_warnings.remove(key)
        return False
    return True


async def audit(interaction: discord.Interaction, action: str, success: bool, batch_id: str | None = None, question_ids: list[str] | None = None) -> bool:
    try:
        await asyncio.to_thread(
            record_operation, audit_path(), user_id=interaction.user.id, action=action, success=success,
            batch_id=batch_id, question_ids=question_ids,
        )
        return True
    except OSError:
        logging.getLogger("history_bot.audit").error("Audit log write failed (action=%s)", action)
        _audit_warnings.add(id(interaction))
        return False


async def audit_failure(interaction: discord.Interaction, attempted_action: str, batch_id: str | None = None, question_ids: list[str] | None = None) -> bool:
    first = await audit(interaction, attempted_action, False, batch_id, question_ids)
    second = await audit(interaction, "operation_failure", False, batch_id, question_ids)
    return first and second

async def send_pages(interaction: discord.Interaction, text: str, limit: int = 1800) -> None:
    """Send complete output in bounded ephemeral messages after defer()."""
    text = with_audit_warning(text, take_audit_warning(interaction))
    pages = []
    current = ""
    for paragraph in text.splitlines(keepends=True):
        while len(paragraph) > limit:
            if current:
                pages.append(current)
                current = ""
            pages.append(paragraph[:limit])
            paragraph = paragraph[limit:]
        if len(current) + len(paragraph) > limit:
            pages.append(current)
            current = ""
        current += paragraph
    if current or not pages:
        pages.append(current)
    await interaction.followup.send(pages[0], ephemeral=True)
    for page in pages[1:]:
        await interaction.followup.send(page, ephemeral=True)


async def report_operation_error(interaction: discord.Interaction) -> None:
    await interaction.followup.send(with_audit_warning("?????????????????????????", take_audit_warning(interaction)), ephemeral=True)


async def report_reconciliation_error(interaction: discord.Interaction, batch_id: str | None = None) -> None:
    target = f" batch_id: `{batch_id}`" if batch_id else ""
    message = f"Sheets???????????????????{target}??????????????/list ????????????????"
    await interaction.followup.send(with_audit_warning(message, take_audit_warning(interaction)), ephemeral=True)


class HistoryBot(discord.Client):
    def __init__(self):
        super().__init__(intents=discord.Intents.none(), allowed_mentions=discord.AllowedMentions.none())
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        guild_id = os.environ.get("DISCORD_GUILD_ID")
        if guild_id:
            guild = discord.Object(id=int(guild_id))
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
        else:
            await self.tree.sync()


bot = HistoryBot()


@bot.tree.command(name="import", description="CSVの問題を検証して下書き登録します")
@app_commands.describe(file="仕様に沿ったUTF-8 CSV")
async def import_csv(interaction: discord.Interaction, file: discord.Attachment):
    if not allowed_user(interaction):
        await interaction.response.send_message("この操作を行う権限がありません。", ephemeral=True)
        await audit(interaction, "csv_import", False)
        await audit(interaction, "operation_failure", False)
        return
    await interaction.response.defer(ephemeral=True)
    rows = []
    batch_id = None
    try:
        if not file.filename.lower().endswith(".csv") or file.size > 1_000_000:
            raise CsvValidationError("CSVファイル（1MB以下）を添付してください。")
        csv_bytes = await file.read()
        rows = await asyncio.to_thread(parse_csv, csv_bytes)
        question_ids = [row["id"] for row in rows]
        batch_id = uuid.uuid4().hex[:12]
        await audit(interaction, "csv_import", True, batch_id, question_ids)
        await asyncio.to_thread(append_batch, rows, batch_id)
        await audit(interaction, "draft_register", True, batch_id, question_ids)
        await interaction.followup.send(f"{len(rows)}問をdraft登録しました。batch_id: `{batch_id}`", ephemeral=True)
    except ReconciliationError:
        question_ids = [row["id"] for row in rows]
        await audit_failure(interaction, "draft_register", batch_id, question_ids)
        await report_reconciliation_error(interaction, batch_id or "unknown")
    except (CsvValidationError, RuntimeError) as exc:
        question_ids = [row["id"] for row in rows]
        if rows:
            await audit_failure(interaction, "draft_register", batch_id, question_ids)
        else:
            await audit_failure(interaction, "csv_import")
        await interaction.followup.send(f"登録を中止しました: {exc}", ephemeral=True)
    except Exception:
        question_ids = [row["id"] for row in rows]
        await audit_failure(interaction, "draft_register" if rows else "csv_import", batch_id, question_ids)
        await report_operation_error(interaction)


@bot.tree.command(name="list", description="登録バッチと状態を一覧表示します")
async def list_batches(interaction: discord.Interaction):
    if not allowed_user(interaction):
        await interaction.response.send_message("権限がありません。", ephemeral=True)
        await audit(interaction, "operation_failure", False)
        return
    await interaction.response.defer(ephemeral=True)
    try:
        rows = await asyncio.to_thread(read_rows)
        batches: dict[str, dict[str, int]] = {}
        for row in rows:
            group = batches.setdefault(row["batch_id"], {})
            group[row["status"]] = group.get(row["status"], 0) + 1
        message = "\n".join(f"{key}: " + ", ".join(f"{state} {count}問" for state, count in counts.items()) for key, counts in batches.items()) or "登録はありません。"
        await send_pages(interaction, message or "登録はありません。")
    except Exception:
        await audit(interaction, "operation_failure", False)
        await report_operation_error(interaction)


@bot.tree.command(name="check", description="指定バッチの問題内容を表示します")
@app_commands.describe(batch_id="/list に表示されたバッチID")
async def check_batch(interaction: discord.Interaction, batch_id: str):
    if not allowed_user(interaction):
        await interaction.response.send_message("権限がありません。", ephemeral=True)
        await audit(interaction, "operation_failure", False, batch_id)
        return
    await interaction.response.defer(ephemeral=True)
    try:
        rows = [row for row in await asyncio.to_thread(read_rows) if row["batch_id"] == batch_id]
        if not rows:
            await send_pages(interaction, "バッチが見つかりません。")
            return
        chunks, current = [], ""
        for row in rows:
            item = f"**{escape_discord_text(row['id'])}** [{escape_discord_text(row['status'])}] {escape_discord_text(row['question'])}\n" + "\n".join(f"{i}. {escape_discord_text(row[f'choice{i}'])}" for i in range(1, 5)) + f"\n正答: {escape_discord_text(row['answer'])} / {escape_discord_text(row['explanation'])}\n\n"
            current += item
        await send_pages(interaction, f"{len(rows)}問\n{current}")
    except Exception:
        await audit(interaction, "operation_failure", False, batch_id)
        await report_operation_error(interaction)


@bot.tree.command(name="publish", description="draftのバッチを公開します")
@app_commands.describe(batch_id="公開するバッチID")
async def publish_batch(interaction: discord.Interaction, batch_id: str):
    if not allowed_user(interaction):
        await interaction.response.send_message("権限がありません。", ephemeral=True)
        await audit(interaction, "operation_failure", False, batch_id)
        return
    await interaction.response.defer(ephemeral=True)
    question_ids = []
    try:
        all_rows = await asyncio.to_thread(read_rows)
        selected = [(index + 2, row) for index, row in enumerate(all_rows) if row["batch_id"] == batch_id]
        question_ids = [row["id"] for _, row in selected]
        targets = [number for number, row in selected if row["status"] == "draft"]
        if not targets:
            await audit_failure(interaction, "publish", batch_id, question_ids)
            await send_pages(interaction, "公開対象のdraftがありません。")
            return
        draft_rows = [row for _, row in selected if row["status"] == "draft"]
        await asyncio.to_thread(
            update_status_with_reconciliation,
            [row["id"] for row in draft_rows], targets, batch_id, "published", "draft",
            read_rows, lambda row_numbers: update_status(row_numbers, "published"),
        )
        await audit(interaction, "publish", True, batch_id, [row["id"] for _, row in selected if row["status"] == "draft"])
        await send_pages(interaction, f"{len(targets)}問を公開しました。")
    except ReconciliationError:
        await audit_failure(interaction, "publish", batch_id, question_ids)
        await report_reconciliation_error(interaction, batch_id)
    except Exception:
        await audit_failure(interaction, "publish", batch_id, question_ids)
        await report_operation_error(interaction)


@bot.tree.command(name="delete", description="問題またはバッチを削除します")
@app_commands.describe(batch_id="削除するバッチID", question_id="削除する問題ID", confirm="公開済み問題を含む場合は確認にチェック")
async def delete_batch(interaction: discord.Interaction, batch_id: str | None = None, question_id: str | None = None, confirm: bool = False):
    if not allowed_user(interaction):
        await interaction.response.send_message("権限がありません。", ephemeral=True)
        await audit(interaction, "operation_failure", False, batch_id, [question_id] if question_id else None)
        return
    await interaction.response.defer(ephemeral=True)
    selected_ids = [question_id] if question_id else []
    target_batch_id = batch_id
    action = "question_delete" if question_id else "batch_delete"
    try:
        spreadsheet_id, title = await asyncio.to_thread(sheet_config)
        rows = await asyncio.to_thread(read_rows)
        if bool(batch_id) == bool(question_id):
            await audit_failure(interaction, action, batch_id, selected_ids)
            await send_pages(interaction, "batch_id または question_id のどちらか一方を指定してください。")
            return
        selected = [(index + 2, row) for index, row in enumerate(rows) if (row["batch_id"] == batch_id if batch_id else row["id"] == question_id)]
        selected_ids = [row["id"] for _, row in selected]
        target_batch_id = batch_id or (selected[0][1]["batch_id"] if selected else None)
        if len(set(selected_ids)) != len(selected_ids):
            raise ReconciliationError("対象問題IDが重複しており、安全に削除できません。")
        validate_deletion_statuses([row for _, row in selected])
        if any(row["status"] == "published" for _, row in selected) and not confirm:
            await audit_failure(interaction, action, target_batch_id, selected_ids)
            await send_pages(interaction, "公開済み問題を含みます。confirm を有効にして再実行してください。")
            return
        if not selected:
            await audit_failure(interaction, action, target_batch_id, selected_ids)
            await send_pages(interaction, "対象が見つかりません。")
            return
        sheet_id = await asyncio.to_thread(_sheet_id, title)

        def delete_rows(row_numbers):
            sheets_client().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": [{"deleteDimension": {"range": {"sheetId": sheet_id, "dimension": "ROWS", "startIndex": number - 1, "endIndex": number}}} for number in sorted(row_numbers, reverse=True)]},
            ).execute()

        await asyncio.to_thread(
            delete_with_reconciliation,
            {row["id"]: row["batch_id"] for _, row in selected}, read_rows, delete_rows,
        )
        await audit(interaction, action, True, target_batch_id, selected_ids)
        await send_pages(interaction, f"{len(selected)}問を削除しました。")
    except ReconciliationError:
        await audit_failure(interaction, action, target_batch_id, selected_ids)
        await report_reconciliation_error(interaction, target_batch_id)
    except Exception:
        await audit_failure(interaction, action, target_batch_id, selected_ids)
        await report_operation_error(interaction)


def _sheet_id(title: str) -> int:
    spreadsheet_id, _ = sheet_config()
    doc = sheets_client().get(spreadsheetId=spreadsheet_id, fields="sheets.properties").execute()
    for sheet in doc.get("sheets", []):
        if sheet["properties"]["title"] == title:
            return sheet["properties"]["sheetId"]
    raise RuntimeError(f"シート '{title}' がありません。")


if __name__ == "__main__":
    token = os.environ.get("DISCORD_BOT_TOKEN")
    if not token:
        raise SystemExit("DISCORD_BOT_TOKEN を bot/.env に設定してください。")
    bot.run(token)
