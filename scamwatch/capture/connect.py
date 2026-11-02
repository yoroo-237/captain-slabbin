"""Connects the ScamWatch Telegram account from Admin → Settings, one step per run.

Reads a JSON object on stdin, prints a JSON object on stdout:
  {"step": "send_code", api_id, api_hash, phone}
      -> {"session", "phone_code_hash"}            Telegram sends a code to the account
  {"step": "sign_in", api_id, api_hash, session, phone, code, phone_code_hash}
      -> {"session", "name", "username", "phone"}  connected
      -> {"need_password": true, "session"}       two-step verification is on
  {"step": "password", api_id, api_hash, session, password}
      -> {"session", "name", "username", "phone"}
  {"step": "log_out", api_id, api_hash, session}   -> {"ok": true}
Errors: {"error": api_invalid | phone_invalid | phone_banned | code_invalid | code_expired
         | password_invalid | flood_wait (with seconds) | telegram}
The session between steps is not signed in yet; the server keeps it in memory only.
"""
import asyncio
import json
import sys

from telethon import TelegramClient, errors
from telethon.sessions import StringSession


def out(data):
    print(json.dumps(data, ensure_ascii=False))


def me_of(client, me):
    name = " ".join(x for x in [me.first_name, me.last_name] if x)
    return {"session": client.session.save(), "name": name, "username": me.username, "phone": me.phone}


async def run(p):
    client = TelegramClient(StringSession(p.get("session") or ""), int(p["api_id"]), p["api_hash"])
    await client.connect()
    try:
        step = p["step"]
        if step == "send_code":
            sent = await client.send_code_request(p["phone"])
            return out({"session": client.session.save(), "phone_code_hash": sent.phone_code_hash})
        if step == "sign_in":
            try:
                me = await client.sign_in(phone=p["phone"], code=p["code"], phone_code_hash=p["phone_code_hash"])
            except errors.SessionPasswordNeededError:
                return out({"need_password": True, "session": client.session.save()})
            return out(me_of(client, me))
        if step == "password":
            me = await client.sign_in(password=p["password"])
            return out(me_of(client, me))
        if step == "log_out":
            await client.log_out()
            return out({"ok": True})
        out({"error": "telegram"})
    except (errors.ApiIdInvalidError, errors.ApiIdPublishedFloodError):
        out({"error": "api_invalid"})
    except (errors.PhoneNumberInvalidError, errors.PhoneNumberUnoccupiedError):
        out({"error": "phone_invalid"})
    except errors.PhoneNumberBannedError:
        out({"error": "phone_banned"})
    except (errors.PhoneCodeInvalidError, errors.PhoneCodeEmptyError):
        out({"error": "code_invalid"})
    except errors.PhoneCodeExpiredError:
        out({"error": "code_expired"})
    except errors.PasswordHashInvalidError:
        out({"error": "password_invalid"})
    except errors.FloodWaitError as e:
        out({"error": "flood_wait", "seconds": e.seconds})
    except errors.RPCError as e:
        out({"error": "telegram", "detail": type(e).__name__})
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(run(json.loads(sys.stdin.read())))
