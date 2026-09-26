'use client';

import { cn } from '@/lib/utils';
import { useTracking } from '@/contexts/tracking-context';
import type { FiltroDoMapa } from '@/lib/tags-no-mapa';

const filters: { key: FiltroDoMapa; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'ignition_on', label: 'Ligado' },
  { key: 'ignition_off', label: 'Desligado' },
  { key: 'offline', label: 'GPS com defeito' },
  { key: 'alert', label: 'Bloqueado' },
  // Veículos que só têm TAG. Só aparece para quem enxerga TAG (time interno).
  { key: 'tag', label: 'TAG' },
];

export function VehicleFilterTabs() {
  const { statusFilter, setStatusFilter, statusCounts, tags } = useTracking();

  function getCount(key: FiltroDoMapa) {
    if (key === 'all') return statusCounts.total;
    return statusCounts[key];
  }

  return (
    <div className="flex gap-1 px-3 py-2 border-b border-border/30 overflow-x-auto">
      {filters.filter((f) => f.key !== 'tag' || tags.length > 0).map((f) => (
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
