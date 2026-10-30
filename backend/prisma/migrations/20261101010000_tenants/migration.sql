-- Bots platform: one shop per owner (staff user). 0 = the platform itself (and
-- everything on the website, which never sets it)
ALTER TABLE "User" ADD COLUMN "tenantId" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TelegramBot" ADD COLUMN "tenantId" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BotStyle" ADD COLUMN "tenantId" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "tenantId" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Category" ADD COLUMN "tenantId" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Voucher" ADD COLUMN "tenantId" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SweepLog" ADD COLUMN "tenantId" INTEGER NOT NULL DEFAULT 0;

-- A Telegram user has one customer account per owner
DROP INDEX "User_telegramId_key";
CREATE UNIQUE INDEX "User_telegramId_tenantId_key" ON "User"("telegramId", "tenantId");

CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");
CREATE INDEX "TelegramBot_tenantId_idx" ON "TelegramBot"("tenantId");
CREATE INDEX "BotStyle_tenantId_idx" ON "BotStyle"("tenantId");
CREATE INDEX "Product_tenantId_idx" ON "Product"("tenantId");
CREATE INDEX "Category_tenantId_idx" ON "Category"("tenantId");
CREATE INDEX "Voucher_tenantId_idx" ON "Voucher"("tenantId");
CREATE INDEX "SweepLog_tenantId_idx" ON "SweepLog"("tenantId");
