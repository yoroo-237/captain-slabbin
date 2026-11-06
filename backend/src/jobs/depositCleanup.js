import { walletService } from '../services/wallet.service.js';
import { orderService } from '../services/order.service.js';

const INTERVAL_MS = 60 * 60 * 1000; // every hour

async function run() {
  try {
    const { cleaned } = await walletService.cleanupExpiredDeposits();
    if (cleaned > 0) {
      console.log(`[DepositCleanup] ${cleaned} expired deposit(s) cleaned up, BlockCypher forwards deleted`);
    }
  } catch (err) {
    console.error('[DepositCleanup] Error:', err.message);
  }
}

// Bot orders awaiting payment: cancelled once their 30 minutes are over
async function expireOrders() {
  try {
    const { expired } = await orderService.expirePendingOrders();
    if (expired > 0) console.log(`[DepositCleanup] ${expired} unpaid order(s) expired`);
  } catch (err) {
    console.error('[DepositCleanup] Orders:', err.message);
  }
}

export function startDepositCleanupJob() {
  expireOrders();
  setInterval(expireOrders, 60 * 1000);
  // Run once immediately at startup to catch anything missed while the server was down
  run();
  setInterval(run, INTERVAL_MS);
  console.log('[DepositCleanup] Job started — runs every hour');
}
