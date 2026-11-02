import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()

const DEFAULT_SETTINGS = {
  maxReportsNoProof: 1,
  maxMediaPerReport: 3,
  maxSendMb: 30,
  tokenPriceUsd: 1,
  reportCostTokens: 1,
  depositExpiryHours: 12,
  reserveAddresses: {},
  xmrAddress: null,
}

// Settings changed from the super admin space (single row id 1), defaults until saved once
export async function getSettings() {
  const row = await prisma.setting.findUnique({ where: { id: 1 } })
  if (!row) return { ...DEFAULT_SETTINGS }
  return {
    maxReportsNoProof: row.maxReportsNoProof,
    maxMediaPerReport: row.maxMediaPerReport,
    maxSendMb: row.maxSendMb,
    tokenPriceUsd: Number(row.tokenPriceUsd),
    reportCostTokens: row.reportCostTokens,
    depositExpiryHours: row.depositExpiryHours,
    reserveAddresses: row.reserveAddresses || {},
    xmrAddress: row.xmrAddress,
  }
}

export const saveSettings = (data) =>
  prisma.setting.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } })
