'use client';

import {
  ChevronDown,
  Compass,
  Gauge,
  KeyRound,
  MapPin,
  Navigation,
  Radio,
  Satellite,
  Signal,
  UserCheck,
  X,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { StockMapPoint } from '@/types/stock';
import { badgeConexao, haQuantoTempo, textoIgnicao, textoVoltagem } from './stock-format';

type Props = {
  ponto: StockMapPoint;
  onClose: () => void;
  onValidar: () => void;
  onAssociar: () => void;
};

function Item({
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
      ? 'text-brand-green-600'
      : tom === 'ruim'
        ? 'text-red-400'
        : tom === 'atencao'
          ? 'text-amber-400'
          : 'text-foreground';
  return (
    <div className="flex flex-col items-center gap-0.5 px-1 py-2 text-center">
      <Icone className="h-4 w-4 text-muted-foreground" />
      <span className="text-[11px] text-muted-foreground">{rotulo}</span>
      <span className={cn('text-xs font-semibold leading-tight', cor)}>{valor}</span>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-xs">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="font-medium">{valor}</span>
    </div>
  );
}

export function StockMapDetail({ ponto, onClose, onValidar, onAssociar }: Props) {
  const [maisInfo, setMaisInfo] = useState(false);
  const badge = badgeConexao(ponto.conexao);

  const streetView =
    ponto.latitude !== null && ponto.longitude !== null
      ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ponto.latitude},${ponto.longitude}`
      : null;

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto bg-card p-3">
      {/* Cabeçalho */}
      <div className="flex items-start gap-2">
        <div className="flex flex-col items-center gap-1">
          <span
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full border-2',
              badge.borda,
            )}
          >
            <Navigation className={cn('h-4 w-4', badge.texto)} />
          </span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-bold',
              badge.fundo,
              badge.texto,
            )}
          >
            {badge.rotulo}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm font-bold">{ponto.imei}</p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Radio className="h-3 w-3" />
            Última atualização {haQuantoTempo(ponto.lastUpdate)}
          </p>
          {ponto.endereco && (
            <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{ponto.endereco}</span>
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {streetView && (
        <a
          href={streetView}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-medium hover:bg-muted/50"
        >
          <MapPin className="h-3.5 w-3.5" />
          Street View
        </a>
      )}

      {/* Telemetria — mesma grade da referência */}
      <div className="grid grid-cols-3 rounded-lg border">
        <Item
          icone={Signal}
          rotulo="GPRS"
          valor={haQuantoTempo(ponto.lastUpdate)}
          tom={ponto.conexao === 'ONLINE' ? 'ok' : 'ruim'}
        />
        <Item
          icone={MapPin}
          rotulo="GPS"
          valor={haQuantoTempo(ponto.fixTime)}
          tom={ponto.gpsConfiavel ? 'ok' : 'ruim'}
        />
        <Item icone={Compass} rotulo="Direção" valor={rumo(ponto.direcao)} />
        <Item
          icone={KeyRound}
          rotulo="Ignição"
          valor={textoIgnicao(ponto.ignicao)}
          tom={ponto.ignicao === null ? 'neutro' : ponto.ignicao ? 'ok' : 'neutro'}
        />
        <Item
          icone={Gauge}
          rotulo="Velocidade"
          valor={
            ponto.velocidade === null ? '—' : `${Math.round(ponto.velocidade)} Km/h`
          }
        />
        <Item
          icone={Zap}
          rotulo="Voltagem"
          valor={textoVoltagem(ponto.volts)}
          tom={
            ponto.faixaEnergia === 'ok'
              ? 'ok'
              : ponto.faixaEnergia === 'baixa' || ponto.faixaEnergia === 'alta'
                ? 'atencao'
                : 'neutro'
          }
        />
        <Item
          icone={Satellite}
          rotulo="Satélites"
          valor={ponto.satelites === null ? '—' : String(ponto.satelites)}
        />
        <Item
          icone={MapPin}
          rotulo="Latitude"
          valor={ponto.latitude === null ? '—' : ponto.latitude.toFixed(6)}
        />
        <Item
          icone={MapPin}
          rotulo="Longitude"
          valor={ponto.longitude === null ? '—' : ponto.longitude.toFixed(6)}
        />
      </div>

      {/* Mais informações */}
      <button
        type="button"
        onClick={() => setMaisInfo((v) => !v)}
        className="flex items-center justify-center gap-1 rounded-md border py-1.5 text-xs text-muted-foreground hover:bg-muted/50"
      >
        Mais informações
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform', maisInfo && 'rotate-180')}
        />
      </button>

      {maisInfo && (
        <div className="rounded-lg border px-3 py-2">
          <Linha rotulo="ICCID" valor={ponto.iccid ?? '—'} />
          <Linha rotulo="Linha" valor={ponto.line ?? '—'} />
          <Linha rotulo="Operadora" valor={ponto.operator ?? '—'} />
          <Linha rotulo="Servidor" valor={ponto.server ?? '—'} />
          <Linha rotulo="Situação do chip" valor={ponto.statusChip ?? '—'} />
          <Linha rotulo="Com o técnico" valor={ponto.tecnico ?? 'em estoque'} />
          <Linha
            rotulo="Bateria interna"
            valor={
              ponto.bateriaInterna === null ? '—' : `${ponto.bateriaInterna}%`
            }
          />
          <Linha rotulo="Bloqueio" valor={ponto.bloqueado ? 'bloqueado' : 'liberado'} />
          <Linha
            rotulo="Conferência"
            valor={
              !ponto.validatedAt
                ? 'ainda não conferido'
                : ponto.validationOk
                  ? 'aprovada'
                  : 'reprovada'
            }
          />
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        <Button variant="outline" size="sm" onClick={onValidar}>
          <Signal className="h-4 w-4 mr-1" />
          Validar instalação
        </Button>
        <Button size="sm" onClick={onAssociar}>
          <UserCheck className="h-4 w-4 mr-1" />
          Associar cliente e ativo (SGA)
        </Button>
      </div>
    </div>
  );
}

/** Rumo em graus para o nome que o operador lê. */
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
  return nomes[Math.round((((graus % 360) + 360) % 360) / 45) % 8];
}
