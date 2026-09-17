'use client';

import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FinancialStatus } from '@/types/financial';
import { FINANCIAL_STATUS_META, FINANCIAL_STATUS_ORDER } from './financial-meta';

/** Seletor da situação pintado com a cor da opção, como a célula da planilha. */
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
    <div className={cn('relative w-full', className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as FinancialStatus)}
        aria-label="Situação financeira"
        className="h-8 w-full cursor-pointer appearance-none px-2 pr-7 text-center text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue-500 [&>option]:bg-white [&>option]:text-slate-900"
        style={{ color: meta.text, backgroundColor: meta.bg }}
      >
        {FINANCIAL_STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {FINANCIAL_STATUS_META[s].label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
        style={{ color: meta.text }}
      />
    </div>
  );
}
