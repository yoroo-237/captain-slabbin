-- Each bot can carry its own PGP public key: customers encrypt their shipping
-- address to it (it overrides the key page of the bot's style)
ALTER TABLE "TelegramBot" ADD COLUMN "pgpKey" TEXT NOT NULL DEFAULT '';
