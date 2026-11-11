"""Ephemeral, owner-bound publication confirmation. No remote work until confirmed."""
import asyncio
import copy
import discord
from discord_display import escape_discord_text
from flow_schema import FlowError


class PublishConfirmation(discord.ui.View):
    def __init__(self, host, make_store, plan, *, actor, guild_id, question_id=None):
        super().__init__(timeout=180)
        self.host, self.make_store = host, make_store
        self.plan = copy.deepcopy(plan)
        self.actor, self.guild_id, self.question_id = actor, guild_id, question_id
        self.message = None
        self.used = False
        self.claim_lock = asyncio.Lock()

    async def interaction_check(self, interaction):
        allowed = (interaction.user.id == self.actor and interaction.guild_id == self.guild_id
                   and interaction.guild_id is not None and self.host.allowed_user(interaction))
        if not allowed:
            await interaction.response.send_message('確認を開始した管理者本人だけが操作できます。', ephemeral=True)
        return allowed

    async def claim(self, interaction):
        if not await self.interaction_check(interaction):
            return False
        if not await self.host.defer_interaction(interaction):
            return False
        async with self.claim_lock:
            if self.used or self.is_finished():
                await interaction.followup.send('この確認は終了しています。/flow publish をやり直してください。', ephemeral=True)
                return False
            self.used = True
            self.stop()
            for control in self.children:
                control.disabled = True
        if self.message is not None:
            try:
                await self.message.edit(view=self)
            except discord.HTTPException:
                pass
        return True

    @discord.ui.button(label='内容を確認して公開', style=discord.ButtonStyle.danger)
    async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not await self.claim(interaction):
            return
        async with self.host._SHEET_MUTATION_LOCK:
            try:
                def perform():
                    return self.make_store().execute('publish_batch', actor=self.actor, apply=True,
                        expected_plan=self.plan['hash'], question_id=self.question_id)
                result = await asyncio.to_thread(perform)
                await interaction.followup.send(f"{result['target_count']}問を公開しました。", ephemeral=True)
            except FlowError as error:
                await interaction.followup.send('公開を中止しました：'+escape_discord_text(str(error)), ephemeral=True,
                                                allowed_mentions=discord.AllowedMentions.none())
            except Exception:
                await interaction.followup.send('公開の完了を確認できません。未完了操作と /flow recover を確認してください。', ephemeral=True)

    @discord.ui.button(label='キャンセル', style=discord.ButtonStyle.secondary)
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        if await self.claim(interaction):
            await interaction.followup.send('公開をキャンセルしました。', ephemeral=True)

    async def on_timeout(self):
        async with self.claim_lock:
            self.used = True
            self.stop()
            for control in self.children:
                control.disabled = True
        if self.message is not None:
            try:
                await self.message.edit(view=self)
            except discord.HTTPException:
                pass
