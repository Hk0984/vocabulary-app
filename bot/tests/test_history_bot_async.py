import asyncio
import sys
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch


BOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BOT_DIR))

import history_bot  # noqa: E402


class _User:
    id = 123


class _Interaction:
    user = _User()


class _Response:
    def __init__(self, done=False, error=None):
        self.done = done
        self.error = error
        self.defer = AsyncMock(side_effect=self._defer)

    def is_done(self):
        return self.done

    async def _defer(self, **kwargs):
        if self.error:
            raise self.error
        self.done = True


class HistoryBotAsyncTests(unittest.TestCase):
    def test_audit_io_runs_off_event_loop_thread(self):
        main_thread = threading.get_ident()
        worker_finished = threading.Event()
        worker_thread = []

        def slow_record_operation(*args, **kwargs):
            worker_thread.append(threading.get_ident())
            time.sleep(0.05)
            worker_finished.set()

        async def exercise():
            audit_task = asyncio.create_task(
                history_bot.audit(_Interaction(), "operation_failure", False)
            )
            await asyncio.sleep(0)
            self.assertFalse(worker_finished.is_set())
            await audit_task

        with patch.object(history_bot, "record_operation", slow_record_operation), patch.object(
            history_bot, "audit_path", return_value=Path("unused-audit.jsonl")
        ):
            asyncio.run(exercise())

        self.assertTrue(worker_finished.is_set())
        self.assertEqual(len(worker_thread), 1)
        self.assertNotEqual(worker_thread[0], main_thread)

    def test_defer_is_ephemeral_and_skips_duplicate_initial_response(self):
        async def exercise():
            response = _Response()
            interaction = SimpleNamespace(response=response)
            self.assertTrue(await history_bot.defer_interaction(interaction))
            response.defer.assert_awaited_once_with(ephemeral=True)

            already_done = _Response(done=True)
            self.assertTrue(await history_bot.defer_interaction(SimpleNamespace(response=already_done)))
            already_done.defer.assert_not_awaited()

        asyncio.run(exercise())

    def test_expired_interaction_stops_command_acknowledgement(self):
        error = history_bot.discord.NotFound(
            SimpleNamespace(status=404, reason="Not Found"),
            {"code": 10062, "message": "Unknown interaction"},
        )

        async def exercise():
            response = _Response(error=error)
            self.assertFalse(await history_bot.defer_interaction(SimpleNamespace(response=response)))
            response.defer.assert_awaited_once_with(ephemeral=True)

        asyncio.run(exercise())

    def test_commands_stop_before_work_when_defer_cannot_be_sent(self):
        async def exercise():
            calls = [
                (history_bot.import_csv, (_Interaction(), None)),
                (history_bot.list_batches, (_Interaction(),)),
                (history_bot.check_batch, (_Interaction(), "batch-1")),
                (history_bot.publish_batch, (_Interaction(), "batch-1")),
                (history_bot.delete_batch, (_Interaction(), "batch-1", None, False)),
            ]
            with patch.object(history_bot, "defer_interaction", new=AsyncMock(return_value=False)) as defer:
                for command, args in calls:
                    await command.callback(*args)
                self.assertEqual(defer.await_count, len(calls))

        asyncio.run(exercise())

    def test_error_responses_are_clear_and_do_not_expose_exception_details(self):
        async def exercise():
            interaction = SimpleNamespace(followup=SimpleNamespace(send=AsyncMock()))
            await history_bot.report_operation_error(interaction)
            message = interaction.followup.send.await_args.args[0]
            self.assertIn("処理に失敗しました", message)
            self.assertNotIn("?", message)

            interaction.followup.send.reset_mock()
            await history_bot.report_reconciliation_error(interaction, "batch-1")
            message = interaction.followup.send.await_args.args[0]
            self.assertIn("状態を確認できず", message)
            self.assertIn("batch-1", message)
            self.assertNotIn("?", message)

        asyncio.run(exercise())

    def test_repair_unexpected_error_is_logged_but_not_sent_to_discord(self):
        interaction = SimpleNamespace(
            user=_User(),
            followup=SimpleNamespace(send=AsyncMock()),
        )
        row = {"id": "q1", "batch_id": "batch-1", "status": "published"}
        logger = Mock()

        async def exercise():
            with patch.object(history_bot, "defer_interaction", new=AsyncMock(return_value=True)), patch.object(
                history_bot, "allowed_user", return_value=True
            ), patch.object(history_bot, "read_rows", return_value=[row]), patch.object(
                history_bot, "repair_published_rows", side_effect=RuntimeError("internal diagnostic detail")
            ), patch.object(history_bot, "audit_failure", new=AsyncMock()), patch.object(
                history_bot.logging, "getLogger", return_value=logger
            ):
                await history_bot.repair_publish_batch.callback(interaction, "batch-1")

        asyncio.run(exercise())
        logger.exception.assert_called_once_with(
            "Unexpected exception during /repair-publish (batch_id=%s)", "batch-1"
        )
        sent = interaction.followup.send.await_args.args[0]
        self.assertIn("処理に失敗しました", sent)
        self.assertNotIn("internal diagnostic detail", sent)


if __name__ == "__main__":
    unittest.main()
