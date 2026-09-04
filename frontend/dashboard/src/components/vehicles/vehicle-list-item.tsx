'use client';

import { cn, formatSpeed, formatRelativeTime, getVehicleStatusLabel } from '@/lib/utils';
import { STATUS_COLORS, STATUS_HINTS } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Phone } from 'lucide-react';
import { useTracking } from '@/contexts/tracking-context';
import { SelectionCheckbox } from '@/components/map/selection-checkbox';
import type { VehicleWithTracking } from '@/types/vehicle';

interface VehicleListItemProps {
  vehicle: VehicleWithTracking;
}

export function VehicleListItem({ vehicle }: VehicleListItemProps) {
  const { selectedIds, selectVehicle, toggleVehicle } = useTracking();
  // Realce pela MARCAÇÃO, não pelo "selecionado sozinho": com 4 marcados o
  // operador precisa reconhecer os 4 na lista, não nenhum.
  const isSelected = selectedIds.includes(vehicle.id);
  const color = STATUS_COLORS[vehicle.displayStatus];
  const statusHint = STATUS_HINTS[vehicle.displayStatus];
  const statusLabel = getVehicleStatusLabel(
    vehicle.displayStatus,
    vehicle.vehicleType,
  );

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg pl-2 pr-3 py-2.5 transition-all duration-200',
        isSelected
          ? 'bg-emerald-500/10 border-l-2 border-emerald-400'
          : 'hover:bg-muted/30 border-l-2 border-transparent',
      )}
    >
      {/* Caixinha = acrescenta este veículo aos que já estão marcados.
          Clicar no corpo da linha continua trocando a seleção inteira por
          este — os dois gestos convivem porque são botões irmãos. */}
      <SelectionCheckbox
        marcado={isSelected}
        onToggle={() => toggleVehicle(vehicle.id)}
        rotulo={vehicle.plate}
        className="mt-0.5"
      />
      <button
        type="button"
        onClick={() => selectVehicle(vehicle.id)}
        className="min-w-0 flex-1 text-left"
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
    </div>
  );
}
