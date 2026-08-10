'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronLeft, X } from 'lucide-react';
import { useTracking } from '@/contexts/tracking-context';
import { VehicleSidebar } from '@/components/vehicles/vehicle-sidebar';
import { VehicleDetailPanel } from '@/components/vehicles/vehicle-detail-panel';
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
  const { filteredVehicles, selectedVehicleId, selectVehicle, vehicles } = useTracking();
  const mapRef = useRef<MapContainerRef>(null);
  // Painel nasce RECOLHIDO: a prioridade é ver o máximo do mapa. Quem quiser
  // informação extra abre pela aba lateral.
  const [panelOpen, setPanelOpen] = useState(false);

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId);

  const handleVehicleClick = useCallback(
    (vehicleId: string) => {
      selectVehicle(vehicleId);
      const v = vehicles.find((veh) => veh.id === vehicleId);
      if (v && v.latitude && v.longitude) {
        mapRef.current?.flyTo(
          v.longitude,
          v.latitude,
          FOCUS_ZOOM,
          panelOpen ? PANEL_WIDTH : 0,
        );
      }
    },
    [selectVehicle, vehicles, panelOpen],
  );

  // Quando seleciona veiculo, da flyTo. Depois disso, segue o veiculo em
  // tempo real: a cada mudanca em vehicles (WS updates), faz easeTo suave
  // pra acompanhar o movimento sem desorientar o operador.
  useEffect(() => {
    if (!selectedVehicleId) return;
    const v = vehicles.find((veh) => veh.id === selectedVehicleId);
    if (!v || !v.latitude || !v.longitude) return;
    mapRef.current?.flyTo(
      v.longitude,
      v.latitude,
      FOCUS_ZOOM,
      panelOpen ? PANEL_WIDTH : 0,
    );
  }, [selectedVehicleId, vehicles, panelOpen]);

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
          vehicles={filteredVehicles}
          onVehicleClick={handleVehicleClick}
        />

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
      </div>
    </div>
  );
}
