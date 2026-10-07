#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
profile="${1:-recognition}"
case "$profile" in
  web|recognition|combined) ;;
  *) echo 'Usage: bash scripts/codex-setup.sh [web|recognition|combined]' >&2; exit 2 ;;
esac

node -e 'if (+process.versions.node.split(".")[0] < 20) throw Error("Node 20 or newer is required; select Node 22.")'
npm ci --include=dev
npm run check
npm test

if [[ "${CODEX_INSTALL_BROWSER:-1}" == 1 ]]; then
  npx --no-install playwright install --with-deps chromium
fi

if [[ "$profile" != web ]]; then
  python_bin="${CODEX_PYTHON:-python3}"
  "$python_bin" -c 'import sys; assert sys.version_info[:2] == (3, 12), "Select Python 3.12 before setup (or set CODEX_PYTHON)."'
  "$python_bin" -m venv services/floorplan/.venv
  python=services/floorplan/.venv/bin/python
  "$python" -m pip install --upgrade pip
  "$python" -m pip install torch==2.14.1+cpu torchvision==0.29.1+cpu --index-url https://download.pytorch.org/whl/cpu
  "$python" -m pip install -r services/floorplan/requirements-cloud.txt
  "$python" services/floorplan/download_model.py
  if [[ "$profile" == combined ]]; then
    "$python" -m pip install -r services/floorplan/requirements.txt
    "$python" services/floorplan/download_mitunet.py
  fi
  "$python" -m unittest discover -s services/floorplan -p 'test_*.py'
  "$python" -c 'import sys; sys.path.insert(0,"services/floorplan"); from pipeline import Pipeline; model=Pipeline(); print("CubiCasa CPU checkpoint loads successfully.")'
fi

echo "Cloud dependencies prepared ($profile). See CODEX-CLOUD.md for startup and environment publishing."
