import asyncio
import copy
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'bot'))
from flow_confirmation import PublishConfirmation
from flow_schema import ADMIN_HEADERS, PUBLIC_HEADERS, FlowError, parse_csv
from flow_store import FlowStore
from test_flow_store import FakeSheets
import history_bot
import flow_commands


class ConfirmationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        env=patch.dict(os.environ,{'ADMIN_USER_IDS':'123'},clear=True);env.start();self.addCleanup(env.stop)
        self.client=FakeSheets()
        self.store=FlowStore(self.client,{'admin_id':'flow-admin','admin_title':'history_flow_admin','public_id':'flow-public','public_title':'history_flow_public'},self.temp.name)
        self.rows=parse_csv((ROOT/'tests/fixtures/flow-admin.synthetic.csv').read_bytes(),True)
        plan=self.store.execute('import',actor=123,rows=self.rows)
        self.store.execute('import',actor=123,rows=self.rows,apply=True,expected_plan=plan['hash'])
        self.host=SimpleNamespace(_SHEET_MUTATION_LOCK=asyncio.Lock(),allowed_user=lambda i:i.user.id==123,
                                  defer_interaction=AsyncMock(return_value=True))

    def interaction(self,user=123,guild=1):
        return SimpleNamespace(user=SimpleNamespace(id=user),guild_id=guild,
            response=SimpleNamespace(send_message=AsyncMock()),followup=SimpleNamespace(send=AsyncMock()))

    def view(self):
        plan=self.store.execute('publish_batch',actor=123)
        view=PublishConfirmation(self.host,lambda:self.store,plan,actor=123,guild_id=1)
        view.message=SimpleNamespace(edit=AsyncMock())
        return view

    async def test_61_publish_only_after_owner_confirms_and_double_click_is_safe(self):
        view=self.view();writes=len(self.client.writes)
        self.assertEqual(view.plan['target_count'],61)
        self.assertEqual(self.store.snapshot()[1],[])
        i=self.interaction()
        await view.confirm.callback(i)
        self.assertEqual(len(self.store.snapshot()[1]),61)
        self.assertTrue(all(r['status']=='published' for r in self.store.snapshot()[0]))
        self.assertEqual(len(self.client.writes),writes+2)
        await view.confirm.callback(i)
        self.assertEqual(len(self.client.writes),writes+2)
        self.assertTrue(all(control.disabled for control in view.children))
        self.assertTrue(all(call.kwargs['ephemeral'] for call in i.followup.send.call_args_list))

    async def test_other_admin_wrong_guild_and_revoked_admin_cannot_confirm(self):
        view=self.view();writes=len(self.client.writes)
        self.host.allowed_user=lambda i:True
        for i in [self.interaction(user=999),self.interaction(guild=2)]:
            await view.confirm.callback(i)
            i.response.send_message.assert_awaited_once()
        self.host.allowed_user=lambda i:False
        await view.confirm.callback(self.interaction())
        self.assertEqual(len(self.client.writes),writes)
        self.assertFalse(view.used)

    async def test_cancel_and_timeout_never_publish(self):
        for cancel in [True,False]:
            view=self.view();writes=len(self.client.writes)
            if cancel:await view.cancel.callback(self.interaction())
            else:await view.on_timeout()
            await view.confirm.callback(self.interaction())
            self.assertEqual(len(self.client.writes),writes)
            self.assertEqual(self.store.snapshot()[1],[])

    async def test_changed_content_or_added_target_after_preview_aborts(self):
        for extra in [False,True]:
            view=self.view();writes=len(self.client.writes)
            if extra:
                row={**self.rows[0],'id':'extra_draft'}
                self.client.tables['flow-admin'].append([row[k] for k in ADMIN_HEADERS])
            else:
                self.client.tables['flow-admin'][1][ADMIN_HEADERS.index('explanation')]='確認後に変更された解説'
            i=self.interaction();await view.confirm.callback(i)
            self.assertEqual(len(self.client.writes),writes)
            self.assertEqual(self.store.snapshot()[1],[])
            self.assertIn('中止',i.followup.send.call_args.args[0])

    async def test_invalid_data_is_revalidated_at_confirmation(self):
        view=self.view();writes=len(self.client.writes)
        self.client.tables['flow-admin'][1][ADMIN_HEADERS.index('answer')]='missing'
        i=self.interaction();await view.confirm.callback(i)
        self.assertEqual(len(self.client.writes),writes)
        self.assertIn('中止',i.followup.send.call_args.args[0])

    async def test_partial_failure_stops_and_recovery_restores_all_drafts(self):
        view=self.view();self.client.fail_side='flow-public'
        await view.confirm.callback(self.interaction())
        self.assertTrue(self.store.pending.exists())
        self.assertRaises(FlowError,self.store.execute,'publish_batch',actor=123)
        plan=self.store.recover(actor=123)
        self.store.recover(actor=123,apply=True,expected_plan=plan['hash'])
        self.assertTrue(all(r['status']=='draft' for r in self.store.snapshot()[0]))
        self.assertEqual(self.store.snapshot()[1],[])
        await self.view().confirm.callback(self.interaction())
        self.assertEqual(len(self.store.snapshot()[1]),61)

    async def test_competing_confirmations_do_not_publish_twice(self):
        first,second=self.view(),self.view();writes=len(self.client.writes)
        await asyncio.gather(first.confirm.callback(self.interaction()),second.confirm.callback(self.interaction()))
        self.assertEqual(len(self.client.writes),writes+2)
        self.assertEqual(len(self.store.snapshot()[1]),61)

    async def test_two_commands_import_then_confirm_publish_all_61(self):
        self.client.tables={'flow-admin':[ADMIN_HEADERS.copy()],'flow-public':[PUBLIC_HEADERS.copy()]}
        self.client.writes.clear()
        data=(ROOT/'tests/fixtures/flow-admin.synthetic.csv').read_bytes()
        file=SimpleNamespace(filename='draft.csv',size=len(data),read=AsyncMock(return_value=data))
        i=self.interaction();i.followup.send.return_value=SimpleNamespace(edit=AsyncMock())
        with patch.object(history_bot,'defer_interaction',AsyncMock(return_value=True)), patch.object(history_bot,'allowed_user',return_value=True), patch.object(history_bot,'_SHEET_MUTATION_LOCK',asyncio.Lock()), patch.object(flow_commands,'configuration',return_value=self.store.config), patch.object(history_bot,'sheets_client',return_value=self.client), patch.object(flow_commands,'FlowStore',return_value=self.store), patch.object(history_bot,'send_pages',AsyncMock()) as send:
            await history_bot.flow_commands.get_command('import').callback(i,file=file)
            self.assertEqual(len(self.client.writes),1)
            self.assertTrue(all(r['status']=='draft' for r in self.store.snapshot()[0]))
            await history_bot.flow_commands.get_command('publish').callback(i)
            self.assertEqual(len(self.client.writes),1)
            view=i.followup.send.call_args.kwargs['view']
            self.assertEqual(view.plan['target_count'],61)
            self.assertTrue(i.followup.send.call_args.kwargs['ephemeral'])
            self.assertTrue(any('61' in c.args[1] for c in send.call_args_list))
            await view.confirm.callback(i)
            self.assertEqual(len(self.client.writes),3)
            self.assertEqual(len(self.store.snapshot()[1]),61)
            for call in i.followup.send.call_args_list:
                if 'file' in call.kwargs:call.kwargs['file'].close()

    async def test_lost_public_write_response_stops_until_explicit_recovery(self):
        view=self.view();self.client.fail_side='flow-public';self.client.lost_response=True
        await view.confirm.callback(self.interaction())
        self.assertTrue(self.store.pending.exists())
        self.assertEqual(len(self.store.snapshot()[1]),61)
        writes=len(self.client.writes)
        await view.confirm.callback(self.interaction())
        self.assertEqual(len(self.client.writes),writes)
        plan=self.store.recover(actor=123)
        self.store.recover(actor=123,apply=True,expected_plan=plan['hash'])
        self.assertEqual(self.store.snapshot()[1],[])
        self.assertTrue(all(r['status']=='draft' for r in self.store.snapshot()[0]))
