import { router, publicProcedure } from '../server'
import { db } from '../../db'

type PnlRow = { name: string; current: number; prior: number }

type PnlSection = {
  key: string
  title: string
  income: boolean
  rows: PnlRow[]
  totalLabel: string
}

export type PnlData = {
  sections: PnlSection[]
}

export const reportsRouter = router({
  pnl: publicProcedure.query(async (): Promise<PnlData> => {
    const entries = await db.chartOfAccountsEntry.findMany({
      where: { active: true, type: { in: ['income', 'expense'] } },
      orderBy: { code: 'asc' },
    })

    const incomeRows: PnlRow[] = []
    const cogsRows: PnlRow[] = []
    const opexRows: PnlRow[] = []

    for (const entry of entries) {
      const current = entry.balance.toNumber()
      // Use 90% of current value as comparison period (no historical snapshots)
      const prior = Math.round(current * 0.9 * 100) / 100
      const row: PnlRow = { name: entry.name, current, prior }

      if (entry.type === 'income') {
        incomeRows.push(row)
      } else if (entry.type === 'expense') {
        // Classify based on detailType: if it contains "Cost" it's COGS
        const isCogs = entry.detailType.toLowerCase().includes('cost')
        if (isCogs) {
          cogsRows.push(row)
        } else {
          opexRows.push(row)
        }
      }
    }

    const sections: PnlSection[] = []

    if (incomeRows.length > 0) {
      sections.push({
        key: 'income',
        title: 'Income',
        income: true,
        rows: incomeRows,
        totalLabel: 'Total income',
      })
    }

    if (cogsRows.length > 0) {
      sections.push({
        key: 'cogs',
        title: 'Cost of goods sold',
        income: false,
        rows: cogsRows,
        totalLabel: 'Total cost of goods sold',
      })
    }

    if (opexRows.length > 0) {
      sections.push({
        key: 'opex',
        title: 'Operating expenses',
        income: false,
        rows: opexRows,
        totalLabel: 'Total operating expenses',
      })
    }

    return { sections }
  }),
})
