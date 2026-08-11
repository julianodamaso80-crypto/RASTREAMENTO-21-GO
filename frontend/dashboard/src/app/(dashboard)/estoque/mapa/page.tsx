'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Boxes,
  Crosshair,
  Gauge,
  KeyRound,
  List,
  Loader2,
  MapPin,
  RefreshCw,
  Satellite,
  Search,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { stockApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { AssociateStockDialog } from '@/components/stock/associate-stock-dialog';
import { InstallCheckSheet } from '@/components/stock/install-check-sheet';
import {
  badgeConexao,
  haQuantoTempo,
  textoIgnicao,
  textoVoltagem,
} from '@/components/stock/stock-format';
import { StockMapDetail } from '@/components/stock/stock-map-detail';
import type { StockConexao, StockMapPoint } from '@/types/stock';
import type { StockMapRef } from '@/components/stock/stock-map-container';

const StockMap = dynamic(
  () => import('@/components/stock/stock-map-container'),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse bg-background" />,
  },
);

/** O estoque muda devagar; 15s dá sensação de ao vivo sem martelar o servidor. */
const REFRESH_MS = 15_000;
const FOCO_ZOOM = 16;
const PAINEL_LARGURA = 360;

type Filtro = 'todos' | 'ONLINE' | 'OFFLINE' | 'SEM_GPS' | 'SLEEP' | 'LIGADOS';

