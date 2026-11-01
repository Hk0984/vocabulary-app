import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from discord_display import escape_discord_text


class DiscordDisplayTests(unittest.TestCase):
    def test_csv_markdown_is_escaped(self):
        value = "**bold** [spoof](https://example.test)"
        escaped = escape_discord_text(value)
        self.assertNotEqual(escaped, value)
        self.assertIn("\\*", escaped)
        self.assertNotIn("**bold**", escaped)


if __name__ == "__main__":
    unittest.main()
