'use client';

import { useState, useCallback, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  type?: 'text' | 'num' | 'date';
  align?: 'left' | 'right';
  className?: string;
  render?: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  toolbar?: ReactNode;
  emptyMessage?: string;
  rowKey?: (row: T) => string;
  onRowClick?: (row: T) => void;
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  toolbar,
  emptyMessage = 'No records found.',
  rowKey,
  onRowClick,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const handleSort = useCallback(
    (col: Column<T>) => {
      if (!col.sortable) return;
      if (sortKey === col.key) {
        setSortDir((d) => (d === 1 ? -1 : 1));
      } else {
        setSortKey(col.key);
        setSortDir(1);
      }
    },
    [sortKey]
  );

  const sorted = [...data].sort((a, b) => {
    if (!sortKey) return 0;
    const col = columns.find((c) => c.key === sortKey);
    let av: any = a[sortKey];
    let bv: any = b[sortKey];

    if (col?.type === 'num') {
      av = parseFloat(av ?? 0);
      bv = parseFloat(bv ?? 0);
    } else if (col?.type === 'date') {
      av = Date.parse(av ?? '');
      bv = Date.parse(bv ?? '');
    } else {
      av = String(av ?? '').toLowerCase();
      bv = String(bv ?? '').toLowerCase();
    }

    if (av < bv) return -1 * sortDir;
    if (av > bv) return 1 * sortDir;
    return 0;
  });

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-[var(--shadow-sm)]">
      {toolbar && (
        <div className="flex items-center gap-3 px-4 py-[14px] border-b border-[var(--border)]">
          {toolbar}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[var(--cell-fs)]">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'text-left font-mono text-micro uppercase tracking-[0.07em] font-semibold',
                    'text-[var(--text-muted)] py-[11px] px-4 bg-[var(--surface-2)]',
                    'border-b border-[var(--border)] whitespace-nowrap sticky top-0',
                    col.sortable && 'cursor-pointer select-none hover:text-[var(--text-strong)]',
                    sortKey === col.key && 'text-[var(--accent)]',
                    col.align === 'right' && 'text-right',
                    col.className
                  )}
                  onClick={() => handleSort(col)}
                >
                  <span className={cn(
                    'inline-flex items-center gap-[5px]',
                    col.align === 'right' && 'flex-row-reverse'
                  )}>
                    {col.header}
                    {col.sortable && (
                      <span className="w-[13px] h-[13px] opacity-45">
                        {sortKey === col.key ? (
                          sortDir === 1 ? <ArrowUp size={13} /> : <ArrowDown size={13} />
                        ) : (
                          <ChevronsUpDown size={13} />
                        )}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-12 text-center text-[var(--text-muted)] text-sm">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sorted.map((row, idx) => (
                <tr
                  key={rowKey ? rowKey(row) : idx}
                  className={cn(
                    'group',
                    idx % 2 === 0 && 'bg-[var(--surface-2)]',
                    'hover:bg-[var(--primary-soft)]',
                    onRowClick && 'cursor-pointer'
                  )}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        'py-[var(--row-py)] px-4 border-b border-[var(--border)]',
                        'text-[var(--text)] align-middle',
                        'group-last:border-b-0',
                        col.align === 'right' && 'text-right font-mono tabular-nums tracking-[-0.01em] text-[var(--text-strong)] font-medium',
                        col.className
                      )}
                    >
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
