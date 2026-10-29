"""Configuration et client partagés par login.py et explore.py."""
import os
from pathlib import Path

from telethon import TelegramClient

# Tout reste dans le dossier de l'outil : rien n'est écrit dans le profil Windows,
# le dossier peut être copié tel quel sur un autre PC.
TOOL = Path(__file__).resolve().parent
HOME = TOOL / "sessions"          # sessions Telegram (secrets, ignorées par git)
CACHE = TOOL / ".cache"           # fichiers temporaires


def config_file():
    return TOOL / ".env"


def read_config():
    """API_ID, API_HASH, PHONE, BOT_USERNAME : variables d'environnement, sinon .env
    à côté des scripts (modèle : .env.example)."""
    values = {}
    config = config_file()
    if config.exists():
        for line in config.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"\'')
    for key in ("API_ID", "API_HASH", "PHONE", "BOT_USERNAME"):
        values[key] = os.environ.get(key, values.get(key, ""))
    return values


def load_config():
    values = read_config()
    config = config_file()
    missing = [k for k in ("API_ID", "API_HASH") if not values[k]]
    if not missing and not values["API_ID"].isdigit():
        missing = ["API_ID (doit être un nombre)"]
    if missing:
        raise SystemExit(f"Configuration manquante : {', '.join(missing)} "
                         f"(copiez .env.example en .env et remplissez-le : {config}).")
    return values


def session_path(profile):
    """Chaque profil a sa propre session : on peut explorer avec plusieurs comptes."""
    HOME.mkdir(parents=True, exist_ok=True)
    return str(HOME / profile)


def make_client(profile, sync=False):
    cfg = load_config()
    if sync:
        from telethon.sync import TelegramClient as SyncClient
        return SyncClient(session_path(profile), int(cfg["API_ID"]), cfg["API_HASH"]), cfg
    return TelegramClient(session_path(profile), int(cfg["API_ID"]), cfg["API_HASH"]), cfg


def normalize_bot(name):
    """@bot, bot, https://t.me/bot et t.me/bot?start=x donnent tous 'bot'."""
    name = name.strip()
    for prefix in ("https://", "http://"):
        if name.startswith(prefix):
            name = name[len(prefix):]
    if name.startswith(("t.me/", "telegram.me/")):
        name = name.split("/", 1)[1].split("?", 1)[0].strip("/")
    return name.lstrip("@")
