'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ArrowLeftRight, Link2, Scale, GitBranch } from 'lucide-react';

const navItems = [
  { href: '/intercompany/transfer',       label: 'New Transfer',  icon: ArrowLeftRight },
  { href: '/intercompany/entries',        label: 'Linked Entries', icon: Link2 },
  { href: '/intercompany/reconciliation', label: 'Reconciliation', icon: Scale },
  { href: '/intercompany/relationships',  label: 'Relationships',  icon: GitBranch },
];

export function IntercompanySidebar() {
  const pathname = usePathname();

  return (
    <div style={{
      width: 216,
      flex: 'none',
      background: 'var(--surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      padding: '18px 12px',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '4px 8px 20px',
      }}>
        <div style={{
          width: 22,
          height: 22,
          borderRadius: 'var(--r-full)',
          border: '1px solid var(--border)',
          display: 'grid',
          placeItems: 'center',
        }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: 'var(--r-full)',
            background: 'var(--warning)',
            boxShadow: '0 0 10px -1px var(--warning)',
          }} />
        </div>
        <div style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-base)',
          fontWeight: 600,
          color: 'var(--text-strong)',
          letterSpacing: '-0.01em',
        }}>
          LedgerPro
        </div>
      </div>

      <div style={{
        padding: '6px 8px',
        fontSize: 'var(--text-xs)',
        fontWeight: 500,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-label)',
      }}>
        Related parties
      </div>

      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-[10px] px-[10px] py-[9px] border-0 rounded-[var(--r-md)] bg-transparent text-[var(--text)] text-[var(--text-sm)] text-left no-underline',
              'hover:bg-[var(--surface-2)] hover:text-[var(--text-strong)]',
              isActive && 'bg-[var(--primary-soft)] text-[var(--primary)] font-medium'
            )}
            style={{
              position: 'relative',
              fontFamily: 'var(--font-sans)',
              transition: 'background var(--dur) var(--ease), color var(--dur) var(--ease)',
            }}
          >
            {isActive && (
              <span style={{
                position: 'absolute',
                left: 0,
                top: 8,
                bottom: 8,
                width: 2,
                borderRadius: 2,
                background: 'var(--primary)',
                boxShadow: '0 0 12px -2px var(--primary)',
              }} />
            )}
            <Icon size={16} />
            {item.label}
          </Link>
        );
      })}

      <div style={{
        marginTop: 'auto',
        borderTop: '1px solid var(--border)',
        paddingTop: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        <div style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 500,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-label)',
        }}>
          Mirror posting
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{
            width: 7,
            height: 7,
            borderRadius: 'var(--r-full)',
            background: 'var(--success)',
          }} />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text)',
          }}>
            Auto-post
          </span>
        </div>
      </div>
    </div>
  );
}
