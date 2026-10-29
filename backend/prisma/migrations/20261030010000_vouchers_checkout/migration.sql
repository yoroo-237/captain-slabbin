-- Checkout of a "commands" bot in progress (voucher, shipping details)
ALTER TABLE "User" ADD COLUMN "telegramCheckout" JSONB;

-- Voucher used on an order
ALTER TABLE "Order" ADD COLUMN "voucherCode" TEXT;
ALTER TABLE "Order" ADD COLUMN "discount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Voucher codes
CREATE TABLE "Voucher" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'percent',
    "value" DECIMAL(10,2) NOT NULL,
    "minOrder" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Voucher_code_key" ON "Voucher"("code");

-- The QT style was copied with QueenTetra's own PGP public key: addresses encrypted
-- to it could only be read by them. Its key page waits for the shop's own key.
UPDATE "BotStyle"
SET "look" = jsonb_set("look", '{pages}', (
  SELECT jsonb_agg(CASE
    WHEN p->>'key' = 'pgp_qtetra' AND p->>'html' LIKE '%mQINBGQ/d90BEAC233Sk0GsbKo1SRJXLvqSCUEarAUKXT9BUC911XYwiq1GYLis%'
    THEN jsonb_set(p, '{html}', to_jsonb('<b>Our PGP key</b>' || chr(10) || chr(10) || 'Paste your PGP public key here (Admin, Telegram bots, Styles, this style, Pages). Until then, customers send their address in plain text.'::text))
    ELSE p END ORDER BY ord)
  FROM jsonb_array_elements("look"->'pages') WITH ORDINALITY AS t(p, ord)))
WHERE jsonb_typeof("look"->'pages') = 'array'
  AND "look"::text LIKE '%mQINBGQ/d90BEAC233Sk0GsbKo1SRJXLvqSCUEarAUKXT9BUC911XYwiq1GYLis%';

-- And it ships at the flat $10 its menu announces, with addresses encrypted to that page's key
UPDATE "BotStyle"
SET "look" = "look" || '{"shippingFee": 10, "pgpPage": "pgp_qtetra", "pgpAddress": "optional"}'::jsonb
WHERE "name" = 'QT Market' AND jsonb_typeof("look") = 'object';
