import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import history_bot


class HistoryAuditTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_audit_write_sets_one_shot_user_notice(self):
        interaction = SimpleNamespace(user=SimpleNamespace(id=123))
        with patch.object(history_bot, "record_operation", side_effect=OSError("private detail")):
            self.assertFalse(await history_bot.audit(interaction, "publish", False))
        self.assertFalse(history_bot.take_audit_warning(interaction))
        self.assertTrue(history_bot.take_audit_warning(interaction))


if __name__ == "__main__":
    unittest.main()
