'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { financialApi } from '@/lib/api';
import type { ConsultantOption } from '@/types/financial';
import { formatContato } from './financial-meta';

export type ConsultorEscolhido = { name: string; contact: string | null };

/**
 * Campo do consultor: digita parte do nome, escolhe na base de consultores e o
 * contato vem junto. Nome digitado sem escolher também vale e não mexe no contato.
 *
 * A lista abre num portal com posição fixa porque a tabela rola na horizontal
 * e cortaria um dropdown absoluto.
 */
export function ConsultantCombobox({
  value,
  onCommit,
  className,
  placeholder,
  id,
}: {
  value: string;
  /** Chamado ao escolher da lista ou ao sair do campo com texto alterado. */
  onCommit: (escolha: ConsultorEscolhido, daLista: boolean) => void;
  className?: string;
  placeholder?: string;
  id?: string;
}) {
  const [texto, setTexto] = useState(value);
  const [aberto, setAberto] = useState(false);
  const [opcoes, setOpcoes] = useState<ConsultantOption[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [destaque, setDestaque] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const escolheuRef = useRef(false);

  const posicionar = () => {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 300) });
  };

  useEffect(() => {
    const termo = texto.trim();
    if (!aberto || termo.length < 2 || termo === value) return;
    let vivo = true;
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const lista = await financialApi.searchConsultants(termo);
        if (vivo) {
          setOpcoes(lista);
          setDestaque(0);
        }
      } catch {
        if (vivo) setOpcoes([]);
      } finally {
        if (vivo) setBuscando(false);
      }
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [texto, aberto, value]);

  useEffect(() => {
    if (!aberto) return;
    const fechar = () => setAberto(false);
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
    return () => {
      window.removeEventListener('scroll', fechar, true);
      window.removeEventListener('resize', fechar);
    };
  }, [aberto]);

  const escolher = (c: ConsultantOption) => {
    escolheuRef.current = true;
    const contato = c.mobile || c.phone;
    setTexto(c.name.toUpperCase());
    setAberto(false);
    onCommit({ name: c.name.toUpperCase(), contact: contato ? formatContato(contato) : null }, true);
  };

  const mostrarLista = aberto && pos && texto.trim().length >= 2 && texto.trim() !== value;

  return (
    <>
      <input
        id={id}
        ref={inputRef}
        value={texto}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          setTexto(e.target.value.toUpperCase());
          posicionar();
          setAberto(true);
        }}
        onFocus={() => {
          escolheuRef.current = false;
        }}
        onBlur={() => {
          // Deixa o clique na lista acontecer antes de fechar.
          setTimeout(() => {
            setAberto(false);
            if (escolheuRef.current) return;
            const final = texto.trim();
            if (final !== value) onCommit({ name: final, contact: null }, false);
          }, 150);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setDestaque((i) => Math.min(i + 1, opcoes.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setDestaque((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (mostrarLista && opcoes[destaque]) escolher(opcoes[destaque]);
            else e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setTexto(value);
            setAberto(false);
          }
        }}
        className={className}
      />
      {mostrarLista &&
        createPortal(
          <div
            className="fixed z-[100] max-h-72 overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-lg"
            style={{ left: pos.left, top: pos.top, width: pos.width }}
          >
            {buscando && opcoes.length === 0 ? (
              <div className="flex items-center gap-2 px-2 py-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando...
              </div>
            ) : opcoes.length === 0 ? (
              <div className="px-2 py-2 text-muted-foreground">
                Nenhum consultor com esse nome
              </div>
            ) : (
              opcoes.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => escolher(c)}
                  onMouseEnter={() => setDestaque(i)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left',
                    i === destaque ? 'bg-muted' : 'hover:bg-muted/60',
                  )}
                >
                  <span className="min-w-0 truncate">
                    {c.name}
                    {!c.active && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground">(inativo)</span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {formatContato(c.mobile || c.phone) || '—'}
                  </span>
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
