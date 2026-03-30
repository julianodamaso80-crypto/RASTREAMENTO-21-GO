'use client';

import { Trash2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Geofence } from '@/types/geofence';

interface GeofenceListProps {
  geofences: Geofence[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function GeofenceList({ geofences, selectedId, onSelect, onDelete }: GeofenceListProps) {
  if (geofences.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground text-sm">
        <MapPin className="h-8 w-8 mx-auto mb-2 opacity-40" />
        Nenhuma cerca criada
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {geofences.map((gf) => {
        const vehicleCount = gf.geofenceVehicles?.length || 0;
        return (
          <button
            key={gf.id}
            onClick={() => onSelect(gf.id)}
            className={`w-full text-left rounded-lg px-3 py-2.5 transition-all ${
              selectedId === gf.id
                ? 'bg-emerald-500/10 border-l-2 border-emerald-400'
                : 'hover:bg-muted/30 border-l-2 border-transparent'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: gf.color }}
                />
                <span className="font-medium text-sm">{gf.name}</span>
              </div>
              <div className="flex items-center gap-1">
                <Badge variant="outline" className="text-[10px] px-1.5">
                  {gf.type === 'CIRCLE' ? 'Círculo' : 'Polígono'}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-red-400"
                  onClick={(e) => { e.stopPropagation(); onDelete(gf.id); }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
            {gf.description && (
              <p className="text-xs text-muted-foreground mt-0.5 ml-5 truncate">{gf.description}</p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5 ml-5">
              {vehicleCount} veículo{vehicleCount !== 1 ? 's' : ''} vinculado{vehicleCount !== 1 ? 's' : ''}
            </p>
          </button>
        );
      })}
    </div>
  );
}
