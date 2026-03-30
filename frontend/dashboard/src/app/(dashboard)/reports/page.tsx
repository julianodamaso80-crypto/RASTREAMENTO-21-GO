'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { ReportFilters } from '@/components/reports/report-filters';
import { TripsTable } from '@/components/reports/trips-table';
import { StopsTable } from '@/components/reports/stops-table';
import { reportsApi } from '@/lib/api';
import type { TraccarPosition } from '@/types/traccar';
import type { Trip, Stop } from '@/types/report';
import type { VehicleWithTracking } from '@/types/vehicle';

const RouteMap = dynamic(
  () => import('@/components/reports/route-map').then((m) => m.RouteMap),
  { ssr: false, loading: () => <div className="w-full h-[400px] bg-muted/20 rounded-lg animate-pulse" /> },
);

export default function ReportsPage() {
  const [loading, setLoading] = useState(false);
  const [positions, setPositions] = useState<TraccarPosition[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleWithTracking | null>(null);
  const [activeTab, setActiveTab] = useState<'route' | 'trips' | 'stops'>('route');

  const handleGenerate = useCallback(
    async (vehicle: VehicleWithTracking, from: string, to: string) => {
      if (!vehicle.traccarDeviceId) {
        toast.error('Veículo sem dispositivo Traccar vinculado');
        return;
      }

      setLoading(true);
      setSelectedVehicle(vehicle);

      try {
        const [pos, trp, stp] = await Promise.all([
          reportsApi.getPositions(vehicle.traccarDeviceId, from, to),
          reportsApi.getTrips(vehicle.traccarDeviceId, from, to),
          reportsApi.getStops(vehicle.traccarDeviceId, from, to),
        ]);

        setPositions(pos);
        setTrips(trp);
        setStops(stp);

        if (pos.length === 0) {
          toast.info('Nenhum dado encontrado para o período selecionado');
        }
      } catch {
        toast.error('Erro ao gerar relatório');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const tabs = [
    { key: 'route' as const, label: 'Rota', count: positions.length },
    { key: 'trips' as const, label: 'Viagens', count: trips.length },
    { key: 'stops' as const, label: 'Paradas', count: stops.length },
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">Relatórios</h1>

        <ReportFilters
          onGenerate={handleGenerate}
          loading={loading}
          selectedVehicle={selectedVehicle}
        />

        {selectedVehicle && (
          <>
            {/* Tabs */}
            <div className="flex gap-1 border-b border-border/30">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? 'border-emerald-400 text-emerald-400'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                  <span className="ml-1.5 text-xs opacity-60">{tab.count}</span>
                </button>
              ))}
            </div>

            {/* Content */}
            {activeTab === 'route' && (
              <div className="h-[400px] rounded-lg overflow-hidden border border-border/30">
                <RouteMap positions={positions} />
              </div>
            )}

            {activeTab === 'trips' && (
              <div className="rounded-lg border border-border/30 p-4">
                <TripsTable trips={trips} />
              </div>
            )}

            {activeTab === 'stops' && (
              <div className="rounded-lg border border-border/30 p-4">
                <StopsTable stops={stops} />
              </div>
            )}
          </>
        )}

        {!selectedVehicle && (
          <div className="text-center py-20 text-muted-foreground">
            <p className="text-lg">Selecione um veículo e período</p>
            <p className="text-sm mt-1">Os dados de posição, viagens e paradas serão exibidos aqui</p>
          </div>
        )}
      </div>
    </div>
  );
}
