# Project instructions

- Read [the AI handoff](docs/ai-handoff/README.md), current status and backlog before planning changes. Update the handoff after implementation, decisions, defects, verification, interruptions and freeze changes. Frozen items require explicit authorization to resume.

- Preserve English study modes, authentication, CSS and existing progress fields.
- Inspect the working tree before editing; keep unrelated uncommitted changes.
- Never commit, push, deploy, publish an environment, or modify production data without explicit approval.
- Never read or print `.env`, service-account JSON, private keys, Bot tokens or administrator credentials. Never upload these files. Tests must use mocks or the `demo-vocab-app-security` emulators.
- History reads only the dedicated public nine- or thirteen-column sheet. Never expose the private twelve-column management sheet. Publishing and deletion require public/private reconciliation; run only one Bot instance per sheet.
- History progress uses `users/{uid}/progress/history_questions`, keys `history_<question ID>`, and the existing progress fields. Do not change Firestore schema or rules without presenting the proposal first.
- Run `npm test` and `.venv/bin/python -m unittest discover -s bot/tests` (Windows: `bot/.venv/Scripts/python.exe`) after relevant changes.
- For progress/auth changes also run `npm run test:rules` and `npm run test:rules:improved`. Use `firebase.test.json`, never a production project. Java 21+ is required. On Windows use `npm.cmd` if PowerShell blocks npm.ps1.
- Cloud setup: `bash scripts/setup-cloud.sh`. Do not start the Discord Bot or provide production credentials in Cloud. See `docs/CODEX_CLOUD.md`.

## README and change history policy (2026-11-23, JST)

- **README.md is user-facing documentation, not a development log.** Keep it understandable to students and first-time users of the vocabulary / four-choice quiz app. It should explain what the app does, how to start, how to load or prepare supported study data, major study modes, progress and caveats, as verified against the current implementation.
- The current README is intentionally short. **Do not replace or expand it with a chronological changelog, PR summary, test log, implementation diary, or raw AI handoff.** Do not silently revert later user edits or regenerate the entire file from an older version.
- Update README only when an actual user-facing feature, workflow, data format or limitation changes, and only the relevant sections. Verify labels, steps and claims against the deployed or targeted code. Distinguish current production features from unmerged or experimental work.
- Write release notes, notable fixes, breaking changes, and date-stamped history in **docs/CHANGELOG.md** instead. Keep detailed verification in the relevant test/release records and work-in-progress handoff in **docs/ai-handoff/**, especially STATUS.md and HANDOFF.md. Do not copy their full contents into README.
- Before any README edit, fetch/read the current branch version; preserve unrelated edits, formatting and user wording. If another agent changed it, re-read and reconcile rather than overwriting with an old snapshot. Review the diff for unintended changes before committing.
- Never describe a preview, draft PR, unverified test, or unpublished content as live in README. Preserve relevant safety and privacy notices, especially distinctions between public quiz data and private management data.
- A user can explicitly request a full README redesign. Such a request permits an accurate, user-friendly rewrite, **not** a replacement by update logs.
- These documentation rules supplement (and do not weaken) the existing security, approval, freeze, production-data and handoff rules above. A documentation change does not authorize commit, push, merge, deploy or production updates without the applicable user approval.

**Documentation destinations:** README.md = user guide; docs/CHANGELOG.md = release history; docs/ai-handoff/ = agent handoff and status; docs/ = specifications, verification and operations.
