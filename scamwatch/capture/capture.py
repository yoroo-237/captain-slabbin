"""Capture of a reported Telegram account, run by the ScamWatch server.

Reads what anyone can see of the account with the ScamWatch Telegram account:
name, bio and photo; for a bot, the screen it answers to /start; for a channel or
a group, its latest public messages. Regular users are never messaged.

Usage: python capture.py <username or numeric id>
Needs TG_API_ID, TG_API_HASH and TG_SESSION (a StringSession made by login.py).
Prints one JSON object on stdout: the capture, or {"error": "<code>"}.
"""
import asyncio
import base64
import json
import os
import sys

from telethon import TelegramClient, errors, functions, types
from telethon.sessions import StringSession

BOT_WAIT_S = 6
MAX_MESSAGES = 30
MAX_TEXT = 4000


def out(data):
    sys.stdout.write(json.dumps(data, ensure_ascii=False))
    sys.stdout.flush()


def text_of(msg):
    """Text of a message plus the labels of its buttons (scam bots hide offers there)."""
    parts = [msg.message or ""]
    markup = getattr(msg, "reply_markup", None)
    for row in getattr(markup, "rows", None) or []:
        for button in row.buttons:
            label = getattr(button, "text", "")
            url = getattr(button, "url", None)
            parts.append(f"[{label}]" + (f" {url}" if url else ""))
    return "\n".join(p for p in parts if p).strip()[:MAX_TEXT]


async def photo_of(client, entity):
    try:
        data = await client.download_profile_photo(entity, file=bytes)
        return base64.b64encode(data).decode() if data else None
    except Exception:
        return None


async def capture(client, ref):
    entity = await client.get_entity(int(ref) if ref.isdigit() else ref)
    result = {"id": str(entity.id), "username": getattr(entity, "username", None), "texts": []}

    if isinstance(entity, types.User):
        full = await client(functions.users.GetFullUserRequest(entity))
        result.update(kind="bot" if entity.bot else "user",
                      title=" ".join(filter(None, [entity.first_name, entity.last_name])),
                      about=full.full_user.about or "")
        if entity.bot:
            # What the bot shows to anyone who opens it
            last = await client.get_messages(entity, limit=1)
            last_id = last[0].id if last else 0
            await client.send_message(entity, "/start")
            await asyncio.sleep(BOT_WAIT_S)
            replies = await client.get_messages(entity, min_id=last_id, limit=10)
            result["texts"] = [t for t in (text_of(m) for m in reversed(replies) if not m.out) if t]
    else:
        full = await client(functions.channels.GetFullChannelRequest(entity))
        result.update(kind="channel" if getattr(entity, "broadcast", False) else "group",
                      title=entity.title or "", about=full.full_chat.about or "")
        messages = await client.get_messages(entity, limit=MAX_MESSAGES)
        result["texts"] = [t for t in (text_of(m) for m in messages) if t]

    result["photo"] = await photo_of(client, entity)
    return result


async def main(ref):
    api_id, api_hash, session = os.environ.get("TG_API_ID"), os.environ.get("TG_API_HASH"), os.environ.get("TG_SESSION")
    if not (api_id and api_hash and session):
        return out({"error": "not_configured"})
    client = TelegramClient(StringSession(session), int(api_id), api_hash)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            return out({"error": "unauthorized"})
        out(await capture(client, ref))
    except (ValueError, errors.UsernameInvalidError, errors.UsernameNotOccupiedError):
        out({"error": "not_found"})
    except (errors.ChannelPrivateError, errors.ChatAdminRequiredError):
        out({"error": "private"})
    except errors.FloodWaitError as e:
        out({"error": "flood_wait", "seconds": e.seconds})
    except errors.RPCError as e:
        out({"error": "telegram", "detail": type(e).__name__})
    finally:
        await client.disconnect()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: capture.py <username or id>")
    asyncio.run(main(sys.argv[1].strip().lstrip("@")))
