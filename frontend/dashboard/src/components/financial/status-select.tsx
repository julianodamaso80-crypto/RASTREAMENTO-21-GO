'use client';

import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FinancialStatus } from '@/types/financial';
import { FINANCIAL_STATUS_META, FINANCIAL_STATUS_ORDER } from './financial-meta';

/** Seletor da situação em forma de selo em relevo, na cor da opção escolhida. */
export function StatusSelect({
  value,
  onChange,
  className,
}: {
  value: FinancialStatus;
  onChange: (value: FinancialStatus) => void;
  className?: string;
}) {
  const meta = FINANCIAL_STATUS_META[value];
  return (
    <div className={cn('relative inline-flex w-full min-w-[168px]', className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as FinancialStatus)}
        aria-label="Situação financeira"
        className="h-9 w-full cursor-pointer appearance-none rounded-lg pl-3 pr-8 text-xs font-extrabold tracking-wide outline-none transition-transform duration-150 hover:-translate-y-px active:translate-y-0.5 focus-visible:ring-2 focus-visible:ring-white/60 [&>option]:bg-popover [&>option]:text-foreground"
        style={{
          color: meta.text,
          background: `linear-gradient(180deg, ${meta.from} 0%, ${meta.to} 100%)`,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,.45), 0 3px 0 ${meta.edge}, 0 6px 14px -4px ${meta.edge}`,
          textShadow: meta.text === '#ffffff' ? '0 1px 1px rgba(0,0,0,.35)' : 'none',
        }}
      >
        {FINANCIAL_STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {FINANCIAL_STATUS_META[s].label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2"
        style={{ color: meta.text }}
      />
    </div>
  );
}
