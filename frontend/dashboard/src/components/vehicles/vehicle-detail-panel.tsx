'use client';

import { X, Navigation, Gauge, Satellite, MapPin, Power, Lock, Unlock, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useTracking } from '@/contexts/tracking-context';
import { cn, maskCPF, formatSpeed, formatRelativeTime } from '@/lib/utils';
import { STATUS_COLORS, STATUS_LABELS, STATUS_HINTS } from '@/lib/constants';
import { useReverseGeocode } from '@/hooks/use-reverse-geocode';
import { BlockConfirmModal } from './block-confirm-modal';
import Link from 'next/link';
import { Activity } from 'lucide-react';
import { useState, useMemo } from 'react';

export function VehicleDetailPanel() {
  const { vehicles, selectedVehicleId, selectVehicle } = useTracking();
  const [showBlockModal, setShowBlockModal] = useState(false);

  const vehicle = useMemo(
    () => vehicles.find((v) => v.id === selectedVehicleId),
    [vehicles, selectedVehicleId],
  );

  // Reverse geocoding via Nominatim (free) — chamado ANTES do early return
  // pra respeitar regras de hooks (sempre na mesma ordem).
  const { address: reverseAddress, loading: addressLoading } = useReverseGeocode(
    vehicle?.latitude,
    vehicle?.longitude,
  );

  if (!vehicle) return null;

  const color = STATUS_COLORS[vehicle.displayStatus];
  const statusHint = STATUS_HINTS[vehicle.displayStatus];
  const isBlocked = vehicle.status === 'BLOCKED';
  // "Movendo de verdade" = motor ligado + speed > 0 + GPS fresh.
  // displayStatus sozinho não diz isso porque ele é sobre IGNIÇÃO agora.
  const isActuallyMoving =
    vehicle.displayStatus === 'ignition_on' && vehicle.speed > 0;
  // Prioriza endereço do Nominatim; se falhou, usa o do Traccar (que pode
  // vir vazio se geocoder do servidor estiver lento/rate-limited).
  const displayAddress = reverseAddress || vehicle.address || null;

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
          <h2 className="text-lg font-bold">{vehicle.plate}</h2>
          <Button variant="ghost" size="icon" onClick={() => selectVehicle(null)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Banner de status — visual rápido pro operador/cliente entender em 1s */}
        <div
          className="p-4 flex items-center gap-3"
          style={{ backgroundColor: `${color}15`, borderBottom: `1px solid ${color}40` }}
        >
          <div
            className={cn(
              'w-3 h-3 rounded-full shrink-0',
              isActuallyMoving && 'animate-pulse',
            )}
            style={{ backgroundColor: color }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold leading-tight" style={{ color }}>
              {STATUS_LABELS[vehicle.displayStatus]}
              {isActuallyMoving && ` · ${formatSpeed(vehicle.speed)}`}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {isActuallyMoving ? 'em movimento' : 'parado'}
              {' · '}
              {vehicle.positionTime
                ? `GPS ${formatRelativeTime(vehicle.positionTime)}`
                : `sem GPS · heartbeat ${formatRelativeTime(vehicle.lastUpdate)}`}
            </div>
            {statusHint && (
              <div
                className="text-xs font-semibold mt-1.5 flex items-center gap-1"
                style={{ color }}
              >
                <Phone className="h-3 w-3 shrink-0" />
                {statusHint}
              </div>
            )}
          </div>
        </div>

        {/* Endereço em destaque — primeira coisa que cliente vê */}
        <div className="px-4 py-3 border-b border-border/30">
          <div className="flex items-start gap-2">
            <MapPin className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Localização
              </p>
              {displayAddress ? (
                <p className="text-sm font-medium leading-tight mt-1">
                  {displayAddress}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic mt-1">
                  {addressLoading ? 'Buscando endereço…' : 'Endereço indisponível'}
                </p>
              )}
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                {vehicle.latitude.toFixed(5)}, {vehicle.longitude.toFixed(5)}
              </p>
            </div>
          </div>
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
                <p className="font-bold text-sm">
                  {isActuallyMoving ? formatSpeed(vehicle.speed) : '0 km/h'}
                </p>
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

        </div>

        <Separator className="opacity-30" />

        {/* Ações */}
        <div className="p-4 space-y-2">
          <Link href={`/veiculos/${vehicle.id}`} className="block">
            <Button variant="outline" className="w-full">
              <Activity className="h-4 w-4 mr-2" />
              Abrir cockpit completo
            </Button>
          </Link>
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
