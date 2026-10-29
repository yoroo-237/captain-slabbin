"""État de la configuration et des sessions, en JSON, pour l'interface web.

Dit quel fichier de configuration est lu, et pour chaque profil (session) quel
compte Telegram y est connecté. Ne demande jamais de code : un profil non
connecté est simplement signalé.

Usage : python status.py [--profile explorer]
"""
import argparse
import asyncio
import json
import re
import sqlite3
from pathlib import Path

from telethon import TelegramClient

from common import CACHE, HOME, config_file, load_config, read_config


def mask(phone):
    digits = re.sub(r"\D", "", phone or "")
    return f"+{digits[:2]} ••• {digits[-4:]}" if len(digits) > 6 else ""


def session_copy(name, tmp):
    """Copie cohérente de la session (API de sauvegarde SQLite) : login.py ou explore.py
    peuvent l'avoir ouverte au même moment, et deux écrivains la verrouilleraient."""
    src_path = HOME / f"{name}.session"
    dst = Path(tmp) / name
    if src_path.exists():
        src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True, timeout=10)
        out = sqlite3.connect(f"{dst}.session")
        try:
            src.backup(out)
        finally:
            src.close()
            out.close()
    return str(dst)


async def profile_status(name):
    info = {"name": name, "authorized": False}
    try:
        cfg = load_config()
        # Copie temporaire dans .cache de l'outil, jamais dans le dossier temporaire du système
        tmp = CACHE / "status"
        tmp.mkdir(parents=True, exist_ok=True)
        try:
            client = TelegramClient(session_copy(name, tmp), int(cfg["API_ID"]), cfg["API_HASH"])
            await check(client, info)
        finally:
            for f in tmp.glob(f"{name}.session*"):
                try:
                    f.unlink()
                except OSError:
                    pass
    except asyncio.TimeoutError:
        info["error"] = "Telegram injoignable (délai dépassé)."
    except SystemExit as e:
        info["error"] = str(e)
    except Exception as e:  # réseau, session illisible…
        info["error"] = f"{type(e).__name__} : {e}"
    return info


async def check(client, info):
    await asyncio.wait_for(client.connect(), 20)
    try:
        if await client.is_user_authorized():
            me = await client.get_me()
            info.update(authorized=True, first_name=me.first_name or "", username=me.username or "",
                        phone=mask(me.phone), phone_digits=me.phone or "")
    finally:
        await client.disconnect()


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", action="append", default=[], help="profil à vérifier en plus des sessions trouvées")
    args = parser.parse_args()

    cfg = read_config()
    names = sorted({p.stem for p in HOME.glob("*.session")} | set(args.profile))
    profiles = [await profile_status(n) for n in names] if cfg["API_ID"] and cfg["API_HASH"] else []
    wanted = re.sub(r"\D", "", cfg["PHONE"])
    for p in profiles:
        # Le .env peut viser un autre numéro que le compte réellement enregistré dans la session
        p["phone_matches"] = (not wanted or not p.get("phone_digits")) or p.pop("phone_digits") == wanted
        p.pop("phone_digits", None)
    print(json.dumps({
        "config": {
            "file": str(config_file()), "exists": config_file().exists(),
            "api": bool(cfg["API_ID"] and cfg["API_HASH"]),
            "phone": mask(cfg["PHONE"]), "bot": cfg["BOT_USERNAME"].lstrip("@"),
        },
        "sessions_dir": str(HOME),
        "profiles": profiles,
    }, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
