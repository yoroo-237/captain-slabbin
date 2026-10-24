import { Router } from 'express';
import { analyticsController } from '../../controllers/admin/analytics.controller.js';

const r = Router();
r.get('/', analyticsController.get);
export default r;
