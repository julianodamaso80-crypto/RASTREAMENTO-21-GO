'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Compass,
  Gauge,
  KeyRound,
  Loader2,
  MapPin,
  RefreshCw,
  Satellite,
  Signal,
  XCircle,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { stockApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import type { DeviceHealth, StockItem } from '@/types/stock';

/** De quanto em quanto tempo a tela repergunta ao servidor GPS. */
const REFRESH_MS = 10_000;

type Props = {
  item: StockItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onValidated: () => void;
};

/** Linha do tempo curta: prova que a ignição virou quando o técnico girou a chave. */
type Evento = { hora: string; texto: string; volts: number | null };

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

/** Rumo em graus para o nome que o operador lê no painel do concorrente. */
function rumo(graus: number | null): string {
  if (graus === null || !Number.isFinite(graus)) return '—';
  const nomes = [
    'Norte',
    'Nordeste',
    'Leste',
    'Sudeste',
    'Sul',
    'Sudoeste',
    'Oeste',
    'Noroeste',
  ];
  return nomes[Math.round(((graus % 360) + 360) % 360 / 45) % 8];
}

function Campo({
  icone: Icone,
  rotulo,
  valor,
  tom = 'neutro',
}: {
  icone: typeof Signal;
  rotulo: string;
  valor: string;
  tom?: 'neutro' | 'ok' | 'ruim' | 'atencao';
}) {
  const cor =
    tom === 'ok'
      ? 'text-emerald-400'
      : tom === 'ruim'
        ? 'text-red-400'
        : tom === 'atencao'
          ? 'text-amber-400'
          : 'text-foreground';
  return (
    <div className="rounded-lg border bg-card/50 px-3 py-2">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icone className="h-3.5 w-3.5" />
        {rotulo}
      </p>
      <p className={cn('mt-0.5 text-sm font-semibold', cor)}>{valor}</p>
    </div>
  );
}

function Checagem({ ok, titulo, detalhe }: { ok: boolean; titulo: string; detalhe: string }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium">{titulo}</p>
        <p className="text-xs text-muted-foreground">{detalhe}</p>
      </div>
    </div>
  );
}

