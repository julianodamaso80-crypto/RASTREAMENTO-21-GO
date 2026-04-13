'use client';

import { useState } from 'react';
import { Search, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTracking } from '@/contexts/tracking-context';
import { reportsApi } from '@/lib/api';
import type { VehicleWithTracking } from '@/types/vehicle';

interface ReportFiltersProps {
  onGenerate: (vehicle: VehicleWithTracking, from: string, to: string) => void;
  loading: boolean;
  selectedVehicle: VehicleWithTracking | null;
}

export function ReportFilters({ onGenerate, loading, selectedVehicle }: ReportFiltersProps) {
  const { vehicles } = useTracking();
  const [vehicleId, setVehicleId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');

  const filteredVehicles = vehicles.filter(
    (v) =>
      !search ||
      v.plate.toLowerCase().includes(search.toLowerCase()) ||
      v.model?.toLowerCase().includes(search.toLowerCase()),
  );

  function handleGenerate() {
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    if (vehicle && from && to) {
      onGenerate(vehicle, new Date(from).toISOString(), new Date(to).toISOString());
    }
  }

  function handleExport(format: 'xlsx' | 'csv') {
    if (!selectedVehicle?.traccarDeviceId || !from || !to) return;
    const url = reportsApi.getExportUrl(
      'positions',
      selectedVehicle.traccarDeviceId,
      new Date(from).toISOString(),
      new Date(to).toISOString(),
      format,
    );
    const token = localStorage.getItem('token');
    // Abrir download via fetch com auth
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `relatorio.${format}`;
        a.click();
      });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        {/* Vehicle selector */}
        <div className="w-64">
          <label className="text-xs text-muted-foreground mb-1 block">Veículo</label>
          <div className="relative">
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-border bg-slate-900 text-slate-100 text-sm appearance-none cursor-pointer focus:outline-none focus:border-brand-orange-500 [&>option]:bg-slate-900 [&>option]:text-slate-100"
            >
              <option value="">Selecione um veículo</option>
              {filteredVehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate} — {v.brand} {v.model}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Date range */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Início</label>
          <Input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 w-48 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Fim</label>
          <Input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 w-48 text-sm"
          />
        </div>

        <Button
          onClick={handleGenerate}
          disabled={!vehicleId || !from || !to || loading}
          className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Search className="h-4 w-4 mr-2" />
          {loading ? 'Gerando...' : 'Gerar Relatório'}
        </Button>

        {selectedVehicle && (
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="h-9" onClick={() => handleExport('xlsx')}>
              <Download className="h-3 w-3 mr-1" /> Excel
            </Button>
            <Button variant="outline" size="sm" className="h-9" onClick={() => handleExport('csv')}>
              <Download className="h-3 w-3 mr-1" /> CSV
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
