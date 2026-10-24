import { Router } from 'express';
import { adminSettingsController } from '../../controllers/admin/settings.controller.js';
import {
  categoriesController,
  brandsController,
  newsController,
  faqController,
  giveawaysController,
  reviewsController,
} from '../../controllers/admin/content.controller.js';

const r = Router();

// ─── System Status ────────────────────────────────────────────────────────────
r.get('/system-status', adminSettingsController.getSystemStatus);

// ─── Categories ───────────────────────────────────────────────────────────────
r.get('/categories',        categoriesController.list);
r.post('/categories',       categoriesController.create);
r.put('/categories/:id',    categoriesController.update);
r.delete('/categories/:id', categoriesController.remove);

// ─── Brands ──────────────────────────────────────────────────────────────────
r.get('/brands',        brandsController.list);
r.post('/brands',       brandsController.create);
r.put('/brands/:id',    brandsController.update);
r.delete('/brands/:id', brandsController.remove);

// ─── News ─────────────────────────────────────────────────────────────────────
r.get('/news',        newsController.list);
r.post('/news',       newsController.create);
r.put('/news/:id',    newsController.update);
r.delete('/news/:id', newsController.remove);

// ─── FAQ ──────────────────────────────────────────────────────────────────────
r.get('/faq',        faqController.list);
r.post('/faq',       faqController.create);
r.put('/faq/:id',    faqController.update);
r.delete('/faq/:id', faqController.remove);

// ─── Giveaways ────────────────────────────────────────────────────────────────
r.get('/giveaways',        giveawaysController.list);
r.post('/giveaways',       giveawaysController.create);
r.put('/giveaways/:id',    giveawaysController.update);
r.delete('/giveaways/:id', giveawaysController.remove);

// ─── Reviews ─────────────────────────────────────────────────────────────────
r.get('/reviews',             reviewsController.list);
r.patch('/reviews/:id/approve', reviewsController.approve);
r.delete('/reviews/:id',        reviewsController.remove);

export default r;
