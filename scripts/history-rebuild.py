"""Offline new-environment preparation; no Google/Discord client or live-write mode."""
import argparse
import csv
import hashlib
import io
import json
import re
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bot'))
from csv_validation import parse_csv
from history_classification import HEADERS,BASE_HEADERS,MANAGEMENT_HEADERS,defaults
from history_data import validate_table,reconcile_tables,question_digest
from history_environment import require_approved,read_local_json,load_profile

def prefix_check(prefix):
    if not re.fullmatch(r'hv1_[a-z][a-z0-9_]{1,40}_',prefix):raise ValueError('hv1_で始まる環境固有のID接頭辞を指定してください')

def read_csv(path):
    path=Path(path)
    if path.suffix.lower()!='.csv' or any(s in path.name.lower() for s in ['.env','service-account','service_account','credentials']) or path.is_symlink():raise ValueError('通常の問題CSVだけを指定してください')
    if path.stat().st_size>10*1024*1024:raise ValueError('CSVは10MiB以内にしてください')
    data=path.read_bytes()
    if b'PRIVATE KEY-----' in data:raise ValueError('秘密情報の可能性があるため中止しました（内容非表示）')
    return data,list(csv.reader(io.StringIO(data.decode('utf-8-sig'),newline=''),strict=True))

def output_folder(path):
    path=Path(path)
    if path.exists():raise ValueError('出力先が存在します。新しいフォルダーを指定してください')
    path.mkdir(parents=True,exist_ok=False)
    return path

def write_csv(path,headers,rows):
    with path.open('x',encoding='utf-8',newline='')as f:
        writer=csv.writer(f);writer.writerow(headers);writer.writerows(rows)

def write_json(path,data):
    with path.open('x',encoding='utf-8')as f:json.dump(data,f,ensure_ascii=False,indent=2);f.write('\n')

def pending_entry(row,legacy_id=None):
    entry={'sha256':question_digest(row),'approved':False,'answer_unique':False,'historical_content':False,
           'classification':False,'reviewed_by':'','reviewed_at':''}
    if legacy_id is not None:entry['legacy_id']=legacy_id
    return entry

def initialize(out,prefix):
    prefix_check(prefix)
    target=output_folder(out)
    write_csv(target/'import-template.csv',HEADERS,[])
    write_csv(target/'management-empty.csv',MANAGEMENT_HEADERS,[])
    write_csv(target/'public-empty.csv',HEADERS,[])
    write_json(target/'review-manifest.json',{'schema_version':'1.0','id_prefix':prefix,'questions':{}})
    write_json(target/'environments.template.json',{'schema_version':'1.0','legacy_spreadsheet_ids':['',''],
        'environments':{'rebuild_v1':{'management_spreadsheet_id':'','management_sheet_name':'history_questions',
            'public_spreadsheet_id':'','public_sheet_name':'history_questions','id_prefix':prefix,'review_file':'review-manifest.json'}}})
    write_json(target/'public-config.template.json',{'spreadsheetId':'','sheetName':'history_questions','expectedIdPrefix':prefix,'requireCurrentSchema':True})
    return {'offline':True,'management_columns':16,'public_columns':13,'csv_columns':13,'approved_questions':0}

