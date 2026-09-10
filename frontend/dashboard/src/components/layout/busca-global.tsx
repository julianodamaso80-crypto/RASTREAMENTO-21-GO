'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2, Search } from 'lucide-react';
import {
  searchApi,
  type GrupoResultadoBusca,
  type ItemResultadoBusca,
  type TipoResultadoBusca,
} from '@/lib/api';
import { useTracking } from '@/contexts/tracking-context';
import { matchesVehicleSearch } from '@/lib/vehicle-search';
import { cn } from '@/lib/utils';

/**
 * Busca única do painel.
 *
 * Antes, a barra do topo só varria os veículos com rastreador já carregados no
 * mapa: quem digitava o CPF de um associado que ainda não tinha instalação, o
 * número do chip ou a placa de um veículo do cadastro não achava nada. Agora a
 * pergunta vai ao servidor e volta agrupada por onde o registro vive.
 */

const COR_GRUPO: Record<TipoResultadoBusca, string> = {
  ATIVO: 'text-emerald-400',
  VEICULO: 'text-sky-400',
  PENDENCIA: 'text-amber-400',
  CADASTRO_SGA: 'text-slate-400',
  ESTOQUE: 'text-violet-400',
  CHIP: 'text-cyan-400',
  TAG: 'text-pink-400',
};

/** Situação do SGA que merece destaque — o resto é ruído no dropdown. */
function corDaSituacao(situacao?: string): string {
  const s = (situacao ?? '').toUpperCase();
  if (s.includes('ATIVO')) return 'bg-emerald-500/15 text-emerald-300';
  if (s.includes('INADIMPL')) return 'bg-red-500/15 text-red-300';
  if (s.includes('INATIVO') || s.includes('CANCEL'))
    return 'bg-slate-500/20 text-slate-300';
  return 'bg-white/10 text-slate-300';
}

export function BuscaGlobal() {
  const router = useRouter();
  const pathname = usePathname();
  const { setSearchQuery, vehicles, selectVehicle } = useTracking();

  const inputRef = useRef<HTMLInputElement>(null);
  const caixaRef = useRef<HTMLDivElement>(null);
  const [valor, setValor] = useState('');
  const [grupos, setGrupos] = useState<GrupoResultadoBusca[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [destacado, setDestacado] = useState(0);
  const [isMac, setIsMac] = useState(false);

  // Lista achatada: o teclado anda por ela, os grupos são só o desenho.
  const itens = useMemo(() => grupos.flatMap((g) => g.itens), [grupos]);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Fecha ao clicar fora — sem isso o dropdown fica pendurado sobre a tela.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!caixaRef.current?.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Busca com espera: quem digita uma placa inteira não dispara 7 consultas.
  useEffect(() => {
    const termo = valor.trim();
    if (termo.length < 2) {
      setGrupos([]);
      setCarregando(false);
      return;
    }

    const controle = new AbortController();
    const timer = setTimeout(() => {
      setCarregando(true);
      searchApi
        .buscar(termo, controle.signal)
        .then((r) => {
          setGrupos(r.grupos);
          setDestacado(0);
          setAberto(true);
        })
        .catch(() => {
          /* busca cancelada ou fora do ar: o dropdown simplesmente não abre */
        })
        .finally(() => setCarregando(false));
    }, 300);

    return () => {
      clearTimeout(timer);
      controle.abort();
    };
  }, [valor]);

  const abrir = useCallback(
    (item: ItemResultadoBusca) => {
      setAberto(false);
      if (!item.href) return; // cadastro do SGA: o dado já está no resultado
      router.push(item.href);
    },
    [router],
  );

  /**
   * Enter sem escolher nada: mantém o atalho antigo de jogar o termo no mapa,
   * que é o que o operador já tem no dedo.
   */
  const submeter = (e: React.FormEvent) => {
    e.preventDefault();
    const termo = valor.trim();
    if (!termo) return;

    if (aberto && itens[destacado]) {
      abrir(itens[destacado]);
      return;
    }

    setSearchQuery(termo);
    const achados = vehicles.filter((v) => matchesVehicleSearch(v, termo));
    const alvo = achados.length === 1 ? achados[0] : null;
    if (!alvo) {
      router.push('/mapa');
      return;
    }
    if (pathname === '/mapa') selectVehicle(alvo.id);
    else router.push(`/mapa?placa=${encodeURIComponent(alvo.plate)}`);
  };

  const teclado = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setAberto(false);
      return;
    }
    if (!aberto || itens.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setDestacado((i) => (i + 1) % itens.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setDestacado((i) => (i - 1 + itens.length) % itens.length);
    }
  };

  let indice = -1;

  return (
    <div ref={caixaRef} className="flex-1 max-w-xl mx-auto relative">
      <form onSubmit={submeter}>
        <div className="relative">
          <Search className="h-4 w-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            type="search"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            onFocus={() => grupos.length > 0 && setAberto(true)}
            onKeyDown={teclado}
            placeholder="Placa, chassi, CPF/CNPJ, nome, chip ou IMEI…"
            className={cn(
              'w-full h-10 pl-10 pr-20 rounded-lg text-sm',
              'bg-[#1f2d63] text-slate-100 placeholder:text-slate-500',
              'border border-white/5',
              'focus:outline-none focus:border-brand-orange-500 focus:ring-2 focus:ring-brand-orange-500/20',
              'transition-colors',
            )}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {carregando && (
              <Loader2 className="h-3.5 w-3.5 text-slate-500 animate-spin" />
            )}
            <kbd className="hidden sm:flex items-center gap-0.5 text-[10px] font-semibold text-slate-500">
              <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/5">
                {isMac ? '⌘' : 'Ctrl'}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/5">
                K
              </span>
            </kbd>
          </div>
        </div>
      </form>

      {aberto && valor.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-12 z-50 rounded-lg border border-white/10 bg-[#1f2d63] shadow-2xl shadow-black/40 max-h-[70vh] overflow-y-auto">
          {grupos.length === 0 && !carregando && (
            <p className="px-4 py-6 text-center text-sm text-slate-400">
              Nada encontrado para “{valor.trim()}”.
            </p>
          )}

          {grupos.map((grupo) => (
            <div key={grupo.tipo} className="py-1">
              <p
                className={cn(
                  'px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide',
                  COR_GRUPO[grupo.tipo],
                )}
              >
                {grupo.titulo}
              </p>
              {grupo.itens.map((item) => {
                indice += 1;
                const atual = indice;
                return (
                  <button
                    key={`${item.tipo}-${item.id}`}
                    type="button"
                    onMouseEnter={() => setDestacado(atual)}
                    onClick={() => abrir(item)}
                    className={cn(
                      'w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors',
                      destacado === atual ? 'bg-white/10' : 'hover:bg-white/5',
                      !item.href && 'cursor-default',
                    )}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-semibold text-slate-100 truncate">
                        {item.titulo}
                      </span>
                      {item.situacao && (
                        <span
                          className={cn(
                            'shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium',
                            corDaSituacao(item.situacao),
                          )}
                        >
                          {item.situacao}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-slate-300 truncate">
                      {item.subtitulo}
                    </span>
                    {item.detalhes.length > 0 && (
                      <span className="text-[11px] text-slate-500 truncate">
                        {item.detalhes.join(' · ')}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
