"""Draft write routing tests: fake client only, no credentials or network."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import history_bot
from history_classification import HEADERS, MANAGEMENT_HEADERS
from history_environment import _profile_snapshot


class DraftRoutingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'profiles.json'
        self.profile = {
            'management_spreadsheet_id': 'new-private', 'management_sheet_name': 'history_questions',
            'public_spreadsheet_id': 'new-public', 'public_sheet_name': 'history_questions',
            'id_prefix': 'hv1_rebuild1_', 'review_file': 'reviews.json'}
        self.config = {'schema_version': '1.0', 'legacy_spreadsheet_ids': ['old-private', 'old-public'],
                       'environments': {'rebuild_v1': self.profile}}
        self.path.write_text(json.dumps(self.config), encoding='utf-8')
        self.addCleanup(_profile_snapshot.cache_clear)
        _profile_snapshot.cache_clear()
        self.env = patch.dict(os.environ, {
            'HISTORY_ENVIRONMENT_FILE': str(self.path), 'HISTORY_ENVIRONMENT': 'rebuild_v1',
            'GOOGLE_SHEETS_SPREADSHEET_ID': 'old-private', 'PUBLIC_QUESTIONS_SPREADSHEET_ID': 'old-public'})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.row = dict(zip(HEADERS, ['hv1_rebuild1_smoke_test', 'test', 'Q', 'A', 'B', 'C', 'D',
                                     '1', '', 'contemporary', 'ce_20', 'geo.france', '1919..1919']))

    def client(self):
        service = Mock()
        def get(**kw):
            self.assertIn(kw['spreadsheetId'], ['new-private', 'new-public'])
            headers = MANAGEMENT_HEADERS if kw['spreadsheetId'] == 'new-private' else HEADERS
            return Mock(execute=Mock(return_value={'values': [headers]}))
        service.values.return_value.get.side_effect = get
        return service

    def test_draft_append_only_targets_new_management_and_keeps_metadata(self):
        service = self.client()
        with patch.object(history_bot, 'sheets_client', return_value=service):
            batch = history_bot.append_batch([self.row], 'test-batch')
        self.assertEqual(batch, 'test-batch')
        append = service.values.return_value.append
        append.assert_called_once()
        kw = append.call_args.kwargs
        self.assertEqual(kw['spreadsheetId'], 'new-private')
        self.assertEqual(kw['range'], "'history_questions'!A:P")
        self.assertEqual(kw['valueInputOption'], 'RAW')
        planned = dict(zip(MANAGEMENT_HEADERS, kw['body']['values'][0]))
        self.assertEqual(planned['status'], 'draft')
        self.assertEqual(planned['batch_id'], 'test-batch')
        self.assertTrue(planned['created_at'])
        self.assertTrue(all(planned[k] == self.row[k] for k in HEADERS))
        service.values.return_value.batchUpdate.assert_not_called()
        service.values.return_value.batchClear.assert_not_called()

    def test_any_old_target_or_private_public_collision_stops_before_client(self):
        for field, value in [('management_spreadsheet_id', 'old-private'),
                             ('management_spreadsheet_id', 'old-public'),
                             ('public_spreadsheet_id', 'old-private'),
                             ('public_spreadsheet_id', 'old-public'),
                             ('public_spreadsheet_id', 'new-private')]:
            with self.subTest(field=field, value=value):
                config = json.loads(json.dumps(self.config))
                config['environments']['rebuild_v1'][field] = value
                self.path.write_text(json.dumps(config), encoding='utf-8')
                _profile_snapshot.cache_clear()
                with patch.object(history_bot, 'sheets_client') as client, self.assertRaises(RuntimeError):
                    history_bot.append_batch([self.row], 'test-batch')
                client.assert_not_called()

    def test_missing_or_unknown_selector_never_falls_back_to_legacy(self):
        for name in ['', 'unknown']:
            with patch.dict(os.environ, {'HISTORY_ENVIRONMENT': name}), \
                 patch.object(history_bot, 'sheets_client') as client, self.assertRaises(RuntimeError):
                history_bot.append_batch([self.row], 'test-batch')
            client.assert_not_called()

    def test_old_question_id_is_rejected_before_append(self):
        service = self.client()
        with patch.object(history_bot, 'sheets_client', return_value=service), self.assertRaises(ValueError):
            history_bot.append_batch([{**self.row, 'id': 'old-001'}], 'test-batch')
        service.values.return_value.append.assert_not_called()
