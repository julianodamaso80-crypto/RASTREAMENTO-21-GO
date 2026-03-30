'use client';

import { cn } from '@/lib/utils';
import { useTracking } from '@/contexts/tracking-context';

export function StatusBar() {
  const { statusCounts, isSocketConnected } = useTracking();

  return (
    <div className="h-8 glass-light flex items-center justify-between px-4 text-xs text-muted-foreground border-t border-border/30">
      <div className="flex items-center gap-4">
        <span>Total: <strong className="text-foreground">{statusCounts.total}</strong></span>
        <span>Online: <strong className="text-emerald-400">{statusCounts.moving + statusCounts.stopped}</strong></span>
        <span>Offline: <strong className="text-gray-400">{statusCounts.offline}</strong></span>
        <span className="hidden sm:inline">Alertas: <strong className="text-red-400">{statusCounts.alert}</strong></span>
      </div>
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'w-2 h-2 rounded-full',
            isSocketConnected ? 'bg-emerald-400' : 'bg-red-400',
          )}
        />
        <span className="hidden sm:inline">
          {isSocketConnected ? 'Conectado' : 'Desconectado'}
        </span>
      </div>
    </div>
  );
}
