"""Safe plain-text display for CSV-controlled values in Discord messages."""

from discord.utils import escape_markdown


def escape_discord_text(value: str) -> str:
    return escape_markdown(str(value))
