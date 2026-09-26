'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bluetooth, MapPin, RefreshCw, Target, UserCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useReverseGeocode } from '@/hooks/use-reverse-geocode';
import { Button } from '@/components/ui/button';
import { stockApi } from '@/lib/api';
import type { StockMapPoint } from '@/types/stock';

/**
 * Painel da TAG no mapa do Estoque.
 *
 * Separado do painel do rastreador de propósito: a TAG não tem GPRS, GPS,
 * ignição, satélites, voltagem nem velocidade, e a posição dela é SEMPRE
 * passado — ela só é vista quando um iPhone passa perto. Repetir a grade de
 * telemetria com tudo "—" convidaria a leitura errada.
 *
 * "Atualizar TAG" copia o botão da RedeVeiculos: re-consulta a rede Find My e
 * trava por 3 minutos. Ele NÃO obriga a TAG a se anunciar — se ninguém passou
 * perto dela, a posição continua a mesma, e a tela diz isso.
 */

type Props = {
  ponto: StockMapPoint;
  onClose: () => void;
  onAssociar: () => void;
  /** Recarrega os pontos do mapa depois que vem posição nova. */
  onAtualizou: () => void;
};

export function StockMapDetailTag({ ponto, onClose, onAssociar, onAtualizou }: Props) {
  const [restam, setRestam] = useState(0);
  const [pendente, setPendente] = useState(false);
  const { address: enderecoAoVivo, loading: buscandoEndereco } = useReverseGeocode(
    ponto.latitude,
    ponto.longitude,
  );
  const endereco = enderecoAoVivo || ponto.endereco;
  const temPosicao = ponto.latitude !== null && ponto.longitude !== null;

  const lerEstado = useCallback(async () => {
    try {
      const e = await stockApi.estadoAtualizarTag(ponto.id);
      setRestam(e.segundosRestantes);
      setPendente(e.pendente);
      return e;
    } catch {
      return null;
    }
  }, [ponto.id]);

  useEffect(() => {
    void lerEstado();
  }, [lerEstado]);

  // Contador do botão, 1 s por vez — o mesmo "02:45" da referência.
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
          toast.success(
            `${e.avistamentosNovos} avistamento(s) novo(s) desta TAG.`,
          );
          onAtualizou();
        } else {
          toast.info(
            'Nenhum avistamento novo: ninguém passou perto da TAG desde a última vez.',
          );
        }
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [pendente, lerEstado, onAtualizou]);

  const atualizar = async () => {
    try {
      const r = await stockApi.atualizarTag(ponto.id);
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
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto bg-card p-3">
      <div className="flex items-start gap-2">
        <div className="flex flex-col items-center gap-1">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-violet-500/50">
            <Bluetooth className="h-4 w-4 text-violet-400" />
          </span>
          <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-300">
            TAG
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm font-bold">{ponto.imei}</p>
          <p className="text-xs text-muted-foreground">
            {ponto.fixTime
              ? `vista ${formatRelativeTime(ponto.fixTime)}`
              : 'nunca foi vista pela rede'}
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
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
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
              {ponto.fixTime ? formatRelativeTime(ponto.fixTime) : '—'}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-1">
            <span className="text-muted-foreground">Precisão</span>
            <span className="font-medium">
              {ponto.precisaoM ? `${Math.round(ponto.precisaoM)} m` : '—'}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-1">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Target className="h-3 w-3" /> Coordenada
            </span>
            <span className="font-mono font-medium">
              {ponto.latitude?.toFixed(5)}, {ponto.longitude?.toFixed(5)}
            </span>
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          Esta TAG ainda não foi vista pela rede. Se acabou de sair da caixa,
          ative a bateria e deixe perto de um iPhone com Bluetooth ligado.
        </p>
      )}

      <div className="mt-auto">
        <Button size="sm" className="w-full" onClick={onAssociar}>
          <UserCheck className="mr-1 h-4 w-4" />
          Associar cliente e ativo (SGA)
        </Button>
      </div>
    </div>
  );
}
