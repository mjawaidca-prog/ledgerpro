import { router, publicProcedure } from '../server'
import { z } from 'zod'

const TYPES = [
  {
    key: 'asset', label: 'Assets', single: 'Asset', color: 'var(--blue-500)',
    accounts: [
      { code: '1000', name: 'Bank Accounts', detail: '—', desc: 'Operating cash accounts', parent: true, children: [
        { code: '1010', name: 'Chase Business Checking', detail: 'Bank', desc: 'Primary operating account', bal: 142580.00, active: true },
        { code: '1020', name: 'Stripe Clearing', detail: 'Bank', desc: 'Payment processor clearing', bal: 6961.55, active: true },
      ]},
      { code: '1200', name: 'Accounts Receivable', detail: 'Accounts receivable', desc: 'Money owed by customers', bal: 58430.00, active: true },
      { code: '1400', name: 'Undeposited Funds', detail: 'Other current asset', desc: 'Received, not yet deposited', bal: 2140.55, active: true },
      { code: '1500', name: 'Inventory', detail: 'Inventory asset', desc: 'Goods held for resale', bal: 38900.00, active: true },
      { code: '1700', name: 'Fixed Assets', detail: '—', desc: 'Property & equipment', parent: true, children: [
        { code: '1710', name: 'Equipment', detail: 'Machinery & equipment', desc: 'Owned equipment at cost', bal: 42000.00, active: true },
        { code: '1720', name: 'Accumulated Depreciation', detail: 'Accumulated depreciation', desc: 'Contra-asset account', bal: -12500.00, active: true },
      ]},
    ],
  },
  {
    key: 'liability', label: 'Liabilities', single: 'Liability', color: 'var(--amber-500)',
    accounts: [
      { code: '2000', name: 'Accounts Payable', detail: 'Accounts payable', desc: 'Money owed to vendors', bal: 21840.00, active: true },
      { code: '2100', name: 'Credit Cards', detail: '—', desc: 'Business credit cards', parent: true, children: [
        { code: '2110', name: 'Amex Business', detail: 'Credit card', desc: 'Corporate charge card', bal: 8420.55, active: true },
      ]},
      { code: '2200', name: 'Sales Tax Payable', detail: 'Other current liability', desc: 'Sales tax collected', bal: 6310.20, active: true },
      { code: '2400', name: 'Payroll Liabilities', detail: 'Payroll liability', desc: 'Withholdings owed', bal: 9180.00, active: true },
      { code: '2700', name: 'SBA Term Loan', detail: 'Long-term liability', desc: '7-year term loan', bal: 60000.00, active: true },
    ],
  },
  {
    key: 'equity', label: 'Equity', single: 'Equity', color: '#7c5cff',
    accounts: [
      { code: '3000', name: "Owner's Capital", detail: "Owner's equity", desc: 'Contributed capital', bal: 120000.00, active: true },
      { code: '3100', name: 'Retained Earnings', detail: 'Retained earnings', desc: 'Accumulated profits', bal: 95420.00, active: true },
      { code: '3900', name: "Owner's Draw", detail: "Owner's equity", desc: 'Distributions to owner', bal: -18000.00, active: true },
    ],
  },
  {
    key: 'income', label: 'Income', single: 'Income', color: 'var(--green-500)',
    accounts: [
      { code: '4000', name: 'Product Sales', detail: 'Income', desc: 'Revenue from goods sold', bal: 248900.00, active: true },
      { code: '4100', name: 'Service Revenue', detail: 'Income', desc: 'Revenue from services', bal: 162400.00, active: true },
      { code: '4900', name: 'Other Income', detail: 'Other income', desc: 'Miscellaneous income', bal: 8150.00, active: true },
    ],
  },
  {
    key: 'expense', label: 'Expenses', single: 'Expense', color: 'var(--red-500)',
    accounts: [
      { code: '5000', name: 'Cost of Goods Sold', detail: '—', desc: 'Direct costs of sales', parent: true, children: [
        { code: '5010', name: 'Materials & Supplies', detail: 'Supplies & materials', desc: 'Raw materials', bal: 78200.00, active: true },
        { code: '5020', name: 'Subcontractors', detail: 'Subcontractor', desc: 'Outsourced labor', bal: 41600.00, active: true },
      ]},
      { code: '6000', name: 'Payroll & Wages', detail: 'Payroll expense', desc: 'Salaries and wages', bal: 138400.00, active: true },
      { code: '6100', name: 'Rent & Lease', detail: 'Rent or lease', desc: 'Office lease', bal: 42500.00, active: true },
      { code: '6200', name: 'Software & Subscriptions', detail: 'Dues & subscriptions', desc: 'SaaS tools', bal: 18900.00, active: true },
      { code: '6300', name: 'Advertising & Marketing', detail: 'Advertising', desc: 'Campaigns & ads', bal: 24600.00, active: true },
      { code: '6400', name: 'Travel & Meals', detail: 'Travel', desc: 'Business travel', bal: 9840.00, active: true },
      { code: '6900', name: 'Utilities', detail: 'Utilities', desc: 'Power, internet, phone', bal: 6420.00, active: true },
      { code: '6950', name: 'Bank Charges', detail: 'Bank charges', desc: 'Legacy fees account', bal: 0.00, active: false },
    ],
  },
]

