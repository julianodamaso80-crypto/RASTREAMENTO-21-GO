'use client';

import { Map as MapIcon, Satellite, SatelliteDish } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BASEMAPS, type BasemapId } from '@/lib/constants';

interface BasemapToggleProps {
  current: BasemapId;
  onChange: (id: BasemapId) => void;
  /** Reposiciona o seletor. No mapa do estoque o painel de detalhe ocupa o
   *  canto direito e cobriria os botões. */
  className?: string;
}

const ICONS: Record<BasemapId, typeof MapIcon> = {
  streets: MapIcon,
  satellite: Satellite,
  'satellite-google': SatelliteDish,
};

/**
 * Escolha do mapa no canto top-right: Padrão, Satélite grátis e Satélite
 * Google. Os três são explícitos de propósito — o Google custa por imagem,
 * então o operador decide quando vale a pena, em vez de o sistema decidir
 * por ele.
 *
 * Em tela estreita fica só o ícone; o nome volta a partir do sm.
 */
export function BasemapToggle({
  current,
  onChange,
  className,
}: BasemapToggleProps) {
  return (
    <div
      className={cn(
        'absolute top-3 right-3 z-10 flex items-center rounded-lg border border-border/40 bg-background/85 p-0.5 shadow-lg backdrop-blur-md',
        className,
      )}
    >
      {BASEMAPS.map((b) => {
        const Icon = ICONS[b.id];
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onChange(b.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              current === b.id
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted',
            )}
            aria-pressed={current === b.id}
            aria-label={`Mudar mapa para ${b.label}`}
            title={b.label}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">{b.label}</span>
          </button>
        );
      })}
    </div>
  );
}
