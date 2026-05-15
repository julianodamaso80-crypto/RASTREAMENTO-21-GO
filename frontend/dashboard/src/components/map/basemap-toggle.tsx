'use client';

import { Map as MapIcon, Satellite } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BASEMAPS, HAS_MAPTILER, type BasemapId } from '@/lib/constants';

interface BasemapToggleProps {
  current: BasemapId;
  onChange: (id: BasemapId) => void;
}

/**
 * Toggle "Padrão / Satélite" no canto top-right do mapa.
 * Esconde a opção "Satélite" se NEXT_PUBLIC_MAPTILER_KEY não estiver setado
 * — sem chave, MapTiler retorna 401 e quebra o mapa.
 */
export function BasemapToggle({ current, onChange }: BasemapToggleProps) {
  const visible = HAS_MAPTILER ? BASEMAPS : BASEMAPS.filter((b) => !b.requiresKey);

  // Se sobrou só 1 opção (sem chave), nem renderiza — toggle não faz sentido.
  if (visible.length < 2) return null;

  const iconFor = (id: BasemapId) =>
    id === 'satellite' ? <Satellite className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />;

  return (
    <div className="absolute top-3 right-3 z-10 flex items-center rounded-lg border border-border/40 bg-background/85 p-0.5 shadow-lg backdrop-blur-md">
      {visible.map((b) => (
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
        >
          {iconFor(b.id)}
          {b.label}
        </button>
      ))}
    </div>
  );
}
