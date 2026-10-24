import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { ticketController } from '../controllers/ticket.controller.js';

const r = Router();

r.use(requireAuth);
r.get('/',               ticketController.list);
r.post('/',              ticketController.create);
r.get('/:id',            ticketController.getOne);
r.post('/:id/messages',  ticketController.reply);

export default r;
