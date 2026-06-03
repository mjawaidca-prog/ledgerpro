'use client'

interface DataPoint {
  m: string
  inc: number
  exp: number
}

interface IncomeExpenseChartProps {
  data: DataPoint[]
}

export function IncomeExpenseChart({ data }: IncomeExpenseChartProps) {
  const W = 680
  const H = 230
  const padL = 42
  const padR = 14
  const padT = 14
  const padB = 26
  const maxVal = 100000
  const barW = 16
  const gap = 7

  const ys = (v: number) => padT + (1 - v / maxVal) * (H - padT - padB)
  const groupW = (W - padL - padR) / data.length
  const base = ys(0)
  const fmtK = (v: number) => v === 0 ? '$0' : '$' + (v / 1000).toFixed(0) + 'k'

  const gridValues = [100000, 75000, 50000, 25000, 0]

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Income versus expense"
    >
      {/* Grid lines + Y labels */}
      {gridValues.map((g) => {
        const y = ys(g)
        return (
          <g key={g}>
            <line className="c-grid" x1={padL} y1={y} x2={W - padR} y2={y} />
            <text className="c-axis" x={padL - 8} y={y + 3} textAnchor="end">{fmtK(g)}</text>
          </g>
        )
      })}

      {/* Bars */}
      {data.map((d, i) => {
        const cx = padL + groupW * i + groupW / 2
        const x1 = cx - barW - gap / 2
        const x2 = cx + gap / 2
        const yi = ys(d.inc)
        const ye = ys(d.exp)
        return (
          <g key={d.m}>
            <rect className="bar-income" x={x1} y={yi} width={barW} height={base - yi} rx="3" />
            <rect className="bar-expense" x={x2} y={ye} width={barW} height={base - ye} rx="3" />
            <text className="c-axis" x={cx} y={H - 8} textAnchor="middle">{d.m}</text>
          </g>
        )
      })}
    </svg>
  )
}
