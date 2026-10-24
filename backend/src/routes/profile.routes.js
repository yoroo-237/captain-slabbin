import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { profileController } from '../controllers/profile.controller.js';

const r = Router();

r.use(requireAuth);
r.get('/', profileController.get);
r.put('/', profileController.update);
r.put('/password', profileController.changePassword);

export default r;
