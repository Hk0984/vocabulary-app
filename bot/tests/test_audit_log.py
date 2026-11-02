import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from audit_log import AUDIT_RETENTION_DAYS, MAX_AUDIT_BYTES, record_operation, with_audit_warning
from datetime import datetime, timedelta, timezone


class AuditLogTests(unittest.TestCase):
    def test_prunes_records_older_than_retention(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audit.jsonl"
            old = datetime.now(timezone.utc) - timedelta(days=AUDIT_RETENTION_DAYS + 1)
            record_operation(path, user_id=1, action="csv_import", success=True, now=old)
            record_operation(path, user_id=2, action="publish", success=True)
            events = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual([item["discord_user_id"] for item in events], ["2"])

    def test_caps_log_size_and_keeps_new_record(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audit.jsonl"
            for index in range(3):
                record_operation(path, user_id=index, action="csv_import", success=True,
                                 question_ids=["x" * 4000] * 1000)
            self.assertLessEqual(path.stat().st_size, MAX_AUDIT_BYTES)
            events = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(events[-1]["discord_user_id"], "2")

    def test_warning_is_added_when_audit_write_fails(self):
        message = with_audit_warning("operation completed", False)
        self.assertIn("Audit log write failed", message)
        self.assertEqual(with_audit_warning("operation completed", True), "operation completed")

    def test_records_required_metadata_without_payload_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audit.jsonl"
            record_operation(path, user_id=1234, action="draft_register", success=True, batch_id="batch-1", question_ids=["q1"])
            event = json.loads(path.read_text(encoding="utf-8").strip())
            self.assertEqual(event["discord_user_id"], "1234")
            self.assertEqual(event["action"], "draft_register")
            self.assertEqual(event["batch_id"], "batch-1")
            self.assertEqual(event["question_ids"], ["q1"])
            self.assertIsInstance(event["success"], bool)
            self.assertIn("timestamp", event)
            self.assertNotIn("question", event)
            self.assertNotIn("token", event)

    def test_rejects_unknown_event_types(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                record_operation(Path(directory) / "audit.jsonl", user_id=1, action="secret", success=False)

    def test_records_failure_and_deletion_actions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audit.jsonl"
            record_operation(path, user_id="7", action="question_delete", success=True, batch_id="b2", question_ids=["q9"])
            record_operation(path, user_id="7", action="operation_failure", success=False, batch_id="b2")
            events = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual([event["action"] for event in events], ["question_delete", "operation_failure"])
            self.assertEqual([event["success"] for event in events], [True, False])

    def test_records_publication_repair_action(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audit.jsonl"
            record_operation(path, user_id=9, action="publication_repair", success=True,
                             batch_id="b-repair", question_ids=["q1"])
            event = json.loads(path.read_text(encoding="utf-8").strip())
            self.assertEqual(event["action"], "publication_repair")
            self.assertTrue(event["success"])


if __name__ == "__main__":
    unittest.main()
