import { Router } from 'express';
import { contentController } from '../controllers/content.controller.js';

const r = Router();

r.get('/settings',  contentController.getSettings);
r.get('/faq',       contentController.getFaq);
r.get('/news',      contentController.getNews);
r.get('/giveaways', contentController.getGiveaways);

export default r;
