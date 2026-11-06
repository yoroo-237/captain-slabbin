-- Bot checkout: a pending order paid straight from its own deposit address
ALTER TABLE "Order" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "Deposit" ADD COLUMN "orderId" INTEGER;
CREATE UNIQUE INDEX "Deposit_orderId_key" ON "Deposit"("orderId");
