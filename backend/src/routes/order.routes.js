import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { orderController } from '../controllers/order.controller.js';

const r = Router();

r.use(requireAuth);
r.get('/',    orderController.list);
r.post('/',   orderController.create);
r.post('/pay',                 orderController.pay);
r.get('/payable-coins',        orderController.payableCoins);
r.get('/:id/payment',          orderController.payment);
r.post('/:id/payment/check',   orderController.checkPayment);
r.post('/:id/cancel',          orderController.cancel);
r.get('/:id', orderController.getOne);

export default r;
