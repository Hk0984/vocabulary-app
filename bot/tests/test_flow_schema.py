import copy
import csv
import io
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'bot'))
from flow_schema import ADMIN_HEADERS, PUBLIC_HEADERS, FlowError, csv_bytes, parse_csv, public_rows, report, temporal_issues, to_question, validate_rows


class FlowSchemaTests(unittest.TestCase):
    def setUp(self):
        self.rows = parse_csv((ROOT/'tests/fixtures/flow-admin.synthetic.csv').read_bytes(), intake=True)

    def test_all_61_drafts_roundtrip_metadata_and_public_projection(self):
        result = report(self.rows)
        self.assertEqual(result['questions'], 61)
        self.assertEqual(result['types'], {'contemporary':31, 'ordering':30})
        self.assertEqual(result['statuses'], {'draft':61})
        self.assertEqual(result['temporal_issues'], [])
        self.assertEqual(parse_csv(csv_bytes(self.rows)), self.rows)
        self.assertEqual(public_rows(self.rows), [])
        approved = [{**r, 'status':'approved'} for r in self.rows]
        self.assertEqual(public_rows(approved), [])
        published = public_rows([{**r, 'status':'published'} for r in self.rows])
        self.assertEqual(len(published), 61)
        for r in published:
            self.assertEqual(list(r), PUBLIC_HEADERS)
            self.assertNotIn('source', to_question(r))
            self.assertNotIn('status', r)

    def test_bad_headers_duplicates_and_intake_status(self):
        self.assertRaises(FlowError, parse_csv, b'id,type\nx,y\n')
        self.assertRaises(FlowError, validate_rows, [self.rows[0], self.rows[0]])
        for state in ['approved', 'published']:
            self.assertRaises(FlowError, parse_csv, csv_bytes([{**self.rows[0], 'status':state}]), True)

    def test_invalid_columns_items_ids_dates_codes_and_formulas(self):
        variants = [('answer','missing'), ('status','bad'), ('type','bad'), ('item2_id','a'),
                    ('item4_text',''), ('time_ranges','0..1'), ('area_codes','geo.missing'),
                    ('century_codes','ce_01'), ('question','=IMPORTXML("x")'), ('source',' @mention')]
        for key, value in variants:
            with self.subTest(key=key):
                self.assertRaises(FlowError, validate_rows, [{**self.rows[0], key:value}])
        ordering = next(r for r in self.rows if r['type']=='ordering')
        self.assertRaises(FlowError, validate_rows, [{**ordering, 'answer':'a;a;b'}])
        self.assertRaises(FlowError, parse_csv, b'\xff')
        self.assertRaises(FlowError, parse_csv, b'"unterminated')

    def test_temporal_checks_report_without_modifying_content(self):
        row = copy.deepcopy(next(r for r in self.rows if r['type']=='ordering'))
        row['answer'] = ';'.join(reversed(row['answer'].split(';')))
        before = copy.deepcopy(row)
        self.assertTrue(temporal_issues(row))
        self.assertEqual(row, before)
        row = {**self.rows[0], 'item1_time_ranges':self.rows[0]['item2_time_ranges']}
        self.assertTrue(temporal_issues(row))

    def test_csv_quotes_newlines_and_three_item_ordering(self):
        row = {**self.rows[0], 'question':'問題,"引用"\n次の行'}
        self.assertEqual(parse_csv(csv_bytes([row])), [row])
        row = copy.deepcopy(next(r for r in self.rows if r['type']=='ordering'))
        removed = row['item4_id']
        row.update({f'item4_{key}':'' for key in ['id','text','time_ranges']})
        row['answer'] = ';'.join(k for k in row['answer'].split(';') if k!=removed)
        self.assertEqual(len(to_question(validate_rows([row])[0])['events']), 3)

    def test_cloze_keeps_columns_and_requires_approval_for_publish(self):
        import json
        from flow_store import plan_operation
        sample = json.loads((ROOT/'templates/history-flow-cloze.sample.json').read_text())['questions'][0]
        row = dict.fromkeys(ADMIN_HEADERS, '')
        row.update((key,value) for key,value in sample.items() if key in row)
        row['status'] = 'draft'
        for index, blank in enumerate(sample['blanks'], 1):
            row[f'item{index}_id'] = blank['id']
            row[f'item{index}_text'] = json.dumps({k:v for k,v in blank.items() if k!='id'},ensure_ascii=False)
        self.assertEqual(parse_csv(csv_bytes([row]),True),[row])
        self.assertEqual(to_question(row),sample)
        self.assertEqual(plan_operation([row],[],'publish_batch',actor='test')[0]['target_count'],0)
        with self.assertRaisesRegex(FlowError, '承認'):
            plan_operation([row],[],'publish_batch',actor='test',question_id=row['id'])
        _, approved, _ = plan_operation([row],[],'approve',actor='test',question_id=row['id'],reviewed=True)
        _, _, released = plan_operation(approved,[],'publish_batch',actor='test',question_id=row['id'])
        self.assertEqual(list(released[0]),PUBLIC_HEADERS)
        self.assertEqual(to_question(released[0]),sample)
        with self.assertRaisesRegex(FlowError,'参照'):
            validate_rows([{**row,'question':'{square}と{square}'}])

    def test_prepare_cli_references_registered_public_rows_and_never_overwrites(self):
        import json
        import subprocess
        import tempfile
        from history_classification import HEADERS
        from flow_store import plan_operation
        sample = json.loads((ROOT/'templates/history-flow-cloze.sample.json').read_text())['questions'][0]
        sample['blanks'][0]['choices'][0].pop('text')
        sample['blanks'][0]['choices'][0]['from'] = 'prior_question'
        with tempfile.TemporaryDirectory() as tmp:
            source, recipe, out = (Path(tmp)/name for name in ('source.csv','recipe.json','draft.csv'))
            with source.open('w',encoding='utf-8',newline='') as handle:
                writer = csv.writer(handle)
                writer.writerow(HEADERS)
                writer.writerow(['prior_question','s1','会議はどこで開かれたか','広場','港','市場','道路','1','',
                                 'unclassified','','unclassified',''])
            recipe.write_text(json.dumps({'schema_version':'1.1','questions':[sample]},ensure_ascii=False),encoding='utf-8')
            cmd = [sys.executable,str(ROOT/'scripts/manage-flow.py'),'prepare','--csv',str(source),'--recipe',str(recipe),'--out',str(out)]
            subprocess.run(cmd,check=True,capture_output=True)
            draft = parse_csv(out.read_bytes(),True)[0]
            self.assertEqual(draft['source'],'flow-origin:prior_question')
            self.assertEqual(to_question(draft)['blanks'][0]['choices'][0]['text'],'広場')
            with self.assertRaisesRegex(FlowError, '承認'):
                plan_operation([draft],[],'publish_batch',actor='test',question_id=draft['id'])
            self.assertNotEqual(subprocess.run(cmd,capture_output=True).returncode,0)
            self.assertEqual(parse_csv(out.read_bytes(),True),[draft])
