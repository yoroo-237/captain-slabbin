import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { orderController } from '../controllers/order.controller.js';

const r = Router();

r.use(requireAuth);
r.get('/',    orderController.list);
r.post('/',   orderController.create);
r.get('/:id', orderController.getOne);

export default r;
