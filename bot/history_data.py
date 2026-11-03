"""Strict whole-used-range validation shared by Bot and offline provisioning tools."""
import csv
import hashlib
import io
import json
import re
from history_classification import HEADERS, MANAGEMENT_HEADERS
from csv_validation import parse_csv

def question_digest(row):
    return hashlib.sha256(json.dumps([row[key] for key in HEADERS],ensure_ascii=False,separators=(',',':')).encode('utf-8')).hexdigest()

def validate_table(values, management=False, id_prefix=None):
    headers=MANAGEMENT_HEADERS if management else HEADERS
    if not isinstance(values,list) or not values or len(values)>100001:
        raise ValueError('シートのヘッダがないか、行数が上限を超えています')
    def cells(raw):
        if not isinstance(raw,list) or any(v is not None and not isinstance(v,str) for v in raw):
            raise ValueError('シートの値は文字列で保存してください')
        return ['' if v is None else v for v in raw]
    header=cells(values[0])
    while header and header[-1]=='':header.pop()
    if header!=headers:raise ValueError('シートのヘッダ・列順・非空の余剰列が不正です')
    result=[];public=[]
    for raw in values[1:]:
        row=cells(raw)
        if any(v!='' for v in row[len(headers):]):raise ValueError('許可列の外に非空セルがあります')
        row=(row[:len(headers)]+['']*len(headers))[:len(headers)]
        item=dict(zip(headers,row));result.append(item)
        if not any(row):continue  # Preserve cleared row positions for reconciliation.
        if id_prefix and (not item['id'].startswith(id_prefix) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',item['id'])):
            raise ValueError('新環境の問題ID接頭辞・書式が一致しません')
        if management:
            states={'draft','published'} if id_prefix else {'draft','published','deleted'}
            if item['status'] not in states or not item['batch_id'].strip() or not item['created_at'].strip():
                raise ValueError('管理データの状態・バッチ・作成日時が不正です')
        public.append([item[k] for k in HEADERS])
    if public:
        stream=io.StringIO(newline='');writer=csv.writer(stream);writer.writerow(HEADERS);writer.writerows(public)
        parse_csv(stream.getvalue().encode('utf-8'))  # All fields, lengths, IDs, choices, dates and master.
    return result

def reconcile_tables(private,public):
    for rows in [private,public]:
        ids=[row['id']for row in rows if row['id']]
        if len(ids)!=len(set(ids)):raise ValueError('照合対象の問題IDが重複しています')
    expected={row['id']:row for row in private if row['id'] and row['status']=='published'}
    actual={row['id']:row for row in public if row['id']}
    if set(expected)!=set(actual):raise ValueError('管理published ID集合と公開ID集合が一致しません')
    if any(any(expected[key][field]!=actual[key][field] for field in HEADERS)for key in expected):
        raise ValueError('管理用と公開用の本文・分類が一致しません')
    return {'management_questions':sum(bool(r['id'])for r in private),'published_questions':len(actual),
            'draft_questions':sum(r.get('status')=='draft' for r in private),'matching_public_content':True}
