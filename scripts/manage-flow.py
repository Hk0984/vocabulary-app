"""Offline by default. Connected operations require explicit configuration and review plans."""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'bot'))
from flow_schema import FlowError, csv_bytes, parse_csv, public_rows, report
from flow_store import FlowStore, configuration, plan_operation


def read_csv(path, intake=False):
    path = Path(path)
    if path.suffix.lower() != '.csv' or path.is_symlink() or any(s in path.name.lower() for s in ['.env','credential','service-account','token']):
        raise FlowError('非機密CSVの通常ファイルを指定してください')
    return parse_csv(path.read_bytes(), intake)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['validate','import','list','show','edit','approve','publish','unpublish','recover','export'])
    parser.add_argument('--csv')
    parser.add_argument('--baseline')
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
