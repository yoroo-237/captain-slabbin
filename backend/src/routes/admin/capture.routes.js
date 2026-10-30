import { Router } from 'express';
import { requireAdmin } from '../../middlewares/auth.js';
import { env } from '../../config/env.js';
import { ok, fail } from '../../utils/response.js';
import * as capture from '../../services/capture.service.js';

// Admin → Captures (bots platform only): browse a Telegram bot with the platform's
// Telegram account, then import its style and products
const r = Router();
r.use((req, res, next) => (env.platform === 'bots' ? next() : res.status(404).json(fail('Captures run on the bots platform only'))));
r.use(requireAdmin);

// Everything below is the signed-in member's own: task, journal, captures
r.get('/state', (req, res) => res.json(ok(capture.state(req.user.sub))));
r.get('/events', (req, res) => capture.subscribe(req.user.sub, req, res));
r.get('/captures', async (req, res) => res.json(ok({ captures: await capture.listCaptures(req.user.sub), key: capture.filesKey(req.user.sub) })));
r.delete('/captures/:bot', async (req, res) => { await capture.removeCapture(req.user.sub, req.params.bot); res.json(ok({ removed: true })); });

// Each staff member's own Telegram: API keys, then sessions
r.get('/api-keys', async (req, res) => res.json(ok(await capture.apiKeys(req.user.sub))));
r.put('/api-keys', async (req, res) => res.json(ok(await capture.setApiKeys(req.user.sub, req.body || {}))));
r.get('/account', async (req, res) => res.json(ok(await capture.account(req.user.sub, req.query.profile))));
r.post('/account/send-code', async (req, res) => res.json(ok(await capture.sendCode(req.user.sub, req.body?.profile, req.body?.phone))));
r.post('/account/sign-in', async (req, res) => res.json(ok(await capture.signIn(req.user.sub, req.body?.profile, req.body || {}))));
r.post('/account/sign-out', async (req, res) => res.json(ok(await capture.signOut(req.user.sub, req.body?.profile))));

r.post('/explore', async (req, res) => res.status(202).json(ok(await capture.explore(req.user.sub, req.body || {}))));
r.post('/stop', async (req, res) => res.json(ok(await capture.stop(req.user.sub))));
r.post('/import', async (req, res) => res.status(202).json(ok(await capture.importCapture(req.user, req.body || {}))));

export default r;

// Report and images of a capture, behind the signed key from GET /captures
export const captureFiles = Router();
captureFiles.get('/:key/*', async (req, res) => {
  const userId = env.platform === 'bots' ? capture.checkFilesKey(req.params.key) : null;
  if (!userId) return res.status(403).end();
  await capture.sendFile(userId, res, req.params[0]);
});
