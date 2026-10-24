import { prisma } from '../db.js';
import { appError } from '../utils/formatters.js';

// Prices a cart server-side — the client's prices are never trusted. Shared by
// wallet checkout and Telegram invoices so both always charge the same amount.
export async function priceCart(items) {
  if (!Array.isArray(items) || !items.length) throw appError('Cart is empty', 400);
  if (items.length > 50) throw appError('Too many lines in one order.', 400);

  const settings = await prisma.siteSetting.findMany({
    where: { key: { in: ['shipping_cost', 'shipping_free_threshold'] } },
  });
  const shippingCost  = parseFloat(settings.find(s => s.key === 'shipping_cost')?.value || '0');
  const freeThreshold = parseFloat(settings.find(s => s.key === 'shipping_free_threshold')?.value || '0');

  const productIds = [...new Set(items.map(i => Number(i.productId)))];
  const products   = await prisma.product.findMany({ where: { id: { in: productIds }, isActive: true } });
  if (products.length !== productIds.length) {
    throw appError('One or more products are no longer available — please review your cart.', 400);
  }
  const byId = Object.fromEntries(products.map(p => [p.id, p]));

  let subtotal = 0;
  const lines = items.map(item => {
    const product  = byId[Number(item.productId)];
    const quantity = parseInt(item.quantity, 10);
    if (!(quantity >= 1 && quantity <= 999)) throw appError('Invalid quantity.', 400);
    if (product.stock < quantity) {
      throw appError(`Only ${product.stock} left of "${product.name}".`, 409);
    }
    const price = Number(product.price);
    subtotal += price * quantity;
    return { productId: product.id, sku: product.sku, name: product.name, price, quantity };
  });

  subtotal = Math.round(subtotal * 100) / 100;
  const shippingFee = (freeThreshold > 0 && subtotal >= freeThreshold) ? 0 : shippingCost;
  const total = Math.round((subtotal + shippingFee) * 100) / 100;
  return { lines, subtotal, shippingFee, total };
}
