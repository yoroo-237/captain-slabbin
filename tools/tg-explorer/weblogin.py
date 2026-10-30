"""Connexion d'un profil depuis une page web, en deux temps (pas de terminal).

  python weblogin.py send --profile explorer --phone +33600000000
      demande le code à Telegram (il arrive dans l'application)
  python weblogin.py code --profile explorer
      lit {"code": "12345", "password": "..."} sur l'entrée standard et ouvre la
      session ; le mot de passe 2FA n'est utile que si Telegram le demande

Le code et le mot de passe passent par l'entrée standard, jamais par la ligne de
commande (visible des autres processus). La dernière ligne écrite est un JSON :
{"ok": true, "first_name": ...}, {"need_password": true} ou {"error": "..."}.
"""
import argparse
import asyncio
import json
import sys

from telethon.errors import (PasswordHashInvalidError, PhoneCodeExpiredError, PhoneCodeInvalidError,
                             PhoneNumberInvalidError, SessionPasswordNeededError, FloodWaitError)

from common import HOME, make_client


def pending_file(profile):
    return HOME / f"{profile}.login.json"


def done(**result):
    print(json.dumps(result, ensure_ascii=False))


async def send(client, profile, phone):
    sent = await client.send_code_request(phone)
    pending_file(profile).write_text(json.dumps({"phone": phone, "hash": sent.phone_code_hash}), encoding="utf-8")
    done(sent=True)


async def sign_in(client, profile, secret):
    me = None
    if not await client.is_user_authorized():
        try:
            pending = json.loads(pending_file(profile).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return done(error="Demandez d'abord un code.")
        code = str(secret.get("code") or "").strip()
        try:
            if code:
                me = await client.sign_in(phone=pending["phone"], code=code, phone_code_hash=pending["hash"])
        except SessionPasswordNeededError:
            if not secret.get("password"):
                return done(need_password=True)
        if me is None:
            if not secret.get("password"):
                return done(error="Tapez le code reçu dans Telegram.")
            me = await client.sign_in(password=secret["password"])
    me = await client.get_me()
    pending_file(profile).unlink(missing_ok=True)
    done(ok=True, first_name=me.first_name or "", username=me.username or "")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("step", choices=["send", "code"])
    parser.add_argument("--profile", default="explorer")
    parser.add_argument("--phone", default="")
    args = parser.parse_args()

    client, cfg = make_client(args.profile)
    await client.connect()
    try:
        if args.step == "send":
            phone = args.phone or cfg["PHONE"]
            if not phone:
                return done(error="Numéro de téléphone manquant.")
            await send(client, args.profile, phone)
        else:
            await sign_in(client, args.profile, json.loads(sys.stdin.read() or "{}"))
    except PhoneNumberInvalidError:
        done(error="Numéro invalide (format international, ex. +33600000000).")
    except PhoneCodeInvalidError:
        done(error="Code incorrect.")
    except PhoneCodeExpiredError:
        done(error="Code expiré : demandez-en un nouveau.")
    except PasswordHashInvalidError:
        done(error="Mot de passe 2FA incorrect.", need_password=True)
    except FloodWaitError as e:
        done(error=f"Telegram demande d'attendre {e.seconds} s avant de réessayer.")
    finally:
        await client.disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except SystemExit as e:  # configuration manquante (common.load_config)
        done(error=str(e))
