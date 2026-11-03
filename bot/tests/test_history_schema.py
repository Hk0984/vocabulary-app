import csv,io,sys,unittest
from pathlib import Path
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from csv_validation import parse_csv,CsvValidationError
from history_classification import HEADERS,BASE_HEADERS,MANAGEMENT_HEADERS,defaults
from public_questions import make_public_rows,publish_drafts_safely
from sheets_write import ROW_FIELDS,ReconciliationError,register_with_reconciliation
import history_bot

def sample():
    return dict(zip(HEADERS,['001','source','Q,\nQ','A','B','C','D','1','','medieval','ce_11','geo.normandy','1066..1066']))
def csv_data(headers,row):
    out=io.StringIO(newline='');writer=csv.writer(out);writer.writerow(headers);writer.writerow(row);return out.getvalue().encode('utf-8-sig')

class HistorySchemaTests(unittest.TestCase):
    def test_csv_legacy_and_current_and_warnings(self):
        row=sample()
        for headers in [BASE_HEADERS,HEADERS]:
            parsed=parse_csv(csv_data(headers,[row[k] for k in headers]))[0]
            self.assertEqual(parsed['id'],'001');self.assertEqual(parsed['question'],'Q,\nQ')
            self.assertEqual(len(parsed),13)
        warnings=[];row['area_codes']='geo.france;geo.normandy'
        parse_csv(csv_data(HEADERS,[row[k] for k in HEADERS]),warnings)
        self.assertTrue(warnings)
    def test_csv_intermediate_and_invalid_classification(self):
        row=sample()
        for size in [10,11,12,14]:
            headers=(HEADERS+['status'])[:size]
            with self.subTest(size=size),self.assertRaises(CsvValidationError):parse_csv(csv_data(headers,[row.get(k,'') for k in headers]))
        for key,value in [('period_codes','modern'),('century_codes','ce_12'),('area_codes','geo.unknown'),('time_ranges','-1..1')]:
            bad={**row,key:value}
            with self.subTest(key=key),self.assertRaises(CsvValidationError):parse_csv(csv_data(HEADERS,[bad[k] for k in HEADERS]))
    def test_exact_order_and_classification_reconciliation(self):
        self.assertEqual(MANAGEMENT_HEADERS[9:12],['status','batch_id','created_at'])
        self.assertEqual(list(ROW_FIELDS),MANAGEMENT_HEADERS)
        source={**sample(),'status':'draft','batch_id':'b','created_at':'2020-01-01T12:34:56+09:00'}
        expected=make_public_rows([source])[0];self.assertEqual(list(expected),HEADERS)
        for field in ['period_codes','century_codes','area_codes','time_ranges']:
            bad={**expected,field:'DIFFERENT'};mark=Mock();append=Mock()
            with self.subTest(field=field),self.assertRaises(ReconciliationError):publish_drafts_safely([source],lambda:[bad],append,mark)
            mark.assert_not_called();append.assert_not_called()
            append=Mock(side_effect=TimeoutError())
            with self.assertRaises(ReconciliationError):register_with_reconciliation([source],lambda:[{**source,field:'DIFFERENT'}],append)
            self.assertEqual(append.call_count,1)
    def test_bot_pads_trailing_cells_and_retains_blank_rows(self):
        row=defaults(sample()); row.update(status='published',batch_id='b',created_at='2020-01-01T12:34:56+09:00')
        values=Mock();values.get.return_value.execute.return_value={'values':[MANAGEMENT_HEADERS,[],[row[k] for k in MANAGEMENT_HEADERS][:-1]]}
        client=Mock();client.values.return_value=values
        with patch.object(history_bot,'sheets_client',return_value=client),patch.object(history_bot,'sheet_config',return_value=('mock','sheet')):
            parsed=history_bot.read_rows()
        self.assertEqual(len(parsed),2);self.assertEqual(parsed[1]['id'],'001');self.assertEqual(parsed[1]['time_ranges'],'')
        self.assertEqual(parsed[1]['created_at'],row['created_at'])
        self.assertEqual(values.get.call_args.kwargs['range'],"'sheet'")
    def test_wrong_headers_stop_all_write_entrypoints(self):
        values=Mock();values.get.return_value.execute.return_value={'values':[BASE_HEADERS]};client=Mock();client.values.return_value=values
        with patch.object(history_bot,'sheets_client',return_value=client),patch.object(history_bot,'sheet_config',return_value=('mock-private','sheet')),patch.object(history_bot,'public_sheet_config',return_value=('mock-public','sheet')):
            for call in [lambda:history_bot.append_batch([sample()]),lambda:history_bot.update_status([2],'published'),lambda:history_bot.append_public_rows([sample()]),lambda:history_bot.clear_public_rows([2])]:
                with self.assertRaises(RuntimeError):call()
        values.append.assert_not_called();values.batchUpdate.assert_not_called();values.batchClear.assert_not_called()

    def test_current_schema_updates_only_status_column_and_public_thirteen_columns(self):
        record={**sample(),'status':'draft','batch_id':'b','created_at':'2020-01-01T00:00:00Z'}
        values=Mock();client=Mock();client.values.return_value=values
        values.get.return_value.execute.return_value={'values':[MANAGEMENT_HEADERS,[record[k] for k in MANAGEMENT_HEADERS]]}
        with patch.object(history_bot,'sheets_client',return_value=client),patch.object(history_bot,'sheet_config',return_value=('mock-private','sheet')):
            history_bot.update_status([2],'published')
        self.assertEqual(values.batchUpdate.call_args.kwargs['body']['data'],[{'range':"'sheet'!J2:J2",'values':[['published']]}])
        values.get.return_value.execute.return_value={'values':[HEADERS]}
        with patch.object(history_bot,'sheets_client',return_value=client),patch.object(history_bot,'public_sheet_config',return_value=('mock-public','sheet')):
            history_bot.append_public_rows([sample()]);history_bot.clear_public_rows([2])
        self.assertEqual(values.append.call_args.kwargs['range'],"'sheet'!A:M")
        self.assertEqual(len(values.append.call_args.kwargs['body']['values'][0]),13)
        self.assertEqual(values.batchClear.call_args.kwargs['body']['ranges'],["'sheet'!A2:M2"])
