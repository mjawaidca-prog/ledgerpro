'use client'

interface DataPoint {
  m: string
  v: number
}

interface CashflowChartProps {
  data: DataPoint[]
}

export function CashflowChart({ data }: CashflowChartProps) {
  const W = 680
  const H = 230
  const padL = 42
  const padR = 14
  const padT = 14
  const padB = 26
  const min = 70000
  const max = 160000

  const xs = (i: number) => padL + (i * (W - padL - padR)) / (data.length - 1)
  const ys = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB)
  const fmtK = (v: number) => '$' + (v / 1000).toFixed(0) + 'k'

  const pts = data.map((d, i) => [xs(i), ys(d.v)] as [number, number])
  const linePath = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const areaPath = linePath + ` L${xs(data.length - 1)} ${H - padB} L${padL} ${H - padB} Z`
  const last = pts[pts.length - 1]

  const gridValues = [160000, 130000, 100000, 70000]

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Cash on hand trend"
    >
      <defs>
        <linearGradient id="cf-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--primary)' }} stopOpacity="0.20" />
          <stop offset="1" style={{ stopColor: 'var(--primary)' }} stopOpacity="0" />
        </linearGradient>
      </defs>

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

      {/* Area fill */}
      <path d={areaPath} fill="url(#cf-grad)" />

      {/* Line */}
      <path className="c-line" d={linePath} />

      {/* X labels */}
      {data.map((d, i) => (
        <text key={d.m} className="c-axis" x={xs(i)} y={H - 8} textAnchor="middle">{d.m}</text>
      ))}

      {/* Last point dot */}
      <circle className="c-dot" cx={last[0]} cy={last[1]} r="4.5" />
    </svg>
  )
}
