'use client';

import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronLeft, List, X } from 'lucide-react';
import { useTracking } from '@/contexts/tracking-context';
import { VehicleSidebar } from '@/components/vehicles/vehicle-sidebar';
import { VehicleDetailPanel } from '@/components/vehicles/vehicle-detail-panel';
import { SelectionListPanel } from '@/components/map/selection-list-panel';
import { useReverseGeocodeMany } from '@/hooks/use-reverse-geocode-many';
import { formatSpeed, formatRelativeTime, getVehicleStatusLabel } from '@/lib/utils';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { STATUS_COLORS } from '@/lib/constants';
import type { MapContainerRef } from '@/components/map/map-container';

const MapContainer = dynamic(
  () => import('@/components/map/map-container'),
  { ssr: false, loading: () => <div className="w-full h-full bg-background animate-pulse" /> },
);

// Zoom 17 = vê o carro + nomes das ruas adjacentes claramente.
// Operador entende em 1s onde o veículo está sem precisar dar zoom manual.
const FOCUS_ZOOM = 17;

// Largura do painel de detalhes — usada como padding do flyTo só quando ele
// está aberto, pra o veículo não ficar centralizado atrás do painel.
const PANEL_WIDTH = 380;

export default function MapaPage() {
  const {
    filteredVehicles,
    selectedIds,
    selectedVehicleId,
    selectVehicle,
    toggleVehicle,
    vehicles,
  } = useTracking();
  const mapRef = useRef<MapContainerRef>(null);
  // Painel nasce RECOLHIDO: a prioridade é ver o máximo do mapa. Quem quiser
  // informação extra abre pela aba lateral.
  const [panelOpen, setPanelOpen] = useState(false);
  const focouInicial = useRef(false);
  /** Último veículo que a câmera já enquadrou — evita reimpor o zoom. */
  const focadoId = useRef<string | null>(null);
  // O mapa é carregado sob demanda: comandar a câmera antes dele existir era
  // comando perdido, e o veículo aberto por "Abrir no mapa" ficava fora da
  // tela justamente na navegação por dentro do painel.
  const [mapaPronto, setMapaPronto] = useState(false);
  // Abaixo de lg a VehicleSidebar (lista pra selecionar veículo) some da
  // tela — sem esta gaveta, no celular só sobra tocar em pins minúsculos no
  // mapa, e foi exatamente isso que ficou impossível de usar.
  const [vehicleListOpen, setVehicleListOpen] = useState(false);

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId);

  // Os marcados, na ordem em que foram marcados — é dela que sai a numeração
  // que aparece igual no pino e na linha do painel.
  const marcados = useMemo(
    () =>
      selectedIds
        .map((id) => vehicles.find((v) => v.id === id))
        .filter((v): v is NonNullable<typeof v> => v !== undefined),
    [selectedIds, vehicles],
  );
  const varios = marcados.length > 1;

  // Endereço de cada marcado. Só busca quando o painel de lista está em cena:
  // com um só quem resolve é o painel de detalhe, e pedir duas vezes o mesmo
  // ponto seria gastar o dobro do limite do geocoder por nada.
  const enderecos = useReverseGeocodeMany(
    varios
      ? marcados.map((v) => ({
          id: v.id,
          latitude: v.latitude,
          longitude: v.longitude,
        }))
      : [],
  );

  // Com um veículo selecionado o mapa mostra SÓ ele.
  //
  // Antes ficavam no mapa os 399 marcadores da frota inteira: a câmera até
  // enquadrava o escolhido, mas em bairro com outros ativos por perto (12 num
  // raio de 1 km, medido em 01/09/2026) ele virava mais um pin no meio dos
  // demais — o operador seleciona um carro e não acha o carro. Selecionar é
  // justamente dizer "quero este"; o resto volta ao soltar a seleção (X).
  //
  // Vem de `vehicles`, não de `filteredVehicles`: o selecionado não pode sumir
  // do mapa porque a busca ou a aba de status deixou de casar com ele.
  const vehiclesNoMapa = marcados.length > 0 ? marcados : filteredVehicles;

  // Selecionou um veículo na lista (mobile) → fecha a gaveta pra revelar o
  // mapa já centrado nele, sem precisar de um segundo toque no X.
  useEffect(() => {
    if (selectedVehicleId) setVehicleListOpen(false);
  }, [selectedVehicleId]);

  /** Coordenadas dos marcados que já reportaram posição. */
  const pontosMarcados = useMemo(
    () =>
      marcados
        .filter((v) => v.latitude && v.longitude)
        .map((v) => [v.longitude, v.latitude] as [number, number]),
    [marcados],
  );

  const enquadrarMarcados = useCallback(() => {
    if (pontosMarcados.length > 0) {
      mapRef.current?.fitTo(pontosMarcados, PANEL_WIDTH);
    }
  }, [pontosMarcados]);

  const onMapaPronto = useCallback(() => setMapaPronto(true), []);

  const handleVehicleClick = useCallback(
    (vehicleId: string) => {
      // Com um grupo marcado, clicar num pino CENTRALIZA nele e pronto. Trocar
      // a seleção aqui desmancharia os outros marcados por um clique de quem
      // só queria olhar de perto — e remontar o grupo é caixinha por caixinha.
      if (!varios) selectVehicle(vehicleId);
      const v = vehicles.find((veh) => veh.id === vehicleId);
      if (v && v.latitude && v.longitude) {
        mapRef.current?.flyTo(
          v.longitude,
          v.latitude,
          FOCUS_ZOOM,
          panelOpen || varios ? PANEL_WIDTH : 0,
        );
      }
    },
    [selectVehicle, vehicles, panelOpen, varios],
  );

  // Placa vinda de "Abrir no mapa" em outra tela. Lida do location (e não com
  // useSearchParams, que exigiria Suspense na rota) DENTRO do efeito: numa
  // navegação client-side o Next troca a URL depois da primeira renderização,
  // então ler no render pegava a rota anterior e o veículo nunca era aberto.
  //
  // A lista de veículos chega assíncrona, então a seleção só pode acontecer
  // depois dela. `focouInicial` garante que isso rode uma vez só — senão o
  // mapa voltaria pro veículo da URL a cada atualização do WebSocket.
  useEffect(() => {
    if (focouInicial.current || vehicles.length === 0) return;
    const placa = new URLSearchParams(window.location.search).get('placa');
    if (!placa) return;
    const alvo = vehicles.find(
      (v) => v.plate?.toUpperCase() === placa.toUpperCase(),
    );
    if (!alvo) return;
    focouInicial.current = true;
    selectVehicle(alvo.id);
  }, [vehicles, selectVehicle]);

  // Coordenada do veículo selecionado, como número solto.
  //
  // Isto existe pra NÃO depender do array `vehicles` nos efeitos de câmera
  // abaixo: ele é recriado inteiro sempre que qualquer um dos 60 veículos
  // reporta posição (~0,84 vez por segundo em 19/08/2026), e era isso que
  // fazia a câmera se mexer o tempo todo mesmo com o veículo selecionado
  // parado.
  const alvoLat = selectedVehicle?.latitude ?? null;
  const alvoLng = selectedVehicle?.longitude ?? null;

  // Foco inicial: acontece uma vez por veículo selecionado. É o único momento
  // em que o zoom é imposto — a partir daqui o zoom é de quem está olhando.
  //
  // O `focadoId` existe porque a coordenada costuma chegar DEPOIS da seleção
  // (as posições vêm do Traccar numa chamada separada da lista de veículos):
  // quem só olhava `selectedVehicleId` desistia com a coordenada ainda nula e
  // o veículo aberto por "Abrir no mapa" ficava fora da tela. Com o ref dá pra
  // esperar a coordenada sem reimpor o zoom a cada metro andado — que era o
  // bug antigo de a câmera brigar com quem estava olhando.
  useEffect(() => {
    if (!selectedVehicleId) {
      focadoId.current = null;
      return;
    }
    if (!mapaPronto || !alvoLat || !alvoLng) return;
    if (focadoId.current === selectedVehicleId) return;
    focadoId.current = selectedVehicleId;
    mapRef.current?.flyTo(
      alvoLng,
      alvoLat,
      FOCUS_ZOOM,
      panelOpen ? PANEL_WIDTH : 0,
    );
  }, [selectedVehicleId, alvoLat, alvoLng, panelOpen, mapaPronto]);

  // Vários marcados: enquadra todos UMA vez, quando o conjunto muda. E só.
  //
  // Nada de perseguir: com quatro carros indo pra lados diferentes, câmera que
  // segue fica pulando entre eles e não dá pra ler nada. Depois do
  // enquadramento o mapa é de quem está olhando; pra reenquadrar existe o
  // botão "Enquadrar" no painel.
  //
  // A dependência é a assinatura do conjunto (ids em ordem), não o array de
  // veículos — que é recriado a cada posição recebida de QUALQUER um do parque
  // e faria a câmera reenquadrar ~1x por segundo.
  const assinaturaMarcados = selectedIds.join(',');
  const enquadradoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!varios || !mapaPronto) {
      if (!varios) enquadradoRef.current = null;
      return;
    }
    if (enquadradoRef.current === assinaturaMarcados) return;
    // Sem coordenada ainda (as posições chegam depois da lista): espera a
    // próxima passagem em vez de dar um enquadramento vazio.
    if (pontosMarcados.length === 0) return;
    enquadradoRef.current = assinaturaMarcados;
    mapRef.current?.fitTo(pontosMarcados, PANEL_WIDTH);
  }, [varios, mapaPronto, assinaturaMarcados, pontosMarcados]);

  // Seguimento: mantém o veículo à vista enquanto ele anda, sem tocar no zoom
  // e sem brigar com quem arrastou o mapa — a câmera só reage quando o veículo
  // sai do quadro.
  useEffect(() => {
    if (!selectedVehicleId || !alvoLat || !alvoLng) return;
    mapRef.current?.keepInView(alvoLng, alvoLat, panelOpen ? PANEL_WIDTH : 0);
  }, [selectedVehicleId, alvoLat, alvoLng, panelOpen]);

  return (
    <div className="flex h-full">
      <div className="hidden lg:block w-[320px] shrink-0 border-r border-border/30">
        <VehicleSidebar />
      </div>

      {/* O mapa ocupa toda a largura restante. O painel de detalhes é overlay
          — abre por cima, nunca encolhe o mapa. */}
      <div className="flex-1 relative">
        <MapContainer
          ref={mapRef}
          vehicles={vehiclesNoMapa}
          selectedIds={selectedIds}
          onVehicleClick={handleVehicleClick}
          onReady={onMapaPronto}
          // O painel de detalhe cobre os 380px da direita e engolia o seletor
          // de mapa (incluindo o Satélite Google). Com o painel aberto ele sai
          // de baixo: à esquerda do painel no desktop, no canto esquerdo no
          // celular, onde o painel toma quase a tela toda.
          basemapToggleClassName={
            varios || (selectedVehicleId && panelOpen)
              ? 'left-3 right-auto lg:left-auto lg:right-[392px]'
              : undefined
          }
        />

        {/* Abaixo de lg a VehicleSidebar ao lado do mapa desaparece — este
            botão + gaveta é a única forma de buscar/listar veículos no
            celular, já que tocar em pins isolados no mapa não basta. */}
        <button
          type="button"
          onClick={() => setVehicleListOpen(true)}
          aria-label="Listar veículos"
          title="Listar veículos"
          className="lg:hidden absolute bottom-3 left-3 z-20 flex items-center gap-2 rounded-full glass-light border border-border/40 px-4 py-2.5 shadow-lg text-sm font-medium hover:bg-muted/40 transition-colors"
        >
          <List className="h-4 w-4" />
          Veículos
        </button>

        {/* Aba pra abrir os detalhes — só aparece com veículo selecionado
            e painel recolhido */}
        {selectedVehicle && !panelOpen && (
          <div className="absolute right-0 top-1/2 -translate-y-1/2 z-20 flex flex-col items-end gap-2 animate-in slide-in-from-right duration-200">
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              title="Abrir detalhes do veículo"
              className="flex items-center gap-2 pl-3 pr-3 py-2.5 rounded-l-xl glass-light border border-r-0 border-border/40 shadow-lg hover:bg-muted/40 transition-colors"
            >
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{
                  backgroundColor: STATUS_COLORS[selectedVehicle.displayStatus],
                }}
              />
              <span className="text-sm font-bold tracking-wide">
                {selectedVehicle.plate}
              </span>
            </button>
            <button
              type="button"
              onClick={() => selectVehicle(null)}
              title="Soltar o veículo"
              aria-label="Soltar o veículo"
              className="flex items-center justify-center h-8 w-9 rounded-l-xl glass-light border border-r-0 border-border/40 shadow-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {selectedVehicleId && panelOpen && (
          <div className="absolute inset-y-0 right-0 z-30">
            <VehicleDetailPanel onCollapse={() => setPanelOpen(false)} />
          </div>
        )}

        {/* Vários marcados: a localização escrita de cada um, lado a lado com
            o mapa. Fica no lugar do painel de detalhe — a pergunta aqui é
            "onde estão estes?", não "tudo sobre um". */}
        {varios && (
          <div className="absolute inset-y-0 right-0 z-30 w-full max-w-[360px]">
            <SelectionListPanel
              linhas={marcados.map((v) => {
                const geo = enderecos.get(v.id);
                const movendo =
                  v.displayStatus === 'ignition_on' && v.speed > 0;
                return {
                  id: v.id,
                  titulo: v.plate,
                  estado: [
                    getVehicleStatusLabel(v.displayStatus, v.vehicleType),
                    movendo ? formatSpeed(v.speed) : null,
                    formatRelativeTime(v.positionTime ?? v.lastUpdate),
                  ]
                    .filter(Boolean)
                    .join(' · '),
                  cor: STATUS_COLORS[v.displayStatus],
                  endereco: geo?.address ?? null,
                  enderecoCarregando: geo?.loading ?? false,
                  temPosicao: Boolean(v.latitude && v.longitude),
                };
              })}
              onFocar={(id) => {
                const v = vehicles.find((x) => x.id === id);
                if (v?.latitude && v?.longitude) {
                  mapRef.current?.flyTo(
                    v.longitude,
                    v.latitude,
                    FOCUS_ZOOM,
                    PANEL_WIDTH,
                  );
                }
              }}
              onDetalhe={(id) => {
                // Cai pro modo de um só, que é onde mora o detalhe completo.
                selectVehicle(id);
                setPanelOpen(true);
              }}
              onRemover={toggleVehicle}
              onEnquadrar={enquadrarMarcados}
              onLimpar={() => selectVehicle(null)}
            />
          </div>
        )}
      </div>

      {/* Gaveta mobile com a mesma lista/busca/filtros da VehicleSidebar de
          desktop — reaproveitada como está, só muda o container. */}
      <Sheet open={vehicleListOpen} onOpenChange={setVehicleListOpen}>
        <SheetContent side="left" className="w-[85vw] max-w-sm p-0 lg:hidden">
          <SheetTitle className="sr-only">Veículos</SheetTitle>
          <VehicleSidebar />
        </SheetContent>
      </Sheet>
    </div>
  );
}
