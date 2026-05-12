'use client';

import { useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useTracking } from '@/contexts/tracking-context';
import { VehicleSidebar } from '@/components/vehicles/vehicle-sidebar';
import { VehicleDetailPanel } from '@/components/vehicles/vehicle-detail-panel';
import type { MapContainerRef } from '@/components/map/map-container';

const MapContainer = dynamic(
  () => import('@/components/map/map-container'),
  { ssr: false, loading: () => <div className="w-full h-full bg-background animate-pulse" /> },
);

// Zoom 16 = rua nivel cidade (consegue ver carro + ruas vizinhas).
// 14 era o default — abria demais, usuario nao via o veiculo direito.
const FOCUS_ZOOM = 16;

export default function MapaPage() {
  const { filteredVehicles, selectedVehicleId, selectVehicle, vehicles } = useTracking();
  const mapRef = useRef<MapContainerRef>(null);

  const handleVehicleClick = useCallback(
    (vehicleId: string) => {
      selectVehicle(vehicleId);
      const v = vehicles.find((veh) => veh.id === vehicleId);
      if (v && v.latitude && v.longitude) {
        mapRef.current?.flyTo(v.longitude, v.latitude, FOCUS_ZOOM);
      }
    },
    [selectVehicle, vehicles],
  );

  // Quando seleciona veiculo, da flyTo. Depois disso, segue o veiculo em
  // tempo real: a cada mudanca em vehicles (WS updates), faz easeTo suave
  // pra acompanhar o movimento sem desorientar o operador.
  useEffect(() => {
    if (!selectedVehicleId) return;
    const v = vehicles.find((veh) => veh.id === selectedVehicleId);
    if (!v || !v.latitude || !v.longitude) return;
    mapRef.current?.flyTo(v.longitude, v.latitude, FOCUS_ZOOM);
  }, [selectedVehicleId, vehicles]);

  return (
    <div className="flex h-full">
      <div className="hidden lg:block w-[320px] shrink-0 border-r border-border/30">
        <VehicleSidebar />
      </div>

      <div className="flex-1 relative">
        <MapContainer
          ref={mapRef}
          vehicles={filteredVehicles}
          onVehicleClick={handleVehicleClick}
        />
      </div>

      {selectedVehicleId && (
        <div className="hidden md:block">
          <VehicleDetailPanel />
        </div>
      )}
    </div>
  );
}
