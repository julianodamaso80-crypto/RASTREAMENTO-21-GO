'use client';

import { cn, formatSpeed, formatRelativeTime } from '@/lib/utils';
import { STATUS_COLORS, STATUS_LABELS, STATUS_HINTS } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Phone } from 'lucide-react';
import { useTracking } from '@/contexts/tracking-context';
import type { VehicleWithTracking } from '@/types/vehicle';

interface VehicleListItemProps {
  vehicle: VehicleWithTracking;
}

export function VehicleListItem({ vehicle }: VehicleListItemProps) {
  const { selectedVehicleId, selectVehicle } = useTracking();
  const isSelected = selectedVehicleId === vehicle.id;
  const color = STATUS_COLORS[vehicle.displayStatus];
  const statusHint = STATUS_HINTS[vehicle.displayStatus];
  const statusLabel =
    vehicle.displayStatus === 'gps_silent'
      ? vehicle.ignition
        ? 'Ligado'
        : 'Desligado'
      : STATUS_LABELS[vehicle.displayStatus];

  return (
    <button
      onClick={() => selectVehicle(vehicle.id)}
      className={cn(
        'w-full text-left rounded-lg px-3 py-2.5 transition-all duration-200',
        isSelected
          ? 'bg-emerald-500/10 border-l-2 border-emerald-400'
          : 'hover:bg-muted/30 border-l-2 border-transparent',
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: color }}
          />
          <span className="font-semibold text-sm text-foreground">
            {vehicle.plate}
          </span>
        </div>
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0"
          style={{ borderColor: color, color }}
        >
          {statusLabel}
        </Badge>
      </div>
      <div className="flex items-center justify-between mt-1 ml-4">
        <span className="text-xs text-muted-foreground">
          {vehicle.brand} {vehicle.model} · {vehicle.color}
        </span>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {vehicle.displayStatus === 'ignition_on' && vehicle.speed > 0 && (
            <span className="text-emerald-400">{formatSpeed(vehicle.speed)}</span>
          )}
          <span>{formatRelativeTime(vehicle.positionTime ?? vehicle.lastUpdate)}</span>
        </div>
      </div>
      {statusHint && (
        <div
          className="flex items-center gap-1 mt-1 ml-4 text-[11px] font-medium"
          style={{ color }}
        >
          <Phone className="h-3 w-3 shrink-0" />
          {statusHint}
        </div>
      )}
    </button>
  );
}