export default function EstoqueMapaPage() {
  const router = useRouter();
  const params = useSearchParams();
  const imeiInicial = params.get('imei');

  const [pontos, setPontos] = useState<StockMapPoint[]>([]);
  const [indisponivel, setIndisponivel] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [validarItem, setValidarItem] = useState<StockMapPoint | null>(null);
  const [associarItem, setAssociarItem] = useState<StockMapPoint | null>(null);
  // Abaixo de lg a aside com a lista some — sem esta gaveta, no celular só
  // sobra tocar em pins minúsculos no mapa, igual ao problema já corrigido
  // no mapa principal de rastreamento.
  const [listaOpen, setListaOpen] = useState(false);
  const mapRef = useRef<StockMapRef>(null);
  const focouInicial = useRef(false);

  const carregar = useCallback(async (comSpinner: boolean) => {
    if (comSpinner) setCarregando(true);
    try {
      const res = await stockApi.map();
      setPontos(res.pontos);
      setIndisponivel(res.indisponivel);
    } catch {
      toast.error('Não consegui carregar o estoque no mapa.');
    } finally {
      if (comSpinner) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar(true);
    const timer = setInterval(() => void carregar(false), REFRESH_MS);
    return () => clearInterval(timer);
  }, [carregar]);

  const selecionar = useCallback(
    (id: string) => {
      setSelecionadoId(id);
      const p = pontos.find((x) => x.id === id);
      if (p?.latitude != null && p?.longitude != null) {
        mapRef.current?.flyTo(p.longitude, p.latitude, FOCO_ZOOM, PAINEL_LARGURA);
      }
    },
    [pontos],
  );

  // Selecionou um item na gaveta (mobile) → fecha pra revelar o mapa focado.
  useEffect(() => {
    if (selecionadoId) setListaOpen(false);
  }, [selecionadoId]);

  // Abrir no mapa a partir do estoque: já entra com o equipamento focado.
  useEffect(() => {
    if (focouInicial.current || !imeiInicial || pontos.length === 0) return;
    const alvo = pontos.find((p) => p.imei === imeiInicial);
    if (!alvo) return;
    focouInicial.current = true;
    setSelecionadoId(alvo.id);
    if (alvo.latitude != null && alvo.longitude != null) {
      mapRef.current?.flyTo(alvo.longitude, alvo.latitude, FOCO_ZOOM, PAINEL_LARGURA);
    } else {
      toast.info('Esse rastreador ainda não reportou posição.');
    }
  }, [imeiInicial, pontos]);

  // Os mesmos cinco contadores da referência.
  const contagem = useMemo(() => {
    let online = 0;
    let offline = 0;
    let semGps = 0;
    let sleep = 0;
    let ligados = 0;
    for (const p of pontos) {
      if (p.conexao === 'ONLINE') online++;
      else if (p.conexao === 'SLEEP') sleep++;
      else offline++;
      if (!p.gpsConfiavel) semGps++;
      if (p.ignicao === true) ligados++;
    }
    return { online, offline, semGps, sleep, ligados };
  }, [pontos]);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return pontos.filter((p) => {
      if (filtro === 'ONLINE' && p.conexao !== 'ONLINE') return false;
      if (filtro === 'OFFLINE' && p.conexao === 'ONLINE') return false;
      if (filtro === 'SEM_GPS' && p.gpsConfiavel) return false;
      if (filtro === 'SLEEP' && p.conexao !== 'SLEEP') return false;
      if (filtro === 'LIGADOS' && p.ignicao !== true) return false;
      if (!termo) return true;
      return (
        p.imei.toLowerCase().includes(termo) ||
        (p.iccid ?? '').toLowerCase().includes(termo) ||
        (p.line ?? '').toLowerCase().includes(termo) ||
        (p.endereco ?? '').toLowerCase().includes(termo)
      );
    });
  }, [pontos, busca, filtro]);

  const selecionado = pontos.find((p) => p.id === selecionadoId) ?? null;

  return (
    <div className="flex h-full">
      {/* Lista lateral — só aparece de lg pra cima */}
      <aside className="hidden w-[340px] shrink-0 flex-col border-r border-border/40 lg:flex">
        <SidebarContent
          total={pontos.length}
          carregando={carregando}
          onBack={() => router.push('/estoque')}
          onRefresh={() => void carregar(true)}
          busca={busca}
          onBuscaChange={setBusca}
          filtro={filtro}
          onFiltroChange={setFiltro}
          contagem={contagem}
          lista={lista}
          selecionadoId={selecionadoId}
          onSelecionar={selecionar}
        />
      </aside>

      {/* Mapa */}
      <div className="relative flex-1">
        {indisponivel && (
          <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-400 backdrop-blur">
            Servidor GPS indisponível — as posições não podem ser conferidas agora.
          </div>
        )}

        <StockMap
          ref={mapRef}
          pontos={pontos}
          selecionadoId={selecionadoId}
          onSelect={selecionar}
        />

        <Button
          variant="outline"
          size="sm"
          className="absolute bottom-24 right-2 z-10 h-8 gap-1 bg-background/90 text-xs backdrop-blur"
          onClick={() => mapRef.current?.fitAll()}
        >
          <Crosshair className="h-3.5 w-3.5" />
          Ver todos
        </Button>

        {/* Abaixo de lg a aside com a lista desaparece — este botão + gaveta é
            a única forma de buscar/listar o estoque no celular. */}
        <button
          type="button"
          onClick={() => setListaOpen(true)}
          aria-label="Listar estoque"
          title="Listar estoque"
          className="lg:hidden absolute bottom-3 left-3 z-20 flex items-center gap-2 rounded-full glass-light border border-border/40 px-4 py-2.5 shadow-lg text-sm font-medium hover:bg-muted/40 transition-colors"
        >
          <List className="h-4 w-4" />
          Estoque
        </button>

        {selecionado && (
          <div className="absolute right-0 top-0 z-20 h-full w-full max-w-[360px] border-l shadow-xl">
            <StockMapDetail
              ponto={selecionado}
              onClose={() => setSelecionadoId(null)}
              onValidar={() => setValidarItem(selecionado)}
              onAssociar={() => setAssociarItem(selecionado)}
            />
          </div>
        )}
      </div>

      {/* Gaveta mobile com a mesma busca/filtros/lista da aside de desktop */}
      <Sheet open={listaOpen} onOpenChange={setListaOpen}>
        <SheetContent side="left" className="w-[85vw] max-w-sm p-0 lg:hidden">
          <SheetTitle className="sr-only">Estoque</SheetTitle>
          <SidebarContent
            total={pontos.length}
            carregando={carregando}
            onBack={() => router.push('/estoque')}
            onRefresh={() => void carregar(true)}
            busca={busca}
            onBuscaChange={setBusca}
            filtro={filtro}
            onFiltroChange={setFiltro}
            contagem={contagem}
            lista={lista}
            selecionadoId={selecionadoId}
            onSelecionar={selecionar}
          />
        </SheetContent>
      </Sheet>

      <InstallCheckSheet
        item={validarItem}
        open={validarItem !== null}
        onOpenChange={(o) => !o && setValidarItem(null)}
        onValidated={() => void carregar(false)}
      />

      <AssociateStockDialog
        item={associarItem}
        open={associarItem !== null}
        onOpenChange={(o) => !o && setAssociarItem(null)}
        onAssociated={() => {
          setSelecionadoId(null);
          void carregar(true);
        }}
      />
    </div>
  );
}

/**
 * Busca + chips de filtro + lista — conteúdo compartilhado entre a aside fixa
 * de desktop (lg+) e a gaveta (Sheet) do celular, pra não duplicar o markup.
 */
