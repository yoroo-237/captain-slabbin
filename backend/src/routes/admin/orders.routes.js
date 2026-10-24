import { Router } from 'express';
import { adminOrdersController as c } from '../../controllers/admin/orders.controller.js';

const r = Router();

r.get('/',                 c.list);
r.get('/:id',              c.getOne);
r.patch('/:id/status',     c.updateStatus);
r.patch('/:id/tracking',   c.updateTracking);

export default r;
