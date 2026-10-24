import { Router } from 'express';
import { adminDepositsController as c } from '../../controllers/admin/deposits.controller.js';

const r = Router();

r.get('/',                          c.list);
r.post('/cleanup',                  c.cleanup);
r.post('/purge-blockcypher',        c.purgeBlockcypher);
r.get('/:id/usd-value',             c.usdValue);
r.get('/:id/onchain',               c.onchain);
r.get('/:id/verify-address',        c.verifyAddress);
r.patch('/:id/confirm',             c.confirm);
r.patch('/:id/expire',              c.expire);
r.post('/:id/reregister-webhook',   c.reregisterWebhook);

export default r;
