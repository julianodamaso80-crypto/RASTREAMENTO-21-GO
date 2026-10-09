'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ChevronDown, ChevronRight, Download, Loader2, Search, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BASEMAPS, MAP_CENTER } from '@/lib/constants';
import {
  diaDeBrasilia,
  duracaoLegivel,
  horaLocal,
  kmLegivel,
  viagensParaCsv,
  type JornadaDoDia,
  type PontoDaViagem,
  type ViagemDoDia,
} from '@/lib/historico';

interface Props {
  /** Busca as viagens de um dia (AAAA-MM-DD, Brasília). */
  carregar: (dia: string) => Promise<JornadaDoDia>;
  /** Quantos dias para trás o seletor deixa escolher. */
  diasMax: number;
  /** Quando a viagem não traz endereço, resolve pela coordenada. */
  resolverEndereco?: (lat: number, lng: number) => Promise<string | null>;
  /** Nome do arquivo ao exportar a viagem (sem extensão). */
  nomeArquivo: string;
}

const COR_LINHA = '#f97316';

/**
 * Histórico por dia no molde do "Viagens e históricos" da Rede: escolhe o dia,
 * vê as viagens (com o tempo parado entre elas), o trajeto no mapa e a linha
 * do tempo de posições da viagem escolhida.
 */
