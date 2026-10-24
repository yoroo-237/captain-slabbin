import { Router } from 'express';
import { adminSupportController as c } from '../../controllers/admin/support.controller.js';

const r = Router();

r.get('/tickets',                  c.list);
r.get('/tickets/:id',              c.getOne);
r.post('/tickets/:id/reply',       c.reply);
r.patch('/tickets/:id/status',     c.updateStatus);

export default r;
