import { Router } from 'express';
import { ok } from '../../utils/response.js';
import { vapidPublicKey, subscribe, unsubscribe, pushStaff } from '../../services/push.service.js';

// Admin header → "Notifications": the browser subscribes here (any staff member,
// moderators included) to receive pushes for orders, messages and tickets.
const r = Router();

r.get('/key', async (req, res) => res.json(ok({ publicKey: await vapidPublicKey() })));

r.post('/subscribe', async (req, res) => {
  await subscribe(req.user.sub, req.body?.subscription, req.headers['user-agent']);
  res.json(ok({ subscribed: true }));
});

r.post('/unsubscribe', async (req, res) => {
  await unsubscribe(req.user.sub, String(req.body?.endpoint || ''));
  res.json(ok({ subscribed: false }));
});

// A notification to this browser only
r.post('/test', async (req, res) => {
  const sent = await pushStaff({ title: 'Notifications are on', body: 'You will be told here about paid orders, messages and tickets.', url: '/admin', tag: 'test' }, req.user.sub);
  res.json(ok({ sent }));
});

export default r;
