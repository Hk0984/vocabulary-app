import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from contextlib import nullcontext
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import history_bot
import flow_commands
from flow_schema import parse_csv
from discord_display import escape_discord_text


class FlowCommandTests(unittest.IsolatedAsyncioTestCase):
    def interaction(self, guild_id=1, user_id=123):
        return SimpleNamespace(guild_id=guild_id, user=SimpleNamespace(id=user_id), followup=SimpleNamespace(send=AsyncMock()))

    async def test_nonadmin_and_dm_do_not_access_flow_configuration(self):
        for allowed, guild_id in [(False,1), (True,None)]:
            i = self.interaction(guild_id)
            with patch.object(history_bot,'defer_interaction',AsyncMock(return_value=True)), patch.object(history_bot,'allowed_user',return_value=allowed), patch.object(history_bot,'audit',AsyncMock()), patch.object(flow_commands,'configuration') as cfg:
                await history_bot.flow_commands.get_command('list').callback(i)
                cfg.assert_not_called(); self.assertTrue(i.followup.send.call_args.kwargs['ephemeral'])

    async def test_admin_mutations_in_multiple_guilds_share_existing_lock_and_remain_ephemeral(self):
        for guild in [1, 2]:
            i = self.interaction(guild)
            repository = Mock(); repository.execute.return_value = {'hash':'test', 'changes':[], 'target_count':0, 'target_ids':[]}
            with patch.object(history_bot,'defer_interaction',AsyncMock(return_value=True)), patch.object(history_bot,'allowed_user',return_value=True), patch.object(flow_commands,'configuration',return_value={}), patch.object(history_bot,'sheets_client',return_value=Mock()), patch.object(flow_commands,'FlowStore',return_value=repository), patch.object(history_bot,'send_pages',AsyncMock()) as send:
                history_bot._SHEET_MUTATION_LOCK = asyncio.Lock()
                await history_bot.flow_commands.get_command('publish').callback(i, 'qid')
                self.assertFalse(repository.execute.call_args.kwargs.get('apply',False))
                self.assertEqual(repository.execute.call_args.kwargs['actor'],123)
                send.assert_awaited_once()

    def test_command_coexistence_and_registration_has_no_network(self):
        names = {c.name for c in history_bot.bot.tree.get_commands()}
        self.assertTrue({'flow','import','list','check','publish','delete'} <= names)
        self.assertEqual({c.name for c in history_bot.flow_commands.commands}, {'list','show','import','edit','approve','publish','unpublish','validate','recover'})
        publish_parameters=history_bot.flow_commands.get_command('publish').parameters
        self.assertEqual([p.name for p in publish_parameters],['question_id'])
        self.assertFalse(publish_parameters[0].required)

    async def test_list_show_validate_and_edit_approve_import_dispatch(self):
        data=(Path(__file__).resolve().parents[2]/'tests/fixtures/flow-admin.synthetic.csv').read_bytes()
        rows=parse_csv(data,True)
        repository=Mock();repository.snapshot.return_value=(rows,[]);repository.locked.side_effect=lambda:nullcontext()
        repository.execute.return_value={'hash':'review-hash','changes':[]}
        file=SimpleNamespace(filename='drafts.csv',size=len(data),read=AsyncMock(return_value=data))
        with patch.object(history_bot,'defer_interaction',AsyncMock(return_value=True)), patch.object(history_bot,'allowed_user',return_value=True), patch.object(flow_commands,'configuration',return_value={}), patch.object(history_bot,'sheets_client',return_value=Mock()), patch.object(flow_commands,'FlowStore',return_value=repository), patch.object(history_bot,'send_pages',AsyncMock()) as send:
            history_bot._SHEET_MUTATION_LOCK=asyncio.Lock()
            i=self.interaction()
            await history_bot.flow_commands.get_command('list').callback(i,page=2,status='draft',question_type='ordering')
            self.assertIn(escape_discord_text('synthetic_ordering_'),send.call_args.args[1])
            await history_bot.flow_commands.get_command('show').callback(i,question_id=rows[0]['id'])
            self.assertIn(escape_discord_text(rows[0]['id']),send.call_args.args[1])
            await history_bot.flow_commands.get_command('validate').callback(i,file=file)
            self.assertIn('61',send.call_args.args[1])
            await history_bot.flow_commands.get_command('edit').callback(i,question_id=rows[0]['id'],field='explanation',value='改訂',apply=True,plan_hash='review-hash')
            self.assertEqual(repository.execute.call_args.args[0],'edit')
            self.assertTrue(repository.execute.call_args.kwargs['apply'])
            await history_bot.flow_commands.get_command('approve').callback(i,question_id=rows[0]['id'],reviewed=True)
            self.assertTrue(repository.execute.call_args.kwargs['reviewed'])
            await history_bot.flow_commands.get_command('unpublish').callback(i,question_id=rows[0]['id'])
            self.assertEqual(repository.execute.call_args.args[0],'unpublish')
            await history_bot.flow_commands.get_command('import').callback(i,file=file)
            self.assertEqual(len(repository.execute.call_args.kwargs['rows']),61)
            self.assertTrue(repository.execute.call_args.kwargs['apply'])

    async def test_import_update_keeps_explicit_plan_and_invalid_csv_never_opens_store(self):
        data=(Path(__file__).resolve().parents[2]/'tests/fixtures/flow-admin.synthetic.csv').read_bytes()
        file=SimpleNamespace(filename='draft.csv',size=len(data),read=AsyncMock(return_value=data))
        repository=Mock();repository.execute.return_value={'hash':'test','changes':[]}
        with patch.object(history_bot,'defer_interaction',AsyncMock(return_value=True)), patch.object(history_bot,'allowed_user',return_value=True), patch.object(flow_commands,'configuration',return_value={}), patch.object(history_bot,'sheets_client',return_value=Mock()), patch.object(flow_commands,'FlowStore',return_value=repository), patch.object(history_bot,'send_pages',AsyncMock()):
            history_bot._SHEET_MUTATION_LOCK=asyncio.Lock()
            await history_bot.flow_commands.get_command('import').callback(self.interaction(),file=file,update=True)
            self.assertEqual(repository.execute.call_count,1)
            self.assertFalse(repository.execute.call_args.kwargs['apply'])
            self.assertTrue(repository.execute.call_args.kwargs['update'])
        bad=SimpleNamespace(filename='bad.csv',size=10,read=AsyncMock(return_value=b'id,type\nx,y\n'))
        with patch.object(history_bot,'defer_interaction',AsyncMock(return_value=True)), patch.object(history_bot,'allowed_user',return_value=True), patch.object(flow_commands,'configuration') as cfg, patch.object(history_bot,'send_pages',AsyncMock()):
            await history_bot.flow_commands.get_command('import').callback(self.interaction(),file=bad)
            cfg.assert_not_called()

    async def test_expired_interaction_never_loads_data(self):
        with patch.object(history_bot,'defer_interaction',AsyncMock(return_value=False)), patch.object(flow_commands,'configuration') as cfg:
            await history_bot.flow_commands.get_command('validate').callback(self.interaction())
            cfg.assert_not_called()
