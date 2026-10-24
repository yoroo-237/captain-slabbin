import { Router } from 'express';
import { adminTransactionsController as c } from '../../controllers/admin/transactions.controller.js';

const r = Router();

r.get('/', c.list);

export default r;
