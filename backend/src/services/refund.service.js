import { isAddress } from 'ethers';
import { prisma } from '../db.js';
import { cryptoService } from './crypto.service.js';

// The optional refund address a customer gives at checkout (website or bot):
// where the shop sends money back should an order be refunded. It goes on the
// order's notes, and BTC / XMR ones on the account too, for refunds from the admin.
export const REFUND_COINS = { BTC: 'Bitcoin', LTC: 'Litecoin', ETH: 'Ethereum', DOGE: 'Dogecoin', XMR: 'Monero' };

export const validRefund = (coin, a) => coin === 'ETH' ? isAddress(a)
  : coin === 'XMR' ? /^[48][1-9A-HJ-NP-Za-km-z]{94}([1-9A-HJ-NP-Za-km-z]{11})?$/.test(a)
  : REFUND_COINS[coin] ? cryptoService.isValidUtxoAddress(coin, a) : false;

export const refundNote = (coin, address) => `Refund address (${coin}): ${address}`;

export async function keepRefundOnAccount(userId, coin, address) {
  const field = { BTC: 'btcRefundAddress', XMR: 'xmrRefundAddress' }[coin];
  if (field) await prisma.user.update({ where: { id: userId }, data: { [field]: address } }).catch(() => {});
}
