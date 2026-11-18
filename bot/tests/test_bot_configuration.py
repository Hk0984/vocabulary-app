import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from history_bot import allowed_user, check_configuration, credential_path
from history_environment import repository_path, REPO_ROOT


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
