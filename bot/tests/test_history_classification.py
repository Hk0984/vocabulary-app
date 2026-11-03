import copy,json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from history_classification import validate,validate_master,load_master,parse_ranges,descendants,matches,defaults
ROOT=Path(__file__).resolve().parents[2]
FIXTURE=json.loads((ROOT/'tests/fixtures/history-classification.json').read_text(encoding='utf-8'))
class ClassificationTests(unittest.TestCase):
    def test_boundaries(self):
        for year,period,century in FIXTURE['years']:
            with self.subTest(year=year):
                row=dict(period_codes=period,century_codes=century,area_codes='geo.france',time_ranges=f'{year}..{year}')
                validate(row)
                self.assertTrue(matches(row,dict(periods=[period],centuries=[century])))
    def test_invalid_and_ambiguity(self):
        for value in FIXTURE['invalidRanges']:
            with self.subTest(value=value),self.assertRaises(ValueError): parse_ranges(value)
        for patch in [dict(period_codes='medieval'),dict(century_codes='ce_17'),dict(area_codes='global;geo.france'),dict(area_codes='geo.france;;geo.normandy'),dict(area_codes='geo.missing'),dict(period_codes='unclassified')]:
            with self.subTest(patch=patch),self.assertRaises(ValueError): validate({**FIXTURE['intersection'],**patch})
        with self.assertRaises(ValueError): validate(dict(period_codes='modern;contemporary',century_codes='ce_19;ce_20',area_codes='global',time_ranges=''))
    def test_master_dag(self):
        master=load_master();self.assertEqual(len(master),92)
        for parent,child,expected in FIXTURE['descendants']: self.assertEqual(child in descendants(master,[parent]),expected)
        data=json.loads((ROOT/'history-regions.json').read_text(encoding='utf-8'))
        for parent in ['geo.missing','geo.europe','geo.france']:
            bad=copy.deepcopy(data);bad['regions'][0]['parents']=[parent]
            with self.assertRaises(ValueError):validate_master(bad)
        bad=copy.deepcopy(data);bad['regions'].append(bad['regions'][0])
        with self.assertRaises(ValueError):validate_master(bad)
    def test_intersection_and_special(self):
        row=FIXTURE['intersection']
        self.assertFalse(matches(row,dict(periods=['modern'],centuries=['ce_18'])))
        self.assertTrue(matches(row,dict(periods=['early_modern','modern'],centuries=['ce_19'],areas=['geo.france'])))
        self.assertFalse(matches({**row,'century_codes':''},dict(centuries=['ce_19'])))
        self.assertFalse(matches({**row,'area_codes':'global'},dict(areas=list(load_master()))))
        self.assertTrue(matches(defaults({}),{}))
        self.assertFalse(matches(defaults({}),dict(areas=['geo.france'])))
