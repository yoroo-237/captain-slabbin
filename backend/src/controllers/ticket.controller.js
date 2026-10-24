import { prisma } from '../db.js';
import { ok } from '../utils/response.js';
import { formatTicketId, appError } from '../utils/formatters.js';

export const ticketController = {
  async list(req, res) {
    const tickets = await prisma.supportTicket.findMany({
      where:   { userId: req.user.sub },
      orderBy: { createdAt: 'desc' },
    });
    res.json(ok(tickets));
  },

  async create(req, res) {
    const { subject, category = 'other', priority = 'normal', message } = req.body;
    if (!subject?.trim()) throw appError('Subject is required', 400);
    if (!message?.trim()) throw appError('Message is required', 400);

    const ticket = await prisma.supportTicket.create({
      data: {
        frontendId: 'TEMP',
        userId:     req.user.sub,
        subject:    subject.trim(),
        category,
        priority,
        messages:   { create: { userId: req.user.sub, message: message.trim(), isAdmin: false } },
      },
    });

    const updated = await prisma.supportTicket.update({
      where:   { id: ticket.id },
      data:    { frontendId: formatTicketId(ticket.id) },
      include: { messages: true },
    });

    res.status(201).json(ok(updated));
  },

  async getOne(req, res) {
    const ticket = await prisma.supportTicket.findFirstOrThrow({
      where:   { id: parseInt(req.params.id, 10), userId: req.user.sub },
      include: {
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

    const ticket = await prisma.supportTicket.findFirstOrThrow({
      where: { id: parseInt(req.params.id, 10), userId: req.user.sub },
    });

    if (['resolved', 'closed'].includes(ticket.status)) {
      throw appError('This ticket is closed, you can no longer reply', 400);
    }

    const msg = await prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        userId:   req.user.sub,
        message:  message.trim(),
        isAdmin:  false,
      },
    });

    res.status(201).json(ok(msg));
  },
};
