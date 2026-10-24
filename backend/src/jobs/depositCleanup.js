import { walletService } from '../services/wallet.service.js';

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

export function startDepositCleanupJob() {
  // Run once immediately at startup to catch anything missed while the server was down
  run();
  setInterval(run, INTERVAL_MS);
  console.log('[DepositCleanup] Job started — runs every hour');
}
