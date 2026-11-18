"""Offline by default. Connected operations require explicit configuration and review plans."""
import argparse
import csv
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'bot'))
from flow_schema import ADMIN_HEADERS, GENERATED_SOURCE, FlowError, csv_bytes, parse_csv, public_rows, report
from history_data import validate_table
from flow_store import FlowStore, configuration, plan_operation


def read_csv(path, intake=False):
    path = Path(path)
    if path.suffix.lower() != '.csv' or path.is_symlink() or any(s in path.name.lower() for s in ['.env','credential','service-account','token']):
        raise FlowError('非機密CSVの通常ファイルを指定してください')
    return parse_csv(path.read_bytes(), intake)


def local_input(filename, extension):
    path = Path(filename or '')
    if (path.suffix.lower() != extension or path.is_symlink() or not path.is_file() or
            path.stat().st_nlink != 1 or path.stat().st_size > 5*1024*1024 or
            any(part in path.name.lower() for part in ['.env','credential','service-account','token'])):
        raise FlowError('5MiB以内の通常の教材ファイルを指定してください')
    return path


def prepare_drafts(source, recipe):
    rows = validate_table(list(csv.reader(source, strict=True)))
    registered = {row['id']:row for row in rows if row['id']}
    if (not isinstance(recipe,dict) or set(recipe) != {'schema_version','questions'} or
            recipe['schema_version'] != '1.1' or not isinstance(recipe['questions'],list) or
            not 1 <= len(recipe['questions']) <= 10000):
        raise FlowError('作成レシピの形式が不正です')
    drafts = []
    for question in recipe['questions']:
        common = ('id','type','question','explanation','period_codes','century_codes','area_codes','time_ranges')
        if not isinstance(question,dict):
            raise FlowError('問題はJSONオブジェクトで指定してください')
        row = dict.fromkeys(ADMIN_HEADERS,'')
        row.update((key, question.get(key,'')) for key in common)
        used = set()

        def resolve(entry):
            if not isinstance(entry,dict) or ('from' in entry) == ('text' in entry):
                raise FlowError('項目は from（登録済みID）または text を一方だけ指定してください')
            item = dict(entry)
            if 'from' in item:
                key = item.pop('from')
                if not isinstance(key,str) or key not in registered:
                    raise FlowError('登録済みの出典IDを確認してください')
                source_row = registered[key]
                used.add(key)
                item['text'] = source_row['choice' + source_row['answer']]
            return item

        if row['type'] == 'cloze':
            if set(question) != set(common) | {'blanks'} or not isinstance(question['blanks'],list) or not 2 <= len(question['blanks']) <= 4:
                raise FlowError('空欄補充のレシピが不正です')
            for i, blank in enumerate(question['blanks'], 1):
                if not isinstance(blank,dict) or 'id' not in blank:
                    raise FlowError('空欄のIDが必要です')
                row[f'item{i}_id'] = blank['id']
                value = {key: val for key,val in blank.items() if key != 'id'}
                if value.get('mode') == 'choice' and isinstance(value.get('choices'),list):
                    value['choices'] = [resolve(entry) for entry in value['choices']]
                elif value.get('mode') == 'input' and isinstance(value.get('accepted'),list):
                    value['accepted'] = [resolve(entry)['text'] if isinstance(entry,dict) else entry for entry in value['accepted']]
                row[f'item{i}_text'] = json.dumps(value,ensure_ascii=False,separators=(',',':'))
        elif row['type'] in ('contemporary','ordering'):
            field = 'choices' if row['type'] == 'contemporary' else 'events'
            if (set(question) != set(common) | {field,'answer'} or not isinstance(question[field],list) or
                    not 3 <= len(question[field]) <= 4):
                raise FlowError('同時代・並び替えレシピの形式が不正です')
            for i, entry in enumerate(question[field], 1):
                item = resolve(entry)
                if not {'id','text'} <= set(item) <= {'id','text','time_ranges'}:
                    raise FlowError('出来事の項目が不正です')
                for key,value in item.items():
                    row[f'item{i}_{key}'] = value
            answer = question['answer']
            if field == 'events':
                if not isinstance(answer,list) or any(not isinstance(value,str) for value in answer):
                    raise FlowError('並び替えの正答順を項目ID配列で指定してください')
                answer = ';'.join(answer)
            row['answer'] = answer
        else:
            raise FlowError('未対応の作成形式です')
        if not used:
            raise FlowError('1問ごとに登録済み出典IDを指定してください')
        row.update(status='draft', source=GENERATED_SOURCE + ';'.join(sorted(used)))
        drafts.append(row)
    return csv_bytes(drafts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare','validate','import','list','show','edit','approve','publish','unpublish','recover','export'])
    parser.add_argument('--csv')
    parser.add_argument('--baseline')
    parser.add_argument('--recipe')
    parser.add_argument('--out')
    parser.add_argument('--connected', action='store_true', help='専用Sheetsを読み取る（既定はオフライン）')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--plan-hash', default='')
    parser.add_argument('--actor', default='local-preview')
    parser.add_argument('--id', dest='question_id')
    parser.add_argument('--field')
    parser.add_argument('--value')
    parser.add_argument('--update', action='store_true')
    parser.add_argument('--reviewed', action='store_true')
    args = parser.parse_args()
    if args.action == 'prepare':
        if args.apply or args.connected or not args.out or Path(args.out).suffix.lower() != '.csv':
            raise FlowError('prepareには接続せず、出力先の新規CSVを指定してください')
        source = local_input(args.csv, '.csv')
        recipe = json.loads(local_input(args.recipe, '.json').read_text(encoding='utf-8-sig'))
        with source.open(encoding='utf-8-sig',newline='') as handle:
            output = prepare_drafts(handle, recipe)
        if len(output) > 5*1024*1024:
            raise FlowError('作成結果をBotへ取り込める5MiB以内に分けてください')
        with Path(args.out).open('xb') as handle:
            handle.write(output)
        print('登録済み教材を参照したdraft CSVを作成しました。')
        return
    if args.action == 'validate':
        if args.apply or args.connected: raise FlowError('validateはオフライン検証専用です')
        print(json.dumps(report(read_csv(args.csv, True)), ensure_ascii=False, indent=2)); return
    if args.apply and not args.connected:
        raise FlowError('書込みには--connected --applyと最新の--plan-hashが必要です')
    repository = None
    if args.connected:
        if args.actor not in {v.strip() for v in os.environ.get('ADMIN_USER_IDS','').split(',') if v.strip()}:
            raise FlowError('接続操作にはADMIN_USER_IDSのactor指定が必要です')
        cfg = configuration()
        from history_bot import sheets_client
        repository = FlowStore(sheets_client(), cfg)
    if args.action == 'recover':
        if not repository: raise FlowError('recoverには--connectedが必要です')
        print(json.dumps(repository.recover(actor=args.actor, apply=args.apply, expected_plan=args.plan_hash), ensure_ascii=False, indent=2)); return
    rows = read_csv(args.csv, True) if args.action == 'import' else None
    kwargs = {'rows':rows,'question_id':args.question_id,'field':args.field,'value':args.value,'update':args.update,'reviewed':args.reviewed}
    if args.action in ['list','show','export']:
        if repository:
            with repository.locked(): admin, public = repository.snapshot()
        else:
            admin = read_csv(args.baseline) if args.baseline else []
        if args.action == 'show': admin = [r for r in admin if r['id']==args.question_id]
        if args.action == 'export': sys.stdout.buffer.write(csv_bytes(admin)); return
        print(json.dumps(admin, ensure_ascii=False, indent=2)); return
    if repository:
        result = repository.execute(args.action, actor=args.actor, apply=args.apply, expected_plan=args.plan_hash, **kwargs)
    else:
        admin = read_csv(args.baseline) if args.baseline else []
        result, _, _ = plan_operation(admin, public_rows(admin), args.action, actor=args.actor, **kwargs)
        result['notice'] = 'オフライン計画です。実際の適用前に--connectedで再計画してください。'
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except FlowError as e:
        print(str(e), file=sys.stderr); sys.exit(1)
    except Exception:
        print('flow処理を完了できません。入力・設定・接続を確認してください（詳細非表示）。', file=sys.stderr); sys.exit(1)
