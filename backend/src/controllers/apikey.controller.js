import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { prisma } from '../db.js';
import { ok } from '../utils/response.js';
import { appError } from '../utils/formatters.js';

export const apikeyController = {
  async list(req, res) {
    const keys = await prisma.apiKey.findMany({
      where:  { userId: req.user.sub },
      select: { id: true, keyPrefix: true, label: true, isActive: true, lastUsed: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(ok(keys));
  },

  async create(req, res) {
    const { label } = req.body;

    const rawKey    = `botb_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash   = await bcrypt.hash(rawKey, 10);
    const keyPrefix = rawKey.slice(0, 12) + '...';

    const apiKey = await prisma.apiKey.create({
      data: {
        userId:    req.user.sub,
        keyHash,
        keyPrefix,
        label:     label?.trim() || null,
      },
    });

    res.status(201).json(ok({
      id:        apiKey.id,
      key:       rawKey,
      keyPrefix,
      label:     apiKey.label,
      createdAt: apiKey.createdAt,
    }));
  },

  async revoke(req, res) {
    const id = parseInt(req.params.id, 10);
    const key = await prisma.apiKey.findFirst({ where: { id, userId: req.user.sub } });
    if (!key) throw appError('API key not found', 404);

    await prisma.apiKey.update({ where: { id }, data: { isActive: false } });
    res.json(ok({ revoked: true }));
  },
};
