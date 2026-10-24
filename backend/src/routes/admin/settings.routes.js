import { Router } from 'express';
import { adminSettingsController as c } from '../../controllers/admin/settings.controller.js';
import { requireAdmin } from '../../middlewares/auth.js';

const r = Router();

r.get('/',                        c.get);
r.put('/',                        requireAdmin, c.update);

export default r;
