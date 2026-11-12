-- A deposit address can be paid again after a sweep: what each sweep already took
ALTER TABLE "Deposit" ADD COLUMN "shopSweptAmount" DECIMAL(18,8) NOT NULL DEFAULT 0;
ALTER TABLE "Deposit" ADD COLUMN "reserveSweptAmount" DECIMAL(18,8) NOT NULL DEFAULT 0;
