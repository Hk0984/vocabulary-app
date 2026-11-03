import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

from history_classification import HEADERS, MANAGEMENT_HEADERS

spec = importlib.util.spec_from_file_location(
    'readonly_connection', Path(__file__).resolve().parents[2] / 'scripts/check-history-sheets-readonly.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class ReadonlyConnectionTests(unittest.TestCase):
    def service(self, private=None, public=None):
        service = Mock()
        service.get.side_effect = lambda **kw: Mock(execute=Mock(return_value={
            'spreadsheetId': kw['spreadsheetId'],
            'sheets': [{'properties': {'title': 'history_questions'}}]}))
        tables = {'private': [MANAGEMENT_HEADERS] if private is None else private,
                  'public': [HEADERS] if public is None else public}
        service.values.return_value.get.side_effect = lambda **kw: Mock(
            execute=Mock(return_value={'values': tables[kw['spreadsheetId']]}))
        return service

    def check(self, service, **kw):
        return tool.check_connections(service, 'private', 'public', 'history_questions',
                                      kw.get('prefix', 'hv1_rebuild1_'))

    def test_empty_new_sheets_validate_using_get_only(self):
        service = self.service()
        result = self.check(service)
        self.assertEqual(result['production_writes'], 0)
        self.assertEqual(result['management']['columns'], 16)
        self.assertEqual(result['public']['columns'], 13)
        self.assertEqual(result['public']['questions'], 0)
        self.assertEqual(tool.SCOPES, ['https://www.googleapis.com/auth/spreadsheets.readonly'])
        self.assertEqual([call[0] for call in service.mock_calls],
                         ['get', 'values', 'values().get'] * 2)
        for call in service.values.return_value.get.call_args_list:
            self.assertEqual(call.kwargs['range'], "'history_questions'")

    def test_invalid_or_extra_headers_fail(self):
        for table in [[], [HEADERS[:-1]], [HEADERS + ['unexpected']]]:
            with self.subTest(table=table), self.assertRaises(ValueError):
                self.check(self.service(public=table))

    def test_wrong_target_or_tab_fails(self):
        for metadata in [{'spreadsheetId': 'wrong'}, {'spreadsheetId': 'private', 'sheets': []}]:
            service = self.service()
            service.get.side_effect = None
            service.get.return_value.execute.return_value = metadata
            with self.assertRaises(ValueError):
                self.check(service)
            service.values.assert_not_called()

    def test_invalid_prefix_fails_before_request(self):
        service = self.service()
        with self.assertRaises(ValueError):
            self.check(service, prefix='legacy_')
        service.get.assert_not_called()

    def test_same_book_is_rejected_before_request(self):
        service = self.service()
        with self.assertRaises(ValueError):
            tool.check_connections(service, 'same', 'same', 'history_questions', 'hv1_rebuild1_')
        service.get.assert_not_called()

    def test_existing_questions_fail_header_only_check(self):
        row = ['hv1_rebuild1_test', 's', 'Q', 'A', 'B', 'C', 'D', '1', '',
               'unclassified', '', 'unclassified', '']
        # A malformed/nonempty sheet must never be treated as the requested empty environment.
        with self.assertRaises(ValueError):
            self.check(self.service(public=[HEADERS, row]))
