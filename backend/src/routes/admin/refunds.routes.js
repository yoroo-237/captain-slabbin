import { Router } from 'express';
import { requireAdmin } from '../../middlewares/auth.js';
import { ok } from '../../utils/response.js';
import { orderRefundService as refunds } from '../../services/orderRefund.service.js';

// Admin → Refunds: the bot orders' refunds waiting for approval (a payment after the 30 minutes,
// a short payment on an expired order, a surplus). Approving sends the money; moving money is
// for admins, not moderators.
const r = Router();
r.use(requireAdmin);
const id = req => parseInt(req.params.id, 10);
r.get('/',              async (req, res) => res.json(ok({ refunds: await refunds.list(req.query.status || null) })));
r.post('/:id/approve',  async (req, res) => res.json(ok(await refunds.approve(id(req)))));
r.post('/:id/sent',     async (req, res) => res.json(ok(await refunds.markSent(id(req), req.body?.txHash))));
r.post('/:id/reject',   async (req, res) => res.json(ok(await refunds.reject(id(req)))));
export default r;
