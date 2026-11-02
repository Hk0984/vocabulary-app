import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from public_questions import revoke_public_rows, make_public_rows
from sheets_write import ReconciliationError
import history_bot
from csv_validation import parse_csv, HEADERS


class PublicRevocationTests(unittest.TestCase):
    def test_mutations_wait_until_private_delete_finishes_but_acknowledge_immediately(self):
        async def exercise():
            events = []
            private_started = asyncio.Event()
            allow_private_finish = asyncio.Event()
            row = {"id": "q1", "batch_id": "b", "status": "published"}

            async def fake_thread(function, *args):
                if function is history_bot.delete_with_reconciliation:
                    private_started.set()
                    await allow_private_finish.wait()
                    events.append("private-deleted")
                else:
                    return function(*args)

            with patch.multiple(history_bot,
                _SHEET_MUTATION_LOCK=asyncio.Lock(),
                defer_interaction=AsyncMock(return_value=True), allowed_user=Mock(return_value=True),
                sheet_config=Mock(return_value=("private", "history_questions")), read_rows=Mock(return_value=[row]),
                _sheet_id=Mock(return_value=1), revoke_public_rows=Mock(side_effect=lambda *args: events.append("public-cleared")),
                repair_published_rows=Mock(side_effect=lambda *args: events.append("repair") or 1),
                audit=AsyncMock(), audit_failure=AsyncMock(), send_pages=AsyncMock()), patch.object(
                    history_bot.asyncio, 'to_thread', side_effect=fake_thread):
                deletion = asyncio.create_task(history_bot.delete_batch.callback(object(), "b", None, True))
                await private_started.wait()
                repair = asyncio.create_task(history_bot.repair_publish_batch.callback(object(), "b"))
                await asyncio.sleep(0)
                self.assertEqual(history_bot.defer_interaction.await_count, 2)
                self.assertEqual(events, ["public-cleared"])
                allow_private_finish.set()
                await asyncio.gather(deletion, repair)
                self.assertEqual(events, ["public-cleared", "private-deleted", "repair"])

        asyncio.run(asyncio.wait_for(exercise(), timeout=2))

    def test_import_allows_empty_explanation_and_public_sheet_cannot_be_private(self):
        data = (','.join(HEADERS) + '\nq,source,Q,A,B,C,D,1,\n').encode()
        self.assertEqual(parse_csv(data)[0]['explanation'], '')
        with patch.dict(history_bot.os.environ, {
            'GOOGLE_SHEETS_SPREADSHEET_ID': 'same-sheet',
            'PUBLIC_QUESTIONS_SPREADSHEET_ID': 'same-sheet',
            'PUBLIC_QUESTIONS_SHEET_NAME': 'history_questions',
        }):
            with self.assertRaises(RuntimeError):
                history_bot.public_sheet_config()

    def test_preserves_blank_row_positions_and_other_questions(self):
        rows = [{}, {"id": "q1"}, {"id": "q2"}]
        cleared = []

        def clear(numbers):
            cleared.extend(numbers)
            for number in numbers:
                rows[number - 2] = {}

        revoke_public_rows(["q1"], lambda: rows, clear)
        self.assertEqual(cleared, [3])
        self.assertEqual(rows[2]["id"], "q2")
        revoke_public_rows(["q1"], lambda: rows, clear)
        self.assertEqual(cleared, [3])

    def test_timeout_after_clear_reads_back_without_repeat(self):
        rows = [{"id": "q1"}]
        calls = []

        def clear(numbers):
            calls.append(numbers)
            rows.clear()
            raise TimeoutError()

        revoke_public_rows(["q1"], lambda: rows, clear)
        self.assertEqual(calls, [[2]])

    def test_unconfirmed_or_duplicate_public_rows_stop(self):
        with self.assertRaises(ReconciliationError):
            revoke_public_rows(["q1"], lambda: [{"id": "q1"}], lambda numbers: None)
        clear = Mock()
        with self.assertRaises(ReconciliationError):
            revoke_public_rows(["q1"], lambda: [{"id": "q1"}, {"id": "q1"}], clear)
        clear.assert_not_called()

    def test_empty_explanation_can_be_published_but_published_and_deleted_cannot_be_drafts(self):
        row = dict(id="q", source_id="source", question="Q", choice1="A", choice2="B",
                   choice3="C", choice4="D", answer="1", explanation="", status="draft")
        self.assertEqual(make_public_rows([row])[0]["explanation"], "")
        for status in ["published", "deleted"]:
            with self.assertRaises(ReconciliationError):
                make_public_rows([{**row, "status": status}])

    def test_command_revokes_public_before_private_delete_and_stops_on_failure(self):
        events = []
        row = {"id": "q1", "batch_id": "b", "status": "published"}
        for failure in [None, ReconciliationError("not confirmed"), TimeoutError(), RuntimeError("permission denied")]:
            events.clear()

            def revoke(*args):
                events.append("public")
                if failure:
                    raise failure

            with patch.multiple(history_bot,
                defer_interaction=AsyncMock(return_value=True), allowed_user=Mock(return_value=True),
                sheet_config=Mock(return_value=("private", "history_questions")), read_rows=Mock(return_value=[row]),
                _sheet_id=Mock(return_value=1), revoke_public_rows=Mock(side_effect=revoke),
                delete_with_reconciliation=Mock(side_effect=lambda *args: events.append("private")),
                audit=AsyncMock(), audit_failure=AsyncMock(), send_pages=AsyncMock(),
                report_reconciliation_error=AsyncMock(), report_operation_error=AsyncMock()):
                asyncio.run(history_bot.delete_batch.callback(object(), "b", None, True))
            self.assertEqual(events, ["public"] if failure else ["public", "private"])
