import { prisma } from '../db.js';
import { appError } from '../utils/formatters.js';

// Voucher codes typed at checkout. A code takes an amount or a percentage off the
// products (never the shipping), within its catalog, dates, uses and minimum.

export const normalizeCode = code => String(code || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 40);

const round2 = v => Math.round(v * 100) / 100;

// What the code takes off `subtotal`; throws with the reason the customer is told
export async function checkVoucher(code, subtotal, source = null, db = prisma) {
  const voucher = await db.voucher.findUnique({ where: { code: normalizeCode(code) } });
  const valid = voucher && voucher.isActive && (voucher.source || null) === (source || null)
    && (!voucher.expiresAt || voucher.expiresAt > new Date())
    && (voucher.maxUses == null || voucher.uses < voucher.maxUses);
  if (!valid) throw appError('The voucher code is not valid.', 400);
  if (subtotal < Number(voucher.minOrder)) {
    throw appError(`This voucher needs at least $${Number(voucher.minOrder).toFixed(2)} of products.`, 400);
  }
  const off = voucher.kind === 'amount' ? Number(voucher.value) : subtotal * Number(voucher.value) / 100;
  return { voucher, discount: round2(Math.min(subtotal, Math.max(0, off))) };
}

// Inside the order's transaction: one more use, refused if the last use just went
export async function useVoucher(tx, voucher) {
  const { count } = await tx.voucher.updateMany({
    where: { id: voucher.id, isActive: true, ...(voucher.maxUses != null ? { uses: { lt: voucher.maxUses } } : {}) },
    data: { uses: { increment: 1 } },
  });
  if (!count) throw appError('The voucher code is not valid.', 400);
}

export const voucherLabel = v => v.kind === 'amount' ? `$${Number(v.value).toFixed(2)} off` : `${Number(v.value)}% off`;
