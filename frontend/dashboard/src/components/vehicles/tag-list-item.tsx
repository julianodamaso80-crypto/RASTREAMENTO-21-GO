'use client';

import { Bluetooth } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useTracking } from '@/contexts/tracking-context';
import { SelectionCheckbox } from '@/components/map/selection-checkbox';
import type { TagNoMapa } from '@/types/tag-map';
import { BateriaTag } from '@/components/ble-tags/bateria-tag';

/** Cor da TAG no mapa e na lista — a mesma do mapa do Estoque. */
export const COR_TAG = '#a78bfa';

/**
 * Linha de um veículo que só tem TAG.
 *
 * Nada de "Ligado/Desligado/velocidade": a TAG não mede isso. O que ela diz é
 * quando foi vista — e isso vai SEMPRE à vista, porque posição de TAG é
 * passado, nunca tempo real.
 */
export function TagListItem({ tag }: { tag: TagNoMapa }) {
  const { selectedTagId, markedTagIds, toggleTag } = useTracking();
  const selecionada = selectedTagId === tag.id || markedTagIds.includes(tag.id);

  // Mesmo comportamento da linha do veículo: clicar MARCA sem soltar os
  // outros. Antes a TAG trocava a seleção inteira e o associado com
  // rastreador + TAG nunca aparecia com os dois no mapa.
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg pl-2 pr-3 py-2.5 transition-all duration-200',
        selecionada
          ? 'bg-violet-500/10 border-l-2 border-violet-400'
          : 'hover:bg-muted/30 border-l-2 border-transparent',
      )}
    >
      <SelectionCheckbox
        marcado={selecionada}
        onToggle={() => toggleTag(tag.id)}
        rotulo={tag.plate}
        className="mt-0.5"
      />
      <button
        type="button"
        onClick={() => toggleTag(tag.id)}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bluetooth className="h-3.5 w-3.5 shrink-0" style={{ color: COR_TAG }} />
            <span className="font-semibold text-sm text-foreground">{tag.plate}</span>
          </div>
          <span
            className="rounded border px-1.5 py-0 text-[10px] font-semibold"
            style={{ borderColor: COR_TAG, color: COR_TAG }}
          >
            TAG
          </span>
        </div>
        <div className="mt-0.5 ml-5 text-xs font-medium text-foreground/80 truncate">
          {tag.associateName}
        </div>
        <div className="flex items-center justify-between mt-1 ml-5 gap-2">
          <span className="text-xs text-muted-foreground truncate">{tag.model ?? ''}</span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
            {tag.bateria && <BateriaTag nivel={tag.bateria} compacto />}
            {tag.seenAt ? `vista ${formatRelativeTime(tag.seenAt)}` : 'ainda não vista'}
          </span>
        </div>
      </button>
    </div>
  );
}
