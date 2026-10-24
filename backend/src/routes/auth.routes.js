import { getUserBalance } from '../services/balance.service.js';
import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { prisma } from '../db.js';
import { ok } from '../utils/response.js';

const r = Router();

r.post('/register', authController.register);
r.post('/login',    authController.login);
r.post('/refresh',  authController.refresh);
r.post('/logout',   authController.logout);

r.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where:  { id: req.user.sub },
    select: { id: true, username: true, role: true, points: true, totalSpent: true, avatarUrl: true, isActive: true },
  });
  const { balance } = await getUserBalance(user.id);
  res.json(ok({ user: { ...user, balance } }));
});

export default r;
