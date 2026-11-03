"""Discord CSV intake and draft/publish management for history questions."""

from __future__ import annotations

import os
import asyncio
import logging
import uuid
import csv
import io
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
from public_questions import PUBLIC_HEADERS, publish_drafts_safely
from public_questions import repair_published_rows, revoke_public_rows
from instance_lock import AlreadyRunningError, acquire_instance_lock, release_instance_lock

from history_classification import MANAGEMENT_HEADERS, validate as validate_classification
from history_data import validate_table
from history_environment import active_profile, require_approved, ApprovalRequiredError

SHEET_HEADERS = MANAGEMENT_HEADERS.copy()
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
# Serialize complete read/write workflows, including private-source updates.
_SHEET_MUTATION_LOCK = asyncio.Lock()


def sheets_client():
    credential_file = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE", "service-account.json")
    credentials = Credentials.from_service_account_file(credential_file, scopes=SCOPES)
    return build("sheets", "v4", credentials=credentials, cache_discovery=False).spreadsheets()


def sheet_config() -> tuple[str, str]:
    profile=active_profile()
    if profile:return profile['management_spreadsheet_id'],profile['management_sheet_name']
    spreadsheet_id = os.environ.get("GOOGLE_SHEETS_SPREADSHEET_ID")
    if not spreadsheet_id:
        raise RuntimeError("GOOGLE_SHEETS_SPREADSHEET_ID が設定されていません。")
    title = os.environ.get("HISTORY_SHEET_NAME", "history_questions")
    return spreadsheet_id, title


def public_sheet_config() -> tuple[str, str]:
    profile=active_profile()
    if profile:return profile['public_spreadsheet_id'],profile['public_sheet_name']
    spreadsheet_id = os.environ.get("PUBLIC_QUESTIONS_SPREADSHEET_ID", "").strip()
    title = os.environ.get("PUBLIC_QUESTIONS_SHEET_NAME", "history_questions").strip()
    if not spreadsheet_id or not title:
        raise RuntimeError("公開専用スプレッドシートの設定が必要です。")
    if spreadsheet_id == os.environ.get("GOOGLE_SHEETS_SPREADSHEET_ID", "").strip():
        raise RuntimeError("公開先と管理用には別のスプレッドシートを指定してください。")
    return spreadsheet_id, title


def read_public_rows():
    spreadsheet_id, title = public_sheet_config()
    result = sheets_client().values().get(
        spreadsheetId=spreadsheet_id, range="'"+title.replace("'","''")+"'"
    ).execute()
    values = result.get("values", [])
    try:
        profile=active_profile()
        return validate_table(values,id_prefix=profile['id_prefix'] if profile else None)
    except ValueError as error:
        raise RuntimeError('公開シート全使用範囲のヘッダ・データが不正です。書込みを停止します。') from error


def append_public_rows(rows: list[dict[str, str]]) -> None:
    profile=active_profile()
    validate_table([PUBLIC_HEADERS]+[[row[k]for k in PUBLIC_HEADERS]for row in rows],id_prefix=profile['id_prefix']if profile else None)
    require_approved(rows,profile)
    read_public_rows()  # Fail before every write on legacy/mixed headers.
    spreadsheet_id, title = public_sheet_config()
    values = [[row[key] for key in PUBLIC_HEADERS] for row in rows]
    sheets_client().values().append(
        spreadsheetId=spreadsheet_id, range=f"'{title}'!A:M", valueInputOption="RAW",
        insertDataOption="INSERT_ROWS", body={"values": values},
    ).execute()


def clear_public_rows(row_numbers: list[int]) -> None:
    if not row_numbers:
        return
    read_public_rows()
    spreadsheet_id, title = public_sheet_config()
    sheets_client().values().batchClear(
        spreadsheetId=spreadsheet_id,
        body={"ranges": [f"'{title}'!A{number}:M{number}" for number in row_numbers]},
    ).execute()


def read_rows():
    spreadsheet_id, title = sheet_config()
    result = sheets_client().values().get(spreadsheetId=spreadsheet_id, range="'"+title.replace("'","''")+"'").execute()
    values = result.get("values", [])
    try:
        profile=active_profile()
        return validate_table(values,True,profile['id_prefix'] if profile else None)
    except ValueError as error:
        raise RuntimeError('管理シート全使用範囲のヘッダ・データが不正です。書込みを停止します。') from error


def append_batch(rows: list[dict[str, str]], batch_id: str | None = None) -> str:
    existing = read_rows()
    profile=active_profile()
    validate_table([PUBLIC_HEADERS]+[[row[k] for k in PUBLIC_HEADERS]for row in rows],id_prefix=profile['id_prefix'] if profile else None)
    if profile:
        public_ids={r['id']for r in read_public_rows() if r['id']}
        if any(row['id'] in public_ids for row in rows):raise CsvValidationError('公開先に既存の問題IDがあります。照合してから再登録してください。')
    known_ids = {row["id"] for row in existing}
    collisions = sorted({row["id"] for row in rows} & known_ids)
    if collisions:
        raise CsvValidationError("シート内に既存の問題IDがあります: " + ", ".join(collisions[:20]))
    batch_id = batch_id or uuid.uuid4().hex[:12]
    created_at = datetime.now(timezone.utc).isoformat()
    planned_rows = [{**row, "status": "draft", "batch_id": batch_id, "created_at": created_at} for row in rows]
    spreadsheet_id, title = sheet_config()

    def append_rows(target_rows):
        read_rows()
        values = [[row[key] for key in SHEET_HEADERS] for row in target_rows]
        sheets_client().values().append(
            spreadsheetId=spreadsheet_id, range=f"'{title}'!A:P", valueInputOption="RAW",
            insertDataOption="INSERT_ROWS", body={"values": values},
        ).execute()

    register_with_reconciliation(planned_rows, read_rows, append_rows)
    return batch_id


