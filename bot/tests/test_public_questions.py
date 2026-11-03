import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from public_questions import PUBLIC_HEADERS, publish_drafts_safely, repair_published_rows
from sheets_write import ReconciliationError


def source_row(question_id="q1"):
    return {
        "id": question_id, "source_id": "term-1", "question": "問題文",
        "choice1": "選択肢1", "choice2": "選択肢2", "choice3": "選択肢3", "choice4": "選択肢4",
        "answer": "2", "explanation": "解説", "status": "draft", "batch_id": "b1",
        "created_at": "2026-01-01T00:00:00Z",
        "period_codes": "unclassified", "century_codes": "", "area_codes": "unclassified", "time_ranges": "",
    }


class PublicQuestionsTests(unittest.TestCase):
    def setUp(self):
        self.rows = []
        self.appended = []
        self.status_updates = []
        self.read_calls = 0

    def read(self):
        self.read_calls += 1
        return list(self.rows)

    def append(self, rows):
        self.appended.append([row["id"] for row in rows])
        self.rows.extend(rows)

    def mark_published(self):
        self.status_updates.append(True)

    def publish(self, source):
        return publish_drafts_safely(source, self.read, self.append, self.mark_published)

    def test_transfers_only_thirteen_columns_then_updates_source(self):
        self.assertEqual(self.publish([source_row()]), 1)
        self.assertEqual(list(self.rows[0]), PUBLIC_HEADERS)
        self.assertEqual(self.appended, [["q1"]])
        self.assertEqual(self.status_updates, [True])
        self.assertEqual(self.read_calls, 2)

    def test_existing_identical_question_is_idempotent(self):
        row = {key: source_row()[key] for key in PUBLIC_HEADERS}
        self.rows.append(row)
        self.publish([source_row()])
        self.assertEqual(self.appended, [])
        self.assertEqual(self.status_updates, [True])

    def test_mismatched_existing_id_stops_before_source_update(self):
        row = {key: source_row()[key] for key in PUBLIC_HEADERS}
        row["question"] = "別の内容"
        self.rows.append(row)
        with self.assertRaises(ReconciliationError):
            self.publish([source_row()])
        self.assertEqual(self.status_updates, [])

    def test_invalid_answer_stops_before_any_write(self):
        invalid = source_row()
        invalid["answer"] = "5"
        with self.assertRaises(ReconciliationError):
            self.publish([invalid])
        self.assertEqual(self.appended, [])
        self.assertEqual(self.status_updates, [])

    def test_failed_public_write_keeps_source_draft(self):
        def fail(_rows):
            raise RuntimeError("write failed")
        with self.assertRaises(RuntimeError):
            publish_drafts_safely([source_row()], self.read, fail, self.mark_published)
        self.assertEqual(self.status_updates, [])

    def test_success_response_without_readback_content_keeps_source_draft(self):
        with self.assertRaises(ReconciliationError):
            publish_drafts_safely([source_row()], self.read, lambda _rows: None, self.mark_published)
        self.assertEqual(self.status_updates, [])

    def test_ambiguous_write_is_read_back_before_retry(self):
        calls = []

        def timeout_after_commit(rows):
            calls.append([row["id"] for row in rows])
            self.rows.extend(rows)
            raise TimeoutError("timeout")

        self.publish = lambda source: publish_drafts_safely(source, self.read, timeout_after_commit, self.mark_published)
        self.publish([source_row()])
        self.assertEqual(calls, [["q1"]])
        self.assertEqual(self.status_updates, [True])

    def test_partial_ambiguous_write_appends_only_missing_id(self):
        calls = []

        def partial_timeout(rows):
            calls.append([row["id"] for row in rows])
            if len(calls) == 1:
                self.rows.append(rows[0])
                raise TimeoutError("partial timeout")
            self.rows.extend(rows)

        source = [source_row("q1"), source_row("q2")]
        publish_drafts_safely(source, self.read, partial_timeout, self.mark_published)
        self.assertEqual(calls, [["q1", "q2"], ["q2"]])
        self.assertEqual([row["id"] for row in self.rows], ["q1", "q2"])
        self.assertEqual(self.status_updates, [True])

    def test_repair_published_missing_row_is_idempotent_and_does_not_change_status(self):
        published = source_row()
        published["status"] = "published"
        self.assertEqual(repair_published_rows([published], self.read, self.append), 1)
        self.assertEqual(self.appended, [["q1"]])
        self.assertEqual(self.read_calls, 2)
        self.assertEqual(repair_published_rows([published], self.read, self.append), 1)
        self.assertEqual(self.appended, [["q1"]])
        self.assertEqual(self.status_updates, [])

    def test_repair_stops_for_same_id_with_different_content(self):
        published = source_row()
        published["status"] = "published"
        existing = {key: published[key] for key in PUBLIC_HEADERS}
        existing["question"] = "different content"
        self.rows.append(existing)
        with self.assertRaises(ReconciliationError):
            repair_published_rows([published], self.read, self.append)
        self.assertEqual(self.appended, [])


if __name__ == "__main__":
    unittest.main()
