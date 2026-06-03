import { ArrowUpRight, ArrowDownRight } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string
  delta: string
  deltaDir: 'up' | 'down' | 'neutral'
  deltaLabel?: string
  icon: React.ReactNode
  iconColor: 'blue' | 'green' | 'red' | 'gray'
  valueClass?: string
}

export function StatCard({
  label,
  value,
  delta,
  deltaDir,
  deltaLabel,
  icon,
  iconColor,
  valueClass,
}: StatCardProps) {
  return (
    <div className="stat">
      <div className="stat-top">
        <span className={`stat-ico ${iconColor}`}>{icon}</span>
        <span className="stat-label">{label}</span>
      </div>
      <div className={`stat-value${valueClass ? ' ' + valueClass : ''}`}>{value}</div>
      <div className={`stat-delta${deltaDir !== 'neutral' ? ' ' + deltaDir : ''}`}>
        {deltaDir === 'up' && <ArrowUpRight />}
        {deltaDir === 'down' && <ArrowDownRight />}
        {delta}
        {deltaLabel && <span className="muted">{deltaLabel}</span>}
      </div>
    </div>
  )
}