def update_status(row_numbers: list[int], status: str) -> None:
    read_rows()
    spreadsheet_id, title = sheet_config()
    requests = [{"range": f"'{title}'!J{number}:J{number}", "values": [[status]]} for number in row_numbers]
    sheets_client().values().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={"valueInputOption": "RAW", "data": requests},
    ).execute()


def allowed_user(interaction: discord.Interaction) -> bool:
    admins = {value.strip() for value in os.environ.get("ADMIN_USER_IDS", "").split(",") if value.strip()}
    return str(interaction.user.id) in admins


async def defer_interaction(interaction: discord.Interaction) -> bool:
    """Acknowledge promptly; stop safely if Discord says the interaction expired."""
    if interaction.response.is_done():
        return True
    try:
        await interaction.response.defer(ephemeral=True)
        return True
    except discord.NotFound:
        logging.getLogger("history_bot.interactions").warning(
            "Interaction expired before defer; command processing was skipped."
        )
        return False


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
    message = "処理に失敗しました。Botのログを確認してください。"
    await interaction.followup.send(with_audit_warning(message, take_audit_warning(interaction)), ephemeral=True)


async def report_reconciliation_error(interaction: discord.Interaction, batch_id: str | None = None) -> None:
    target = f"対象batch_id: `{batch_id}`。" if batch_id else ""
    message = f"スプレッドシートの状態を確認できず、安全のため処理を中止しました。{target}/list と対象シートを確認してください。"
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
    if not await defer_interaction(interaction):
        return
    async with _SHEET_MUTATION_LOCK:
        if not allowed_user(interaction):
            await interaction.followup.send("この操作を行う権限がありません。", ephemeral=True)
            await audit(interaction, "csv_import", False)
            await audit(interaction, "operation_failure", False)
            return
        rows = []
        batch_id = None
        try:
            if not file.filename.lower().endswith(".csv") or file.size > 1_000_000:
                raise CsvValidationError("CSVファイル（1MB以下）を添付してください。")
            csv_bytes = await file.read()
            if active_profile() and next(csv.reader(io.StringIO(csv_bytes.decode('utf-8-sig'),newline='')),None)!=HEADERS:
                raise CsvValidationError('新環境には正確な13列CSVだけを取り込めます。旧CSVは候補変換ツールでレビューしてください。')
            classification_warnings = []
            rows = await asyncio.to_thread(parse_csv, csv_bytes, classification_warnings)
            question_ids = [row["id"] for row in rows]
            batch_id = uuid.uuid4().hex[:12]
            await audit(interaction, "csv_import", True, batch_id, question_ids)
            await asyncio.to_thread(append_batch, rows, batch_id)
            await audit(interaction, "draft_register", True, batch_id, question_ids)
            warning_text = '\n'.join(classification_warnings[:20])
            await interaction.followup.send(f"{len(rows)}問をdraft登録しました。batch_id: `{batch_id}`\n{warning_text}", ephemeral=True)
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
    if not await defer_interaction(interaction):
        return
    if not allowed_user(interaction):
        await interaction.followup.send("権限がありません。", ephemeral=True)
        await audit(interaction, "operation_failure", False)
        return
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
    if not await defer_interaction(interaction):
        return
    if not allowed_user(interaction):
        await interaction.followup.send("権限がありません。", ephemeral=True)
        await audit(interaction, "operation_failure", False, batch_id)
        return
    try:
        rows = [row for row in await asyncio.to_thread(read_rows) if row["batch_id"] == batch_id]
        if not rows:
            await send_pages(interaction, "バッチが見つかりません。")
            return
        chunks, current = [], ""
        for row in rows:
            warnings = validate_classification(row)['warnings']
            item = f"**{escape_discord_text(row['id'])}** [{escape_discord_text(row['status'])}] {escape_discord_text(row['question'])}\n" + "\n".join(f"{i}. {escape_discord_text(row[f'choice{i}'])}" for i in range(1, 5)) + f"\n正答: {escape_discord_text(row['answer'])} / {escape_discord_text(row['explanation'])}\n\n"
            item += '分類: ' + escape_discord_text(' / '.join(row.get(k,'') for k in ['period_codes','century_codes','area_codes','time_ranges'])) + '\n' + '\n'.join(warnings) + '\n'
            current += item
        await send_pages(interaction, f"{len(rows)}問\n{current}")
    except Exception:
        await audit(interaction, "operation_failure", False, batch_id)
        await report_operation_error(interaction)