def candidates(source,out,prefix):
    prefix_check(prefix)
    raw,values=read_csv(source)
    if not values or values[0]!=BASE_HEADERS:raise ValueError('再登録候補の元には旧9列CSVを指定してください')
    original=parse_csv(raw)
    if any(r['id'].startswith(prefix)for r in original):raise ValueError('既に新環境IDの問題が含まれています。二重のID再発行はしません')
    rows=[];mapping=[];reviews={};seen={r['id']for r in original};created=set()
    for old in original:
        digest=hashlib.sha256(json.dumps([old[k]for k in BASE_HEADERS],ensure_ascii=False,separators=(',',':')).encode('utf-8')).hexdigest()[:24]
        new_id=prefix+digest
        if new_id in seen or new_id in created:raise ValueError('新旧のID衝突があります。中止します')
        created.add(new_id)
        row=defaults({k:old[k]for k in BASE_HEADERS});row['id']=new_id
        rows.append(row);reviews[new_id]=pending_entry(row,old['id'])
        mapping.append([old['id'],new_id,'history_'+old['id'],'history_'+new_id,'needs_review'])
    validate_table([HEADERS]+[[r[k]for k in HEADERS]for r in rows],id_prefix=prefix)
    target=output_folder(out)
    write_csv(target/'candidates-13.csv',HEADERS,[[r[k]for k in HEADERS]for r in rows])
    write_csv(target/'id-map.csv',['legacy_id','candidate_id','legacy_firestore_key','candidate_firestore_key','review_status'],mapping)
    write_json(target/'review-manifest.json',{'schema_version':'1.0','id_prefix':prefix,'questions':reviews})
    report={'offline':True,'source_sha256':hashlib.sha256(raw).hexdigest(),'candidate_questions':len(rows),'new_ids':True,
            'old_and_new_ids_disjoint':not(seen&created),'body_choices_answers_source_id_preserved':True,
            'classification':'unclassified; no inferred dates or areas','approved_questions':0,'firestore_writes':0}
    write_json(target/'report.json',report)
    return report

def review(csv_path,out,prefix,previous=None):
    prefix_check(prefix)
    _,values=read_csv(csv_path)
    rows=validate_table(values,id_prefix=prefix)
    previous_data=read_local_json(previous)if previous else {'questions':{}}
    entries={};retained=0
    for row in rows:
        if not row['id']:continue
        entries[row['id']]=pending_entry(row)
        if previous:
            try:
                require_approved([row],{'id_prefix':prefix,'review_file':str(previous)})
                entries[row['id']]=previous_data['questions'][row['id']];retained+=1
            except RuntimeError:pass  # Changed/unapproved content requires fresh manual review.
    target=output_folder(out)
    write_json(target/'review-manifest.json',{'schema_version':'1.0','id_prefix':prefix,'questions':entries})
    return {'offline':True,'questions':len(entries),'unchanged_approvals_retained':retained,'needs_review':len(entries)-retained}

def validate_environment(management,public,prefix,reviews=None):
    prefix_check(prefix)
    private=validate_table(read_csv(management)[1],True,prefix)
    shared=validate_table(read_csv(public)[1],False,prefix)
    report=reconcile_tables(private,shared)
    published=[r for r in shared if r['id']]
    if published:
        if not reviews:raise ValueError('公開問題がある環境では承認記録の検証が必要です')
        require_approved(published,{'id_prefix':prefix,'review_file':str(reviews)})
    return {'offline':True,**report,'approval_verified':True,'production_writes':0}

def public_configuration(profiles,environment,out):
    profile=load_profile(profiles,environment)
    target=output_folder(out)
    write_json(target/'public-config.json',{'spreadsheetId':profile['public_spreadsheet_id'],'sheetName':profile['public_sheet_name'],
        'expectedIdPrefix':profile['id_prefix'],'requireCurrentSchema':True})
    return {'offline':True,'public_only_configuration':True,'no_credentials_copied':True}

def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    for name in ['init','candidates','review','validate']:
        p=sub.add_parser(name);p.add_argument('--prefix',required=True)
        if name!='validate':p.add_argument('--out',required=True)
        if name=='candidates':p.add_argument('--input',required=True)
        if name=='review':p.add_argument('--csv',required=True);p.add_argument('--previous-manifest')
        if name=='validate':p.add_argument('--management',required=True);p.add_argument('--public',required=True);p.add_argument('--reviews')
    p=sub.add_parser('public-config');p.add_argument('--profiles',required=True);p.add_argument('--environment',required=True);p.add_argument('--out',required=True)
    args=parser.parse_args()
    try:
        if args.command=='init':result=initialize(args.out,args.prefix)
        elif args.command=='candidates':result=candidates(args.input,args.out,args.prefix)
        elif args.command=='review':result=review(args.csv,args.out,args.prefix,args.previous_manifest)
        elif args.command=='validate':result=validate_environment(args.management,args.public,args.prefix,args.reviews)
        else:result=public_configuration(args.profiles,args.environment,args.out)
    except (ValueError,RuntimeError,OSError,TypeError,KeyError,csv.Error)as error:
        parser.exit(1,'処理を中止しました: '+str(error)+'\n')
    print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':main()
