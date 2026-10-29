#!/usr/bin/env sh
# Équivalent de lancer.bat pour macOS / Linux. Tout reste dans ce dossier.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export PIP_CACHE_DIR="$ROOT/.cache/pip" npm_config_cache="$ROOT/.cache/npm" PYTHONPYCACHEPREFIX="$ROOT/.cache/pycache"
export PIP_DISABLE_PIP_VERSION_CHECK=1

if [ ! -x .venv/bin/python ]; then
  command -v python3 >/dev/null || { echo "Python 3.8+ introuvable (https://www.python.org/downloads/)"; exit 1; }
  python3 -m venv .venv
fi
export PYTHON="$ROOT/.venv/bin/python"
"$PYTHON" -c "import telethon" 2>/dev/null || "$PYTHON" -m pip install -q -r requirements.txt

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Fichier .env créé : remplissez API_ID, API_HASH et PHONE, puis relancez."
  exit 1
fi

command -v node >/dev/null || { echo "Node.js introuvable (https://nodejs.org)"; exit 1; }
cd web
[ -d node_modules ] || npm install --no-audit --no-fund
[ -f ui/dist/index.html ] || npm run build
echo "Connexion Telegram : $PYTHON login.py (dans $ROOT)"
node server.mjs