@bot.tree.command(name="publish", description="draftのバッチを公開します")
@app_commands.describe(batch_id="公開するバッチID")
async def publish_batch(interaction: discord.Interaction, batch_id: str):
    if not await defer_interaction(interaction):
        return
    async with _SHEET_MUTATION_LOCK:
        if not allowed_user(interaction):
            await interaction.followup.send("権限がありません。", ephemeral=True)
            await audit(interaction, "operation_failure", False, batch_id)
            return
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
            await asyncio.to_thread(require_approved,draft_rows,active_profile())
            await asyncio.to_thread(
                publish_drafts_safely,
                draft_rows,
                read_public_rows,
                append_public_rows,
                lambda: update_status_with_reconciliation(
                    [row["id"] for row in draft_rows], targets, batch_id, "published", "draft",
                    read_rows, lambda row_numbers: update_status(row_numbers, "published"),
                ),
            )
            await audit(interaction, "publish", True, batch_id, [row["id"] for _, row in selected if row["status"] == "draft"])
            await send_pages(interaction, f"{len(targets)}問を公開しました。")
        except ApprovalRequiredError:
            await audit_failure(interaction,'publish',batch_id,question_ids)
            await send_pages(interaction,'未承認、内容変更、または承認記録の不備があるため公開を中止しました。レビューを確認してください。')
        except ReconciliationError:
            await audit_failure(interaction, "publish", batch_id, question_ids)
            await report_reconciliation_error(interaction, batch_id)
        except Exception:
            await audit_failure(interaction, "publish", batch_id, question_ids)
            await report_operation_error(interaction)


@bot.tree.command(name="repair-publish", description="published済み問題を公開先へ安全に補完します")
@app_commands.describe(batch_id="補完するbatch_id")
async def repair_publish_batch(interaction: discord.Interaction, batch_id: str):
    if not await defer_interaction(interaction):
        return
    async with _SHEET_MUTATION_LOCK:
        if not allowed_user(interaction):
            await interaction.followup.send("権限がありません。", ephemeral=True)
            await audit(interaction, "operation_failure", False, batch_id)
            return
        question_ids: list[str] = []
        try:
            all_rows = await asyncio.to_thread(read_rows)
            published_rows = [
                row for row in all_rows
                if row["batch_id"] == batch_id and row["status"] == "published"
            ]
            question_ids = [row["id"] for row in published_rows]
            if not published_rows:
                await audit_failure(interaction, "publication_repair", batch_id)
                await send_pages(interaction, "指定batchに補完対象のpublished問題がありません。")
                return
            await asyncio.to_thread(require_approved,published_rows,active_profile())
            count = await asyncio.to_thread(
                repair_published_rows, published_rows, read_public_rows, append_public_rows
            )
            await audit(interaction, "publication_repair", True, batch_id, question_ids)
            await send_pages(interaction, f"公開先で{count}問を確認・補完しました。管理用statusは変更していません。")
        except ApprovalRequiredError:
            await audit_failure(interaction,'publication_repair',batch_id,question_ids)
            await send_pages(interaction,'承認記録と現在の問題内容が一致しないため、公開先の補完を中止しました。')
        except ReconciliationError:
            await audit_failure(interaction, "publication_repair", batch_id, question_ids)
            await report_reconciliation_error(interaction, batch_id)
        except Exception:
            logging.getLogger("history_bot").exception(
                "Unexpected exception during /repair-publish (batch_id=%s)", batch_id
            )
            await audit_failure(interaction, "publication_repair", batch_id, question_ids)
            await report_operation_error(interaction)


@bot.tree.command(name="delete", description="問題またはバッチを削除します")
@app_commands.describe(batch_id="削除するバッチID", question_id="削除する問題ID", confirm="公開済み問題を含む場合は確認にチェック")
async def delete_batch(interaction: discord.Interaction, batch_id: str | None = None, question_id: str | None = None, confirm: bool = False):
    if not await defer_interaction(interaction):
        return
    async with _SHEET_MUTATION_LOCK:
        if not allowed_user(interaction):
            await interaction.followup.send("権限がありません。", ephemeral=True)
            await audit(interaction, "operation_failure", False, batch_id, [question_id] if question_id else None)
            return
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

            # Include drafts too: a previously interrupted publish may have copied them.
            await asyncio.to_thread(revoke_public_rows, selected_ids, read_public_rows, clear_public_rows)

            def delete_rows(row_numbers):
                read_rows()
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
    load_dotenv(Path(__file__).with_name(".env"))
    token = os.environ.get("DISCORD_BOT_TOKEN")
    if not token:
        raise SystemExit("DISCORD_BOT_TOKEN を bot/.env に設定してください。")
    lock_path = Path(__file__).with_name("history_bot.lock")
    try:
        instance_lock = acquire_instance_lock(lock_path)
    except AlreadyRunningError:
        raise SystemExit("別のHistory Botプロセスが起動中です。既存プロセスを確認してください。") from None
    try:
        bot.run(token)
    finally:
        release_instance_lock(instance_lock)
