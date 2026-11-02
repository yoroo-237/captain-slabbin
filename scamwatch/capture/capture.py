"""Capture of a reported Telegram account, run by the ScamWatch server.

Reads what anyone can see of the account with the ScamWatch Telegram account:
- every account: name, bio and profile photo;
- a bot: the conversation it holds. It sends /start, then presses the bot's buttons
  (inline buttons and keyboard buttons, MAX_CLICKS at most, MAX_DEPTH levels) and
  keeps every answer. Buttons that would share the phone number or the location,
  pay, open a mini app or switch chat are never pressed; link buttons are only kept;
- a channel or a public group: its message history (MAX_HISTORY latest messages);
- images: photos of the messages and thumbnails of videos (MAX_MEDIA at most).
Regular users are never messaged.

Usage: python capture.py <username or numeric id>
Reads TG_API_ID, TG_API_HASH and TG_SESSION from its environment: the server passes the account
connected in Admin → Settings (connect.py), they are not variables to set.
Prints one JSON object on stdout: the capture, or {"error": "<code>"}.
  messages: [{id, date, from: "them" | "me", text, buttons: [{text, url?}], media: [index], edited?}]
  media:    [{data (base64), mime, message}]
  texts:    the account's messages as plain text (type detection)
"""
import asyncio
import base64
import json
import os
import sys

from telethon import TelegramClient, errors, functions, types
from telethon.sessions import StringSession

START_WAIT_S = 6
CLICK_WAIT_S = 4
MAX_CLICKS = 8
MAX_DEPTH = 2
MAX_HISTORY = 100
MAX_MEDIA = 20
MAX_MEDIA_BYTES = 1_500_000
MAX_TEXT = 4000

# The only buttons pressed: they send a callback or the button's text, nothing else
PRESSABLE = (types.KeyboardButtonCallback, types.KeyboardButton)


def out(data):
    sys.stdout.write(json.dumps(data, ensure_ascii=False))
    sys.stdout.flush()


def pressable(b):
    return isinstance(b, PRESSABLE) and not getattr(b, "requires_password", False)


def buttons_of(msg):
    """Buttons of a message: [(row, col, button)]."""
    markup = getattr(msg, "reply_markup", None)
    return [(i, j, b) for i, row in enumerate(getattr(markup, "rows", None) or []) for j, b in enumerate(row.buttons)]


def text_of(entry):
    """Text of a message plus its button labels (scam bots hide offers there), for the detection."""
    parts = [entry["text"]] + [f"[{b['text']}]" + (f" {b['url']}" if b.get("url") else "") for b in entry["buttons"]]
    return "\n".join(p for p in parts if p).strip()[:MAX_TEXT]


