"""Configuration et client partagés par login.py et explore.py."""
import os
from pathlib import Path

from telethon import TelegramClient

HOME = Path.home() / ".tg-explorer"


def load_config():
    """API_ID, API_HASH, PHONE : variables d'environnement, sinon .env à côté
    des scripts, sinon config.env dans le dossier de session."""
    values = {}
    local = Path(__file__).with_name(".env")
    config = local if local.exists() else HOME / "config.env"
    if config.exists():
        for line in config.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip()
    for key in ("API_ID", "API_HASH", "PHONE"):
        values[key] = os.environ.get(key, values.get(key, ""))
    missing = [k for k in ("API_ID", "API_HASH") if not values[k]]
    if missing:
        raise SystemExit(f"Configuration manquante : {', '.join(missing)} "
                         f"(voir README, fichier {config}).")
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
