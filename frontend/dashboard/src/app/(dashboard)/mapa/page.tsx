'use client';

import { useRef, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { ChevronLeft, ChevronUp, List, X } from 'lucide-react';
import { useTracking } from '@/contexts/tracking-context';
import { VehicleSidebar } from '@/components/vehicles/vehicle-sidebar';
import { VehicleDetailPanel } from '@/components/vehicles/vehicle-detail-panel';
import { SelectionListPanel, type LinhaSelecionada } from '@/components/map/selection-list-panel';
import { TagDetailPanel } from '@/components/map/tag-detail-panel';
import { useReverseGeocodeMany } from '@/hooks/use-reverse-geocode-many';
import { useIgnicaoHistorico } from '@/hooks/use-ignicao-historico';
import {
  estaConectado,
  formatRelativeTime,
  formatSpeed,
  getVehicleStatusLabel,
  ultimaAtualizacao,
} from '@/lib/utils';
import { COR_TAG } from '@/components/vehicles/tag-list-item';
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

// Largura do painel de detalhes no computador — usada como padding do flyTo
// só quando ele está aberto, pra o veículo não ficar atrás do painel.
const PANEL_WIDTH = 380;

// Tela dividida (mapa em cima, informação embaixo) é só no celular — navegador
// do celular e os apps iOS/Android. No computador o painel fica ao lado, por
// cima do mapa, como sempre foi. Mesmo corte do `lg` que esconde a lista.
const CELULAR = '(max-width: 1023px)';
function assinarTela(avisar: () => void) {
  const mq = window.matchMedia(CELULAR);
  mq.addEventListener('change', avisar);
  return () => mq.removeEventListener('change', avisar);
}
function useCelular() {
  return useSyncExternalStore(
    assinarTela,
    () => window.matchMedia(CELULAR).matches,
    () => false,
  );
}

export default function MapaPage() {
  const {
    filteredVehicles,
    selectedIds,
    selectedVehicleId,
    selectVehicle,
    toggleVehicle,
    vehicles,
    tags,
    filteredTags,
    selectedTagId,
    selectTag,
    markedTagIds,
    toggleTag,
    refreshTags,
  } = useTracking();
  const mapRef = useRef<MapContainerRef>(null);
  const celular = useCelular();
  // Computador: painel nasce RECOLHIDO, a prioridade é ver o máximo do mapa.
  // Celular: tela dividida, o painel abre a cada seleção nova.
  const [panelOpen, setPanelOpen] = useState(false);
  const pad = celular ? 0 : PANEL_WIDTH;
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
  const tagsMarcadas = useMemo(
    () =>
      markedTagIds
        .map((id) => tags.find((t) => t.id === id))
        .filter((t): t is NonNullable<typeof t> => t !== undefined),
    [markedTagIds, tags],
  );
  // Rastreador e TAG do mesmo associado contam juntos: são "vários".
  const varios = marcados.length + tagsMarcadas.length > 1;

  // Com vários marcados, o de baixo mostra UM deles — o último clicado no
  // mapa ou na lista. Chave com prefixo porque veículo e TAG são listas
  // diferentes.
  const chavesMarcadas = useMemo(
    () => [
      ...marcados.map((v) => `v:${v.id}`),
      ...tagsMarcadas.map((t) => `t:${t.id}`),
    ],
    [marcados, tagsMarcadas],
  );
  const [foco, setFoco] = useState<string | null>(null);
  const focoEfetivo = varios
    ? foco && chavesMarcadas.includes(foco)
      ? foco
      : (chavesMarcadas[0] ?? null)
    : null;
  const vehicleFoco = focoEfetivo?.startsWith('v:')
    ? vehicles.find((v) => v.id === focoEfetivo.slice(2))
    : undefined;
  const tagFoco = focoEfetivo?.startsWith('t:')
    ? tags.find((t) => t.id === focoEfetivo.slice(2))
    : undefined;

  // Marcados conectados cuja posição atual não trouxe a chave: a leitura vem
  // do histórico, nunca de um "Desligada" presumido.
  const ignicaoHistorico = useIgnicaoHistorico(
    varios
      ? marcados
          .filter((v) => v.traccarDeviceId && !v.ignicaoLeitura && estaConectado(v.displayStatus))
          .map((v) => v.traccarDeviceId as number)
      : [],
  );

  // Endereço de cada marcado. Só busca quando o painel de lista está em cena:
  // com um só quem resolve é o painel de detalhe, e pedir duas vezes o mesmo
  // ponto seria gastar o dobro do limite do geocoder por nada.
  const enderecos = useReverseGeocodeMany(
    varios
      ? [
          ...marcados.map((v) => ({
            id: `v:${v.id}`,
            latitude: v.latitude,
            longitude: v.longitude,
          })),
          ...tagsMarcadas.map((t) => ({
            id: `t:${t.id}`,
            latitude: t.latitude,
            longitude: t.longitude,
          })),
        ]
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
  // TAG sozinha: aberta pelo clique no mapa, ou a única marcada na lista.
  const selectedTag =
    tags.find((t) => t.id === selectedTagId) ??
    (!varios && marcados.length === 0 ? (tagsMarcadas[0] ?? null) : null);

  // A TAG segue a mesma regra do veículo: aberta, o mapa mostra SÓ ela. Com
  // marcados, o mapa mostra só os marcados — veículos E TAGs.
  const algumMarcado = marcados.length + tagsMarcadas.length > 0;
  const vehiclesNoMapa = selectedTag
    ? []
    : algumMarcado
      ? marcados
      : filteredVehicles;
  const tagsNoMapa = selectedTag
    ? [selectedTag]
    : algumMarcado
      ? tagsMarcadas
      : filteredTags;

  // Celular: seleção nova = painel de baixo aberto de novo.
  const assinaturaSelecao = `${selectedIds.join(',')}|${markedTagIds.join(',')}|${selectedTagId ?? ''}`;
  const [assinaturaVista, setAssinaturaVista] = useState(assinaturaSelecao);
  if (assinaturaVista !== assinaturaSelecao) {
    setAssinaturaVista(assinaturaSelecao);
    if (celular) setPanelOpen(true);
  }

  // Selecionou um veículo na lista (mobile) → fecha a gaveta pra revelar o
  // mapa já centrado nele, sem precisar de um segundo toque no X.
  useEffect(() => {
    if (selectedVehicleId || selectedTagId) setVehicleListOpen(false);
  }, [selectedVehicleId, selectedTagId]);

  // Abriu uma TAG: a câmera vai até ela UMA vez. A posição da TAG não anda
  // sozinha (ela é o último avistamento), então não há seguimento.
  const tagAbertaId = selectedTag?.id ?? null;
  const tagLat = selectedTag?.latitude ?? null;
  const tagLng = selectedTag?.longitude ?? null;
  const tagFocadaId = useRef<string | null>(null);
  useEffect(() => {
    if (!tagAbertaId) {
      tagFocadaId.current = null;
      return;
    }
    if (!mapaPronto || tagLat === null || tagLng === null) return;
    if (tagFocadaId.current === tagAbertaId) return;
    tagFocadaId.current = tagAbertaId;
    mapRef.current?.flyTo(tagLng, tagLat, FOCUS_ZOOM, pad);
  }, [tagAbertaId, tagLat, tagLng, mapaPronto, pad]);

  /** Coordenadas dos marcados que já reportaram posição. */
  const pontosMarcados = useMemo(
    () => [
      ...marcados
        .filter((v) => v.latitude && v.longitude)
        .map((v) => [v.longitude, v.latitude] as [number, number]),
      ...tagsMarcadas
        .filter((t) => t.latitude !== null && t.longitude !== null)
        .map((t) => [t.longitude as number, t.latitude as number] as [number, number]),
    ],
    [marcados, tagsMarcadas],
  );

  const enquadrarMarcados = useCallback(() => {
    if (pontosMarcados.length > 0) {
      mapRef.current?.fitTo(pontosMarcados, pad);
    }
  }, [pontosMarcados, pad]);

  const onMapaPronto = useCallback(() => setMapaPronto(true), []);

  const handleVehicleClick = useCallback(
    (vehicleId: string) => {
      // Com um grupo marcado, clicar num pino CENTRALIZA nele e troca o que
      // aparece embaixo — sem desmanchar os outros marcados, que remontar é
      // caixinha por caixinha.
      if (varios) {
        setFoco(`v:${vehicleId}`);
        if (celular) setPanelOpen(true);
      } else {
        selectVehicle(vehicleId);
      }
      const v = vehicles.find((veh) => veh.id === vehicleId);
      if (v && v.latitude && v.longitude) {
        mapRef.current?.flyTo(
          v.longitude,
          v.latitude,
          FOCUS_ZOOM,
          panelOpen || varios ? pad : 0,
        );
      }
    },
    [selectVehicle, vehicles, varios, celular, panelOpen, pad],
  );

  const handleTagClick = useCallback(
    (tagId: string) => {
      if (varios && markedTagIds.includes(tagId)) {
        setFoco(`t:${tagId}`);
        if (celular) {
          setPanelOpen(true);
        } else {
          const t = tags.find((x) => x.id === tagId);
          if (t && t.latitude !== null && t.longitude !== null) {
            mapRef.current?.flyTo(t.longitude, t.latitude, FOCUS_ZOOM, PANEL_WIDTH);
          }
        }
        return;
      }
      selectTag(tagId);
    },
    [varios, markedTagIds, selectTag, celular, tags],
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
    if (alvo) {
      focouInicial.current = true;
      selectVehicle(alvo.id);
      return;
    }
    // Não é veículo com rastreador: pode ser um cliente que só tem TAG.
    const tag = tags.find((t) => t.plate.toUpperCase() === placa.toUpperCase());
    if (!tag) return;
    focouInicial.current = true;
    selectTag(tag.id);
  }, [vehicles, tags, selectVehicle, selectTag]);

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
    mapRef.current?.flyTo(alvoLng, alvoLat, FOCUS_ZOOM, panelOpen ? pad : 0);
  }, [selectedVehicleId, alvoLat, alvoLng, panelOpen, pad, mapaPronto]);

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
  const assinaturaMarcados = chavesMarcadas.join(',');
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
    mapRef.current?.fitTo(pontosMarcados, pad);
  }, [varios, mapaPronto, assinaturaMarcados, pontosMarcados, pad]);

  // Seguimento: mantém o veículo à vista enquanto ele anda, sem tocar no zoom
  // e sem brigar com quem arrastou o mapa — a câmera só reage quando o veículo
  // sai do quadro.
  useEffect(() => {
    if (!selectedVehicleId || !alvoLat || !alvoLng) return;
    mapRef.current?.keepInView(alvoLng, alvoLat, panelOpen ? pad : 0);
  }, [selectedVehicleId, alvoLat, alvoLng, panelOpen, pad]);

  const linhaDoVeiculo = (v: (typeof marcados)[number]): LinhaSelecionada => {
    const geo = enderecos.get(`v:${v.id}`);
    return {
      id: `v:${v.id}`,
      titulo: v.plate,
      estado: [
        getVehicleStatusLabel(v.displayStatus),
        v.moving ? formatSpeed(v.speed) : null,
        ultimaAtualizacao(v.lastUpdate),
      ]
        .filter(Boolean)
        .join(' · '),
      cor: STATUS_COLORS[v.displayStatus],
      endereco: geo?.address ?? null,
      enderecoCarregando: geo?.loading ?? false,
      temPosicao: Boolean(v.latitude && v.longitude),
      // Desconectado = a leitura pode ser velha; a Rede mostra "--" e nós
      // também. Sem leitura real nenhuma, também "--".
      ignicao: estaConectado(v.displayStatus)
        ? (v.ignicaoLeitura ??
            (v.traccarDeviceId ? ignicaoHistorico.get(v.traccarDeviceId) : null) ??
            null)
        : null,
    };
  };

  const linhaDaTag = (t: (typeof tagsMarcadas)[number]): LinhaSelecionada => {
    const geo = enderecos.get(`t:${t.id}`);
    return {
      id: `t:${t.id}`,
      titulo: `${t.plate} · TAG`,
      estado: t.seenAt ? `vista ${formatRelativeTime(t.seenAt)}` : 'ainda não vista',
      cor: COR_TAG,
      endereco: geo?.address ?? null,
      enderecoCarregando: geo?.loading ?? false,
      temPosicao: t.latitude !== null && t.longitude !== null,
    };
  };

  const focarChave = (chave: string) => {
    setFoco(chave);
    if (celular) setPanelOpen(true);
    const id = chave.slice(2);
    if (chave.startsWith('v:')) {
      const v = vehicles.find((x) => x.id === id);
      if (v?.latitude && v?.longitude) {
        mapRef.current?.flyTo(v.longitude, v.latitude, FOCUS_ZOOM, pad);
      }
    } else {
      const t = tags.find((x) => x.id === id);
      if (t && t.latitude !== null && t.longitude !== null) {
        mapRef.current?.flyTo(t.longitude, t.latitude, FOCUS_ZOOM, pad);
      }
    }
  };

  // Computador: o "detalhe" de uma linha cai pro modo de um só, que é onde
  // mora o painel completo.
  const detalheNoComputador = (chave: string) => {
    const id = chave.slice(2);
    if (chave.startsWith('v:')) {
      selectVehicle(id);
      setPanelOpen(true);
    } else {
      selectTag(id);
    }
  };

  const linhasMarcadas = varios
    ? [...marcados.map(linhaDoVeiculo), ...tagsMarcadas.map(linhaDaTag)]
    : [];

  const removerChave = (chave: string) => {
    const id = chave.slice(2);
    if (chave.startsWith('v:')) toggleVehicle(id);
    else toggleTag(id);
  };

  const temPainel = varios || Boolean(selectedTag) || Boolean(selectedVehicle);
  const tituloRecolhido = varios
    ? `${chavesMarcadas.length} marcados`
    : (selectedTag?.plate ?? selectedVehicle?.plate ?? '');

  if (!celular) {
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
            tags={tagsNoMapa}
            selectedTagId={selectedTag?.id ?? null}
            onTagClick={handleTagClick}
            // O painel de detalhe cobre os 380px da direita e engolia o seletor
            // de mapa (incluindo o Satélite Google). Com o painel aberto ele
            // sai de baixo, à esquerda do painel.
            basemapToggleClassName={
              varios || (selectedVehicleId && panelOpen) || selectedTag
                ? 'left-3 right-auto lg:left-auto lg:right-[392px]'
                : undefined
            }
          />

          {/* Aba pra abrir os detalhes — só aparece com veículo selecionado
              e painel recolhido */}
          {selectedVehicle && !varios && !panelOpen && (
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

          {/* TAG aberta: o painel dela entra direto — ela não tem a telemetria
              do rastreador que justifica o painel recolhido. */}
          {selectedTag && (
            <div className="absolute inset-y-0 right-0 z-30 w-full max-w-[380px]">
              <TagDetailPanel
                tag={selectedTag}
                onClose={() => selectTag(null)}
                onAtualizou={refreshTags}
                onCentralizar={(lng, lat) => mapRef.current?.flyTo(lng, lat, FOCUS_ZOOM, pad)}
              />
            </div>
          )}

          {selectedVehicleId && !varios && panelOpen && (
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
                linhas={linhasMarcadas}
                onFocar={focarChave}
                onDetalhe={detalheNoComputador}
                onRemover={removerChave}
                onEnquadrar={enquadrarMarcados}
                onLimpar={() => selectVehicle(null)}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Tela dividida como na Rede: o mapa em cima com os marcados, embaixo
          a informação do que foi escolhido. Clicar em outro pino ou em outra
          linha troca só a parte de baixo. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <MapContainer
            ref={mapRef}
            vehicles={vehiclesNoMapa}
            selectedIds={selectedIds}
            onVehicleClick={handleVehicleClick}
            onReady={onMapaPronto}
            tags={tagsNoMapa}
            selectedTagId={selectedTag?.id ?? tagFoco?.id ?? null}
            onTagClick={handleTagClick}
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

          {/* Painel recolhido: a alça embaixo do mapa devolve a informação. */}
          {temPainel && !panelOpen && (
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              title="Mostrar informações"
              className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full glass-light border border-border/40 px-4 py-2.5 shadow-lg text-sm font-bold tracking-wide hover:bg-muted/40 transition-colors"
            >
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
              {tituloRecolhido}
            </button>
          )}
        </div>

        {temPainel && panelOpen && (
          <div className="h-[48%] shrink-0 overflow-hidden border-t border-border/40 bg-background">
            {varios ? (
              <div className="flex h-full flex-col md:flex-row">
                <div className="h-36 shrink-0 overflow-hidden border-b border-border/40 md:h-full md:w-[340px] md:border-b-0 md:border-r">
                  <SelectionListPanel
                    linhas={linhasMarcadas}
                    ativoId={focoEfetivo}
                    onFocar={focarChave}
                    onDetalhe={focarChave}
                    onRemover={removerChave}
                    onEnquadrar={enquadrarMarcados}
                    onLimpar={() => selectVehicle(null)}
                  />
                </div>
                <div className="min-h-0 min-w-0 flex-1">
                  {vehicleFoco ? (
                    <VehicleDetailPanel
                      embaixo
                      vehicleId={vehicleFoco.id}
                      onClose={() => toggleVehicle(vehicleFoco.id)}
                      onCollapse={() => setPanelOpen(false)}
                    />
                  ) : tagFoco ? (
                    <TagDetailPanel
                      embaixo
                      tag={tagFoco}
                      onClose={() => toggleTag(tagFoco.id)}
                      onAtualizou={refreshTags}
                    />
                  ) : null}
                </div>
              </div>
            ) : selectedTag ? (
              <TagDetailPanel
                embaixo
                tag={selectedTag}
                onClose={() => selectTag(null)}
                onAtualizou={refreshTags}
              />
            ) : (
              <VehicleDetailPanel embaixo onCollapse={() => setPanelOpen(false)} />
            )}
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
