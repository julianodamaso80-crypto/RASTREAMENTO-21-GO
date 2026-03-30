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

export default function DashboardPage() {
  const { filteredVehicles, selectedVehicleId, selectVehicle, vehicles } = useTracking();
  const mapRef = useRef<MapContainerRef>(null);

  const handleVehicleClick = useCallback(
    (vehicleId: string) => {
      selectVehicle(vehicleId);
      const v = vehicles.find((veh) => veh.id === vehicleId);
      if (v && v.latitude && v.longitude) {
        mapRef.current?.flyTo(v.longitude, v.latitude);
      }
    },
    [selectVehicle, vehicles],
  );

  // Centralizar no mapa quando selecionar da sidebar
  useEffect(() => {
    if (selectedVehicleId) {
      const v = vehicles.find((veh) => veh.id === selectedVehicleId);
      if (v && v.latitude && v.longitude) {
        mapRef.current?.flyTo(v.longitude, v.latitude);
      }
    }
  }, [selectedVehicleId, vehicles]);

  return (
    <div className="flex h-full">
      {/* Vehicle sidebar - desktop only */}
      <div className="hidden lg:block w-[320px] shrink-0 border-r border-border/30">
        <VehicleSidebar />
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <MapContainer
          ref={mapRef}
          vehicles={filteredVehicles}
          onVehicleClick={handleVehicleClick}
        />
      </div>

      {/* Detail panel */}
      {selectedVehicleId && (
        <div className="hidden md:block">
          <VehicleDetailPanel />
        </div>
      )}
    </div>
  );
}
