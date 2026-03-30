'use client';

import { cn } from '@/lib/utils';
import { useTracking } from '@/contexts/tracking-context';
import type { DisplayStatus } from '@/types/vehicle';

const filters: { key: 'all' | DisplayStatus; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'moving', label: 'Online' },
  { key: 'stopped', label: 'Parado' },
  { key: 'offline', label: 'Offline' },
  { key: 'alert', label: 'Alerta' },
];

export function VehicleFilterTabs() {
  const { statusFilter, setStatusFilter, statusCounts } = useTracking();

  function getCount(key: 'all' | DisplayStatus) {
    if (key === 'all') return statusCounts.total;
    return statusCounts[key];
  }

  return (
    <div className="flex gap-1 px-3 py-2 border-b border-border/30 overflow-x-auto">
      {filters.map((f) => (
        <button
          key={f.key}
          onClick={() => setStatusFilter(f.key)}
          className={cn(
            'px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
            statusFilter === f.key
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/30',
          )}
        >
          {f.label}
          <span className="ml-1 opacity-60">{getCount(f.key)}</span>
        </button>
      ))}
    </div>
  );
}
