import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { profileController } from '../controllers/profile.controller.js';

const r = Router();

r.use(requireAuth);
r.get('/', profileController.get);
r.put('/', profileController.update);
r.put('/password', profileController.changePassword);
r.put('/username', profileController.changeUsername);
r.post('/telegram', profileController.telegramLink);
r.delete('/telegram', profileController.telegramUnlink);

export default r;
