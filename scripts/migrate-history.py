"""Offline CSV conversion only. No Sheets SDK, dotenv, credentials or live-write mode."""
from __future__ import annotations
import argparse
import csv
import hashlib
import io
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bot'))
from history_classification import BASE_HEADERS,HEADERS,MANAGEMENT_HEADERS,validate

LEGACY_MANAGEMENT=BASE_HEADERS+['status','batch_id','created_at']

def read_backup(path,management):
    path=Path(path)
    if path.suffix.lower()!='.csv' or path.is_symlink(): raise ValueError('通常ファイルのCSVバックアップを指定してください')
    if path.stat().st_size>10*1024*1024: raise ValueError('入力は10MiB以内にしてください')
    data=path.read_bytes()
    if len(data)>10*1024*1024: raise ValueError('入力は10MiB以内にしてください')
    if b'PRIVATE KEY-----' in data or b'"type": "service_account"' in data: raise ValueError('秘密情報の可能性があるため中止しました（内容非表示）')
    rows=list(csv.reader(io.StringIO(data.decode('utf-8-sig'),newline=''),strict=True))
    if not rows or len(rows)>100001: raise ValueError('ヘッダがないか10万行を超えています')
    old=LEGACY_MANAGEMENT if management else BASE_HEADERS
    new=MANAGEMENT_HEADERS if management else HEADERS
    header=rows[0]
    if header not in (old,new): raise ValueError('CSVヘッダが確定仕様と一致しません')
    result=[]
    seen=set()
    for number,raw in enumerate(rows[1:],2):
        if len(raw)>len(header): raise ValueError(f'{number}行目に余分な列があります')
        raw=raw+['']*(len(header)-len(raw))
        blank=not any(raw)
        converted=raw+(['','','',''] if blank else ['unclassified','','unclassified','']) if header==old else raw
        row=dict(zip(new,converted))
        if not blank:
            if any(not row[key] for key in BASE_HEADERS if key!='explanation'): raise ValueError(f'{number}行目に必須値の欠落があります')
            if row['id'] in seen: raise ValueError('問題IDが重複しています')
            seen.add(row['id'])
            if row['answer'] not in {'1','2','3','4'} or len({row[f'choice{i}'].strip() for i in range(1,5)})!=4: raise ValueError('正答・選択肢が不正です')
            validate(row)
            if management and (row['status'] not in {'draft','published','deleted'} or not row['batch_id'] or not row['created_at']): raise ValueError('管理用の状態・バッチ・作成日時が不正です')
        if converted[:len(header)]!=raw: raise ValueError('既存セルが変更されました')
        result.append(row)
    return result,header==old,hashlib.sha256(data).hexdigest()

def convert_pair(management_path,public_path,output_path):
    private,old_private,private_hash=read_backup(management_path,True)
    public,old_public,public_hash=read_backup(public_path,False)
    if old_private!=old_public: raise ValueError('管理用・公開用の移行世代が混在しています。両方の同時点バックアップを確認してください')
    expected={row['id']:row for row in private if row['id'] and row['status']=='published'}
    actual={row['id']:row for row in public if row['id']}
    if set(expected)!=set(actual): raise ValueError('公開済みID集合と公開先ID集合が一致しません。自動修復せず中止します')
    if any(any(expected[key][field]!=actual[key][field] for field in HEADERS) for key in expected): raise ValueError('管理用と公開用の本文または分類が一致しません。中止します')
    report={'schema_version':'1.0','dry_run':True,'sheets_contacted':False,'legacy_conversion':old_private,
        'management_rows':len(private),'public_rows':len(public),'published_questions':len(expected),
        'existing_cells_preserved':True,'row_order_preserved':True,'management_sha256':private_hash,'public_sha256':public_hash}
    output=Path(output_path)
    if output.exists(): raise ValueError('出力先が存在します。上書きせず新しい出力先を指定してください')
    output.mkdir(parents=True,exist_ok=False)
    for name,header,rows in [('management.csv',MANAGEMENT_HEADERS,private),('public.csv',HEADERS,public)]:
        with (output/name).open('x',encoding='utf-8',newline='') as target:
            writer=csv.writer(target);writer.writerow(header);writer.writerows([row[k] for k in header] for row in rows)
    (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return report

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--management',required=True);parser.add_argument('--public',required=True);parser.add_argument('--out',required=True)
    parser.add_argument('--dry-run',action='store_true',default=True,help='常にオフライン。ライブ書込み機能はありません')
    args=parser.parse_args()
    try:
        report=convert_pair(args.management,args.public,args.out)
    except (ValueError,OSError,UnicodeError,csv.Error) as error:
        parser.exit(1,f'変換中止: {error}\n')
    print(json.dumps(report,ensure_ascii=False))
if __name__=='__main__':main()
