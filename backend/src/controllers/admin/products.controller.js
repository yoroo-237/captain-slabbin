import { prisma } from '../../db.js';
import { ok } from '../../utils/response.js';
import { parsePaginationParams, buildPagination } from '../../utils/pagination.js';
import { appError } from '../../utils/formatters.js';
import { uploadToCloudinary } from '../../middlewares/upload.js';
import { postProduct } from '../../services/telegram.service.js';

// Storefront fields: SKU (shown on the invoice), strike-through price (Fire Sale
// shelf), unit label, card badge and featured flag. Only fields sent are returned.
function merchFields(body) {
  const out = {};
  const text = v => (v == null || String(v).trim() === '' ? null : String(v).trim());
  if (body.sku !== undefined)            out.sku = text(body.sku)?.toUpperCase() ?? null;
  if (body.compareAtPrice !== undefined) out.compareAtPrice = Number(body.compareAtPrice) > 0 ? Number(body.compareAtPrice) : null;
  if (body.unitLabel !== undefined)      out.unitLabel = text(body.unitLabel);
  if (body.badge !== undefined)          out.badge = text(body.badge);
  if (body.isFeatured !== undefined)     out.isFeatured = Boolean(body.isFeatured);
  return out;
}

export const adminProductsController = {
  async list(req, res) {
    const { page, limit, skip } = parsePaginationParams(req.query);
    const { search, category, isActive } = req.query;

    const where = {};
    if (search)               where.name     = { contains: search.trim(), mode: 'insensitive' };
    if (category)             where.category = { slug: category };
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: { images: { orderBy: { position: 'asc' } }, category: true, brand: true, _count: { select: { images: true } } },
      }),
      prisma.product.count({ where }),
    ]);
    res.json(ok({ products, pagination: buildPagination(page, limit, total) }));
  },

  async create(req, res) {
    const { name, slug, price, description, stock, categoryId, brandId, images = [] } = req.body;
    const extra = merchFields(req.body);
    if (!name?.trim()) throw appError('name is required', 400);
    if (!slug?.trim()) throw appError('slug is required', 400);
    if (!price)        throw appError('price is required', 400);

    const product = await prisma.product.create({
      data: {
        name:        name.trim(),
        slug:        slug.trim().toLowerCase(),
        price:       parseFloat(price),
        description: description?.trim() || null,
        stock:       parseInt(stock || 0, 10),
        categoryId:  categoryId ? parseInt(categoryId, 10) : null,
        brandId:     brandId    ? parseInt(brandId, 10)    : null,
        ...extra,
        images:      images.length ? { create: images.map((img, i) => ({ url: img.url, thumbnail: img.thumbnail || null, position: i, mediaType: img.mediaType || 'image' })) } : undefined,
      },
      include: { images: true, category: true },
    });
    // Announce it on Telegram a little later, once its photos are uploaded
    if (product.isActive !== false) setTimeout(() => postProduct(product.id).catch(err => console.error('[Telegram] post product:', err.message)), 90_000);
    res.status(201).json(ok(product));
  },

  async update(req, res) {
    const id   = parseInt(req.params.id, 10);
    const { name, slug, price, description, stock, isActive, categoryId, brandId } = req.body;
    const data = {};
    if (name        !== undefined) data.name        = name.trim();
    if (slug        !== undefined) data.slug        = slug.trim().toLowerCase();
    if (price       !== undefined) data.price       = parseFloat(price);
    if (description !== undefined) data.description = description?.trim() || null;
    if (stock       !== undefined) data.stock       = parseInt(stock, 10);
    if (isActive    !== undefined) data.isActive    = Boolean(isActive);
    if (categoryId  !== undefined) data.categoryId  = categoryId ? parseInt(categoryId, 10) : null;
    if (brandId     !== undefined) data.brandId     = brandId    ? parseInt(brandId, 10)    : null;
    Object.assign(data, merchFields(req.body));

    const product = await prisma.product.update({ where: { id }, data, include: { images: true, category: true } });
    res.json(ok(product));
  },

  async remove(req, res) {
    const id = parseInt(req.params.id, 10);
    await prisma.productImage.deleteMany({ where: { productId: id } });
    await prisma.product.delete({ where: { id } });
    res.json(ok({ deleted: true }));
  },

  // ─── Images ─────────────────────────────────────────────────────────────────

  async addImage(req, res) {
    const productId = parseInt(req.params.id, 10);
    const { url, thumbnail, position = 0, mediaType = 'image' } = req.body;
    if (!url) throw appError('url is required', 400);
    const validTypes = ['image', 'video'];
    const type = validTypes.includes(mediaType) ? mediaType : 'image';
    const img = await prisma.productImage.create({ data: { productId, url, thumbnail: thumbnail || null, position: parseInt(position, 10), mediaType: type } });
    res.status(201).json(ok(img));
  },

  async removeImage(req, res) {
    await prisma.productImage.delete({ where: { id: parseInt(req.params.imgId, 10) } });
    res.json(ok({ deleted: true }));
  },

  async uploadImage(req, res) {
    const productId = parseInt(req.params.id, 10);
    const files = req.files;
    if (!files || files.length === 0) throw appError('No files uploaded', 400);

    const startPosition = await prisma.productImage.count({ where: { productId } });

    const imgs = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const type = file.mimetype.startsWith('video/') ? 'video' : 'image';
      const { url, thumbnail } = await uploadToCloudinary(file.buffer, file.mimetype, 'captain-slabbin', `${req.protocol}://${req.get('host')}`);
      const img = await prisma.productImage.create({
        data: { productId, url, thumbnail, position: startPosition + i, mediaType: type },
      });
      imgs.push(img);
    }

    res.status(201).json(ok(imgs));
  },
};
