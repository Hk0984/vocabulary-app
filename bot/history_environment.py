"""Non-secret environment registry and explicit content-bound publication approvals."""
import json
import os
import re
from functools import lru_cache
from pathlib import Path
from history_data import question_digest

class ApprovalRequiredError(RuntimeError):
    pass

def read_local_json(path):
    path=Path(path)
    name=path.name.lower()
    if path.suffix.lower()!='.json' or '.env' in name or any(w in name for w in ['service-account','service_account','credentials','firebase-adminsdk']):
        raise ValueError('認証情報ではない専用JSON設定を指定してください')
    if path.is_symlink() or not path.is_file() or path.stat().st_nlink>1:raise ValueError('通常ファイルの専用JSONを指定してください')
    if path.stat().st_size>2*1024*1024:raise ValueError('JSON設定は2MiB以内にしてください')
    return json.loads(path.read_text(encoding='utf-8-sig'))

def load_profile(path,name):
    data=read_local_json(path)
    if set(data)!={'schema_version','legacy_spreadsheet_ids','environments'} or data['schema_version']!='1.0':raise ValueError('環境設定の形式が不正です')
    if not isinstance(data['legacy_spreadsheet_ids'],list) or len(data['legacy_spreadsheet_ids'])<2 or any(not isinstance(v,str) or not v for v in data['legacy_spreadsheet_ids']):raise ValueError('旧シートIDを管理用・公開用とも記録してください')
    if not isinstance(data['environments'],dict) or name not in data['environments']:raise ValueError('指定した新環境が登録されていません')
    prefixes=set();used_ids=set()
    allowed={'management_spreadsheet_id','management_sheet_name','public_spreadsheet_id','public_sheet_name','id_prefix','review_file'}
    for entry in data['environments'].values():
        if not isinstance(entry,dict) or set(entry)!=allowed or any(not isinstance(v,str) or not v.strip() or v!=v.strip() for v in entry.values()):raise ValueError('環境設定の項目が不正です（鍵・トークンは格納しないでください）')
        if not re.fullmatch(r'hv1_[a-z][a-z0-9_]{1,40}_',entry['id_prefix']) or entry['id_prefix'] in prefixes:raise ValueError('新環境のID接頭辞が不正または重複しています')
        prefixes.add(entry['id_prefix'])
        ids=[entry['management_spreadsheet_id'],entry['public_spreadsheet_id']]
        if ids[0]==ids[1] or any(i in data['legacy_spreadsheet_ids'] for i in ids):raise ValueError('新旧・管理公開のシートIDを分離してください')
        if any(i in used_ids for i in ids):raise ValueError('新環境同士で接続先を使い回さないでください')
        used_ids.update(ids)
    selected=dict(data['environments'][name])
    review=Path(selected['review_file'])
    selected['review_file']=str(review if review.is_absolute() else Path(path).resolve().parent/review)
    return selected

@lru_cache(maxsize=4)
def _profile_snapshot(filename,name):
    return load_profile(filename,name)

def active_profile():
    filename=os.environ.get('HISTORY_ENVIRONMENT_FILE')
    selected=os.environ.get('HISTORY_ENVIRONMENT')
    if not filename and not selected:return None  # Preserve existing legacy configuration.
    if not filename or not selected:raise RuntimeError('環境JSONと環境名を両方明示してください')
    try:
        profile=dict(_profile_snapshot(filename,selected))
        old={os.environ.get('GOOGLE_SHEETS_SPREADSHEET_ID'),os.environ.get('PUBLIC_QUESTIONS_SPREADSHEET_ID')}-{None,''}
        if profile['management_spreadsheet_id'] in old or profile['public_spreadsheet_id'] in old:raise ValueError('旧接続先を新環境として使用できません')
        return profile
    except (ValueError,OSError,TypeError,KeyError) as error:
        raise RuntimeError('新環境設定を検証できません。旧接続先へ自動フォールバックしません。') from error

def require_approved(rows,profile):
    if not profile:return
    try:
        manifest=read_local_json(profile['review_file'])
        if manifest.get('schema_version')!='1.0' or manifest.get('id_prefix')!=profile['id_prefix'] or not isinstance(manifest.get('questions'),dict):raise ValueError()
        for row in rows:
            entry=manifest['questions'].get(row['id'],{})
            if not row['id'].startswith(profile['id_prefix']) or entry.get('approved') is not True or entry.get('sha256')!=question_digest(row):raise ValueError()
            if not all(entry.get(key) is True for key in ['answer_unique','historical_content','classification']):raise ValueError()
            if not isinstance(entry.get('reviewed_by'),str) or not entry['reviewed_by'].strip() or not isinstance(entry.get('reviewed_at'),str) or not entry['reviewed_at'].strip():raise ValueError()
    except (ValueError,OSError,TypeError,KeyError,AttributeError) as error:
        raise ApprovalRequiredError('未承認・内容変更・承認記録不備の問題があります。公開を中止しました。') from error
