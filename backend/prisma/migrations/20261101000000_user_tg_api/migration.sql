-- Bots platform: each staff member's own Telegram API keys (my.telegram.org) for
-- the bot captures; the api_hash is stored encrypted
ALTER TABLE "User" ADD COLUMN "tgApiId" TEXT;
ALTER TABLE "User" ADD COLUMN "tgApiHash" TEXT;
