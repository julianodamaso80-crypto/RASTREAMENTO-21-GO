'use client';

import { cn } from '@/lib/utils';
import { useTracking } from '@/contexts/tracking-context';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'v2.4.1';

export function StatusBar() {
  const { statusCounts, isSocketConnected } = useTracking();

  return (
    <div className="h-12 bg-[#293c82] border-t border-white/5 flex items-center justify-between px-4 md:px-6 text-xs">
      {/* Esquerda: contadores rápidos da frota */}
      <div className="flex items-center gap-5 text-slate-400">
        <span>
          Total:{' '}
          <strong className="text-slate-100 tabular-nums">{statusCounts.total}</strong>
        </span>
        <span>
          Ligados:{' '}
          <strong className="text-emerald-400 tabular-nums">
            {statusCounts.ignition_on}
          </strong>
        </span>
        <span>
          Desligados:{' '}
          <strong className="text-red-400 tabular-nums">
            {statusCounts.ignition_off}
          </strong>
        </span>
        <span className="hidden sm:inline">
          GPS desligado:{' '}
          <strong className="text-orange-400 tabular-nums">
            {statusCounts.gps_silent}
          </strong>
        </span>
        <span>
          Sem comunicação:{' '}
          <strong className="text-slate-300 tabular-nums">{statusCounts.offline}</strong>
        </span>
        <span className="hidden sm:inline">
          Bloqueados:{' '}
          <strong className="text-red-500 tabular-nums">{statusCounts.alert}</strong>
        </span>
      </div>

      {/* Centro: versão em fonte monoespaçada */}
      <span className="hidden md:inline-flex items-center gap-1.5 text-[10px] font-mono tracking-wider text-slate-500">
        21GO {APP_VERSION}
      </span>

      {/* Direita: status do socket com pulse */}
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          {isSocketConnected && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-green-500 opacity-60" />
          )}
          <span
            className={cn(
              'relative inline-flex h-2 w-2 rounded-full',
              isSocketConnected ? 'bg-brand-green-500' : 'bg-red-400',
            )}
          />
        </span>
        <span className="hidden sm:inline text-slate-400">
          {isSocketConnected ? 'Conectado' : 'Desconectado'}
        </span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-500">© 21 GO {new Date().getFullYear()}</span>
      </div>
    </div>
  );
}