export function HistoricoDoDia({ carregar, diasMax, resolverEndereco, nomeArquivo }: Props) {
  const hoje = useMemo(() => diaDeBrasilia(Date.now()), []);
  const minimo = useMemo(() => diaDeBrasilia(Date.now() - diasMax * 86_400_000), [diasMax]);
  const [dia, setDia] = useState(hoje);
  const [jornada, setJornada] = useState<JornadaDoDia | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [escolhida, setEscolhida] = useState(0);
  const [detalhes, setDetalhes] = useState(false);
  const [enderecos, setEnderecos] = useState<Record<string, string>>({});
  // A tela pai re-renderiza (atualização periódica); a função não pode virar dependência.
  const carregarRef = useRef(carregar);
  useEffect(() => {
    carregarRef.current = carregar;
  });

  const buscar = useCallback(
    async (d: string) => {
      setCarregando(true);
      setErro(null);
      try {
        const j = await carregarRef.current(d);
        setJornada(j);
        setEscolhida(0);
        setDetalhes(false);
      } catch (e: unknown) {
        const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
        setJornada(null);
        setErro(msg || 'Não foi possível carregar o histórico agora.');
      } finally {
        setCarregando(false);
      }
    },
    [],
  );

  useEffect(() => {
    const t = setTimeout(() => buscar(hoje), 0);
    return () => clearTimeout(t);
  }, [buscar, hoje]);

  const viagens = jornada?.trips ?? [];
  const viagem: ViagemDoDia | undefined = viagens[escolhida];

  // Endereço das pontas quando o backend não mandou (painel interno).
  useEffect(() => {
    if (!resolverEndereco || !viagem) return;
    let cancelado = false;
    const pontos: [string, number, number][] = [
      [`${viagem.startLat},${viagem.startLng}`, viagem.startLat, viagem.startLng],
      [`${viagem.endLat},${viagem.endLng}`, viagem.endLat, viagem.endLng],
    ];
    pontos.forEach(async ([chave, lat, lng]) => {
      if (enderecos[chave]) return;
      const a = await resolverEndereco(lat, lng).catch(() => null);
      if (a && !cancelado) setEnderecos((atual) => ({ ...atual, [chave]: a }));
    });
    return () => {
      cancelado = true;
    };
    // enderecos fora da lista de propósito: só resolve o que ainda falta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viagem, resolverEndereco]);

  const enderecoDe = (v: ViagemDoDia, ponta: 'start' | 'end') => {
    const lat = ponta === 'start' ? v.startLat : v.endLat;
    const lng = ponta === 'start' ? v.startLng : v.endLng;
    return (
      (ponta === 'start' ? v.startAddress : v.endAddress) ||
      enderecos[`${lat},${lng}`] ||
      null
    );
  };

  function exportar() {
    if (!viagem) return;
    const blob = new Blob([viagensParaCsv(viagem)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nomeArquivo}-${dia}-viagem${escolhida + 1}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="historico-dia" className="mb-1 block text-xs text-muted-foreground">
            Data selecionada
          </label>
          <Input
            id="historico-dia"
            type="date"
            value={dia}
            min={minimo}
            max={hoje}
            onChange={(e) => setDia(e.target.value)}
            className="w-44"
          />
        </div>
        <Button
          size="sm"
          disabled={carregando || !dia || dia < minimo || dia > hoje}
          onClick={() => buscar(dia)}
        >
          {carregando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
          Buscar
        </Button>
        <p className="text-xs text-muted-foreground">
          Últimos {diasMax} dias. Cada saída em movimento até a parada é uma viagem.
        </p>
      </div>

      <TrajetoNoMapa viagem={viagem} />

      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {!erro && !carregando && jornada && viagens.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Nenhuma viagem encontrada nesse dia.
        </p>
      )}

      {viagens.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {viagens.map((v, i) => (
            <div key={v.startTime} className="flex items-stretch gap-2">
              <button
                onClick={() => {
                  setEscolhida(i);
                  setDetalhes(false);
                }}
                className={`min-w-44 rounded-md border p-2 text-left text-xs ${
                  i === escolhida ? 'border-orange-500 bg-orange-500/10' : 'hover:bg-muted/50'
                }`}
              >
                <div className="font-semibold">
                  Viagem {i + 1} · {horaLocal(v.startTime)} às {horaLocal(v.endTime)}
                </div>
                <div className="text-muted-foreground">
                  {kmLegivel(v.distanceKm)} · {duracaoLegivel(v.durationMin)}
                </div>
                <div className="text-muted-foreground">
                  máx {v.maxSpeed} km/h · média {v.avgSpeed} km/h
                </div>
              </button>
              {v.stopAfterMin !== null && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Timer className="h-3.5 w-3.5" />
                  {duracaoLegivel(v.stopAfterMin)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {viagem && (
        <div className="rounded-md border p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">Informações da viagem</span>
            <Button variant="ghost" size="sm" onClick={exportar}>
              <Download className="mr-2 h-4 w-4" /> Exportar viagem
            </Button>
          </div>
          <div className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
            <div>
              <span className="text-muted-foreground">Saída:</span>{' '}
              {enderecoDe(viagem, 'start') ?? 'Endereço indisponível'}
            </div>
            <div>
              <span className="text-muted-foreground">Chegada:</span>{' '}
              {enderecoDe(viagem, 'end') ?? 'Endereço indisponível'}
            </div>
            <div>
              <span className="text-muted-foreground">Tempo da viagem:</span>{' '}
              {duracaoLegivel(viagem.durationMin)}
            </div>
            <div>
              <span className="text-muted-foreground">Percurso:</span> {kmLegivel(viagem.distanceKm)}
            </div>
          </div>
          <button
            className="mt-3 flex items-center gap-1 text-xs text-primary"
            onClick={() => setDetalhes((d) => !d)}
          >
            {detalhes ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Detalhes da viagem
          </button>
          {detalhes && (
            <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-xs">
              {viagem.path.map((p) => (
                <li key={p.time} className="flex justify-between gap-3 border-b py-1">
                  <span className="tabular-nums">{horaLocal(p.time, true)}</span>
                  <span className="tabular-nums">{p.speed} km/h</span>
                  <span className="text-muted-foreground">
                    Ignição {p.ignition === null ? '—' : p.ignition ? 'ligada' : 'desligada'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function TrajetoNoMapa({ viagem }: { viagem?: { path: PontoDaViagem[] } }) {
  const box = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const marcas = useRef<maplibregl.Marker[]>([]);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({
      container: box.current,
      style: BASEMAPS[0].url,
      center: MAP_CENTER,
      zoom: 11,
    });
    m.addControl(new maplibregl.NavigationControl(), 'top-right');
    m.on('load', () => setPronto(true));
    mapa.current = m;
    return () => {
      m.remove();
      mapa.current = null;
    };
  }, []);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !pronto) return;
    marcas.current.forEach((x) => x.remove());
    marcas.current = [];
    if (m.getLayer('trajeto')) m.removeLayer('trajeto');
    if (m.getSource('trajeto')) m.removeSource('trajeto');
    if (!viagem || viagem.path.length < 2) return;

    const coords = viagem.path.map((p) => [p.lng, p.lat] as [number, number]);
    m.addSource('trajeto', {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
    });
    m.addLayer({
      id: 'trajeto',
      type: 'line',
      source: 'trajeto',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': COR_LINHA, 'line-width': 4 },
    });
    marcas.current = [
      new maplibregl.Marker({ color: '#16a34a' }).setLngLat(coords[0]).addTo(m),
      new maplibregl.Marker({ color: '#dc2626' }).setLngLat(coords[coords.length - 1]).addTo(m),
    ];
    const b = new maplibregl.LngLatBounds();
    coords.forEach((c) => b.extend(c));
    m.fitBounds(b, { padding: 50, maxZoom: 17, duration: 0 });
  }, [viagem, pronto]);

  return <div ref={box} className="h-72 w-full overflow-hidden rounded-md border sm:h-96" />;
}
