"""Standard-library-only CSV validation for history question imports."""

from __future__ import annotations

import csv
import io

HEADERS = ["id", "source_id", "question", "choice1", "choice2", "choice3", "choice4", "answer", "explanation"]
MAX_CELL_LENGTHS = {
    "id": 128,
    "source_id": 128,
    "question": 4000,
    "choice1": 1000,
    "choice2": 1000,
    "choice3": 1000,
    "choice4": 1000,
    "answer": 1,
    "explanation": 10000,
}


class CsvValidationError(ValueError):
    pass


def parse_csv(data: bytes) -> list[dict[str, str]]:
    try:
        text = data.decode("utf-8-sig", errors="strict")
        reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
        if reader.fieldnames != HEADERS:
            raise CsvValidationError("CSVの列名または列順が仕様と一致しません。")
        rows = list(reader)
    except (UnicodeDecodeError, csv.Error) as exc:
        raise CsvValidationError("UTF-8 CSVとして読み込めません。") from exc
    if not rows:
        raise CsvValidationError("CSVに問題がありません。")

    seen: set[str] = set()
    validated = []
    for line, row in enumerate(rows, start=2):
        if None in row or any(value is None for value in row.values()):
            raise CsvValidationError(f"{line}行目: 列数が不正です。")
        row = {key: value.strip() for key, value in row.items()}
        for key in HEADERS:
            if not row[key] and key != "explanation":
                raise CsvValidationError(f"{line}行目: {key} が空欄です。")
            if len(row[key]) > MAX_CELL_LENGTHS[key]:
                raise CsvValidationError(f"{line}行目: {key} は最大{MAX_CELL_LENGTHS[key]}文字です。")
        if row["answer"] not in {"1", "2", "3", "4"}:
            raise CsvValidationError(f"{line}行目: answer は1〜4で指定してください。")
        if len({row[f"choice{i}"] for i in range(1, 5)}) != 4:
            raise CsvValidationError(f"{line}行目: 選択肢はすべて異なる必要があります。")
        if row["id"] in seen:
            raise CsvValidationError(f"{line}行目: CSV内で問題ID {row['id']} が重複しています。")
        seen.add(row["id"])
        validated.append(row)
    return validated
