import { prisma } from '../../db.js';
import { ok } from '../../utils/response.js';
import { parsePaginationParams, buildPagination } from '../../utils/pagination.js';
import { appError } from '../../utils/formatters.js';

const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

export const adminSupportController = {
  async list(req, res) {
    const { page, limit, skip } = parsePaginationParams(req.query);
    const { status, priority, category, search } = req.query;

    const where = {};
    if (status)   where.status   = status;
    if (priority) where.priority = priority;
    if (category) where.category = category;
    if (search)   where.OR = [
      { subject:  { contains: search, mode: 'insensitive' } },
      { user:     { username: { contains: search, mode: 'insensitive' } } },
    ];

    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, username: true } }, _count: { select: { messages: true } } },
      }),
      prisma.supportTicket.count({ where }),
    ]);
    res.json(ok({ tickets, pagination: buildPagination(page, limit, total) }));
  },

  async getOne(req, res) {
    const ticket = await prisma.supportTicket.findUniqueOrThrow({
      where:   { id: parseInt(req.params.id, 10) },
      include: {
        user:     { select: { id: true, username: true, telegramHandle: true } },
        messages: {
          include: { user: { select: { username: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    res.json(ok(ticket));
  },

  async reply(req, res) {
    const { message } = req.body;
    if (!message?.trim()) throw appError('Message is required', 400);

    const ticketId = parseInt(req.params.id, 10);
    const ticket   = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });

    if (['resolved', 'closed'].includes(ticket.status)) {
      throw appError('This ticket is closed', 400);
    }

    const msg = await prisma.ticketMessage.create({
      data: {
        ticketId,
        userId:  req.user.sub,
        message: message.trim(),
        isAdmin: true,
      },
    });

    await prisma.supportTicket.update({
      where: { id: ticketId },
      data:  { status: 'in_progress', assignedTo: req.user.username || null },
    });

    res.status(201).json(ok(msg));
  },

  async updateStatus(req, res) {
    const { status, assignedTo } = req.body;
    if (!VALID_STATUSES.includes(status)) {
      throw appError(`Invalid status. Valid values: ${VALID_STATUSES.join(', ')}`, 400);
    }
    const ticket = await prisma.supportTicket.update({
      where: { id: parseInt(req.params.id, 10) },
      data:  { status, assignedTo: assignedTo || null },
    });
    res.json(ok(ticket));
  },
};
