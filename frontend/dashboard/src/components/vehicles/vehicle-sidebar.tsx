'use client';

import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useTracking } from '@/contexts/tracking-context';
import { useDebounce } from '@/hooks/use-debounce';
import { VehicleListItem } from './vehicle-list-item';
import { VehicleFilterTabs } from './vehicle-filter-tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useState, useEffect } from 'react';

export function VehicleSidebar() {
  const { filteredVehicles, setSearchQuery, isLoading } = useTracking();
  const [localSearch, setLocalSearch] = useState('');
  const debouncedSearch = useDebounce(localSearch, 300);

  useEffect(() => {
    setSearchQuery(debouncedSearch);
  }, [debouncedSearch, setSearchQuery]);

  return (
    <div className="w-full h-full flex flex-col glass-light">
      {/* Search */}
      <div className="p-3 border-b border-border/30">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por placa ou modelo..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-9 bg-background/50 h-9 text-sm"
          />
        </div>
      </div>

      {/* Filters */}
      <VehicleFilterTabs />

      {/* Vehicle list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : filteredVehicles.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            Nenhum veículo encontrado
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {filteredVehicles.map((vehicle) => (
              <VehicleListItem key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
