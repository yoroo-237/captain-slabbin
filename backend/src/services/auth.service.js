import { getUserBalance } from './balance.service.js';
import bcrypt from 'bcrypt';
import { prisma } from '../db.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import { appError } from '../utils/formatters.js';
import { notificationService } from './notification.service.js';

const SALT_ROUNDS = 12;

export const authService = {
  async register({ username, password, telegramHandle }) {
    if (!username || username.trim().length < 3) throw appError('Username too short (min 3 characters)', 400);
    if (!password || password.length < 6)         throw appError('Password too short (min 6 characters)', 400);

    // Admin → Settings → General → Registration Open
    const registration = await prisma.siteSetting.findUnique({ where: { key: 'registration_open' } });
    if (registration?.value === 'false') throw appError('Registrations are currently closed', 403);

    const exists = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (exists) throw appError('Username already taken', 409);

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await prisma.user.create({
      data: {
        username: username.trim(), passwordHash,
        telegramHandle: telegramHandle ? String(telegramHandle).trim().replace(/^@/, '').slice(0, 64) || null : null,
      },
    });

    await notificationService.createWelcomeNotifications(user.id);

    // Signed in straight away, so a guest can create an account in the middle of checkout
    const payload = { sub: user.id, role: user.role, username: user.username };
    return {
      id: user.id, username: user.username,
      accessToken:  signAccessToken(payload),
      refreshToken: signRefreshToken({ sub: user.id }),
      user: { id: user.id, username: user.username, role: user.role, balance: 0, points: 0 },
    };
  },

  async login({ username, password }) {
    if (!username || !password) throw appError('Username and password are required', 400);

    const user = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (!user)          throw appError('Invalid credentials', 401);
    if (!user.isActive) throw appError('Account disabled', 403);

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) throw appError('Invalid credentials', 401);

    await prisma.user.update({
      where: { id: user.id },
      data:  { lastLoginAt: new Date() },
    });

    const payload = { sub: user.id, role: user.role, username: user.username };
    return {
      accessToken:  signAccessToken(payload),
      refreshToken: signRefreshToken({ sub: user.id }),
      user: {
        id:       user.id,
        username: user.username,
        role:     user.role,
        balance:  (await getUserBalance(user.id)).balance,
        points:   user.points,
      },
    };
  },

  async refresh(refreshToken) {
    if (!refreshToken) throw appError('refreshToken is required', 400);

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw appError('Invalid or expired refresh token', 401);
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw appError('User not found or disabled', 401);

    const newPayload = { sub: user.id, role: user.role, username: user.username };
    return { accessToken: signAccessToken(newPayload) };
  },
};
