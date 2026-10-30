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

r.get('/state', (req, res) => res.json(ok(capture.state())));
r.get('/events', (req, res) => capture.subscribe(req, res));
r.get('/captures', async (req, res) => res.json(ok({ captures: await capture.listCaptures(), key: capture.filesKey() })));
r.delete('/captures/:bot', async (req, res) => { await capture.removeCapture(req.params.bot); res.json(ok({ removed: true })); });

r.get('/account', async (req, res) => res.json(ok(await capture.account(req.query.profile))));
r.post('/account/send-code', async (req, res) => res.json(ok(await capture.sendCode(req.body?.profile, req.body?.phone))));
r.post('/account/sign-in', async (req, res) => res.json(ok(await capture.signIn(req.body?.profile, req.body || {}))));
r.post('/account/sign-out', (req, res) => res.json(ok(capture.signOut(req.body?.profile))));

r.post('/explore', async (req, res) => res.status(202).json(ok(await capture.explore(req.body || {}))));
r.post('/stop', async (req, res) => res.json(ok(await capture.stop())));
r.post('/import', async (req, res) => res.status(202).json(ok(await capture.importCapture(req.body || {}))));

export default r;

// Report and images of a capture, behind the signed key from GET /captures
export const captureFiles = Router();
captureFiles.get('/:key/*', async (req, res) => {
  if (env.platform !== 'bots' || !capture.checkFilesKey(req.params.key)) return res.status(403).end();
  await capture.sendFile(res, req.params[0]);
});
