'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  marcado: boolean;
  onToggle: () => void;
  /** Vai no aria-label: "Marcar ABC1D23" / "Marcar 861234567890123". */
  rotulo: string;
  className?: string;
}

/**
 * A caixinha que marca um item pra ver vários no mapa ao mesmo tempo.
 *
 * É um `<button>` e não um `<input type=checkbox>` porque ela mora ao lado do
 * botão da linha (que seleciona só aquele item): input dentro de label dentro
 * de lista dava conflito de foco e o clique na caixinha acabava selecionando a
 * linha inteira. Com dois botões irmãos, cada clique faz uma coisa só.
 *
 * `stopPropagation` é obrigatório: sem ele o clique sobe pro container da
 * linha e o operador que queria ACRESCENTAR um veículo perdia os outros.
 */
export function SelectionCheckbox({ marcado, onToggle, rotulo, className }: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={marcado}
      aria-label={`Marcar ${rotulo}`}
      title={marcado ? 'Desmarcar' : 'Marcar pra ver junto no mapa'}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
        marcado
          ? 'border-emerald-400 bg-emerald-500 text-white'
          : 'border-border/60 bg-background/40 hover:border-emerald-400/70',
        className,
      )}
    >
      {marcado && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </button>
  );
}
