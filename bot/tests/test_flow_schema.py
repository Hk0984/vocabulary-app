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
