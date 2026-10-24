import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { walletController } from '../controllers/wallet.controller.js';

const r = Router();

r.use(requireAuth);
r.get('/',             walletController.getWallet);
r.get('/balance',      walletController.getBalance);
r.get('/prices',       walletController.getPrices);
r.get('/deposits',              walletController.getDeposits);
r.get('/deposits/:id',          walletController.getDeposit);
r.post('/deposits/:id/check',   walletController.checkDeposit);
r.post('/deposit',              walletController.createDeposit);
r.get('/transactions', walletController.getTransactions);

export default r;
