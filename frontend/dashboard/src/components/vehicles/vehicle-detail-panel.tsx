'use client';

import { X, Navigation, Gauge, Satellite, MapPin, Power, Lock, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useTracking } from '@/contexts/tracking-context';
import { cn, maskCPF, formatSpeed, formatRelativeTime } from '@/lib/utils';
import { STATUS_COLORS, STATUS_LABELS } from '@/lib/constants';
import { BlockConfirmModal } from './block-confirm-modal';
import { useState, useMemo } from 'react';

export function VehicleDetailPanel() {
  const { vehicles, selectedVehicleId, selectVehicle } = useTracking();
  const [showBlockModal, setShowBlockModal] = useState(false);

  const vehicle = useMemo(
    () => vehicles.find((v) => v.id === selectedVehicleId),
    [vehicles, selectedVehicleId],
  );

  if (!vehicle) return null;

  const color = STATUS_COLORS[vehicle.displayStatus];
  const isBlocked = vehicle.status === 'BLOCKED';

  return (
    <>
      <div
        className={cn(
          'w-[380px] h-full glass-light border-l border-border/30 flex flex-col overflow-y-auto',
          'animate-in slide-in-from-right duration-200',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/30">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
            <h2 className="text-lg font-bold">{vehicle.plate}</h2>
            <Badge variant="outline" style={{ borderColor: color, color }} className="text-xs">
              {STATUS_LABELS[vehicle.displayStatus]}
            </Badge>
          </div>
          <Button variant="ghost" size="icon" onClick={() => selectVehicle(null)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Veículo */}
        <div className="p-4 space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Veículo
          </h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground text-xs">Marca/Modelo</span>
              <p className="font-medium">{vehicle.brand} {vehicle.model}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Ano/Cor</span>
              <p className="font-medium">{vehicle.year} · {vehicle.color}</p>
            </div>
            {vehicle.chassi && (
              <div className="col-span-2">
                <span className="text-muted-foreground text-xs">Chassi</span>
                <p className="font-medium font-mono text-xs">{vehicle.chassi}</p>
              </div>
            )}
          </div>
        </div>

        <Separator className="opacity-30" />

        {/* Associado */}
        {vehicle.associate && (
          <>
            <div className="p-4 space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Associado
              </h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">Nome</span>
                  <p className="font-medium">{vehicle.associate.name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">CPF</span>
                  <p className="font-medium">{maskCPF(vehicle.associate.cpf)}</p>
                </div>
                {vehicle.associate.phone && (
                  <div>
                    <span className="text-muted-foreground text-xs">Telefone</span>
                    <p className="font-medium">{vehicle.associate.phone}</p>
                  </div>
                )}
              </div>
            </div>
            <Separator className="opacity-30" />
          </>
        )}

        {/* Tempo Real */}
        <div className="p-4 space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Tempo Real
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2 bg-muted/20 rounded-lg p-2.5">
              <Gauge className="h-4 w-4 text-brand-green-500" />
              <div>
                <p className="text-xs text-muted-foreground">Velocidade</p>
                <p className="font-bold text-sm">{formatSpeed(vehicle.speed)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-muted/20 rounded-lg p-2.5">
              <Power className={cn('h-4 w-4', vehicle.ignition ? 'text-brand-green-500' : 'text-gray-500')} />
              <div>
                <p className="text-xs text-muted-foreground">Ignição</p>
                <p className="font-bold text-sm">{vehicle.ignition ? 'Ligada' : 'Desligada'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-muted/20 rounded-lg p-2.5">
              <Satellite className="h-4 w-4 text-blue-400" />
              <div>
                <p className="text-xs text-muted-foreground">Satélites</p>
                <p className="font-bold text-sm">{vehicle.satellites}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-muted/20 rounded-lg p-2.5">
              <Navigation className="h-4 w-4 text-yellow-400" />
              <div>
                <p className="text-xs text-muted-foreground">Direção</p>
                <p className="font-bold text-sm">{Math.round(vehicle.course)}°</p>
              </div>
            </div>
          </div>

          {/* Coordenadas */}
          <div className="flex items-start gap-2 bg-muted/20 rounded-lg p-2.5">
            <MapPin className="h-4 w-4 text-red-400 mt-0.5" />
            <div>
              <p className="text-xs text-muted-foreground">Localização</p>
              <p className="text-xs font-mono">
                {vehicle.latitude.toFixed(6)}, {vehicle.longitude.toFixed(6)}
              </p>
              {vehicle.address && (
                <p className="text-xs text-muted-foreground mt-0.5">{vehicle.address}</p>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-right">
            Atualizado {formatRelativeTime(vehicle.lastUpdate)}
          </p>
        </div>

        <Separator className="opacity-30" />

        {/* Ações */}
        <div className="p-4 space-y-2">
          <Button
            variant={isBlocked ? 'default' : 'destructive'}
            className={cn('w-full', isBlocked && 'bg-emerald-600 hover:bg-emerald-700')}
            onClick={() => setShowBlockModal(true)}
          >
            {isBlocked ? (
              <>
                <Unlock className="h-4 w-4 mr-2" />
                Desbloquear Veículo
              </>
            ) : (
              <>
                <Lock className="h-4 w-4 mr-2" />
                Bloquear Veículo
              </>
            )}
          </Button>
        </div>
      </div>

      <BlockConfirmModal
        open={showBlockModal}
        onClose={() => setShowBlockModal(false)}
        vehicle={vehicle}
        isBlocking={!isBlocked}
      />
    </>
  );
}
