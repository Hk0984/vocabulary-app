import asyncio,csv,hashlib,importlib.util,io,json,os,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import Mock,AsyncMock,patch
from types import SimpleNamespace
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'bot'))
from history_classification import BASE_HEADERS,HEADERS,MANAGEMENT_HEADERS
from history_data import validate_table,reconcile_tables,question_digest
from history_environment import load_profile,active_profile,require_approved,read_local_json
from public_questions import publish_drafts_safely,repair_published_rows
import history_bot
spec=importlib.util.spec_from_file_location('history_rebuild',ROOT/'scripts/history-rebuild.py')
tool=importlib.util.module_from_spec(spec);spec.loader.exec_module(tool)
PREFIX='hv1_rebuild1_'

def question():return dict(zip(HEADERS,[PREFIX+'sample001','s','Q','A','B','C','D','1','','medieval','ce_11','geo.normandy','1066..1066']))
def matrix(row,management=False):
    headers=MANAGEMENT_HEADERS if management else HEADERS
    return [headers,[row[k]for k in headers]]

class RebuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.envpatch=patch.dict(os.environ,{'HISTORY_ENVIRONMENT':'','HISTORY_ENVIRONMENT_FILE':''});self.envpatch.start();self.addCleanup(self.envpatch.stop)
        self.row=question();self.private={**self.row,'status':'draft','batch_id':'b','created_at':'2026-01-01T00:00:00+09:00'}
        self.reviews=self.root/'reviews.json'
        self.profile={'id_prefix':PREFIX,'review_file':str(self.reviews)}
    def write_manifest(self,approved=False):
        entry={'sha256':question_digest(self.row),'approved':approved,'answer_unique':approved,'historical_content':approved,'classification':approved,'reviewed_by':'local-test' if approved else '', 'reviewed_at':'2026-01-01' if approved else ''}
        self.reviews.write_text(json.dumps({'schema_version':'1.0','id_prefix':PREFIX,'questions':{self.row['id']:entry}}),encoding='utf-8')
    def config(self):
        return {'schema_version':'1.0','legacy_spreadsheet_ids':['old-private','old-public'],'environments':{'rebuild_v1':{'management_spreadsheet_id':'new-private','management_sheet_name':'sheet','public_spreadsheet_id':'new-public','public_sheet_name':'sheet','id_prefix':PREFIX,'review_file':'reviews.json'}}}
    def csv_file(self,name,headers,rows):
        path=self.root/name
        with path.open('w',encoding='utf-8',newline='')as f:w=csv.writer(f);w.writerow(headers);w.writerows(rows)
        return path
    def test_empty_headers_and_cleared_rows_with_unused_physical_columns(self):
        self.assertEqual(validate_table([HEADERS],id_prefix=PREFIX),[])
        self.assertEqual(validate_table([MANAGEMENT_HEADERS],True,PREFIX),[])
        values=[HEADERS+['',''],[],[self.row[k]for k in HEADERS]+['',None]]
        rows=validate_table(values,id_prefix=PREFIX)
        self.assertEqual(len(rows),2);self.assertEqual(rows[0]['id'],'');self.assertEqual(rows[1]['id'],self.row['id'])
    def test_nonempty_overflow_headers_or_cells_are_rejected(self):
        for management,row in [(False,self.row),(True,self.private)]:
            values=matrix(row,management)
            for bad in [[values[0]+['EXTRA'],values[1]+['X']],[values[0],values[1]+['X']],[values[0],values[1]+['','X']]]:
                with self.subTest(management=management),self.assertRaises(ValueError):validate_table(bad,management,PREFIX)
    def test_realistic_sheet_range_mock_detects_columns_outside_old_caps_before_write(self):
        for management,row in [(True,self.private),(False,self.row)]:
            headers=MANAGEMENT_HEADERS if management else HEADERS
            full=[headers+['EXTRA'],[row[k]for k in headers]+['NONEMPTY']]
            client=Mock()
            def get(**kwargs):
                value=full
                if ':' in kwargs['range']:
                    width=ord(kwargs['range'].split(':')[-1])-ord('A')+1;value=[r[:width]for r in full]
                return Mock(execute=Mock(return_value={'values':value}))
            client.values.return_value.get.side_effect=get
            with patch.object(history_bot,'sheets_client',return_value=client),patch.object(history_bot,'sheet_config',return_value=('mock-private','sheet')),patch.object(history_bot,'public_sheet_config',return_value=('mock-public','sheet')):
                with self.assertRaises(RuntimeError):
                    if management:history_bot.append_batch([self.row])
                    else:history_bot.append_public_rows([self.row])
            self.assertEqual(client.values.return_value.get.call_args.kwargs['range'],"'sheet'")
            client.values.return_value.append.assert_not_called()
    def test_duplicate_ids_choices_invalid_dates_and_wrong_namespace_fail(self):
        for values in [matrix(self.row)+[matrix(self.row)[1]],matrix({**self.row,'choice2':'A'}),matrix({**self.row,'time_ranges':'-1..1'}),matrix({**self.row,'area_codes':'geo.missing'}),matrix({**self.row,'id':'001'})]:
            with self.assertRaises(ValueError):validate_table(values,id_prefix=PREFIX)
    def test_global_alignment_requires_published_and_all_thirteen_fields(self):
        published={**self.private,'status':'published'}
        self.assertEqual(reconcile_tables([published],[self.row])['published_questions'],1)
        for private,public in [([self.private],[self.row]),([published],[]),([published],[{**self.row,'area_codes':'geo.france'}]),([published],[{**self.row,'question':'different'}])]:
            with self.assertRaises(ValueError):reconcile_tables(private,public)
    def test_pending_partial_and_changed_content_never_approve(self):
        self.write_manifest(False)
        with self.assertRaises(RuntimeError):require_approved([self.row],self.profile)
        self.write_manifest(True);require_approved([self.row],self.profile)
        for patch_row in [{'question':'changed'},{'area_codes':'geo.france'},{'id':'legacy'}]:
            with self.assertRaises(RuntimeError):require_approved([{**self.row,**patch_row}],self.profile)
        manifest=json.loads(self.reviews.read_text());manifest['questions'][self.row['id']]['classification']=False;self.reviews.write_text(json.dumps(manifest))
        with self.assertRaises(RuntimeError):require_approved([self.row],self.profile)
    def test_publish_and_repair_gate_even_if_no_append_is_needed(self):
        for command,state,helper in [(history_bot.publish_batch,'draft','publish_drafts_safely'),(history_bot.repair_publish_batch,'published','repair_published_rows')]:
            self.write_manifest(False)
            with patch.multiple(history_bot,defer_interaction=AsyncMock(return_value=True),allowed_user=Mock(return_value=True),active_profile=Mock(return_value=self.profile),read_rows=Mock(return_value=[{**self.private,'status':state}]),audit_failure=AsyncMock(),report_operation_error=AsyncMock(),send_pages=AsyncMock()),patch.object(history_bot,helper)as operation:
                asyncio.run(command.callback(object(),'b'));operation.assert_not_called()
    def test_direct_public_append_blocks_pending_before_read_or_write(self):
        self.write_manifest(False)
        with patch.object(history_bot,'active_profile',return_value=self.profile),patch.object(history_bot,'sheets_client')as client:
            with self.assertRaises(RuntimeError):history_bot.append_public_rows([self.row])
            client.assert_not_called()
    def test_profiles_separate_new_old_and_private_public_without_fallback(self):
        path=self.root/'profiles.json';path.write_text(json.dumps(self.config()))
        profile=load_profile(path,'rebuild_v1');self.assertEqual(profile['public_spreadsheet_id'],'new-public')
        for field,value in [('public_spreadsheet_id','new-private'),('management_spreadsheet_id','old-private')]:
            bad=self.config();bad['environments']['rebuild_v1'][field]=value;path.write_text(json.dumps(bad))
            with self.assertRaises(ValueError):load_profile(path,'rebuild_v1')
        with patch.dict(os.environ,{'HISTORY_ENVIRONMENT':'missing','HISTORY_ENVIRONMENT_FILE':str(path)}):
            with self.assertRaises(RuntimeError):active_profile()
        with patch.dict(os.environ,{'HISTORY_ENVIRONMENT':'rebuild_v1','HISTORY_ENVIRONMENT_FILE':''}):
            with self.assertRaises(RuntimeError):active_profile()
    def test_credentials_paths_never_opened(self):
        with patch.object(Path,'read_text')as read:
            for filename in ['.env.json','service-account.json','credentials.json']:
                with self.assertRaises(ValueError):read_local_json(self.root/filename)
            read.assert_not_called()
    def test_initializer_templates_and_empty_environment(self):
        target=self.root/'init';tool.initialize(target,PREFIX)
        report=tool.validate_environment(target/'management-empty.csv',target/'public-empty.csv',PREFIX)
        self.assertEqual(report['published_questions'],0)
        for filename,headers in [('history-import-13.csv',HEADERS),('history-public-13.csv',HEADERS),('history-management-16.csv',MANAGEMENT_HEADERS)]:
            with (ROOT/'templates'/filename).open(encoding='utf-8',newline='')as f:self.assertEqual(list(csv.reader(f)),[headers])
        with self.assertRaises(ValueError):tool.initialize(target,PREFIX)
    def test_candidates_preserve_body_reissue_ids_pending_and_are_repeatable(self):
        legacy=['001','old-source','Q,\nQ','A','B','C','D','1','']
        source=self.csv_file('legacy.csv',BASE_HEADERS,[legacy]);before=source.read_bytes()
        report=tool.candidates(source,self.root/'first',PREFIX);tool.candidates(source,self.root/'second',PREFIX)
        self.assertEqual(report['approved_questions'],0);self.assertTrue(report['old_and_new_ids_disjoint'])
        self.assertEqual(source.read_bytes(),before)
        self.assertEqual((self.root/'first/candidates-13.csv').read_bytes(),(self.root/'second/candidates-13.csv').read_bytes())
        rows=tool.read_csv(self.root/'first/candidates-13.csv')[1]
        self.assertEqual(rows[1][1:9],legacy[1:9]);self.assertTrue(rows[1][0].startswith(PREFIX))
        self.assertEqual(rows[1][9:],['unclassified','','unclassified',''])
        manifest=json.loads((self.root/'first/review-manifest.json').read_text());self.assertFalse(next(iter(manifest['questions'].values()))['approved'])
        changed=self.csv_file('changed.csv',BASE_HEADERS,[[legacy[0],legacy[1],'Different Q']+legacy[3:]])
        tool.candidates(changed,self.root/'changed',PREFIX)
        self.assertNotEqual(rows[1][0],tool.read_csv(self.root/'changed/candidates-13.csv')[1][1][0])
    def test_changed_classification_resets_review_and_unchanged_approval_is_retained(self):
        self.write_manifest(True)
        source=self.csv_file('current.csv',HEADERS,[[self.row[k]for k in HEADERS]])
        self.assertEqual(tool.review(source,self.root/'same',PREFIX,self.reviews)['unchanged_approvals_retained'],1)
        self.row['area_codes']='geo.france';self.csv_file('current.csv',HEADERS,[[self.row[k]for k in HEADERS]])
        self.assertEqual(tool.review(source,self.root/'changed',PREFIX,self.reviews)['unchanged_approvals_retained'],0)
    def test_public_configuration_contains_no_private_connection_or_credentials(self):
        path=self.root/'profiles.json';path.write_text(json.dumps(self.config()))
        tool.public_configuration(path,'rebuild_v1',self.root/'public-config')
        data=(self.root/'public-config/public-config.json').read_text()
        self.assertNotIn('new-private',data);self.assertNotIn('review_file',data);self.assertNotIn('apiKey',data)
    def test_new_environment_requires_review_for_any_public_data(self):
        private=self.csv_file('private.csv',MANAGEMENT_HEADERS,[[{**self.private,'status':'published'}[k]for k in MANAGEMENT_HEADERS]])
        public=self.csv_file('public.csv',HEADERS,[[self.row[k]for k in HEADERS]])
        with self.assertRaises(ValueError):tool.validate_environment(private,public,PREFIX)
        self.write_manifest(False)
        with self.assertRaises(RuntimeError):tool.validate_environment(private,public,PREFIX,self.reviews)
        self.write_manifest(True);self.assertTrue(tool.validate_environment(private,public,PREFIX,self.reviews)['approval_verified'])

    def test_new_bot_import_rejects_legacy_csv_before_registration(self):
        source=self.csv_file('legacy.csv',BASE_HEADERS,[['001','s','Q','A','B','C','D','1','']])
        interaction=SimpleNamespace(followup=SimpleNamespace(send=AsyncMock()))
        attachment=SimpleNamespace(filename='questions.csv',size=source.stat().st_size,read=AsyncMock(return_value=source.read_bytes()))
        with patch.multiple(history_bot,defer_interaction=AsyncMock(return_value=True),allowed_user=Mock(return_value=True),active_profile=Mock(return_value=self.profile),audit=AsyncMock(),audit_failure=AsyncMock()),patch.object(history_bot,'append_batch')as append:
            asyncio.run(history_bot.import_csv.callback(interaction,attachment));append.assert_not_called()
        self.assertIn('13',interaction.followup.send.await_args.args[0])

    def test_new_import_creates_only_draft_metadata_without_requiring_public_approval(self):
        with patch.object(history_bot,'active_profile',return_value=self.profile),patch.object(history_bot,'read_rows',return_value=[]),patch.object(history_bot,'read_public_rows',return_value=[]),patch.object(history_bot,'sheet_config',return_value=('new-private','sheet')),patch.object(history_bot,'register_with_reconciliation')as register:
            history_bot.append_batch([self.row],'new-batch')
        planned=register.call_args.args[0][0]
        self.assertEqual(planned['status'],'draft');self.assertEqual(planned['batch_id'],'new-batch')
        self.assertTrue(planned['created_at']);self.assertEqual(planned['id'],self.row['id'])

    def test_approved_new_environment_retains_timeout_reconciliation_and_repair(self):
        self.write_manifest(True);shared=[];status=[];calls=[]
        client=Mock()
        def append(**kwargs):
            def execute():
                calls.append(True);shared.extend(dict(zip(HEADERS,values))for values in kwargs['body']['values'])
                if len(calls)==1:raise TimeoutError('synthetic timeout after commit')
            return Mock(execute=execute)
        client.values.return_value.append.side_effect=append
        with patch.object(history_bot,'active_profile',return_value=self.profile),patch.object(history_bot,'read_public_rows',side_effect=lambda:list(shared)),patch.object(history_bot,'public_sheet_config',return_value=('new-public','sheet')),patch.object(history_bot,'sheets_client',return_value=client):
            require_approved([self.private],self.profile)
            publish_drafts_safely([self.private],lambda:list(shared),history_bot.append_public_rows,lambda:status.append('published'))
            self.assertEqual(len(calls),1);self.assertEqual(status,['published']);self.assertEqual(len(shared),1)
            shared.clear()
            repair_published_rows([{**self.private,'status':'published'}],lambda:list(shared),history_bot.append_public_rows)
            self.assertEqual(len(calls),2);self.assertEqual(status,['published']);self.assertEqual(len(shared),1)
