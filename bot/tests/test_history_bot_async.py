import asyncio
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch


BOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BOT_DIR))

import history_bot  # noqa: E402


class _User:
    id = 123


class _Interaction:
    user = _User()


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


if __name__ == "__main__":
    unittest.main()
