import csv,importlib.util,json,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('history_migration',ROOT/'scripts/migrate-history.py')
migration=importlib.util.module_from_spec(spec);spec.loader.exec_module(migration)

class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.row=['001','s','Q,\n Q ','A','B','C','D','1','']
        self.write('private.csv',migration.LEGACY_MANAGEMENT,[self.row+['published','batch','2020-01-01T12:34:56+09:00'],self.row[:0],['002']+self.row[1:]+['draft','batch','2020-01-01']])
        self.write('public.csv',migration.BASE_HEADERS,[self.row])
    def write(self,name,header,rows):
        with (self.root/name).open('w',encoding='utf-8-sig',newline='')as f:
            writer=csv.writer(f);writer.writerow(header);writer.writerows(rows)
    def convert(self,out='output'):
        return migration.convert_pair(self.root/'private.csv',self.root/'public.csv',self.root/out)
    def test_preservation_and_idempotence(self):
        report=self.convert();self.assertTrue(report['existing_cells_preserved']);self.assertEqual(report['management_rows'],3)
        with (self.root/'output/management.csv').open(newline='',encoding='utf-8')as f: rows=list(csv.reader(f))
        self.assertEqual(rows[1][:12],self.row+['published','batch','2020-01-01T12:34:56+09:00']);self.assertEqual(rows[1][12:],['unclassified','','unclassified',''])
        self.assertEqual(rows[0][9:12],['status','batch_id','created_at'])
        second=migration.convert_pair(self.root/'output/management.csv',self.root/'output/public.csv',self.root/'second')
        self.assertFalse(second['legacy_conversion'])
        for name in ['management.csv','public.csv']:self.assertEqual((self.root/'output'/name).read_bytes(),(self.root/'second'/name).read_bytes())
    def test_mismatch_or_duplicate_stops_before_creating_output(self):
        for rows in [[self.row,self.row],[['009']+self.row[1:]],[self.row[:2]+['changed']+self.row[3:]],[]]:
            self.write('public.csv',migration.BASE_HEADERS,rows)
            with self.assertRaises(ValueError):self.convert()
            self.assertFalse((self.root/'output').exists())
    def test_draft_never_becomes_public(self):
        self.write('public.csv',migration.BASE_HEADERS,[self.row,['002']+self.row[1:]])
        with self.assertRaises(ValueError):self.convert()
    def test_mixed_schema_and_output_overwrite_are_rejected(self):
        self.convert()
        with self.assertRaises(ValueError):self.convert()
        with self.assertRaises(ValueError):migration.convert_pair(self.root/'private.csv',self.root/'output/public.csv',self.root/'mixed')
        self.assertFalse((self.root/'mixed').exists())
