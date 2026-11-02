# Project instructions

- Preserve English study modes, authentication, CSS and existing progress fields.
- Inspect the working tree before editing; keep unrelated uncommitted changes.
- Never commit, push, deploy, publish an environment, or modify production data without explicit approval.
- Never read or print `.env`, service-account JSON, private keys, Bot tokens or administrator credentials. Never upload these files. Tests must use mocks or the `demo-vocab-app-security` emulators.
- History reads only the dedicated public nine-column sheet. Never expose the private twelve-column management sheet. Publishing and deletion require public/private reconciliation; run only one Bot instance per sheet.
- History progress uses `users/{uid}/progress/history_questions`, keys `history_<question ID>`, and the existing progress fields. Do not change Firestore schema or rules without presenting the proposal first.
- Run `npm test` and `.venv/bin/python -m unittest discover -s bot/tests` (Windows: `bot/.venv/Scripts/python.exe`) after relevant changes.
- For progress/auth changes also run `npm run test:rules` and `npm run test:rules:improved`. Use `firebase.test.json`, never a production project. Java 21+ is required. On Windows use `npm.cmd` if PowerShell blocks npm.ps1.
- Cloud setup: `bash scripts/setup-cloud.sh`. Do not start the Discord Bot or provide production credentials in Cloud. See `docs/CODEX_CLOUD.md`.
