// Reports of a batch spread over time: each one is created when its time comes.
// They are paid with the batch, so sending one only creates the report.
// Checked every minute, and at start: reports due during a restart go out then.

import { prisma } from './db.js'

const TICK_MS = 60 * 1000

export async function sendDueReports(onSent = () => {}) {
  const due = await prisma.scheduledReport.findMany({
    where: { sentAt: null, dueAt: { lte: new Date() } },
    orderBy: { dueAt: 'asc' },
    take: 50,
  })
  for (const s of due) {
    const sent = await prisma.$transaction(async (tx) => {
      // Claimed first: a second tick or instance never sends it twice
      const claim = await tx.scheduledReport.updateMany({ where: { id: s.id, sentAt: null }, data: { sentAt: new Date() } })
      if (!claim.count) return false
      const report = await tx.report.create({
        data: {
          targetId: s.targetId, userId: s.userId, type: s.type, detectedType: s.detectedType,
          description: s.description, lang: s.lang, ipHash: s.ipHash,
          // Its own proof, reserved when the batch was paid: a capture (the type is already
          // the capture's), a link and/or media
          captureId: s.captureId, proofUrl: s.proofUrl, proofHash: s.proofHash, captured: !!s.captureId,
        },
      })
      await tx.evidence.updateMany({ where: { scheduledId: s.id }, data: { reportId: report.id, scheduledId: null } })
      await tx.target.update({ where: { id: s.targetId }, data: { reportCount: { increment: 1 } } })
      await tx.scheduledReport.update({ where: { id: s.id }, data: { reportId: report.id } })
      return true
    })
    if (sent) onSent(s.targetId)
  }
}

export function startScheduledReports(onSent) {
  const tick = () => sendDueReports(onSent).catch((err) => console.error('[scheduled] send failed:', err.message))
  tick()
  setInterval(tick, TICK_MS).unref()
}
