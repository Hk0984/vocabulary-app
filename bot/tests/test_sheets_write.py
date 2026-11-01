import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sheets_write import (
    ReconciliationError, delete_with_reconciliation, register_with_reconciliation,
    is_ambiguous_write_error, update_status_with_reconciliation, validate_deletion_statuses,
)


def row(question_id, batch="batch-1"):
    return {
        "id": question_id, "source_id": "source-" + question_id, "question": "Q " + question_id,
        "choice1": "a", "choice2": "b", "choice3": "c", "choice4": "d", "answer": "1",
        "explanation": "reason", "status": "draft", "batch_id": batch, "created_at": "2026-01-01T00:00:00+00:00",
    }


class FakeStore:
    def __init__(self):
        self.rows = []
        self.append_calls = []
        self.commit_count = None
        self.fail_read = False
        self.fail_second_append = False

    def read(self):
        if self.fail_read:
            raise OSError("read failed")
        return list(self.rows)

    def append(self, rows):
        self.append_calls.append([item["id"] for item in rows])
        if len(self.append_calls) == 1 and self.commit_count is not None:
            self.rows.extend(rows[: self.commit_count])
            raise TimeoutError("write timed out")
        if len(self.append_calls) == 2 and self.fail_second_append:
            raise TimeoutError("repair timed out")
        self.rows.extend(rows)


class FakeMutationStore:
    def __init__(self, rows):
        self.rows = list(rows)
        self.calls = []
        self.partial_first = False
        self.fail_read = False

    def read(self):
        if self.fail_read:
            raise OSError("read failed")
        return list(self.rows)

    def set_status(self, row_numbers):
        self.calls.append(list(row_numbers))
        targets = row_numbers[:1] if self.partial_first and len(self.calls) == 1 else row_numbers
        for row_number in targets:
            self.rows[row_number - 2]["status"] = "published"
        if self.partial_first and len(self.calls) == 1:
            raise TimeoutError("partial status update timed out")

    def delete(self, row_numbers):
        self.calls.append(list(row_numbers))
        targets = row_numbers[:1] if self.partial_first and len(self.calls) == 1 else row_numbers
        for row_number in sorted(targets, reverse=True):
            del self.rows[row_number - 2]
        if self.partial_first and len(self.calls) == 1:
            raise TimeoutError("partial deletion timed out")


