import { Router } from 'express';
import { webhookController } from '../controllers/webhook.controller.js';

const r = Router();

r.post('/blockcypher', webhookController.blockcypher);
r.post('/alchemy',     webhookController.alchemy);
r.post('/telegram-bot', webhookController.telegramBot);
r.post('/telegram-bot/:id', webhookController.telegramBot);

export default r;
