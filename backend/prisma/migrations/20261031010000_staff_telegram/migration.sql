-- Staff accounts can be signed in from the buttons of Telegram notifications:
-- the Telegram account linked to them (kept apart from telegramId, which is the
-- account a customer shops with in the bots)
ALTER TABLE "User" ADD COLUMN "staffTelegramId" TEXT;
CREATE UNIQUE INDEX "User_staffTelegramId_key" ON "User"("staffTelegramId");
