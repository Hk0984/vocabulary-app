import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

BOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BOT_DIR))
from instance_lock import acquire_instance_lock, release_instance_lock


class InstanceLockTests(unittest.TestCase):
    def run_child(self, lock_path):
        child_code = (
            "import sys; from pathlib import Path; "
            f"sys.path.insert(0, {str(BOT_DIR)!r}); "
            "from instance_lock import AlreadyRunningError, acquire_instance_lock, release_instance_lock; "
            "p=Path(sys.argv[1]); "
            "\ntry:\n h=acquire_instance_lock(p)\n"
            "except AlreadyRunningError:\n print('locked')\n"
            "else:\n release_instance_lock(h); print('acquired')"
        )
        return subprocess.run(
            [sys.executable, "-c", child_code, str(lock_path)],
            check=True, capture_output=True, text=True,
        ).stdout.strip()

    def test_second_process_is_blocked_until_first_releases_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            lock_path = Path(directory) / "history_bot.lock"
            handle = acquire_instance_lock(lock_path)
            try:
                self.assertEqual(self.run_child(lock_path), "locked")
            finally:
                release_instance_lock(handle)
            self.assertEqual(self.run_child(lock_path), "acquired")


if __name__ == "__main__":
    unittest.main()
