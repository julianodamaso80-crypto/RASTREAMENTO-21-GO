'use client';

import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useTracking } from '@/contexts/tracking-context';
import { useDebounce } from '@/hooks/use-debounce';
import { VehicleListItem } from './vehicle-list-item';
import { TagListItem } from './tag-list-item';
import { VehicleFilterTabs } from './vehicle-filter-tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useState, useEffect } from 'react';

/** TAGs mostradas por vez: são milhares, e cada linha é um nó na tela. */
const TAGS_POR_VEZ = 200;

/**
 * Veículos mostrados por vez. Medido em produção (09/10/2026): os ~6,7 mil
 * veículos desenhados de uma vez davam 95 mil nós só na lista e travavam a
 * thread principal por 15 s a cada carga do mapa. A busca e os filtros agem
 * sobre a lista inteira — só o que é desenhado é limitado.
 */
const VEICULOS_POR_VEZ = 200;

export function VehicleSidebar() {
  const { filteredVehicles, filteredTags, searchQuery, setSearchQuery, isLoading } = useTracking();
  const [tagsVisiveis, setTagsVisiveis] = useState(TAGS_POR_VEZ);
  const [veiculosVisiveis, setVeiculosVisiveis] = useState(VEICULOS_POR_VEZ);
  // Nasce com a busca que já está valendo (ex.: o IMEI digitado na barra do
  // topo). Começar vazio zerava o filtro assim que o mapa montava, e o
  // operador via a lista inteira de volta com o termo ainda escrito em cima.
  const [localSearch, setLocalSearch] = useState(searchQuery);
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
            placeholder="Placa, nome, CPF, IMEI, chassi, modelo..."
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
        ) : filteredVehicles.length === 0 && filteredTags.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            Nenhum veículo encontrado
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {filteredVehicles.slice(0, veiculosVisiveis).map((vehicle) => (
              <VehicleListItem key={vehicle.id} vehicle={vehicle} />
            ))}
            {filteredVehicles.length > veiculosVisiveis && (
              <button
                type="button"
                onClick={() => setVeiculosVisiveis((n) => n + VEICULOS_POR_VEZ)}
                className="w-full rounded-lg py-2 text-xs font-medium text-muted-foreground hover:bg-muted/30 hover:text-foreground"
              >
                Mostrar mais veículos ({filteredVehicles.length - veiculosVisiveis} restantes)
              </button>
            )}
            {filteredTags.slice(0, tagsVisiveis).map((tag) => (
              <TagListItem key={tag.id} tag={tag} />
            ))}
            {filteredTags.length > tagsVisiveis && (
              <button
                type="button"
                onClick={() => setTagsVisiveis((n) => n + TAGS_POR_VEZ)}
                className="w-full rounded-lg py-2 text-xs font-medium text-muted-foreground hover:bg-muted/30 hover:text-foreground"
              >
                Mostrar mais TAGs ({filteredTags.length - tagsVisiveis} restantes)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
