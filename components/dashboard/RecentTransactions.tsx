'use client'

import { useState } from 'react'
import { ArrowRight, ChevronsUpDown, ArrowUp, ArrowDown } from 'lucide-react'

interface Transaction {
  id: string
  date: string
  dateLabel: string
  description: string
  category: string
  categoryColor: string
  account: string
  amount: number
  amountDisplay: string
}

interface RecentTransactionsProps {
  transactions: Transaction[]
}

type SortKey = 'date' | 'description' | 'amount'
type SortDir = 1 | -1

export function RecentTransactions({ transactions }: RecentTransactionsProps) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(1)

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1))
    } else {
      setSortKey(key)
      setSortDir(1)
    }
  }

  const sorted = [...transactions].sort((a, b) => {
    if (!sortKey) return 0
    let av: string | number
    let bv: string | number
    if (sortKey === 'date') {
      av = Date.parse(a.date)
      bv = Date.parse(b.date)
    } else if (sortKey === 'amount') {
      av = a.amount
      bv = b.amount
    } else {
      av = a.description.toLowerCase()
      bv = b.description.toLowerCase()
    }
    return (av < bv ? -1 : av > bv ? 1 : 0) * sortDir
  })

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="sort-ico" />
    return sortDir === 1 ? <ArrowUp className="sort-ico" /> : <ArrowDown className="sort-ico" />
  }

  return (
    <div className="table-wrap" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <div className="panel-head">
        <h3 className="t-h3">Recent transactions</h3>
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm">
          View all<ArrowRight />
        </button>
      </div>
      <table className="data">
        <thead>
          <tr>
            <th
              className={`sortable${sortKey === 'date' ? ' sorted' : ''}`}
              onClick={() => handleSort('date')}
            >
              <span className="th-inner">
                Date <SortIcon col="date" />
              </span>
            </th>
            <th
              className={`sortable${sortKey === 'description' ? ' sorted' : ''}`}
              onClick={() => handleSort('description')}
            >
              <span className="th-inner">
                Description <SortIcon col="description" />
              </span>
            </th>
            <th>Category</th>
            <th>Account</th>
            <th
              className={`sortable num${sortKey === 'amount' ? ' sorted' : ''}`}
              onClick={() => handleSort('amount')}
            >
              <span className="th-inner">
                Amount <SortIcon col="amount" />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((txn) => (
            <tr key={txn.id}>
              <td className="t-num" style={{ color: 'var(--text-muted)' }}>{txn.dateLabel}</td>
              <td>
                <span style={{ fontWeight: 550, color: 'var(--text-strong)' }}>{txn.description}</span>
              </td>
              <td>
                <span className="txn-cat">
                  <span className="dot" style={{ background: txn.categoryColor }} />
                  {txn.category}
                </span>
              </td>
              <td><span className="acct-chip">{txn.account}</span></td>
              <td className={`num ${txn.amount >= 0 ? 'pos' : 'neg'}`}>
                {txn.amountDisplay}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
