-- CreateTable
CREATE TABLE "BotStyle" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "look" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT,
    "capture" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotStyle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramBot" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "chatId" TEXT NOT NULL DEFAULT '',
    "postChatId" TEXT NOT NULL DEFAULT '',
    "seenChats" JSONB NOT NULL DEFAULT '[]',
    "shelves" JSONB NOT NULL DEFAULT '[]',
    "styleId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramBot_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "telegramBotId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "TelegramBot_token_key" ON "TelegramBot"("token");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_telegramBotId_fkey" FOREIGN KEY ("telegramBotId") REFERENCES "TelegramBot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramBot" ADD CONSTRAINT "TelegramBot_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "BotStyle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
