'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface OpcaoMulti {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  opcoes: OpcaoMulti[];
  valor: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  /** Mostra o campo "Pesquisar..." no topo da lista. */
  pesquisa?: boolean;
  className?: string;
}

/**
 * Seleção múltipla com "[Selecionar todos]" e busca — o mesmo controle que a
 * origem usa nos filtros de técnico, usuário e status.
 */
export function MultiSelect({
  opcoes,
  valor,
  onChange,
  placeholder = 'Selecione uma ou mais opções',
  pesquisa = true,
  className,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState('');
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  const habilitadas = opcoes.filter((o) => !o.disabled);
  const visiveis = useMemo(() => {
    const t = termo.trim().toLowerCase();
    return t ? opcoes.filter((o) => o.label.toLowerCase().includes(t)) : opcoes;
  }, [opcoes, termo]);

  const todos = habilitadas.length > 0 && habilitadas.every((o) => valor.includes(o.value));

  const resumo = (() => {
    const escolhidas = opcoes.filter((o) => valor.includes(o.value));
    if (escolhidas.length === 0) return null;
    if (todos) return 'Todos selecionados';
    if (escolhidas.length <= 3) return escolhidas.map((o) => o.label).join(', ');
    return `${escolhidas.length} de ${opcoes.length} selecionados`;
  })();

  const alternar = (v: string) =>
    onChange(valor.includes(v) ? valor.filter((x) => x !== v) : [...valor, v]);

  return (
    <div ref={raiz} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm shadow-xs"
      >
        <span className={cn('truncate', !resumo && 'text-muted-foreground')}>
          {resumo ?? placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {aberto && (
        <div className="absolute z-50 mt-1 w-full min-w-[220px] rounded-md border bg-popover p-1 text-sm shadow-lg">
          {pesquisa && (
            <input
              autoFocus
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Pesquisar..."
              className="mb-1 h-8 w-full rounded border border-input bg-background px-2 text-sm outline-none"
            />
          )}
          <ul className="max-h-64 overflow-y-auto">
            {!termo && habilitadas.length > 0 && (
              <li>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={todos}
                    onChange={() =>
                      onChange(
                        todos
                          ? valor.filter((v) => !habilitadas.some((o) => o.value === v))
                          : Array.from(new Set([...valor, ...habilitadas.map((o) => o.value)])),
                      )
                    }
                  />
                  <span>[Selecionar todos]</span>
                </label>
              </li>
            )}
            {visiveis.map((o) => (
              <li key={o.value}>
                <label
                  className={cn(
                    'flex items-center gap-2 rounded px-2 py-1.5',
                    o.disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer hover:bg-muted',
                  )}
                >
                  <input
                    type="checkbox"
                    disabled={o.disabled}
                    checked={valor.includes(o.value)}
                    onChange={() => alternar(o.value)}
                  />
                  <span>{o.label}</span>
                </label>
              </li>
            ))}
            {visiveis.length === 0 && (
              <li className="px-2 py-1.5 text-muted-foreground">Nenhum resultado encontrado</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
