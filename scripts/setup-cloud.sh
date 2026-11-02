#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --version
python3 --version
java -version
npm ci --no-audit --no-fund
python3 -m venv .venv
.venv/bin/python -m pip install -r bot/requirements.lock
npm test
.venv/bin/python -m unittest discover -s bot/tests
# Run emulator tests separately, with the demo project in package.json.
# No .env file or production credentials are needed.
