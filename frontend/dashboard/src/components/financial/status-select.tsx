'use client';

import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FinancialStatus } from '@/types/financial';
import { FINANCIAL_STATUS_META, FINANCIAL_STATUS_ORDER } from './financial-meta';

/** Seletor da situação com o visual de selo, na cor da opção escolhida. */
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
    <div className={cn('relative inline-flex', className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as FinancialStatus)}
        aria-label="Situação financeira"
        className={cn(
          'h-7 w-full cursor-pointer appearance-none rounded-md border pl-2.5 pr-7 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand-orange-500/40 [&>option]:bg-popover [&>option]:text-foreground',
          meta.badge,
        )}
      >
        {FINANCIAL_STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {FINANCIAL_STATUS_META[s].label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-70" />
    </div>
  );
}
