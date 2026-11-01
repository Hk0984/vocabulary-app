# History question Discord bot

This bot is isolated from the existing vocabulary app. It accepts UTF-8 CSV (with or without BOM), validates the fixed column order, and writes valid batches as `draft` to a dedicated Google Sheet tab.

## Setup on Windows

1. Python 3.14.3 was found at `C:\Users\PC_User\AppData\Local\Python\bin\python.exe` on the current machine. The Microsoft Store `python`/`py` aliases do not launch here, so select the real interpreter directly. For another Windows account or installation, locate it with `Get-Command python, python3 -All` and replace the path below.
2. From the repository root, create the Bot virtual environment and install the dependencies:

   ```powershell
   $pythonExe = "C:\Users\PC_User\AppData\Local\Python\bin\python.exe"
   & $pythonExe -m venv bot/.venv
   .\bot\.venv\Scripts\python.exe -m pip install -r bot/requirements.txt
   ```

   To reproduce the exact tested dependency set, install `bot/requirements.lock` instead:

   ```powershell
   .\bot\.venv\Scripts\python.exe -m pip install -r bot/requirements.lock
   ```

   After an intentional dependency update, regenerate the lock from the validated environment with `pip freeze > bot/requirements.lock` and review the diff.

   Required packages are `discord.py`, `google-api-python-client`, `google-auth`, and `python-dotenv`. CSV validation tests use only Python's standard library.

3. Copy `bot/.env.example` to `bot/.env` and set the values locally. `ADMIN_USER_IDS` is a comma-separated list of Discord user IDs. Keep the bot token and Google key out of chat, source control, and screenshots.
4. Configure Google Sheets access:

   1. In Google Cloud Console, create or select a project. Enable **Google Sheets API**; a billing account is not needed for this setup.
   2. Create a service account and create a JSON key for it. Save the file as `bot/service-account.json` (or set `GOOGLE_SERVICE_ACCOUNT_FILE` to its path).
   3. In the dedicated spreadsheet's Share dialog, give the service account email **Editor** access. Do not grant it access to unrelated spreadsheets.
   4. Create a tab named `history_questions` (or set `HISTORY_SHEET_NAME`) with row 1 exactly:

      `id, source_id, question, choice1, choice2, choice3, choice4, answer, explanation, status, batch_id, created_at`

5. Configure Discord:

   1. In the Discord Developer Portal, create an Application and add a Bot user.
   2. Install it to the intended test server with the `bot` and `applications.commands` scopes. Grant only **View Channels** and **Send Messages**; message content intent is not used.
   3. Copy the Bot token directly into `DISCORD_BOT_TOKEN` in the local `.env`. Set `DISCORD_GUILD_ID` to the test server ID and `ADMIN_USER_IDS` to the allowed operator IDs. Enable Developer Mode in Discord to copy IDs.

6. From the repository root, run `.\bot\.venv\Scripts\python.exe bot/history_bot.py`. Attach a CSV to `/import`, then use `/list`, `/check`, `/publish`, or `/delete` with its batch ID. Run only one Bot process against this sheet at a time.

Without `DISCORD_GUILD_ID`, slash-command registration is global and may take time to appear. Configure a guild ID for immediate development-server sync. `/delete` requires `confirm: true` when a batch contains published rows.

The Bot writes minimal operation metadata to `bot/history_bot.audit.jsonl` by default (timestamp, Discord user ID, action, batch/problem IDs, success). It never stores CSV cell contents or credentials there. The log prunes entries older than 90 days and is capped at 5 MiB, dropping oldest entries if necessary. A failed write is reported in the command response and process log. `AUDIT_LOG_FILE` can change the path; ensure any custom path is also excluded from Git. Protect the log as operational data; export/archive it securely if longer retention is required.

For ambiguous Sheets write timeouts during import, publish, or delete, the Bot reads the batch and problem IDs back. It treats confirmed complete operations as success, retries only confirmed remaining rows once, and stops with the batch ID for manual review when it cannot prove the result. Check `/list` and the target sheet before taking manual action.

## CSV format

The exact nine-column order is `id,source_id,question,choice1,choice2,choice3,choice4,answer,explanation`. Quote cells containing commas, quotes, or line breaks according to standard CSV rules. The bot derives status, batch ID, and creation time; those columns must not be included in the upload.

## Validation tests

Run `.\bot\.venv\Scripts\python.exe -m unittest discover -s bot/tests -v` from the repository root (or use the selected Python executable if you have not created the venv). Tests use fake Sheets callbacks and temporary audit files; they do not connect to Discord or Google.