class SheetsWriteTests(unittest.TestCase):
    def test_delete_accepts_only_known_states(self):
        validate_deletion_statuses([{"status": "draft"}, {"status": "published"}])
        with self.assertRaisesRegex(ReconciliationError, "draft/published以外"):
            validate_deletion_statuses([{"status": "Published"}])
        with self.assertRaises(ReconciliationError):
            validate_deletion_statuses([{}])

    def test_gateway_timeout_is_ambiguous_but_client_error_is_not(self):
        gateway_timeout = RuntimeError()
        gateway_timeout.resp = SimpleNamespace(status=504)
        bad_request = RuntimeError()
        bad_request.resp = SimpleNamespace(status=400)
        self.assertTrue(is_ambiguous_write_error(gateway_timeout))
        self.assertFalse(is_ambiguous_write_error(bad_request))

    def test_timeout_after_full_commit_is_success_without_retry(self):
        store = FakeStore()
        store.commit_count = 2
        expected = [row("q1"), row("q2")]
        register_with_reconciliation(expected, store.read, store.append)
        self.assertEqual(store.append_calls, [["q1", "q2"]])

    def test_partial_commit_appends_only_missing_rows(self):
        store = FakeStore()
        store.commit_count = 1
        expected = [row("q1"), row("q2")]
        register_with_reconciliation(expected, store.read, store.append)
        self.assertEqual(store.append_calls, [["q1", "q2"], ["q2"]])
        self.assertEqual([item["id"] for item in store.rows], ["q1", "q2"])

    def test_no_rows_after_timeout_retries_once(self):
        store = FakeStore()
        store.commit_count = 0
        register_with_reconciliation([row("q1")], store.read, store.append)
        self.assertEqual(store.append_calls, [["q1"], ["q1"]])
        self.assertEqual(len(store.rows), 1)

    def test_failed_read_stops_without_retry(self):
        store = FakeStore()
        store.commit_count = 0
        store.fail_read = True
        with self.assertRaises(ReconciliationError):
            register_with_reconciliation([row("q1")], store.read, store.append)
        self.assertEqual(len(store.append_calls), 1)

    def test_mismatched_content_stops_without_retry(self):
        store = FakeStore()
        wrong = row("q1")
        wrong["question"] = "different"
        store.rows.append(wrong)
        store.commit_count = 0
        with self.assertRaises(ReconciliationError):
            register_with_reconciliation([row("q1")], store.read, store.append)
        self.assertEqual(len(store.append_calls), 1)

    def test_timeout_during_repair_is_reconciled_without_second_repair(self):
        store = FakeStore()
        store.commit_count = 1
        store.fail_second_append = True
        with self.assertRaises(ReconciliationError):
            register_with_reconciliation([row("q1"), row("q2")], store.read, store.append)
        self.assertEqual(store.append_calls, [["q1", "q2"], ["q2"]])

    def test_status_timeout_after_complete_update_is_success(self):
        rows = [row("q1"), row("q2")]
        store = FakeMutationStore(rows)
        store.set_status = self._timeout_after_status_commit(store)
        update_status_with_reconciliation(["q1", "q2"], [2, 3], "batch-1", "published", "draft", store.read, store.set_status)
        self.assertEqual(store.calls, [[2, 3]])
        self.assertEqual([item["status"] for item in store.rows], ["published", "published"])

    def test_partial_status_timeout_updates_only_remaining_row(self):
        store = FakeMutationStore([row("q1"), row("q2")])
        store.partial_first = True
        update_status_with_reconciliation(["q1", "q2"], [2, 3], "batch-1", "published", "draft", store.read, store.set_status)
        self.assertEqual(store.calls, [[2, 3], [3]])
        self.assertEqual([item["status"] for item in store.rows], ["published", "published"])

    def test_status_timeout_with_unreadable_state_stops(self):
        store = FakeMutationStore([row("q1")])
        store.fail_read = True
        store.set_status = self._timeout_without_status_commit(store)
        with self.assertRaises(ReconciliationError):
            update_status_with_reconciliation(["q1"], [2], "batch-1", "published", "draft", store.read, store.set_status)
        self.assertEqual(store.calls, [[2]])

    def test_partial_delete_timeout_deletes_only_remaining_rows(self):
        store = FakeMutationStore([row("q1"), row("q2")])
        store.partial_first = True
        delete_with_reconciliation({"q1": "batch-1", "q2": "batch-1"}, store.read, store.delete)
        self.assertEqual(store.calls, [[2, 3], [2]])
        self.assertEqual(store.rows, [])

    def test_delete_timeout_after_complete_delete_is_success(self):
        store = FakeMutationStore([row("q1")])
        store.delete = self._timeout_after_delete_commit(store)
        delete_with_reconciliation({"q1": "batch-1"}, store.read, store.delete)
        self.assertEqual(store.calls, [[2]])
        self.assertEqual(store.rows, [])

    @staticmethod
    def _timeout_after_status_commit(store):
        def update(row_numbers):
            store.calls.append(list(row_numbers))
            for row_number in row_numbers:
                store.rows[row_number - 2]["status"] = "published"
            raise TimeoutError("committed then timed out")
        return update

    @staticmethod
    def _timeout_without_status_commit(store):
        def update(row_numbers):
            store.calls.append(list(row_numbers))
            raise TimeoutError("timed out before commit")
        return update

    @staticmethod
    def _timeout_after_delete_commit(store):
        def delete(row_numbers):
            store.calls.append(list(row_numbers))
            for row_number in sorted(row_numbers, reverse=True):
                del store.rows[row_number - 2]
            raise TimeoutError("committed then timed out")
        return delete


if __name__ == "__main__":
    unittest.main()
