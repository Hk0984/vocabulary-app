import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from flow_schema import FlowError
from flow_store import configuration as flow_configuration
from history_bot import allowed_user, check_configuration, credential_path, sheet_config
from history_environment import public_web_book_ids, repository_path, REPO_ROOT


class BotConfigurationTests(unittest.TestCase):
    def test_relative_paths_are_anchored_and_stale_path_is_not_printed(self):
        self.assertEqual(repository_path('bot/example.json'), REPO_ROOT/'bot'/'example.json')
        with patch.dict(os.environ, {'GOOGLE_SERVICE_ACCOUNT_FILE':'private_missing_path.json'}, clear=True):
            with self.assertRaises(RuntimeError) as error:
                check_configuration()
            self.assertNotIn('private_missing_path',str(error.exception))

    def test_check_does_not_read_credential_file_or_connect(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'fixture.json'
            path.touch()
            config = {
                'GOOGLE_SERVICE_ACCOUNT_FILE':str(path),
                'GOOGLE_SHEETS_SPREADSHEET_ID':'fixture-admin',
                'PUBLIC_QUESTIONS_SPREADSHEET_ID':'fixture-public',
                'DISCORD_GUILD_ID':'123',
                'ADMIN_USER_IDS':'456',
            }
            with patch.dict(os.environ,config,clear=True), patch('history_bot.Credentials.from_service_account_file') as read:
                self.assertEqual(credential_path(),path)
                check_configuration()
                read.assert_not_called()
                os.environ['PUBLIC_QUESTIONS_SPREADSHEET_ID'] = 'fixture-admin'
                with self.assertRaises(RuntimeError):
                    check_configuration()

    def test_configured_discord_guild_and_operator_both_must_match(self):
        with patch.dict(os.environ, {'DISCORD_GUILD_ID':'123','ADMIN_USER_IDS':'456'},clear=True):
            self.assertTrue(allowed_user(SimpleNamespace(guild_id=123,user=SimpleNamespace(id=456))))
            self.assertFalse(allowed_user(SimpleNamespace(guild_id=789,user=SimpleNamespace(id=456))))
            self.assertFalse(allowed_user(SimpleNamespace(guild_id=123,user=SimpleNamespace(id=789))))
            self.assertFalse(allowed_user(SimpleNamespace(guild_id=None,user=SimpleNamespace(id=456))))

    def test_known_public_books_are_rejected_as_management_destinations(self):
        self.assertGreaterEqual(len(public_web_book_ids()), 3)
        for public_id in public_web_book_ids():
            config = {
                'GOOGLE_SHEETS_SPREADSHEET_ID': public_id,
                'FLOW_ADMIN_SPREADSHEET_ID': public_id,
                'FLOW_ADMIN_SHEET_NAME': 'history_flow_admin',
                'FLOW_PUBLIC_SPREADSHEET_ID': 'fixture-flow-public',
                'FLOW_PUBLIC_SHEET_NAME': 'history_flow_public',
            }
            with patch.dict(os.environ, config, clear=True):
                with self.assertRaisesRegex(RuntimeError, '公開ブック'):
                    sheet_config()
                os.environ.pop('GOOGLE_SHEETS_SPREADSHEET_ID')
                with self.assertRaisesRegex(FlowError, '公開ブック'):
                    flow_configuration()
            profile = {'management_spreadsheet_id': public_id, 'management_sheet_name': 'history_questions'}
            with patch('history_bot.active_profile', return_value=profile):
                with self.assertRaisesRegex(RuntimeError, '公開ブック'):
                    sheet_config()

    def test_missing_or_invalid_discord_scope_fails_closed(self):
        interaction = SimpleNamespace(guild_id=123, user=SimpleNamespace(id=456))
        for config in (
            {'ADMIN_USER_IDS': '456'},
            {'DISCORD_GUILD_ID': '123'},
            {'DISCORD_GUILD_ID': '123', 'ADMIN_USER_IDS': '456,invalid'},
        ):
            with self.subTest(config=config), patch.dict(os.environ, config, clear=True), patch('history_bot.credential_path'):
                self.assertFalse(allowed_user(interaction))
                with self.assertRaises(RuntimeError):
                    check_configuration()