function SidebarContent({
  total,
  carregando,
  onBack,
  onRefresh,
  busca,
  onBuscaChange,
  filtro,
  onFiltroChange,
  contagem,
  lista,
  selecionadoId,
  onSelecionar,
}: {
  total: number;
  carregando: boolean;
  onBack: () => void;
  onRefresh: () => void;
  busca: string;
  onBuscaChange: (v: string) => void;
  filtro: Filtro;
  onFiltroChange: (f: Filtro) => void;
  contagem: {
    online: number;
    offline: number;
    semGps: number;
    sleep: number;
    ligados: number;
  };
  lista: StockMapPoint[];
  selecionadoId: string | null;
  onSelecionar: (id: string) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-2 border-b p-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onBack}
            aria-label="Voltar pro estoque"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="flex items-center gap-1.5 text-sm font-bold">
            <Boxes className="h-4 w-4 text-brand-orange-500" />
            {total} no estoque
          </h1>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-8 w-8 p-0"
            onClick={onRefresh}
            aria-label="Atualizar"
          >
            <RefreshCw className={cn('h-4 w-4', carregando && 'animate-spin')} />
          </Button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => onBuscaChange(e.target.value)}
            placeholder="IMEI, ICCID, linha ou endereço"
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div className="grid grid-cols-5 gap-1 text-center text-[11px]">
          <FiltroChip
            ativo={filtro === 'ONLINE'}
            onClick={() => onFiltroChange(filtro === 'ONLINE' ? 'todos' : 'ONLINE')}
            rotulo="Conectados"
            valor={contagem.online}
            cor="text-emerald-400"
          />
          <FiltroChip
            ativo={filtro === 'OFFLINE'}
            onClick={() => onFiltroChange(filtro === 'OFFLINE' ? 'todos' : 'OFFLINE')}
            rotulo="Desconect."
            valor={contagem.offline}
            cor="text-red-400"
          />
          <FiltroChip
            ativo={filtro === 'SEM_GPS'}
            onClick={() => onFiltroChange(filtro === 'SEM_GPS' ? 'todos' : 'SEM_GPS')}
            rotulo="Sem GPS"
            valor={contagem.semGps}
            cor="text-foreground"
          />
          <FiltroChip
            ativo={filtro === 'SLEEP'}
            onClick={() => onFiltroChange(filtro === 'SLEEP' ? 'todos' : 'SLEEP')}
            rotulo="Sleep"
            valor={contagem.sleep}
            cor="text-sky-400"
          />
          <FiltroChip
            ativo={filtro === 'LIGADOS'}
            onClick={() => onFiltroChange(filtro === 'LIGADOS' ? 'todos' : 'LIGADOS')}
            rotulo="Ligados"
            valor={contagem.ligados}
            cor="text-emerald-400"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {carregando && total === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando o estoque...
          </div>
        ) : lista.length === 0 ? (
          <p className="px-3 py-16 text-center text-xs text-muted-foreground">
            Nenhum rastreador com esse filtro.
          </p>
        ) : (
          lista.map((p) => (
            <CardEstoque
              key={p.id}
              ponto={p}
              selecionado={p.id === selecionadoId}
              onClick={() => onSelecionar(p.id)}
            />
          ))
        )}
      </div>
    </>
  );
}

function FiltroChip({
  ativo,
  onClick,
  rotulo,
  valor,
  cor,
}: {
  ativo: boolean;
  onClick: () => void;
  rotulo: string;
  valor: number;
  cor: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border px-1 py-1 transition-colors hover:bg-muted/50',
        ativo && 'border-brand-orange-500/60 bg-brand-orange-500/10',
      )}
    >
      <span className={cn('block text-sm font-bold', cor)}>{valor}</span>
      <span className="block text-[10px] text-muted-foreground">{rotulo}</span>
    </button>
  );
}

function CardEstoque({
  ponto,
  selecionado,
  onClick,
}: {
  ponto: StockMapPoint;
  selecionado: boolean;
  onClick: () => void;
}) {
  const badge = badgeConexao(ponto.conexao);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full border-b px-3 py-2 text-left transition-colors hover:bg-muted/40',
        selecionado && 'bg-brand-orange-500/10',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', badge.ponto)} />
        <span className="font-mono text-xs font-semibold">{ponto.imei}</span>
        <span
          className={cn(
            'ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold',
            badge.fundo,
            badge.texto,
          )}
        >
          {badge.rotulo}
        </span>
      </div>

      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Última atualização {haQuantoTempo(ponto.lastUpdate)}
      </p>

      {ponto.endereco && (
        <p className="mt-0.5 flex items-start gap-1 text-[11px] text-muted-foreground">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="line-clamp-2">{ponto.endereco}</span>
        </p>
      )}

      <div className="mt-1.5 grid grid-cols-4 gap-1 border-t pt-1.5 text-center">
        <Mini
          icone={KeyRound}
          rotulo="Ignição"
          valor={textoIgnicao(ponto.ignicao)}
        />
        <Mini
          icone={Gauge}
          rotulo="Velocidade"
          valor={
            ponto.velocidade === null ? '—' : `${Math.round(ponto.velocidade)} Km/h`
          }
        />
        <Mini icone={Zap} rotulo="Voltagem" valor={textoVoltagem(ponto.volts)} />
        <Mini
          icone={Satellite}
          rotulo="Satélites"
          valor={ponto.satelites === null ? '—' : String(ponto.satelites)}
        />
      </div>
    </button>
  );
}

function Mini({
  icone: Icone,
  rotulo,
  valor,
}: {
  icone: typeof KeyRound;
  rotulo: string;
  valor: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <Icone className="h-3 w-3 text-muted-foreground" />
      <span className="text-[9px] text-muted-foreground">{rotulo}</span>
      <span className="text-[10px] font-semibold leading-none">{valor}</span>
    </div>
  );
}

export type { StockConexao };
