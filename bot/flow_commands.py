"""Flow-only slash commands. All content and plans remain administrator-ephemeral."""
import asyncio
import io
import json
import discord
from discord import app_commands
from discord_display import escape_discord_text
from flow_schema import FlowError, parse_csv, report
from flow_store import FlowStore, configuration
from flow_confirmation import PublishConfirmation


def register_flow_commands(host):
    group = app_commands.Group(name='flow', description='世界史の流れ専用の管理・審査・公開')

    def store():
        config = configuration()  # Stop before constructing credentials on bad/missing settings.
        return FlowStore(host.sheets_client(), config)

    async def authorize(interaction):
        if not await host.defer_interaction(interaction):
            return False
        if not host.allowed_user(interaction) or interaction.guild_id is None:
            await interaction.followup.send('サーバー内の管理者だけが利用できます。', ephemeral=True)
            await host.audit(interaction, 'operation_failure', False)
            return False
        return True

    async def output(interaction, result):
        text = json.dumps(result, ensure_ascii=False, indent=2)
        if len(text) <= 5500:
            await host.send_pages(interaction, escape_discord_text(text))
        else:
            await interaction.followup.send(f"検証・差分は添付JSONを確認してください。plan_hash: {result.get('hash', 'なし')}",
                file=discord.File(io.BytesIO(text.encode('utf-8')), filename='flow-review.json'), ephemeral=True,
                allowed_mentions=discord.AllowedMentions.none())

    async def run(interaction, action, apply=False, plan_hash='', auto_import=False, **kwargs):
        async with host._SHEET_MUTATION_LOCK:
            try:
                def perform():
                    repository = store()
                    if action == 'recover':
                        return repository.recover(actor=interaction.user.id, apply=apply, expected_plan=plan_hash)
                    if auto_import:
                        plan = repository.execute('import', actor=interaction.user.id, **kwargs)
                        return repository.execute('import', actor=interaction.user.id, apply=True,
                                                  expected_plan=plan['hash'], **kwargs)
                    return repository.execute(action, actor=interaction.user.id, apply=apply, expected_plan=plan_hash, **kwargs)
                result = await asyncio.to_thread(perform)
                if auto_import:
                    count = len(result['changes'])
                    await host.send_pages(interaction, f'{count}問をdraft登録しました。公開は /flow publish で確認してください。' if count else '登録内容に変更はありません。既存の状態を維持しました。')
                else:
                    await output(interaction, result)
            except FlowError as e:
                await host.send_pages(interaction, escape_discord_text(str(e)))
            except Exception:
                await host.send_pages(interaction, 'flow操作を完了できません。設定・接続・未完了操作を管理者が確認してください。')

    @group.command(name='import', description='CSV全件を検証して新規問題をdraft登録します')
    async def import_csv(interaction: discord.Interaction, file: discord.Attachment, update: bool=False, apply: bool | None=None, plan_hash: str=''):
        if not await authorize(interaction): return
        try:
            if not file.filename.lower().endswith('.csv') or file.size > 5*1024*1024:
                raise FlowError('5MiB以内のCSVを指定してください')
            rows = await asyncio.to_thread(parse_csv, await file.read(), True)
        except FlowError as e:
            await host.send_pages(interaction, escape_discord_text(str(e))); return
        except Exception:
            await host.send_pages(interaction, '添付CSVを取得できません。再度確認してください。'); return
        auto_import = not update and apply is not False and not plan_hash
        await run(interaction, 'import', bool(apply), plan_hash, auto_import=auto_import, rows=rows, update=update)

    @group.command(name='edit', description='1フィールドの差分確認・更新。変更後はdraftに戻します')
    async def edit(interaction: discord.Interaction, question_id: str, field: str, value: str, apply: bool=False, plan_hash: str=''):
        if await authorize(interaction):
            await run(interaction, 'edit', apply, plan_hash, question_id=question_id, field=field, value=value)

    @group.command(name='approve', description='史実・正解・分類を人手確認した問題を承認します')
    async def approve(interaction: discord.Interaction, question_id: str, reviewed: bool=False, apply: bool=False, plan_hash: str=''):
        if await authorize(interaction):
            await run(interaction, 'approve', apply, plan_hash, question_id=question_id, reviewed=reviewed)

    @group.command(name='publish', description='draft全件または指定問題を確認ボタンで公開します')
    async def publish(interaction: discord.Interaction, question_id: str | None=None):
        if not await authorize(interaction): return
        try:
            async with host._SHEET_MUTATION_LOCK:
                def prepare():
                    return store().execute('publish_batch', actor=interaction.user.id, question_id=question_id)
                plan = await asyncio.to_thread(prepare)
            if not plan['target_count']:
                await host.send_pages(interaction, '公開対象のdraftがありません。approvedの再公開はquestion_idを指定してください。')
                return
            summary = f"公開対象：{plan['target_count']}問\n対象ID：\n"+'\n'.join(plan['target_ids'])
            summary += '\n変更：対象をpublishedに変更し、公開用21列へ追加します。既存のpublishedは維持します。'
            await host.send_pages(interaction, escape_discord_text(summary))
            await output(interaction, plan)
            view = PublishConfirmation(host, store, plan, actor=interaction.user.id,
                                       guild_id=interaction.guild_id, question_id=question_id)
            view.message = await interaction.followup.send('対象ID・差分・問題内容を確認後、180秒以内に公開を確定してください。',
                view=view, ephemeral=True, wait=True, allowed_mentions=discord.AllowedMentions.none())
        except FlowError as error:
            await host.send_pages(interaction, escape_discord_text(str(error)))
        except Exception:
            await host.send_pages(interaction, '公開確認を作成できません。設定・接続・未完了操作を確認してください。')

    @group.command(name='unpublish', description='公開を取り消してapprovedへ戻します')
    async def unpublish(interaction: discord.Interaction, question_id: str, apply: bool=False, plan_hash: str=''):
        if await authorize(interaction): await run(interaction, 'unpublish', apply, plan_hash, question_id=question_id)

    @group.command(name='recover', description='未完了操作の照合とバックアップへのロールバック')
    async def recover(interaction: discord.Interaction, apply: bool=False, plan_hash: str=''):
        if await authorize(interaction): await run(interaction, 'recover', apply, plan_hash)

    @group.command(name='list', description='問題を状態・形式で絞り込んで一覧表示します')
    async def list_questions(interaction: discord.Interaction, page: int=1, status: str='', question_type: str=''):
        if not await authorize(interaction): return
        try:
            if page < 1: raise FlowError('pageは1以上です')
            def load():
                repository = store()
                with repository.locked(): return repository.snapshot()[0]
            rows = [r for r in await asyncio.to_thread(load) if (not status or r['status']==status) and (not question_type or r['type']==question_type)]
            await output(interaction, {'page':page, 'total':len(rows), 'questions':[{k:r[k] if k!='question' else r[k][:100] for k in ['id','type','question','status','period_codes','area_codes']} for r in rows[(page-1)*10:page*10]]})
        except Exception:
            await host.send_pages(interaction, '一覧を取得できません。設定・シート整合性を確認してください。')

    @group.command(name='show', description='指定IDの問題全文・正解・分類・出典を管理者に表示します')
    async def show(interaction: discord.Interaction, question_id: str):
        if not await authorize(interaction): return
        try:
            def load():
                repository = store()
                with repository.locked(): return repository.snapshot()[0]
            rows = [r for r in await asyncio.to_thread(load) if r['id']==question_id]
            await output(interaction, {'questions':rows})
        except Exception:
            await host.send_pages(interaction, '詳細を取得できません。設定・シート整合性を確認してください。')

    @group.command(name='validate', description='添付CSVまたは管理シートの全件を検証します')
    async def validate(interaction: discord.Interaction, file: discord.Attachment | None=None):
        if not await authorize(interaction): return
        try:
            if file:
                if not file.filename.lower().endswith('.csv') or file.size > 5*1024*1024: raise FlowError('5MiB以内のCSVが必要です')
                rows = await asyncio.to_thread(parse_csv, await file.read(), True)
            else:
                def load():
                    repository = store()
                    with repository.locked(): return repository.snapshot()[0]
                rows = await asyncio.to_thread(load)
            await output(interaction, await asyncio.to_thread(report, rows))
        except FlowError as e:
            await host.send_pages(interaction, escape_discord_text(str(e)))
        except Exception:
            await host.send_pages(interaction, '検証できません。設定・接続を確認してください。')

    host.bot.tree.add_command(group)
    return group
