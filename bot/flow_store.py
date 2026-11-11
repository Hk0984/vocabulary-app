"""Dedicated Sheets repository with content-bound plans, backups and fail-stop recovery."""
import copy
import hashlib
import json
import os
import re
import uuid
from contextlib import ExitStack, contextmanager
from pathlib import Path
from datetime import datetime, timezone

from flow_schema import ADMIN_HEADERS, PUBLIC_HEADERS, FlowError, public_rows, temporal_issues, validate_rows
from instance_lock import acquire_instance_lock, release_instance_lock


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def configuration():
    keys = ['FLOW_ADMIN_SPREADSHEET_ID', 'FLOW_ADMIN_SHEET_NAME', 'FLOW_PUBLIC_SPREADSHEET_ID', 'FLOW_PUBLIC_SHEET_NAME']
    values = [os.environ.get(k, '').strip() for k in keys]
    if not all(values) or any(not re.fullmatch(r'[A-Za-z0-9_-]+', i) for i in (values[0], values[2])):
        raise FlowError('flow設定: 専用の管理・公開シートIDと名前を明示してください')
    if values[1] != 'history_flow_admin' or values[3] != 'history_flow_public' or values[0] == values[2]:
        raise FlowError('flow設定: 管理・公開には別のスプレッドシートと専用タブ名が必要です')
    legacy = {os.environ.get(k, '').strip() for k in ['GOOGLE_SHEETS_SPREADSHEET_ID', 'PUBLIC_QUESTIONS_SPREADSHEET_ID']}
    from history_environment import active_profile
    profile = active_profile()
    if profile:
        legacy.update([profile['management_spreadsheet_id'], profile['public_spreadsheet_id']])
    if set([values[0], values[2]]) & legacy:
        raise FlowError('flow設定: 既存一問一答のシートIDは流用できません')
    return {'admin_id':values[0], 'admin_title':values[1], 'public_id':values[2], 'public_title':values[3]}


def reconcile(admin, public):
    validate_rows(admin)
    validate_rows(public, False)
    expected = {r['id']:r for r in public_rows(admin)}
    if expected != {r['id']:r for r in public}:
        raise FlowError('管理publishedと公開データが一致しません。書込みを停止します')


def plan_operation(admin, public, action, *, actor, rows=None, question_id=None, field=None, value=None, update=False, reviewed=False):
    reconcile(admin, public)
    after = copy.deepcopy(admin)
    by_id = {r['id']:r for r in after}
    if action == 'import':
        validate_rows(rows or [])
        if not rows or any(r['status'] != 'draft' for r in rows):
            raise FlowError('import: draftのCSVを指定してください')
        for row in rows:
            old = by_id.get(row['id'])
            if old and all(old[k] == row[k] for k in ADMIN_HEADERS if k != 'status'):
                continue  # Idempotent import never resets approved/published state.
            if old:
                if not update:
                    fields = [k for k in ADMIN_HEADERS if old[k] != row[k]]
                    raise FlowError(f"{row['id']}: 既存IDとの衝突（差分: {', '.join(fields)}）。updateを明示してドライランしてください")
                old.update(row)
            else:
                by_id[row['id']] = copy.deepcopy(row)
                after.append(by_id[row['id']])
    elif action == 'publish_batch':
        if question_id is not None and question_id not in by_id:
            raise FlowError('id: 対象が見つかりません')
        targets = ([by_id[question_id]] if question_id is not None else
                   [r for r in after if r['status'] == 'draft'])
        for row in targets:
            if row['status'] == 'published':
                continue
            issues = temporal_issues(row)
            if any('逆転または重複' in issue or '正解1件に限定' in issue for issue in issues):
                raise FlowError(f"{row['id']}: " + '; '.join(issues))
            row['status'] = 'published'
    else:
        row = by_id.get(question_id)
        if row is None:
            raise FlowError('id: 対象が見つかりません')
        if action == 'edit':
            if field not in ADMIN_HEADERS or field in {'id', 'status'} or not isinstance(value, str):
                raise FlowError('field: ID・状態以外の有効な列を指定してください')
            if row[field] != value:
                row[field] = value
                row['status'] = 'draft'
        elif action == 'approve':
            if row['status'] == 'published':
                raise FlowError('status: 公開済み問題の承認を変更できません')
            if not reviewed:
                raise FlowError('reviewed: 正解一意性・史実・分類を人手確認してから承認してください')
            issues = temporal_issues(row)
            if any('逆転または重複' in issue or '正解1件に限定' in issue for issue in issues):
                raise FlowError(f"{question_id}: " + '; '.join(issues))
            row['status'] = 'approved'
        elif action == 'publish':
            if row['status'] not in {'approved', 'published'}:
                raise FlowError('status: 未承認問題は公開できません')
            row['status'] = 'published'
        elif action == 'unpublish':
            if row['status'] == 'published':
                row['status'] = 'approved'
        else:
            raise FlowError('action: 未対応の操作です')
    validate_rows(after)
    after_public = public_rows(after)
    before_by_id = {r['id']:r for r in admin}
    changes = []
    for row in after:
        old = before_by_id.get(row['id'], {})
        changed = {k:{'before':old.get(k), 'after':row[k]} for k in ADMIN_HEADERS if old.get(k) != row[k]}
        if changed:
            changes.append({'id':row['id'], 'fields':changed})
    details = {'action':action, 'actor':str(actor), 'before':digest([admin, public]), 'after':digest([after, after_public]), 'changes':changes}
    if action == 'publish_batch':
        ids = [change['id'] for change in changes]
        selected = set(ids)
        details.update(target_ids=ids, target_count=len(ids),
                       public_additions=[r for r in after_public if r['id'] in selected],
                       review_warnings=[{'id':r['id'], 'issues':temporal_issues(r)} for r in targets if temporal_issues(r)])
    return {'hash':digest(details), **details}, after, after_public