type AccountEntry = {
  code: string
  name: string
  detail: string
  desc: string
  bal: number
  active: boolean
  isParent?: boolean
  isSub?: boolean
  typeKey: string
  typeLabel: string
  typeSingle: string
  typeColor: string
}

function flatten(): AccountEntry[] {
  const out: AccountEntry[] = []
  for (const t of TYPES) {
    for (const a of t.accounts) {
      if ('parent' in a && a.parent && 'children' in a) {
        const total = a.children.reduce((s, c) => s + c.bal, 0)
        out.push({
          code: a.code,
          name: a.name,
          detail: a.detail,
          desc: a.desc,
          bal: total,
          active: true,
          isParent: true,
          typeKey: t.key,
          typeLabel: t.label,
          typeSingle: t.single,
          typeColor: t.color,
        })
        for (const c of a.children) {
          out.push({
            code: c.code,
            name: c.name,
            detail: c.detail,
            desc: c.desc,
            bal: c.bal,
            active: c.active ?? true,
            isSub: true,
            typeKey: t.key,
            typeLabel: t.label,
            typeSingle: t.single,
            typeColor: t.color,
          })
        }
      } else if (!('parent' in a)) {
        const leaf = a as { code: string; name: string; detail: string; desc: string; bal: number; active: boolean }
        out.push({
          code: leaf.code,
          name: leaf.name,
          detail: leaf.detail,
          desc: leaf.desc,
          bal: leaf.bal,
          active: leaf.active ?? true,
          typeKey: t.key,
          typeLabel: t.label,
          typeSingle: t.single,
          typeColor: t.color,
        })
      }
    }
  }
  return out
}

export const coaRouter = router({
  list: publicProcedure
    .input(z.object({
      type: z.string().optional(),
      search: z.string().optional(),
      active: z.string().optional(),
    }).optional())
    .query(({ input }) => {
      let rows = flatten()
      if (input?.type && input.type !== 'all') {
        rows = rows.filter((r) => r.typeKey === input.type)
      }
      if (input?.active && input.active !== 'all') {
        const wantActive = input.active === 'active'
        rows = rows.filter((r) => r.active === wantActive)
      }
      if (input?.search) {
        const q = input.search.toLowerCase()
        rows = rows.filter(
          (r) =>
            r.code.toLowerCase().includes(q) ||
            r.name.toLowerCase().includes(q) ||
            r.detail.toLowerCase().includes(q) ||
            r.desc.toLowerCase().includes(q),
        )
      }
      return rows
    }),

  stats: publicProcedure.query(() => {
    const result: Record<string, { count: number; total: number }> = {}
    for (const t of TYPES) {
      let total = 0
      let count = 0
      for (const a of t.accounts) {
        if ('parent' in a && a.parent && 'children' in a) {
          for (const c of a.children) {
            total += c.bal
            count++
          }
          count++ // parent row
        } else {
          const leaf = a as { bal: number }
          total += leaf.bal
          count++
        }
      }
      result[t.key] = { count, total }
    }
    return result
  }),
})
