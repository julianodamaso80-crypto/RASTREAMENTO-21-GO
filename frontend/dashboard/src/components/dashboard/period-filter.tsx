'use client';

import { cn } from '@/lib/utils';
import type { DashboardPeriod } from '@/types/dashboard';
import { PERIOD_LABELS } from '@/types/dashboard';

interface PeriodFilterProps {
  value: DashboardPeriod;
  onChange: (p: DashboardPeriod) => void;
}

const options: DashboardPeriod[] = ['today', '7d', '30d'];

export function PeriodFilter({ value, onChange }: PeriodFilterProps) {
  return (
    <div className="inline-flex items-center rounded-lg bg-muted/30 p-1 ring-1 ring-border">
      {options.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          className={cn(
            'px-3 py-1 text-xs font-medium rounded-md transition-all',
            value === p
              ? 'bg-emerald-500/15 text-emerald-400 shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {PERIOD_LABELS[p]}
        </button>
      ))}
    </div>
  );
}
