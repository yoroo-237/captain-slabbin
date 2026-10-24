// One-off: converts every legacy USD balance (User.balance) into a crypto holding
// at today's price, then zeroes User.balance. Safe to re-run: users already at 0
// are skipped. Usage:
//   node scripts/convert-balances-to-crypto.js            # dry run, prints the plan
//   node scripts/convert-balances-to-crypto.js --apply    # writes it
//
// Currency: the user's most recent confirmed deposit currency, else BTC
// (override with --currency=LTC). No commission is taken — these funds predate it.
import 'dotenv/config';
import { prisma } from '../src/db.js';
import { getUsdPrice as getCurrencyUsdPrice } from '../src/services/price.service.js';
import { formatTxnId } from '../src/utils/formatters.js';

const APPLY = process.argv.includes('--apply');
const forced = (process.argv.find(a => a.startsWith('--currency=')) || '').split('=')[1];

(async () => {
  const users = await prisma.user.findMany({
    where:  { balance: { gt: 0 } },
    select: { id: true, username: true, balance: true },
  });
  if (!users.length) { console.log('No USD balances left to convert.'); return; }

  const prices = {};
  const priceOf = async c => (prices[c] ??= await getCurrencyUsdPrice(c));

  let n = 0;
  for (const u of users) {
    const last = forced ? null : await prisma.deposit.findFirst({
      where: { userId: u.id, status: 'confirmed' }, orderBy: { confirmedAt: 'desc' }, select: { currency: true },
    });
    const currency = forced || last?.currency || 'BTC';
    const price = await priceOf(currency);
    if (!price) { console.error(`! ${u.username}: ${currency} price unavailable — skipped`); continue; }

    const usd = parseFloat(u.balance);
    const amount = Math.round((usd / price) * 1e8) / 1e8;
    console.log(`${APPLY ? '✓' : '·'} ${u.username.padEnd(20)} $${usd.toFixed(2).padStart(10)} → ${amount} ${currency} @ $${price}`);
    if (!APPLY) continue;

    await prisma.$transaction(async tx => {
      await tx.walletHolding.upsert({
        where:  { userId_currency: { userId: u.id, currency } },
        update: { amount: { increment: amount } },
        create: { userId: u.id, currency, amount },
      });
      await tx.transaction.create({
        data: {
          frontendId: formatTxnId(`${Date.now()}-${u.id}`), userId: u.id, type: 'adjustment',
          amount: 0, currency, cryptoAmount: amount, rate: price, status: 'confirmed',
          note: `USD balance $${usd.toFixed(2)} converted to ${amount} ${currency} @ $${price}`,
        },
      });
      await tx.user.update({ where: { id: u.id }, data: { balance: 0 } });
    });
    n++;
  }
  console.log(APPLY ? `\nConverted ${n} balance(s).` : `\nDry run — re-run with --apply to write.`);
})()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
