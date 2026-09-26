'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bluetooth, MapPin, RefreshCw, Target, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useReverseGeocode } from '@/hooks/use-reverse-geocode';
import { Button } from '@/components/ui/button';
import { stockApi } from '@/lib/api';
import { COR_TAG } from '@/components/vehicles/tag-list-item';
import type { TagNoMapa } from '@/types/tag-map';

/**
 * Painel da TAG de cliente no Mapa — irmão do painel de TAG do Estoque
 * (`stock-map-detail-tag.tsx`), com as mesmas regras:
 *
 * - a TAG não tem GPS, ignição, velocidade, bloqueio nem "online", então nada
 *   disso aparece — repetir a grade do rastreador com "—" convidaria a leitura
 *   errada;
 * - a posição é SEMPRE passado (a TAG só é vista quando um iPhone passa
 *   perto), então a idade do avistamento fica sempre à vista;
 * - "Atualizar TAG" re-consulta a rede Find My, trava 3 min e NÃO obriga a TAG
 *   a se anunciar.
 */
export function TagDetailPanel({
  tag,
  onClose,
  onAtualizou,
}: {
  tag: TagNoMapa;
  onClose: () => void;
  /** Recarrega as TAGs depois que vem posição nova. */
  onAtualizou: () => void;
}) {
  const [restam, setRestam] = useState(0);
  const [pendente, setPendente] = useState(false);
  const { address: endereco, loading: buscandoEndereco } = useReverseGeocode(
    tag.latitude,
    tag.longitude,
  );
  const temPosicao = tag.latitude !== null && tag.longitude !== null;

  const lerEstado = useCallback(async () => {
    try {
      const e = await stockApi.estadoAtualizarTagPorSerie(tag.serialNumber);
      setRestam(e.segundosRestantes);
      setPendente(e.pendente);
      return e;
    } catch {
      return null;
    }
  }, [tag.serialNumber]);

  useEffect(() => {
    void lerEstado();
  }, [lerEstado]);

  useEffect(() => {
    if (restam <= 0) return;
    const t = setInterval(() => setRestam((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [restam]);

  // Enquanto o coletor não responde, pergunta a cada 10 s se já chegou.
  useEffect(() => {
    if (!pendente) return;
    const t = setInterval(async () => {
      const e = await lerEstado();
      if (e && !e.pendente) {
        clearInterval(t);
        if (e.avistamentosNovos && e.avistamentosNovos > 0) {
          toast.success(`${e.avistamentosNovos} avistamento(s) novo(s) desta TAG.`);
          onAtualizou();
        } else {
          toast.info('Nenhum avistamento novo: ninguém passou perto da TAG desde a última vez.');
        }
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [pendente, lerEstado, onAtualizou]);

  const atualizar = async () => {
    try {
      const r = await stockApi.atualizarTagPorSerie(tag.serialNumber);
      setPendente(true);
      setRestam(
        Math.max(0, Math.round((new Date(r.disponivelEm).getTime() - Date.now()) / 1000)),
      );
      toast.info('Consultando a rede Find My… a resposta chega em instantes.');
    } catch (err) {
      const dados = (err as { response?: { data?: { message?: string; segundosRestantes?: number } } })
        ?.response?.data;
      if (dados?.segundosRestantes) setRestam(dados.segundosRestantes);
      toast.error(dados?.message ?? 'Não consegui pedir a atualização desta TAG.');
    }
  };

  const mmss = `${String(Math.floor(restam / 60)).padStart(2, '0')}:${String(restam % 60).padStart(2, '0')}`;

  return (
    <div className="flex h-full w-full max-w-[380px] flex-col gap-3 overflow-y-auto border-l border-border/30 bg-card p-3 shadow-xl">
      <div className="flex items-start gap-2">
        <div className="flex flex-col items-center gap-1">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full border-2"
            style={{ borderColor: COR_TAG }}
          >
            <Bluetooth className="h-4 w-4" style={{ color: COR_TAG }} />
          </span>
          <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-300">
            TAG
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold tracking-wide">{tag.plate}</p>
          <p className="truncate text-xs font-medium text-foreground/80">{tag.associateName}</p>
          {tag.model && <p className="truncate text-xs text-muted-foreground">{tag.model}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {tag.seenAt ? `vista ${formatRelativeTime(tag.seenAt)}` : 'nunca foi vista pela rede'}
          </p>
          {temPosicao && (
            <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
              {endereco ? (
                <span>{endereco}</span>
              ) : (
                <span className="italic">
                  {buscandoEndereco ? 'Buscando endereço…' : 'Endereço indisponível'}
                </span>
              )}
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose} aria-label="Fechar">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Button
        size="sm"
        className={cn('w-full', restam > 0 && 'pointer-events-none opacity-60')}
        disabled={restam > 0 || pendente}
        onClick={atualizar}
      >
        <RefreshCw className={cn('mr-1 h-4 w-4', pendente && 'animate-spin')} />
        {pendente ? 'Consultando…' : 'Atualizar TAG'}
        {restam > 0 && <span className="ml-auto font-mono text-xs">{mmss}</span>}
      </Button>

      {temPosicao ? (
        <div className="rounded-lg border px-3 py-2 text-xs">
          <div className="flex items-baseline justify-between gap-3 py-1">
            <span className="text-muted-foreground">Último avistamento</span>
            <span className="font-medium">
              {tag.seenAt ? formatRelativeTime(tag.seenAt) : '—'}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-1">
            <span className="text-muted-foreground">Precisão</span>
            <span className="font-medium">
              {tag.accuracyM ? `${Math.round(tag.accuracyM)} m` : '—'}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-1">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Target className="h-3 w-3" /> Coordenada
            </span>
            <span className="font-mono font-medium">
              {tag.latitude?.toFixed(5)}, {tag.longitude?.toFixed(5)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-1">
            <span className="text-muted-foreground">Número da TAG</span>
            <span className="font-mono font-medium">{tag.serialNumber}</span>
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          Esta TAG ainda não foi vista pela rede. Ela aparece no mapa na primeira
          vez que um iPhone com Bluetooth ligado passar perto do veículo.
        </p>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        A TAG não informa ignição, velocidade nem bloqueio, e a posição é sempre a da
        última vez que ela foi vista, nunca em tempo real.
      </p>
    </div>
  );
}
