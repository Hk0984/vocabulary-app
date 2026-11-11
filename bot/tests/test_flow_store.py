import copy
import os
import sys
import tempfile
import unittest
import json
import subprocess
import shutil
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
NODE = shutil.which('node')
NODE_RUNTIME_ENV = {k:os.environ[k] for k in ['SYSTEMROOT','WINDIR','PATH','TEMP','TMP','USERPROFILE'] if k in os.environ}
sys.path.insert(0, str(ROOT/'bot'))
from flow_schema import ADMIN_HEADERS, PUBLIC_HEADERS, FlowError, parse_csv, public_rows
from flow_store import FlowStore, configuration, parse_table, plan_operation
from instance_lock import AlreadyRunningError


class Request:
    def __init__(self, fn): self.fn = fn
    def execute(self): return self.fn()


class FakeSheets:
    def __init__(self):
        self.tables = {'flow-admin':[ADMIN_HEADERS.copy()], 'flow-public':[PUBLIC_HEADERS.copy()]}
        self.writes = []
        self.fail_side = None
        self.lost_response = False
    def values(self): return self
    def get(self, **kwargs):
        return Request(lambda:{'values':copy.deepcopy(self.tables[kwargs['spreadsheetId']])})
    def update(self, **kwargs):
        def write():
            self.writes.append(copy.deepcopy(kwargs))
            if kwargs['spreadsheetId'] == self.fail_side:
                self.fail_side = None
                if self.lost_response: self.tables[kwargs['spreadsheetId']] = copy.deepcopy(kwargs['body']['values'])
                raise TimeoutError('test network fault')
            self.tables[kwargs['spreadsheetId']] = copy.deepcopy(kwargs['body']['values'])
            return {}
        return Request(write)


class FlowStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env = patch.dict(os.environ, {'ADMIN_USER_IDS':'123'}, clear=True)
        self.env.start(); self.addCleanup(self.env.stop)
        self.client = FakeSheets()
        self.store = FlowStore(self.client, {'admin_id':'flow-admin','admin_title':'history_flow_admin','public_id':'flow-public','public_title':'history_flow_public'}, self.tmp.name)
        self.rows = parse_csv((ROOT/'tests/fixtures/flow-admin.synthetic.csv').read_bytes(), True)
        self.qid = self.rows[0]['id']

    def perform(self, action, **kwargs):
        plan = self.store.execute(action, actor=123, **kwargs)
        return self.store.execute(action, actor=123, apply=True, expected_plan=plan['hash'], **kwargs)

    def initialize(self): self.perform('import', rows=[self.rows[0]])
    def approve(self): self.perform('approve', question_id=self.qid, reviewed=True)

    def test_full_lifecycle_publish_edit_reapprove_revoke_and_bounded_writes(self):
        self.initialize()
        self.assertRaises(FlowError, self.store.execute, 'publish', actor=123, question_id=self.qid)
        self.assertRaises(FlowError, self.store.execute, 'approve', actor=123, question_id=self.qid)
        self.approve(); self.perform('publish', question_id=self.qid)
        admin, public = self.store.snapshot()
        self.assertEqual(public, public_rows(admin)); self.assertEqual(len(public), 1)
        self.assertNotIn('source', public[0]); self.assertNotIn('status', public[0])
        self.perform('edit', question_id=self.qid, field='explanation', value='確認済みの新しい解説')
        self.assertEqual(self.store.snapshot()[0][0]['status'], 'draft')
        self.assertEqual(self.store.snapshot()[1], [])
        self.approve(); self.perform('publish', question_id=self.qid); self.perform('unpublish', question_id=self.qid)
        self.assertEqual(self.store.snapshot()[0][0]['status'], 'approved')
        self.assertEqual(self.store.snapshot()[1], [])
        for call in self.client.writes:
            self.assertEqual(call['valueInputOption'], 'RAW')
            self.assertRegex(call['range'], r"^'history_flow_(admin|public)'!A1:[WU][0-9]+$")
        self.assertTrue(list(self.store.directory.glob('*.backup.json')))
        self.assertTrue((self.store.directory/'audit.jsonl').exists())

    def test_import_dryrun_idempotence_conflict_and_explicit_update(self):
        plan = self.store.execute('import', actor=123, rows=self.rows)
        self.assertEqual(len(plan['changes']), 61); self.assertEqual(self.client.writes, [])
        self.perform('import', rows=self.rows)
        self.assertEqual(len(self.store.snapshot()[0]), 61)
        writes = len(self.client.writes)
        self.perform('import', rows=self.rows)
        self.assertEqual(len(self.client.writes), writes)
        changed = {**self.rows[0], 'question':'修正された問題文'}
        self.assertRaisesRegex(FlowError, '衝突', self.store.execute, 'import', actor=123, rows=[changed])
        self.perform('import', rows=[changed], update=True)
        self.assertEqual(self.store.snapshot()[0][0]['question'], changed['question'])

    def test_stale_plan_nonadmin_and_edited_approved_content_rejected(self):
        plan = self.store.execute('import', actor=123, rows=[self.rows[0]])
        self.assertRaises(FlowError, self.store.execute, 'import', actor=999, rows=[self.rows[0]], apply=True, expected_plan=plan['hash'])
        self.assertRaises(FlowError, self.store.execute, 'import', actor=123, rows=[self.rows[0]], apply=True, expected_plan='wrong')
        self.initialize(); self.approve()
        self.client.tables['flow-admin'][1][ADMIN_HEADERS.index('explanation')] = '承認後に手動で変更された解説'
        self.assertRaisesRegex(FlowError, '承認時', self.store.execute, 'publish', actor=123, question_id=self.qid)

    def test_write_failure_blocks_retries_and_recovery_rolls_back(self):
        self.initialize(); self.approve()
        self.client.fail_side = 'flow-public'
        self.assertRaisesRegex(FlowError, '停止', self.perform, 'publish', question_id=self.qid)
        self.assertTrue(self.store.pending.exists())
        self.assertRaises(FlowError, self.store.execute, 'unpublish', actor=123, question_id=self.qid)
        plan = self.store.recover(actor=123)
        self.store.recover(actor=123, apply=True, expected_plan=plan['hash'])
        self.assertFalse(self.store.pending.exists())
        self.assertEqual(self.store.snapshot()[0][0]['status'], 'approved')
        self.assertEqual(self.store.snapshot()[1], [])

    def test_lost_response_is_not_retried_and_unknown_changes_block_rollback(self):
        self.initialize(); self.approve()
        self.client.fail_side = 'flow-public'; self.client.lost_response = True
        self.assertRaises(FlowError, self.perform, 'publish', question_id=self.qid)
        self.assertEqual(self.store.snapshot()[0][0]['status'], 'published')
        self.client.tables['flow-admin'][1][ADMIN_HEADERS.index('question')] = '第三者による変更'
        self.assertRaises(FlowError, self.store.recover, actor=123)

    def test_reconciliation_backup_audit_and_lock_fail_closed(self):
        with self.store.locked():
            self.assertRaises(AlreadyRunningError, self.store.execute, 'import', actor=123, rows=self.rows)
        with patch.object(self.store, 'audit', side_effect=OSError('test')):
            self.assertRaises(OSError, self.perform, 'import', rows=[self.rows[0]])
        self.assertEqual(self.client.writes, [])
        self.client.tables['flow-public'].append([self.rows[0][k] for k in PUBLIC_HEADERS])
        self.assertRaises(FlowError, self.store.execute, 'import', actor=123, rows=self.rows)

    def test_table_schema_extra_columns_formula_and_configuration(self):
        for table in [[], [ADMIN_HEADERS+['secret']], [ADMIN_HEADERS, ['']*23+['extra']], [ADMIN_HEADERS, [], [self.rows[0][k] for k in ADMIN_HEADERS]]]:
            self.assertRaises(FlowError, parse_table, table, True)
        self.assertRaises(FlowError, configuration)
        valid = {'FLOW_ADMIN_SPREADSHEET_ID':'flow-admin', 'FLOW_ADMIN_SHEET_NAME':'history_flow_admin',
                 'FLOW_PUBLIC_SPREADSHEET_ID':'flow-public','FLOW_PUBLIC_SHEET_NAME':'history_flow_public'}
        with patch.dict(os.environ, valid):
            self.assertEqual(configuration()['public_id'], 'flow-public')
            with patch.dict(os.environ, {'PUBLIC_QUESTIONS_SPREADSHEET_ID':'flow-public'}): self.assertRaises(FlowError, configuration)
            with patch.dict(os.environ, {'FLOW_PUBLIC_SPREADSHEET_ID':'flow-admin'}): self.assertRaises(FlowError, configuration)

    def test_source_or_body_changes_invalidate_stored_approval_and_update_resets_draft(self):
        self.initialize(); self.approve(); self.perform('publish', question_id=self.qid)
        updated={**self.rows[0], 'source':'校正後の出典'}
        self.perform('import', rows=[updated], update=True)
        self.assertEqual(self.store.snapshot()[0][0]['status'],'draft')
        self.assertEqual(self.store.snapshot()[1],[])
        self.assertNotIn(self.qid,self.store.approvals())
        stale=self.store.execute('approve',actor=123,question_id=self.qid,reviewed=True)
        self.perform('edit',question_id=self.qid,field='explanation',value='計画後の修正')
        self.assertRaises(FlowError,self.store.execute,'approve',actor=123,question_id=self.qid,reviewed=True,apply=True,expected_plan=stale['hash'])

    def test_all_61_mock_import_batch_publication_and_javascript_grading(self):
        if not NODE: self.skipTest('Node is required for the cross-runtime integration check')
        original=copy.deepcopy(self.rows)
        self.perform('import',rows=self.rows)
        plan = self.store.execute('publish_batch',actor=123)
        self.assertEqual(plan['target_count'],61)
        self.assertEqual(len(plan['public_additions']),61)
        self.assertTrue(all(r['status']=='draft' for r in self.store.snapshot()[0]))
        self.store.execute('publish_batch',actor=123,apply=True,expected_plan=plan['hash'])
        self.assertEqual(len(self.store.approvals()),61)
        admin,public=self.store.snapshot()
        self.assertEqual(len(public),61)
        values=[PUBLIC_HEADERS]+[[r[k] for k in PUBLIC_HEADERS] for r in public]
        script="""
import './history-classification.js';
import './history-flow.js';
import './history-flow-source.js';
import {readFileSync} from 'node:fs';
const master=HistoryClassification.validateMaster(JSON.parse(readFileSync('history-regions.json','utf8')));
const loaded=HistoryFlowSource.parseValues(VALUES,master);
const s=HistoryFlow.session(HistoryFlow.shuffle(loaded.questions),()=>0);
while(s.current){s.options();if(s.submit(s.current.answer)!==true)throw Error('grading failed');s.next();}
console.log(JSON.stringify(s.summary));
""".replace('VALUES',json.dumps(values,ensure_ascii=False))
        result=subprocess.run([NODE,'--input-type=module'],input=script,text=True,encoding='utf-8',cwd=ROOT,env=NODE_RUNTIME_ENV,capture_output=True,check=True,timeout=30)
        self.assertEqual(json.loads(result.stdout),{'total':61,'correct':61,'incorrect':0,'accuracy':100})
        self.assertEqual(self.rows,original)

    def test_batch_preserves_published_and_approved_and_supports_republication(self):
        self.initialize();self.approve();self.perform('publish',question_id=self.qid)
        first=copy.deepcopy(self.store.snapshot()[1][0])
        self.perform('import',rows=self.rows[1:])
        approved_id=self.rows[1]['id']
        self.perform('approve',question_id=approved_id,reviewed=True)
        plan=self.store.execute('publish_batch',actor=123)
        self.assertEqual(plan['target_count'],59)
        self.assertNotIn(self.qid,plan['target_ids']);self.assertNotIn(approved_id,plan['target_ids'])
        self.perform('publish_batch')
        self.assertEqual(self.store.snapshot()[1][0],first)
        self.perform('publish_batch',question_id=approved_id)
        self.assertEqual(len(self.store.snapshot()[1]),61)
        self.perform('unpublish',question_id=self.qid)
        self.assertEqual(len(self.store.snapshot()[1]),60)
        self.perform('publish_batch',question_id=self.qid)
        self.assertEqual(len(self.store.snapshot()[1]),61)
        count=len(self.client.writes)
        self.perform('publish_batch');self.perform('publish_batch',question_id=self.qid)
        self.assertEqual(len(self.client.writes),count)

    def test_entire_batch_rejected_on_temporal_or_structural_error(self):
        self.perform('import',rows=self.rows)
        row=next(r for r in self.rows if r['type']=='ordering')
        index=self.rows.index(row)+1
        self.client.tables['flow-admin'][index][ADMIN_HEADERS.index('answer')]=';'.join(reversed(row['answer'].split(';')))
        before=len(self.client.writes)
        self.assertRaises(FlowError,self.store.execute,'publish_batch',actor=123)
        self.assertEqual(len(self.client.writes),before)
