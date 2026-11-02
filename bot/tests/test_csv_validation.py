import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from csv_validation import CsvValidationError, HEADERS, MAX_CELL_LENGTHS, parse_csv


def csv_bytes(rows, bom=False):
    import csv
    import io
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\r\n")
    writer.writerow(HEADERS)
    writer.writerows(rows)
    return ("\ufeff" if bom else "").encode() + stream.getvalue().encode()


class CsvValidationTests(unittest.TestCase):
    def setUp(self):
        self.row = ["q1", "s1", "question, with comma\nand newline", "a", "b", "c", "d", "2", "why"]

    def test_utf8_bom_and_quoted_newlines(self):
        result = parse_csv(csv_bytes([self.row], bom=True))
        self.assertEqual(result[0]["question"], self.row[2])

    def test_utf8_without_bom(self):
        row = self.row.copy()
        row[2] = "日本史の問題"
        self.assertEqual(parse_csv(csv_bytes([row]))[0]["question"], row[2])

    def test_wrong_column_order_rejected(self):
        data = csv_bytes([self.row]).replace(b"id,source_id", b"source_id,id")
        with self.assertRaises(CsvValidationError):
            parse_csv(data)

    def test_duplicate_ids_rejected(self):
        with self.assertRaisesRegex(CsvValidationError, "重複"):
            parse_csv(csv_bytes([self.row, self.row]))

    def test_invalid_answer_rejected(self):
        row = self.row.copy()
        row[7] = "5"
        with self.assertRaisesRegex(CsvValidationError, "1〜4"):
            parse_csv(csv_bytes([row]))

    def test_empty_required_value_rejected(self):
        for index in range(8):
            with self.subTest(column=index):
                row = self.row.copy()
                row[index] = ""
                with self.assertRaisesRegex(CsvValidationError, "空欄"):
                    parse_csv(csv_bytes([row]))

    def test_missing_choice_rejected(self):
        row = self.row.copy()
        row[5] = ""
        with self.assertRaisesRegex(CsvValidationError, "choice3.*空欄"):
            parse_csv(csv_bytes([row]))

    def test_empty_file_and_header_only_rejected(self):
        with self.assertRaises(CsvValidationError):
            parse_csv(b"")
        with self.assertRaises(CsvValidationError):
            parse_csv((",".join(HEADERS) + "\n").encode())

    def test_short_and_extra_rows_rejected(self):
        short = csv_bytes([self.row]).replace(b"q1,s1,", b"q1,")
        extra = csv_bytes([self.row]).replace(b",why\r\n", b",why,unexpected\r\n")
        for data in (short, extra):
            with self.subTest(data=data):
                with self.assertRaisesRegex(CsvValidationError, "列数"):
                    parse_csv(data)

    def test_invalid_utf8_and_malformed_quoting_rejected(self):
        with self.assertRaisesRegex(CsvValidationError, "UTF-8"):
            parse_csv(b"\xff\xfe")
        malformed = (",".join(HEADERS) + '\nq1,s1,"unterminated,a,b,c,d,1,why').encode()
        with self.assertRaisesRegex(CsvValidationError, "UTF-8"):
            parse_csv(malformed)

    def test_duplicate_choices_rejected(self):
        row = self.row.copy()
        row[4] = row[3]
        with self.assertRaisesRegex(CsvValidationError, "選択肢"):
            parse_csv(csv_bytes([row]))

    def test_cell_length_limits_accept_boundary_and_reject_overflow(self):
        row = self.row.copy()
        row[0] = "x" * MAX_CELL_LENGTHS["id"]
        self.assertEqual(parse_csv(csv_bytes([row]))[0]["id"], row[0])
        row[0] += "x"
        with self.assertRaisesRegex(CsvValidationError, "id は最大128文字"):
            parse_csv(csv_bytes([row]))

        row = self.row.copy()
        row[2] = "問" * (MAX_CELL_LENGTHS["question"] + 1)
        with self.assertRaisesRegex(CsvValidationError, "question は最大4000文字"):
            parse_csv(csv_bytes([row]))


if __name__ == "__main__":
    unittest.main()