export function InstallCheckSheet({ item, open, onOpenChange, onValidated }: Props) {
  const [health, setHealth] = useState<DeviceHealth | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [reprovando, setReprovando] = useState(false);
  const [notas, setNotas] = useState('');
  const [eventos, setEventos] = useState<Evento[]>([]);
  const anterior = useRef<DeviceHealth | null>(null);

  const carregar = useCallback(
    async (comSpinner: boolean) => {
      if (!item) return;
      if (comSpinner) setCarregando(true);
      try {
        const atual = await stockApi.signal(item.id);
        // A mudança da ignição é a prova do fio: registra o instante em que o
        // técnico girou a chave, com a voltagem do momento.
        const antes = anterior.current;
        if (
          antes?.ignicao.reportada &&
          atual.ignicao.reportada &&
          antes.ignicao.ligada !== atual.ignicao.ligada
        ) {
          setEventos((prev) =>
            [
              {
                hora: new Date().toLocaleTimeString('pt-BR'),
                texto: `Ignição → ${atual.ignicao.ligada ? 'Ligada' : 'Desligada'}`,
                volts: atual.energia.volts,
              },
              ...prev,
            ].slice(0, 6),
          );
        }
        anterior.current = atual;
        setHealth(atual);
      } catch {
        toast.error('Não consegui consultar o rastreador.');
      } finally {
        if (comSpinner) setCarregando(false);
      }
    },
    [item],
  );

  useEffect(() => {
    if (!open || !item) return;
    setHealth(null);
    setEventos([]);
    setNotas('');
    setReprovando(false);
    anterior.current = null;
    void carregar(true);
    const timer = setInterval(() => void carregar(false), REFRESH_MS);
    return () => clearInterval(timer);
  }, [open, item, carregar]);

  const registrar = async (aprovado: boolean) => {
    if (!item) return;
    setSalvando(true);
    try {
      await stockApi.validate(item.id, {
        approved: aprovado,
        notes: notas.trim() || undefined,
      });
      toast.success(
        aprovado ? 'Instalação aprovada e registrada.' : 'Instalação reprovada e registrada.',
      );
      onValidated();
      onOpenChange(false);
    } catch {
      toast.error('Não consegui registrar a conferência.');
    } finally {
      setSalvando(false);
    }
  };

  const energiaTom = !health
    ? 'neutro'
    : health.energia.faixa === 'ok'
      ? 'ok'
      : health.energia.faixa === 'ausente'
        ? 'ruim'
        : 'atencao';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="data-[side=right]:sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 font-mono">
            {item?.imei ?? '—'}
          </SheetTitle>
          <SheetDescription>
            Confira se o rastreador foi instalado direito antes de vincular no SGA. A tela
            atualiza sozinha a cada 10 segundos — peça ao técnico para girar a chave e veja a
            ignição mudar.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          {carregando && !health ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Consultando o servidor GPS...
            </div>
          ) : !health ? null : health.indisponivel ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div>
                <p className="text-sm font-medium">Servidor GPS indisponível</p>
                <p className="text-xs text-muted-foreground">
                  Nada aqui pode ser confirmado agora. Tente de novo em instantes.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Veredito */}
              <div
                className={cn(
                  'flex items-start gap-2 rounded-lg border p-3',
                  health.checkOk
                    ? 'border-emerald-500/30 bg-emerald-500/10'
                    : 'border-red-500/30 bg-red-500/10',
                )}
              >
                {health.checkOk ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {health.checkOk
                      ? 'Instalação conferida — pode liberar'
                      : 'Instalação com pendência'}
                  </p>
                  {health.motivos.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {health.motivos.map((m) => (
                        <li key={m}>• {m}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Telemetria */}
              <div className="grid grid-cols-3 gap-2">
                <Campo
                  icone={Signal}
                  rotulo="GPRS"
                  valor={haQuantoTempo(health.lastUpdate)}
                  tom={health.comunicando ? 'ok' : 'ruim'}
                />
                <Campo
                  icone={MapPin}
                  rotulo="GPS"
                  valor={haQuantoTempo(health.gps.fixTime)}
                  tom={health.gps.ok ? 'ok' : 'ruim'}
                />
                <Campo icone={Compass} rotulo="Direção" valor={rumo(health.direcao)} />
                <Campo
                  icone={KeyRound}
                  rotulo="Ignição"
                  valor={
                    health.ignicao.reportada
                      ? health.ignicao.ligada
                        ? 'Ligada'
                        : 'Desligada'
                      : 'Não informa'
                  }
                  tom={health.ignicao.reportada ? 'ok' : 'ruim'}
                />
                <Campo
                  icone={Gauge}
                  rotulo="Velocidade"
                  valor={
                    health.velocidade === null
                      ? '—'
                      : `${Math.round(health.velocidade)} km/h`
                  }
                />
                <Campo
                  icone={Zap}
                  rotulo="Voltagem"
                  valor={
                    health.energia.volts === null
                      ? 'Não reporta'
                      : `${health.energia.volts.toFixed(2).replace('.', ',')} V`
                  }
                  tom={energiaTom}
                />
                <Campo
                  icone={Satellite}
                  rotulo="Satélites"
                  valor={health.gps.satellites === null ? '—' : String(health.gps.satellites)}
                />
                <Campo
                  icone={MapPin}
                  rotulo="Latitude"
                  valor={health.gps.latitude === null ? '—' : health.gps.latitude.toFixed(6)}
                />
                <Campo
                  icone={MapPin}
                  rotulo="Longitude"
                  valor={health.gps.longitude === null ? '—' : health.gps.longitude.toFixed(6)}
                />
              </div>

              {health.gps.address && (
                <p className="text-xs text-muted-foreground">{health.gps.address}</p>
              )}

              {/* As quatro checagens */}
              <div className="rounded-lg border p-3">
                <Checagem
                  ok={health.comunicando}
                  titulo="Comunicando"
                  detalhe={
                    health.comunicando
                      ? 'o chip está falando com o servidor'
                      : 'sem pacote nos últimos 5 minutos'
                  }
                />
                <Checagem
                  ok={health.gps.ok}
                  titulo="GPS real"
                  detalhe={
                    health.gps.ok
                      ? `fix válido${health.gps.satellites ? `, ${health.gps.satellites} satélites` : ''}`
                      : 'posição não confiável ou velha'
                  }
                />
                <Checagem
                  ok={health.energia.faixa === 'ok'}
                  titulo="Alimentação"
                  detalhe={
                    health.energia.faixa === 'ausente'
                      ? 'o rastreador não reporta voltagem'
                      : `${health.energia.volts?.toFixed(2).replace('.', ',')} V — sistema ${health.energia.sistema}`
                  }
                />
                <Checagem
                  ok={health.ignicao.reportada}
                  titulo="Ignição"
                  detalhe={
                    health.ignicao.reportada
                      ? 'o rastreador informa o estado da chave'
                      : 'o fio de ignição não foi ligado'
                  }
                />
              </div>

              {/* Prova do giro da chave */}
              {eventos.length > 0 && (
                <div className="rounded-lg border p-3">
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Mudanças enquanto você acompanha
                  </p>
                  {eventos.map((e, i) => (
                    <p key={`${e.hora}-${i}`} className="font-mono text-xs">
                      {e.hora} · {e.texto}
                      {e.volts !== null && ` · ${e.volts.toFixed(2).replace('.', ',')} V`}
                    </p>
                  ))}
                </div>
              )}

              {reprovando && (
                <Textarea
                  placeholder="O que está errado? (fica registrado no equipamento)"
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  rows={3}
                />
              )}

              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void carregar(true)}
                  disabled={carregando}
                >
                  <RefreshCw className={cn('h-4 w-4 mr-1', carregando && 'animate-spin')} />
                  Atualizar
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={salvando}
                    onClick={() => (reprovando ? void registrar(false) : setReprovando(true))}
                  >
                    {salvando && reprovando ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4 mr-1" />
                    )}
                    Reprovar
                  </Button>
                  <Button size="sm" disabled={salvando} onClick={() => void registrar(true)}>
                    {salvando && !reprovando ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                    )}
                    Aprovar instalação
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