def parse_table(values, management):
    headers = ADMIN_HEADERS if management else PUBLIC_HEADERS
    if not isinstance(values, list) or not values or len(values) > 10001:
        raise FlowError('シート: 正確な見出しの事前作成が必要です。自動作成しません')
    if values[0] != headers:
        raise FlowError('シート: 見出し・列順・余剰列が不正です')
    result = []
    empty_seen = False
    for cells in values[1:]:
        if not isinstance(cells, list) or any(not isinstance(v, str) for v in cells):
            raise FlowError('シート: 全セルを文字列にしてください')
        if any(cells[len(headers):]):
            raise FlowError('シート: 許可範囲外に非空データがあります')
        if not any(cells):
            empty_seen = True
            continue
        if empty_seen:
            raise FlowError('シート: 途中の空行の後にデータがあります。行位置を自動変更せず停止します')
        row = dict(zip(headers, (cells+['']*len(headers))[:len(headers)]))
        result.append(row)
    return validate_rows(result, management)


class FlowStore:
    def __init__(self, client, config, state_dir=None):
        self.client, self.config = client, dict(config)
        self.root = Path(state_dir or Path(__file__).resolve().parents[1]/'local-history/flow')
        self.identity = digest(config)
        self.directory = self.root/self.identity

    @contextmanager
    def locked(self):
        self.root.mkdir(parents=True, exist_ok=True)
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        with ExitStack() as stack:
            for sid in sorted([self.config['admin_id'], self.config['public_id']]):
                handle = acquire_instance_lock(self.root/(digest(sid)+'.lock'))
                stack.callback(release_instance_lock, handle)
            yield

    @property
    def pending(self):
        return self.directory/'pending.json'

    def read(self, side):
        cfg = self.config
        values = self.client.values().get(spreadsheetId=cfg[side+'_id'], range="'"+cfg[side+'_title']+"'", valueRenderOption='FORMULA').execute().get('values', [])
        return parse_table(values, side == 'admin')

    def snapshot(self):
        admin, public = self.read('admin'), self.read('public')
        reconcile(admin, public)
        return admin, public

    def save_json(self, path, data):
        tmp = path.with_suffix('.tmp')
        with tmp.open('w', encoding='utf-8') as stream:
            os.chmod(tmp, 0o600)
            json.dump(data, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)

    def audit(self, actor, action, state, plan):
        event = {'time':datetime.now(timezone.utc).isoformat(), 'actor':str(actor), 'action':action,
                 'state':state, 'plan_hash':plan['hash'], 'ids':[r['id'] for r in plan.get('changes', [])]}
        with (self.directory/'audit.jsonl').open('a', encoding='utf-8') as stream:
            os.chmod(stream.name, 0o600)
            stream.write(json.dumps(event, ensure_ascii=False)+'\n')
            stream.flush()
            os.fsync(stream.fileno())

    def approvals(self):
        path = self.directory/'approvals.json'
        return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}

    def write(self, side, before, after):
        # Compare immediately before each bounded RAW write. No blind retries.
        if self.read(side) != before:
            raise FlowError('シートが計画後に変更されました。書込み停止')
        headers = ADMIN_HEADERS if side == 'admin' else PUBLIC_HEADERS
        size = max(len(before), len(after))+1
        values = [headers]+[[r[k] for k in headers] for r in after]
        values += [['']*len(headers) for _ in range(size-len(values))]
        self.client.values().update(spreadsheetId=self.config[side+'_id'], range=f"'{self.config[side+'_title']}'!A1:{'W' if side=='admin' else 'U'}{size}",
                                    valueInputOption='RAW', body={'values':values}).execute()
        if self.read(side) != after:
            raise FlowError('書込み後の内容が一致しません')

    def execute(self, action, *, actor, apply=False, expected_plan='', **kwargs):
        with self.locked():
            if self.pending.exists():
                raise FlowError('未完了のflow操作があります。バックアップと照合してrecoverを行ってください')
            admin, public = self.snapshot()
            plan, after, after_public = plan_operation(admin, public, action, actor=actor, **kwargs)
            approvals_before = self.approvals()
            approvals_after = {r['id']:approvals_before[r['id']] for r in after
                               if r['id'] in approvals_before and approvals_before[r['id']] == digest({k:v for k,v in r.items() if k!='status'})}
            if action == 'approve':
                row = next(r for r in after if r['id']==kwargs['question_id'])
                approvals_after[row['id']] = digest({k:v for k,v in row.items() if k!='status'})
            if action == 'publish_batch':
                # The content-bound confirmation replaces per-question approval.
                selected = set(plan['target_ids'])
                for row in after:
                    if row['id'] in selected:
                        approvals_after[row['id']] = digest({k:v for k,v in row.items() if k!='status'})
            if action == 'publish':
                row = next(r for r in admin if r['id']==kwargs['question_id'])
                if approvals_before.get(row['id']) != digest({k:v for k,v in row.items() if k!='status'}):
                    raise FlowError('承認時の本文と一致しません。人手確認してapproveをやり直してください')
            plan['approval_before'] = digest(approvals_before)
            plan['approval_after'] = digest(approvals_after)
            plan['environment'] = self.identity
            plan['hash'] = digest({k:v for k,v in plan.items() if k != 'hash'})
            if not apply:
                return plan
            admins = {v.strip() for v in os.environ.get('ADMIN_USER_IDS', '').split(',') if v.strip()}
            if str(actor) not in admins:
                raise FlowError('actor: 管理者以外は書き込めません')
            if not expected_plan or expected_plan != plan['hash']:
                raise FlowError('plan: ドライランのハッシュが不一致です。差分を再確認してください')
            if not plan['changes'] and approvals_before == approvals_after:
                return {**plan, 'result':'unchanged'}
            backup = {'config_digest':self.identity, 'plan':plan, 'before':[admin, public], 'after':[after, after_public],
                      'approvals_before':approvals_before, 'approvals_after':approvals_after}
            self.save_json(self.directory/(uuid.uuid4().hex+'.backup.json'), backup)
            self.audit(actor, action, 'intent', plan)  # Audit/backup failure stops before remote writes.
            self.save_json(self.pending, backup)
            try:
                # Revocation first; publication last. New unreviewed content is never copied.
                removing = any(r not in after_public for r in public)
                order = ['public','admin'] if removing else ['admin','public']
                for side in order:
                    before, target = (admin, after) if side=='admin' else (public, after_public)
                    if before != target:
                        self.write(side, before, target)
                if self.snapshot() != (after, after_public):
                    raise FlowError('更新後の照合に失敗しました')
                self.save_json(self.directory/'approvals.json', approvals_after)
                self.audit(actor, action, 'complete', plan)
                self.pending.unlink()
                return {**plan, 'result':'complete'}
            except Exception:
                # Unknown outcomes are never retried or silently rolled back.
                try:
                    self.audit(actor, action, 'incomplete', plan)
                except OSError:
                    pass
                raise FlowError('書込み・監査の完了を確認できません。以降の変更を停止しました。recoverで照合してください') from None

    def recover(self, *, actor, apply=False, expected_plan=''):
        with self.locked():
            if not self.pending.exists():
                raise FlowError('復旧対象はありません')
            backup = json.loads(self.pending.read_text(encoding='utf-8'))
            if backup.get('config_digest') != self.identity:
                raise FlowError('復旧先の設定が一致しません')
            before, after = backup['before'], backup['after']
            reconcile(*before)
            reconcile(*after)
            actual = [self.read('admin'), self.read('public')]
            if any(actual[i] not in [before[i], after[i]] for i in (0,1)):
                raise FlowError('未知の変更があります。自動復旧は行えません')
            approval_state = self.approvals()
            if approval_state not in [backup['approvals_before'], backup['approvals_after']]:
                raise FlowError('承認記録に未知の変更があり、自動復旧できません')
            recovery_hash = digest([self.identity, str(actor), actual, before, approval_state, backup['plan']['hash']])
            if not apply:
                return {'hash':recovery_hash, 'action':'rollback', 'transaction':backup['plan']['hash']}
            if str(actor) not in {v.strip() for v in os.environ.get('ADMIN_USER_IDS','').split(',')} or expected_plan != recovery_hash:
                raise FlowError('復旧は管理者と最新の復旧計画ハッシュが必要です')
            self.audit(actor, 'rollback', 'intent', backup['plan'])
            # Remove newly published data before reverting the admin state.
            for i, side in [(1,'public'), (0,'admin')]:
                if actual[i] != before[i]:
                    self.write(side, actual[i], before[i])
            if self.snapshot() != tuple(before):
                raise FlowError('復旧後の照合に失敗しました')
            self.save_json(self.directory/'approvals.json', backup['approvals_before'])
            self.audit(actor, 'rollback', 'complete', backup['plan'])
            self.pending.unlink()
            return {'hash':recovery_hash, 'result':'rolled_back'}
