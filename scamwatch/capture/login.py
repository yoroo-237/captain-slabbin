"""Connects the ScamWatch Telegram account once and prints its session.

Run on your PC (not on the server):  python login.py
It asks for API_ID and API_HASH (https://my.telegram.org, API development tools),
the phone number, the code Telegram sends, and the 2FA password if there is one.
Copy the printed line into the TG_SESSION variable on Railway. It is as secret as
a password: anyone holding it is signed in to that Telegram account.
"""
import asyncio

from telethon import TelegramClient
from telethon.sessions import StringSession


async def main():
    api_id = int(input("API_ID: ").strip())
    api_hash = input("API_HASH: ").strip()
    async with TelegramClient(StringSession(), api_id, api_hash) as client:
        me = await client.get_me()
        print(f"\nSigned in as {me.first_name} (@{me.username}).")
        print("TG_SESSION value (keep it secret):\n")
        print(client.session.save())


if __name__ == "__main__":
    asyncio.run(main())
