import { Router } from 'express';
import { requireAdmin } from '../../middlewares/auth.js';
import { env } from '../../config/env.js';
import { ok, fail } from '../../utils/response.js';
import * as qt from '../../services/qtCapture.service.js';

// Admin → Bot captures (Captain Slabbin's site): capture @QTMARKETBOT and apply its style
// to a Telegram bot. Separate from the bots platform, which has its own capture routes.
const r = Router();
r.use((req, res, next) => (env.platform === 'bots' ? res.status(404).json(fail('Not available on the bots platform.')) : next()));
r.use(requireAdmin);
r.get('/state', async (req, res) => res.json(ok(await qt.state(req.user.sub))));
r.get('/api-keys', async (req, res) => res.json(ok(await qt.apiKeys(req.user.sub))));
r.put('/api-keys', async (req, res) => res.json(ok(await qt.setApiKeys(req.user.sub, req.body || {}))));
r.get('/account', async (req, res) => res.json(ok(await qt.account(req.user.sub))));
r.post('/account/send-code', async (req, res) => res.json(ok(await qt.sendCode(req.user.sub, req.body?.phone))));
r.post('/account/sign-in', async (req, res) => res.json(ok(await qt.signIn(req.user.sub, req.body || {}))));
r.post('/account/sign-out', async (req, res) => res.json(ok(await qt.signOut(req.user.sub))));
r.post('/apply', async (req, res) => res.status(202).json(ok(await qt.apply(req.user, req.body || {}))));
r.post('/stop', async (req, res) => res.json(ok(await qt.stop(req.user.sub))));
export default r;
