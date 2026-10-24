import { Router } from 'express';
import { sweepController as c } from '../../controllers/admin/sweep.controller.js';
import { requireAdmin, requireSuperAdmin } from '../../middlewares/auth.js';

const r = Router();

// ─── Sweeps (admin) ───────────────────────────────────────────────────────────
// The commission is taken when a deposit is credited, so the admin sweep only
// collects the customer-credited share — no commission on the admin side.
r.post('/eth/sweep',              requireAdmin, c.sweepEth);
r.post('/utxo/sweep/:currency',   requireAdmin, c.sweepUtxo);
r.get('/sweep/pending',           requireAdmin, c.shopPending);
r.get('/sweep/logs',              requireAdmin, c.listLogs);

// ─── Super admin — deposit commissions / reserve fund ─────────────────────────
r.get('/superadmin/settings',                requireSuperAdmin, c.getCommission);
r.put('/superadmin/settings',                requireSuperAdmin, c.updateCommission);
r.get('/superadmin/sweep-logs',              requireSuperAdmin, c.listLogs);
r.get('/superadmin/pending',                 requireSuperAdmin, c.reservePending);
r.post('/superadmin/eth/sweep',              requireSuperAdmin, c.sweepReserveEth);
r.post('/superadmin/utxo/sweep/:currency',   requireSuperAdmin, c.sweepReserveUtxo);

export default r;
