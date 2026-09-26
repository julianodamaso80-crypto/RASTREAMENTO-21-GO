'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  MapPin,
  RefreshCw,
  Signal,
  XCircle,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { stockApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import type { DeviceHealth, StockBatchSignal, StockItem } from '@/types/stock';

/** Mesmo ritmo do painel de um equipamento só. */
const REFRESH_MS = 10_000;

type Props = {
  items: Pick<StockItem, 'id' | 'imei'>[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onValidated: () => void;
};

/** Registro de giro de chave por equipamento — a prova do fio de ignição. */
type Giro = { hora: string; ligada: boolean };

function haQuantoTempo(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `há ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

function textoVoltagem(health: DeviceHealth): string {
  if (health.energia.volts !== null) {
    return `${health.energia.volts.toFixed(2).replace('.', ',')} V`;
  }
  if (health.energia.faixa === 'sem-leitura') return 'Alimentado';
  if (health.energia.faixa === 'cortada') return 'Sem energia';
  return 'Não informa';
}

export function InstallCheckBatchSheet({
  items,
  open,
  onOpenChange,
  onValidated,
}: Props) {
  const [saude, setSaude] = useState<Record<string, DeviceHealth>>({});
  const [giros, setGiros] = useState<Record<string, Giro[]>>({});
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [decididos, setDecididos] = useState<Record<string, boolean>>({});
  const anterior = useRef<Record<string, DeviceHealth>>({});

  // Assinatura do conjunto: o array é recriado a cada render do pai.
  const ids = items.map((i) => i.id);
  const assinatura = ids.join(',');

  const carregar = useCallback(
    async (comSpinner: boolean) => {
      if (ids.length === 0) return;
      if (comSpinner) setCarregando(true);
      try {
        const lote: StockBatchSignal[] = await stockApi.signalBatch(ids);
        const mapa: Record<string, DeviceHealth> = {};
        for (const linha of lote) {
          mapa[linha.id] = linha.health;
          const antes = anterior.current[linha.id];
          // Giro de chave: só conta quando os dois lados reportam ignição.
          if (
            antes?.ignicao.reportada &&
            linha.health.ignicao.reportada &&
            antes.ignicao.ligada !== linha.health.ignicao.ligada
          ) {
            setGiros((prev) => ({
              ...prev,
              [linha.id]: [
                {
                  hora: new Date().toLocaleTimeString('pt-BR'),
                  ligada: linha.health.ignicao.ligada === true,
                },
                ...(prev[linha.id] ?? []),
              ].slice(0, 4),
            }));
          }
        }
        anterior.current = mapa;
        setSaude(mapa);
      } catch {
        toast.error('Não consegui consultar os rastreadores.');
      } finally {
        if (comSpinner) setCarregando(false);
      }
    },
    // `ids` muda de identidade a cada render; o conjunto é que manda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assinatura],
  );

  useEffect(() => {
    if (!open || items.length === 0) return;
    setSaude({});
    setGiros({});
    setDecididos({});
    anterior.current = {};
    void carregar(true);
    const timer = setInterval(() => void carregar(false), REFRESH_MS);
    return () => clearInterval(timer);
  }, [open, items.length, carregar]);

  const registrar = async (id: string, aprovado: boolean) => {
    setSalvando(id);
    try {
      await stockApi.validate(id, { approved: aprovado });
      setDecididos((prev) => ({ ...prev, [id]: aprovado }));
      onValidated();
    } catch {
      toast.error('Não consegui registrar a conferência.');
    } finally {
      setSalvando(null);
    }
  };

  const prontos = items.filter((i) => saude[i.id]?.checkOk).length;
  const decididosCount = Object.keys(decididos).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="data-[side=right]:sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Signal className="h-5 w-5 text-brand-orange-500" />
            Conferência em pacote — {items.length} equipamento(s)
          </SheetTitle>
          <SheetDescription>
            Todos atualizam sozinhos a cada 10 segundos. Peça a cada técnico pra
            girar a chave: o card dele mostra a mudança na hora.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4 pb-4">
          {/* Progresso do pacote */}
          <div className="flex items-center justify-between rounded-lg border bg-card/50 px-3 py-2">
            <p className="text-xs text-muted-foreground">
              <strong className="text-emerald-400">{prontos}</strong> conferido(s) de{' '}
              {items.length}
              {decididosCount > 0 && ` · ${decididosCount} carimbado(s)`}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void carregar(true)}
              disabled={carregando}
            >
              <RefreshCw
                className={cn('h-4 w-4 mr-1', carregando && 'animate-spin')}
              />
              Atualizar
            </Button>
          </div>

          {carregando && Object.keys(saude).length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Consultando o servidor GPS...
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((item) => (
                <CardPacote
                  key={item.id}
                  imei={item.imei}
                  health={saude[item.id]}
                  giros={giros[item.id] ?? []}
                  decidido={decididos[item.id]}
                  salvando={salvando === item.id}
                  onAprovar={() => void registrar(item.id, true)}
                  onReprovar={() => void registrar(item.id, false)}
                />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CardPacote({
  imei,
  health,
  giros,
  decidido,
  salvando,
  onAprovar,
  onReprovar,
}: {
  imei: string;
  health: DeviceHealth | undefined;
  giros: Giro[];
  decidido: boolean | undefined;
  salvando: boolean;
  onAprovar: () => void;
  onReprovar: () => void;
}) {
  const borda = !health
    ? 'border-border'
    : health.indisponivel || !health.jaReportou
      ? 'border-slate-500/30'
      : health.checkOk
        ? 'border-emerald-500/40'
        : 'border-red-500/30';

  return (
    <div className={cn('rounded-lg border p-3', borda)}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-semibold">{imei}</span>
        {!health ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : health.checkOk ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        ) : (
          <AlertTriangle
            className={cn(
              'h-4 w-4',
              health.jaReportou ? 'text-red-400' : 'text-slate-400',
            )}
          />
        )}
      </div>

      {!health ? (
        <p className="mt-2 text-xs text-muted-foreground">consultando...</p>
      ) : health.indisponivel ? (
        <p className="mt-2 text-xs text-amber-400">
          Servidor GPS não respondeu por este equipamento.
        </p>
      ) : !health.jaReportou ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Rastreador desligado — nunca se conectou.
        </p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
            <Linha
              icone={Signal}
              rotulo="GPRS"
              valor={haQuantoTempo(health.lastUpdate)}
              ok={health.comunicando}
            />
            <Linha
              icone={MapPin}
              rotulo="GPS"
              valor={haQuantoTempo(health.gps.fixTime)}
              ok={health.gps.ok}
            />
            <Linha
              icone={KeyRound}
              rotulo="Ignição"
              valor={
                health.ignicao.reportada
                  ? health.ignicao.ligada
                    ? 'Ligada'
                    : 'Desligada'
                  : 'Não informa'
              }
              ok={health.ignicao.reportada}
            />
            <Linha
              icone={Zap}
              rotulo="Energia"
              valor={textoVoltagem(health)}
              ok={
                health.energia.faixa === 'ok' ||
                health.energia.faixa === 'sem-leitura'
              }
            />
          </div>

          {giros.length > 0 && (
            <div className="mt-2 rounded border bg-muted/30 px-2 py-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Giro da chave
              </p>
              {giros.map((g, i) => (
                <p key={`${g.hora}-${i}`} className="font-mono text-[11px]">
                  {g.hora} · {g.ligada ? 'Ligada' : 'Desligada'}
                </p>
              ))}
            </div>
          )}

          {health.motivos.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
              {health.motivos.slice(0, 2).map((m) => (
                <li key={m}>• {m}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {decidido !== undefined ? (
        <p
          className={cn(
            'mt-2 flex items-center gap-1 text-[11px]',
            decidido ? 'text-emerald-400' : 'text-red-400',
          )}
        >
          {decidido ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : (
            <XCircle className="h-3 w-3" />
          )}
          {decidido ? 'Aprovado' : 'Reprovado'}
        </p>
      ) : (
        health?.jaReportou &&
        !health.indisponivel && (
          <div className="mt-2 flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 flex-1 text-xs"
              disabled={salvando}
              onClick={onReprovar}
            >
              Reprovar
            </Button>
            <Button
              size="sm"
              className="h-7 flex-1 text-xs"
              disabled={salvando}
              onClick={onAprovar}
            >
              {salvando ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                'Aprovar'
              )}
            </Button>
          </div>
        )
      )}
    </div>
  );
}

function Linha({
  icone: Icone,
  rotulo,
  valor,
  ok,
}: {
  icone: typeof Signal;
  rotulo: string;
  valor: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <Icone className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">{rotulo}</span>
      <span className={cn('ml-auto font-medium', ok ? 'text-emerald-400' : 'text-red-400')}>
        {valor}
      </span>
    </div>
  );
}
