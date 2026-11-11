"""Independent 23-column flow intake. No network or implicit content corrections."""
import csv
import io
import json
import re
from collections import Counter
from history_classification import validate as classify, parse_ranges, century_range, overlaps

ADMIN_HEADERS = ['id', 'type', 'question'] + [f'item{i}_{field}' for i in range(1, 5) for field in ('id', 'text', 'time_ranges')] + ['answer', 'explanation', 'period_codes', 'century_codes', 'area_codes', 'time_ranges', 'source', 'status']
PUBLIC_HEADERS = ADMIN_HEADERS[:-2]
STATES = {'draft', 'approved', 'published'}
ID = re.compile(r'[A-Za-z][A-Za-z0-9_-]{0,79}\Z')


class FlowError(ValueError):
    pass


def check(condition, field, message):
    if not condition:
        raise FlowError(f'{field}: {message}')


def to_question(row):
    q = {k: row[k] for k in ('id', 'type', 'question', 'explanation', 'period_codes', 'century_codes', 'area_codes', 'time_ranges')}
    items = []
    for i in range(1, 5):
        if row[f'item{i}_id']:
            items.append({'id': row[f'item{i}_id'], 'text': row[f'item{i}_text'], 'time_ranges': row[f'item{i}_time_ranges']})
    q['choices' if row['type'] == 'contemporary' else 'events'] = items
    q['answer'] = row['answer'] if row['type'] == 'contemporary' else row['answer'].split(';')
    # Source is private review metadata and is intentionally not emitted.
    return q


def validate_row(row, management=True):
    headers = ADMIN_HEADERS if management else PUBLIC_HEADERS
    check(set(row) == set(headers), 'headers', '列構成が不正です')
    for key, value in row.items():
        check(isinstance(value, str) and len(value) <= 24000, key, '文字列・長さが不正です')
        check(not any(ord(c) < 32 and c not in '\r\n\t' for c in value), key, '制御文字があります')
        # Signed years are data, never formulas; all writes also use RAW.
        if not key.endswith('time_ranges'):
            check(not value.lstrip().startswith(('=', '+', '-', '@')), key, '式として解釈され得る入力は禁止です')
    check(bool(ID.fullmatch(row['id'])), 'id', '安定IDの構文が不正です')
    check(row['type'] in {'contemporary', 'ordering'}, 'type', '未知の問題形式です')
    for key in ('question', 'explanation'):
        check(bool(row[key].strip()) and len(row[key]) <= 10000, key, '必須・10000文字以内です')
    if management:
        check(row['status'] in STATES, 'status', '未知の管理状態です')
        check(not row['source'] or (bool(row['source'].strip()) and len(row['source']) <= 10000), 'source', '出典が不正です')
    ids, texts = [], []
    import unicodedata
    for i in range(1, 5):
        prefix = f'item{i}_'
        item_id, text, times = [row[prefix+k] for k in ('id', 'text', 'time_ranges')]
        if i == 4 and row['type'] == 'ordering' and not any((item_id, text, times)):
            continue
        check(bool(ID.fullmatch(item_id)), prefix+'id', '項目IDが不正です')
        check(bool(text.strip()) and len(text) <= 10000, prefix+'text', '項目文が不正です')
        try:
            parse_ranges(times)
        except ValueError as e:
            raise FlowError(f'{prefix}time_ranges: {e}') from None
        ids.append(item_id)
        texts.append(unicodedata.normalize('NFKC', text).strip())
    check(len(set(ids)) == len(ids), 'items', '項目IDが重複しています')
    check(len(set(texts)) == len(texts), 'items', '項目文が重複しています')
    answer = row['answer'].split(';')
    if row['type'] == 'contemporary':
        check(len(answer) == 1 and row['answer'] in ids, 'answer', '正解IDが存在しません')
    else:
        check(len(answer) == len(ids) and len(set(answer)) == len(ids) and set(answer) == set(ids), 'answer', '正解順に欠落・重複・未知IDがあります')
    try:
        classify(row)
    except (ValueError, KeyError) as e:
        raise FlowError(f'period_codes/century_codes/area_codes/time_ranges: {e}') from None
    return row


def temporal_issues(row):
    """Metadata checks only. Never infer historical facts from question prose."""
    q = to_question(row)
    items = q.get('choices', q.get('events'))
    ranges = {v['id']: parse_ranges(v['time_ranges']) for v in items}
    if not all(ranges.values()):
        return ['items.time_ranges: 年代情報不足のため年代順・正解一意性は人手確認が必要です']
    if row['type'] == 'ordering':
        ordered = [ranges[k] for k in q['answer']]
        if any(max(b for _, b in a) >= min(c for c, _ in b) for a, b in zip(ordered, ordered[1:])):
            return ['answer/items.time_ranges: 正解順の年代が逆転または重複しています']
    elif '同じ世紀' in row['question'] and row['century_codes']:
        targets = [century_range(c) for c in row['century_codes'].split(';')]
        matching = [key for key, dates in ranges.items() if any(overlaps(a, b) for a in dates for b in targets)]
        if matching != [row['answer']]:
            return ['answer/century_codes/items.time_ranges: 指定世紀と一致する選択肢が正解1件に限定されません']
    else:
        return ['answer/items.time_ranges: 同時代の基準は問題文とともに人手確認が必要です']
    return []


def validate_rows(rows, management=True):
    seen = set()
    for row in rows:
        try:
            validate_row(row, management)
            check(row['id'] not in seen, 'id', '問題IDが重複しています')
            seen.add(row['id'])
        except FlowError as e:
            raise FlowError(f"{row.get('id', '(IDなし)')}: {e}") from None
    return rows


def parse_csv(data, intake=False):
    check(isinstance(data, bytes) and len(data) <= 5*1024*1024, 'csv', '5MiB以内のUTF-8 CSVを指定してください')
    try:
        values = list(csv.reader(io.StringIO(data.decode('utf-8-sig'), newline=''), strict=True))
    except (UnicodeError, csv.Error):
        raise FlowError('csv: UTF-8・引用符の構文が不正です') from None
    check(bool(values) and values[0] == ADMIN_HEADERS, 'headers', '23列の見出し・列順が不正です')
    rows = []
    for i, values_row in enumerate(values[1:], 2):
        check(len(values_row) == len(ADMIN_HEADERS), f'row {i}', '列数が不正です')
        row = dict(zip(ADMIN_HEADERS, values_row))
        if intake:
            check(row['status'] == 'draft', f"{row['id']}.status", '新規投入はdraftのみです')
        rows.append(row)
    check(len(rows) <= 10000, 'csv', '上限10000問です')
    return validate_rows(rows)


def csv_bytes(rows):
    validate_rows(rows)
    out = io.StringIO(newline='')
    writer = csv.writer(out)
    writer.writerow(ADMIN_HEADERS)
    writer.writerows([[r[k] for k in ADMIN_HEADERS] for r in rows])
    return out.getvalue().encode('utf-8-sig')


def public_rows(admin):
    validate_rows(admin)
    return [{key: r[key] for key in PUBLIC_HEADERS} for r in admin if r['status'] == 'published']


def report(rows):
    return {'questions': len(rows), 'types': dict(Counter(r['type'] for r in rows)),
            'statuses': dict(Counter(r['status'] for r in rows)),
            'temporal_issues': [{'id': r['id'], 'issues': temporal_issues(r)} for r in rows if temporal_issues(r)],
            'historical_fact_check': '外部資料による史実確認は未実施。年代メタデータの検証だけです。'}
