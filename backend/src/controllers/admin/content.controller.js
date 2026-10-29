import { prisma } from '../../db.js';
import { ok } from '../../utils/response.js';
import { appError } from '../../utils/formatters.js';
import { shopWhere, newSource } from '../../utils/shops.js';

// "Blue Gumbo!" → "blue-gumbo" — used when the admin leaves the slug field empty
const slugify = v => String(v || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ─── Categories ───────────────────────────────────────────────────────────────

export const categoriesController = {
  // ?shop=site | <catalog>: only that shop's shelves
  async list(req, res) {
    const cats = await prisma.category.findMany({
      where: shopWhere(req.query.shop),
      orderBy: { name: 'asc' },
      include: { children: { orderBy: { name: 'asc' } }, _count: { select: { products: true } } },
    });
    res.json(ok(cats));
  },

  async create(req, res) {
    const { name, slug, parentId } = req.body;
    if (!name?.trim()) throw appError('name is required', 400);
    // In the shop being viewed; a bot catalog's shelves are stored as "<source>-<slug>"
    // so they never clash with the website's
    const source = newSource(req.body.source);
    const base = slugify(slug?.trim() || name);
    const cat = await prisma.category.create({
      data: {
        name: name.trim(), slug: source && !base.startsWith(`${source}-`) ? `${source}-${base}` : base, source,
        parentId: parentId ? parseInt(parentId, 10) : null,
        imageUrl: req.body.imageUrl?.trim() || null, position: parseInt(req.body.position || 0, 10) || 0,
      },
    });
    res.status(201).json(ok(cat));
  },

  async update(req, res) {
    const { name, slug, parentId } = req.body;
    const data = {};
    if (name     !== undefined) data.name     = name.trim();
    if (slug     !== undefined) data.slug     = slugify(slug.trim() || name);
    if (parentId !== undefined) data.parentId = parentId ? parseInt(parentId, 10) : null;
    if (req.body.imageUrl !== undefined) data.imageUrl = req.body.imageUrl?.trim() || null;
    if (req.body.position !== undefined) data.position = parseInt(req.body.position, 10) || 0;
    const cat = await prisma.category.update({ where: { id: parseInt(req.params.id, 10) }, data });
    res.json(ok(cat));
  },

  async remove(req, res) {
    await prisma.category.delete({ where: { id: parseInt(req.params.id, 10) } });
    res.json(ok({ deleted: true }));
  },
};

// ─── Brands ──────────────────────────────────────────────────────────────────

export const brandsController = {
  async list(req, res) {
    const brands = await prisma.brand.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
    res.json(ok(brands));
  },

  async create(req, res) {
    const { name, slug, logoUrl } = req.body;
    if (!name?.trim()) throw appError('name is required', 400);
    const brand = await prisma.brand.create({
      data: { name: name.trim(), slug: slugify(slug?.trim() || name), logoUrl: logoUrl || null },
    });
    res.status(201).json(ok(brand));
  },

  async update(req, res) {
    const { name, slug, logoUrl } = req.body;
    const data = {};
    if (name    !== undefined) data.name    = name.trim();
    if (slug    !== undefined) data.slug    = slugify(slug.trim() || name);
    if (logoUrl !== undefined) data.logoUrl = logoUrl || null;
    const brand = await prisma.brand.update({ where: { id: parseInt(req.params.id, 10) }, data });
    res.json(ok(brand));
  },

  async remove(req, res) {
    await prisma.brand.delete({ where: { id: parseInt(req.params.id, 10) } });
    res.json(ok({ deleted: true }));
  },
};

// ─── News ─────────────────────────────────────────────────────────────────────

export const newsController = {
  async list(req, res) {
    const news = await prisma.newsArticle.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(ok(news));
  },

  async create(req, res) {
    const { title, slug, content, imageUrl, isPublished = false } = req.body;
    if (!title?.trim())   throw appError('title is required', 400);
    if (!content?.trim()) throw appError('content is required', 400);
    // Unique slug: the title alone can repeat between articles
    const article = await prisma.newsArticle.create({
      data: {
        title: title.trim(), slug: slugify(slug?.trim() || title) + (slug?.trim() ? '' : `-${Date.now().toString(36)}`), content: content.trim(),
        imageUrl: imageUrl || null, isPublished: Boolean(isPublished),
        publishedAt: isPublished ? new Date() : null,
      },
    });
    res.status(201).json(ok(article));
  },

  async update(req, res) {
    const { title, slug, content, imageUrl, isPublished } = req.body;
    const data = {};
    if (title       !== undefined) data.title       = title.trim();
    if (slug        !== undefined && slug.trim()) data.slug = slugify(slug);
    if (content     !== undefined) data.content     = content.trim();
    if (imageUrl    !== undefined) data.imageUrl    = imageUrl || null;
    if (isPublished !== undefined) {
      data.isPublished = Boolean(isPublished);
      if (Boolean(isPublished)) data.publishedAt = new Date();
    }
    const article = await prisma.newsArticle.update({ where: { id: parseInt(req.params.id, 10) }, data });
    res.json(ok(article));
  },

  async remove(req, res) {
    await prisma.newsArticle.delete({ where: { id: parseInt(req.params.id, 10) } });
    res.json(ok({ deleted: true }));
  },
};

// ─── FAQ ──────────────────────────────────────────────────────────────────────

export const faqController = {
  async list(req, res) {
    const faqs = await prisma.fAQ.findMany({ orderBy: { position: 'asc' } });
    res.json(ok(faqs));
  },

  async create(req, res) {
    const { question, answer, category, position = 0, isActive = true } = req.body;
    if (!question?.trim()) throw appError('question is required', 400);
    if (!answer?.trim())   throw appError('answer is required', 400);
    const faq = await prisma.fAQ.create({
      data: { question: question.trim(), answer: answer.trim(), category: category || null, position: parseInt(position, 10), isActive: Boolean(isActive) },
    });
    res.status(201).json(ok(faq));
  },

  async update(req, res) {
    const { question, answer, category, position, isActive } = req.body;
    const data = {};
    if (question !== undefined) data.question = question.trim();
    if (answer   !== undefined) data.answer   = answer.trim();
    if (category !== undefined) data.category = category || null;
    if (position !== undefined) data.position = parseInt(position, 10);
    if (isActive !== undefined) data.isActive = Boolean(isActive);
    const faq = await prisma.fAQ.update({ where: { id: parseInt(req.params.id, 10) }, data });
    res.json(ok(faq));
  },

  async remove(req, res) {
    await prisma.fAQ.delete({ where: { id: parseInt(req.params.id, 10) } });
    res.json(ok({ deleted: true }));
  },
};

// ─── Giveaways ────────────────────────────────────────────────────────────────

export const giveawaysController = {
  async list(req, res) {
    const giveaways = await prisma.giveaway.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(ok(giveaways));
  },

  async create(req, res) {
    const { title, description, prize, imageUrl, status = 'draft', endsAt } = req.body;
    if (!title?.trim())       throw appError('title is required', 400);
    if (!description?.trim()) throw appError('description is required', 400);
    if (!prize?.trim())       throw appError('prize is required', 400);
    const giveaway = await prisma.giveaway.create({
      data: { title: title.trim(), description: description.trim(), prize: prize.trim(), imageUrl: imageUrl || null, status, endsAt: endsAt ? new Date(endsAt) : null },
    });
    res.status(201).json(ok(giveaway));
  },

  async update(req, res) {
    const { title, description, prize, imageUrl, status, endsAt } = req.body;
    const data = {};
    if (title       !== undefined) data.title       = title.trim();
    if (description !== undefined) data.description = description.trim();
    if (prize       !== undefined) data.prize       = prize.trim();
    if (imageUrl    !== undefined) data.imageUrl    = imageUrl || null;
    if (status      !== undefined) data.status      = status;
    if (endsAt      !== undefined) data.endsAt      = endsAt ? new Date(endsAt) : null;
    const giveaway = await prisma.giveaway.update({ where: { id: parseInt(req.params.id, 10) }, data });
    res.json(ok(giveaway));
  },

  async remove(req, res) {
    await prisma.giveaway.delete({ where: { id: parseInt(req.params.id, 10) } });
    res.json(ok({ deleted: true }));
  },
};

// ─── Reviews ─────────────────────────────────────────────────────────────────

export const reviewsController = {
  async list(req, res) {
    const where = {};
    if (req.query.approved !== undefined) where.isApproved = req.query.approved === 'true';
    const reviews = await prisma.review.findMany({
      where,
      include: {
        user:    { select: { id: true, username: true } },
        product: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(ok(reviews));
  },

  async approve(req, res) {
    const review = await prisma.review.update({
      where: { id: parseInt(req.params.id, 10) },
      data:  { isApproved: true },
    });
    res.json(ok(review));
  },

  async remove(req, res) {
    await prisma.review.delete({ where: { id: parseInt(req.params.id, 10) } });
    res.json(ok({ deleted: true }));
  },
};
