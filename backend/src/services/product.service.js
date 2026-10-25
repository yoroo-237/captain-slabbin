import { prisma } from '../db.js';
import { parsePaginationParams, buildPagination } from '../utils/pagination.js';

const CARD_INCLUDE = { images: { orderBy: { position: 'asc' } }, category: { include: { parent: true } } };

export const productService = {
  // Filters: category (slug, includes sub-shelves; "fire-sale" = discounted items),
  // search (name or SKU), minPrice / maxPrice, inStock=1, onSale=1, sort.
  // onSale is independent of category, so "on sale" can be combined with any shelf.
  async list(query) {
    const { page, limit, skip } = parsePaginationParams(query);
    const { search, category, sort, minPrice, maxPrice, inStock, onSale } = query;

    const where = { isActive: true };

    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { sku:  { contains: q, mode: 'insensitive' } },
      ];
    }

    if (category === 'fire-sale') {
      where.compareAtPrice = { not: null };
    } else if (category) {
      const cat = await prisma.category.findUnique({ where: { slug: category }, include: { children: true } });
      where.categoryId = { in: cat ? [cat.id, ...cat.children.map(c => c.id)] : [] };
    }
    if ((onSale === '1' || onSale === 'true') && category !== 'fire-sale') where.compareAtPrice = { not: null };

    const price = {};
    if (Number(minPrice) > 0) price.gte = Number(minPrice);
    if (Number(maxPrice) > 0) price.lte = Number(maxPrice);
    if (Object.keys(price).length) where.price = price;
    if (inStock === '1' || inStock === 'true') where.stock = { gt: 0 };

    const sortMap = {
      featured:   [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
      price_asc:  { price: 'asc' },
      price_desc: { price: 'desc' },
      latest:     { createdAt: 'desc' },
      name:       { name: 'asc' },
      popularity: { orderItems: { _count: 'desc' } },
    };
    const orderBy = sortMap[sort] || sortMap.featured;

    const [products, total] = await Promise.all([
      prisma.product.findMany({ where, skip, take: limit, orderBy, include: CARD_INCLUDE }),
      prisma.product.count({ where }),
    ]);

    return { products, pagination: buildPagination(page, limit, total) };
  },

  // Product pages are addressed by SKU (/p/:sku) like the original shop; slugs still work
  async getBySlug(key) {
    return prisma.product.findFirstOrThrow({
      where:   { isActive: true, OR: [{ slug: key }, { sku: key.toUpperCase() }] },
      include: { ...CARD_INCLUDE, brand: true },
    });
  },

  async getRelated(key) {
    const product = await prisma.product.findFirstOrThrow({ where: { OR: [{ slug: key }, { sku: key.toUpperCase() }] } });
    return prisma.product.findMany({
      where:   { categoryId: product.categoryId, id: { not: product.id }, isActive: true },
      take:    4,
      include: CARD_INCLUDE,
    });
  },
};
