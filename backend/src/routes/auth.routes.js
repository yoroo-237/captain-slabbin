import { getUserBalance } from '../services/balance.service.js';
import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { authService } from '../services/auth.service.js';
import { requireAuth } from '../middlewares/auth.js';
import { prisma } from '../db.js';
import { ok, fail } from '../utils/response.js';
import { staffFromTelegram } from '../services/staffLogin.service.js';

const r = Router();

r.post('/register', authController.register);
r.post('/login',    authController.login);
r.post('/refresh',  authController.refresh);
r.post('/logout',   authController.logout);
r.post('/telegram', async (req, res) => res.json(ok(await authService.loginWithTelegram(req.body?.token))));
// Staff buttons on Telegram notifications: the signed Telegram login opens the dashboard
r.post('/telegram-staff', async (req, res) => {
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  try {
    res.json(ok(await authService.session(await staffFromTelegram(req.body?.data, bearer))));
  } catch (err) {
    if (!err.needLogin) throw err;
    res.status(401).json({ ...fail(err.message), needLogin: true });
  }
});

r.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where:  { id: req.user.sub },
    select: { id: true, username: true, role: true, points: true, totalSpent: true, avatarUrl: true, isActive: true },
  });
  const { balance } = await getUserBalance(user.id);
  res.json(ok({ user: { ...user, balance } }));
});

export default r;
