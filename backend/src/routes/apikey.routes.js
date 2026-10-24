import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { apikeyController } from '../controllers/apikey.controller.js';

const r = Router();

r.use(requireAuth);
r.get('/',      apikeyController.list);
r.post('/',     apikeyController.create);
r.delete('/:id', apikeyController.revoke);

export default r;
