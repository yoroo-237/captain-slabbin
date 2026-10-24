import { Router } from 'express';
import { dashboardController } from '../../controllers/admin/dashboard.controller.js';

const r = Router();
r.get('/', dashboardController.get);
export default r;