class Capture:
    def __init__(self, client, entity):
        self.client, self.entity = client, entity
        self.messages, self.media = [], []

    async def keep_media(self, msg):
        """Photo of the message, or the thumbnail of a video / image file."""
        if len(self.media) >= MAX_MEDIA or not msg.media:
            return []
        try:
            if msg.photo:
                data, mime = await self.client.download_media(msg, file=bytes), "image/jpeg"
            elif msg.document and (msg.document.mime_type or "").startswith("image/") and msg.document.size <= MAX_MEDIA_BYTES:
                data, mime = await self.client.download_media(msg, file=bytes), msg.document.mime_type
            elif msg.document and msg.document.thumbs:
                data, mime = await self.client.download_media(msg, file=bytes, thumb=-1), "image/jpeg"
            else:
                return []
        except Exception:
            return []
        if not data or len(data) > MAX_MEDIA_BYTES or mime not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
            return []
        self.media.append({"data": base64.b64encode(data).decode(), "mime": mime, "message": msg.id})
        return [len(self.media) - 1]

    async def keep(self, msg, edited=False):
        entry = {
            "id": msg.id,
            "date": msg.date.isoformat() if msg.date else None,
            "from": "me" if msg.out else "them",
            "text": (msg.message or "")[:MAX_TEXT],
            "buttons": [{"text": getattr(b, "text", ""), **({"url": b.url} if getattr(b, "url", None) else {})} for _, _, b in buttons_of(msg)],
            "media": await self.keep_media(msg),
        }
        if edited:
            entry["edited"] = True
        self.messages.append(entry)

    def note(self, text):
        """What the capture account did (the button it pressed), shown in the conversation."""
        self.messages.append({"id": None, "date": None, "from": "me", "text": text, "buttons": [], "media": []})

    async def new_since(self, last_id):
        msgs = await self.client.get_messages(self.entity, min_id=last_id, limit=20)
        return [m for m in reversed(msgs) if not m.out]

    async def last_id(self):
        last = await self.client.get_messages(self.entity, limit=1)
        return last[0].id if last else 0

    async def bot(self):
        """Opens the bot, then presses its buttons level by level and keeps every answer."""
        before = await self.last_id()
        await self.client.send_message(self.entity, "/start")
        self.note("/start")
        await asyncio.sleep(START_WAIT_S)
        frontier = []  # (message, row, col, label, depth)
        for m in await self.new_since(before):
            await self.keep(m)
            frontier += [(m, i, j, b.text, 1) for i, j, b in buttons_of(m) if pressable(b)]

        pressed, clicks = set(), 0
        while frontier and clicks < MAX_CLICKS:
            msg, i, j, label, depth = frontier.pop(0)
            if label in pressed:
                continue
            pressed.add(label)
            clicks += 1
            before = await self.last_id()
            self.note(f"[{label}]")
            try:
                answer = await msg.click(i, j)
            except Exception:
                continue
            # A pop-up or toast answer of the bot
            if isinstance(answer, types.messages.BotCallbackAnswer) and answer.message:
                self.messages.append({"id": None, "date": None, "from": "them", "text": answer.message[:MAX_TEXT], "buttons": [], "media": []})
            await asyncio.sleep(CLICK_WAIT_S)
            found = []
            # Bots often edit the message that holds the buttons instead of sending a new one
            fresh = await self.client.get_messages(self.entity, ids=msg.id)
            if fresh and (fresh.message != msg.message or fresh.edit_date != msg.edit_date):
                await self.keep(fresh, edited=True)
                found.append(fresh)
            for m in await self.new_since(before):
                await self.keep(m)
                found.append(m)
            if depth < MAX_DEPTH:
                for m in found:
                    frontier += [(m, a, c, b.text, depth + 1) for a, c, b in buttons_of(m) if pressable(b)]

    async def history(self):
        msgs = await self.client.get_messages(self.entity, limit=MAX_HISTORY)
        for m in reversed(msgs):
            if m.message or m.media:
                await self.keep(m)

    async def profile_photo(self):
        try:
            data = await self.client.download_profile_photo(self.entity, file=bytes)
            return base64.b64encode(data).decode() if data else None
        except Exception:
            return None


async def capture(client, ref):
    entity = await client.get_entity(int(ref) if ref.isdigit() else ref)
    c = Capture(client, entity)
    result = {"id": str(entity.id), "username": getattr(entity, "username", None)}

    if isinstance(entity, types.User):
        full = await client(functions.users.GetFullUserRequest(entity))
        result.update(kind="bot" if entity.bot else "user",
                      title=" ".join(filter(None, [entity.first_name, entity.last_name])),
                      about=full.full_user.about or "")
        if entity.bot:
            await c.bot()
    else:
        full = await client(functions.channels.GetFullChannelRequest(entity))
        result.update(kind="channel" if getattr(entity, "broadcast", False) else "group",
                      title=entity.title or "", about=full.full_chat.about or "")
        await c.history()

    result.update(
        photo=await c.profile_photo(),
        messages=c.messages,
        media=c.media,
        texts=[t for t in (text_of(m) for m in c.messages if m["from"] == "them") if t],
    )
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
