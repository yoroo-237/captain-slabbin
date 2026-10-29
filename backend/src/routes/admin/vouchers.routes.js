import { Router } from 'express';
import { requireAdmin } from '../../middlewares/auth.js';
import { prisma } from '../../db.js';
import { ok } from '../../utils/response.js';
import { appError } from '../../utils/formatters.js';
import { normalizeCode } from '../../services/voucher.service.js';

// Admin → Vouchers: codes customers type at a bot's checkout. Money off, so admins only.
const r = Router();
r.use(requireAdmin);

function voucherData(body) {
  const code = normalizeCode(body.code);
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw appError('The code needs 3 to 40 letters, digits, - or _.', 400);
  const kind = body.kind === 'amount' ? 'amount' : 'percent';
  const value = Number(body.value);
  if (!(value > 0) || (kind === 'percent' && value > 100)) throw appError(kind === 'percent' ? 'The percentage must be between 1 and 100.' : 'The amount must be above 0.', 400);
  const maxUses = body.maxUses === '' || body.maxUses == null ? null : parseInt(body.maxUses, 10);
  if (maxUses != null && !(maxUses >= 1)) throw appError('Uses must be 1 or more (empty = unlimited).', 400);
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw appError('That end date is not valid.', 400);
  return {
    code, kind, value, maxUses, expiresAt,
    minOrder: Math.max(0, Number(body.minOrder) || 0),
    isActive: body.isActive !== false,
    source: String(body.source || '').trim() || null,
  };
}

const taken = err => err?.code === 'P2002' ? appError('A voucher with that code already exists.', 409) : err;

r.get('/', async (req, res) => {
  const [vouchers, sources] = await Promise.all([
    prisma.voucher.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.product.findMany({ where: { source: { not: null } }, distinct: ['source'], select: { source: true } }),
  ]);
  res.json(ok({ vouchers, catalogs: sources.map(s => s.source) }));
});

r.post('/', async (req, res) => {
  try { res.json(ok(await prisma.voucher.create({ data: voucherData(req.body || {}) }))); }
  catch (err) { throw taken(err); }
});

r.put('/:id', async (req, res) => {
  try { res.json(ok(await prisma.voucher.update({ where: { id: Number(req.params.id) }, data: voucherData(req.body || {}) }))); }
  catch (err) { throw taken(err); }
});

r.delete('/:id', async (req, res) => {
  await prisma.voucher.delete({ where: { id: Number(req.params.id) } });
  res.json(ok(true));
});

export default r;
