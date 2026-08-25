'use client';

import {
  X,
  ChevronRight,
  Navigation,
  Gauge,
  Satellite,
  MapPin,
  Power,
  Lock,
  Unlock,
  Phone,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useTracking } from '@/contexts/tracking-context';
import { useAuth } from '@/contexts/auth-context';
import { canBlockVehicle, canSeeInstallLocation } from '@/lib/manageable-routes';
import { cn, maskCPF, formatCpfCnpj, formatSpeed, formatRelativeTime, getVehicleStatusLabel } from '@/lib/utils';
import { STATUS_COLORS, STATUS_HINTS } from '@/lib/constants';
import { useReverseGeocode } from '@/hooks/use-reverse-geocode';
import { BlockConfirmModal } from './block-confirm-modal';
import Link from 'next/link';
import { Activity } from 'lucide-react';
import { useState, useMemo } from 'react';

interface VehicleDetailPanelProps {
  /** Recolhe o painel mantendo o veículo selecionado no mapa. */
  onCollapse?: () => void;
}

export function VehicleDetailPanel({ onCollapse }: VehicleDetailPanelProps) {
  const { vehicles, selectedVehicleId, selectVehicle } = useTracking();
  const { user } = useAuth();
  const canBlock = canBlockVehicle(user?.role);
  // Cliente final não pode saber onde o rastreador está escondido.
  const showInstallLocation = canSeeInstallLocation(user?.role);
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
  // "Carro/Moto ligado(a)" | "...desligado(a)" | "GPS com defeito".
  const statusLabel = getVehicleStatusLabel(
    vehicle.displayStatus,
    vehicle.vehicleType,
  );
  const isBlocked = vehicle.status === 'BLOCKED';
  // "Movendo de verdade" = motor ligado + speed > 0 + GPS fresh.
  // displayStatus sozinho não diz isso porque ele é sobre IGNIÇÃO agora.
  const isActuallyMoving =
    vehicle.displayStatus === 'ignition_on' && vehicle.speed > 0;
  // Os dois endereços aqui são da MESMA coordenada que aparece logo abaixo
  // deles na tela, e é isso que os torna intercambiáveis: `reverseAddress` só
  // sai do hook carimbado com a coordenada pedida, e `vehicle.address` vem do
  // mesmo objeto `position` do Traccar que forneceu latitude e longitude.
  // Nenhum dos dois pode ser de um ponto anterior — se algum dia um fallback
  // sem esse vínculo entrar aqui, o texto volta a divergir do mapa.
  const displayAddress = reverseAddress || vehicle.address || null;
  // Local físico no veículo informado na instalação (ex.: "atrás do porta-luvas").
  const installLocation = vehicle.device?.installLocation?.trim() || null;
  // IMEI do rastreador instalado. `uniqueId` guarda o mesmo número nos ativos
  // vindos do estoque, e serve de rede quando o Device não veio no payload.
  // Mesmo critério do esconderijo: número de equipamento é dado do time
  // interno, cliente final não recebe.
  // `uniqueId` também guarda valores sintéticos pra veículo sem rastreador
  // (`RETIRADO-<id>` depois do desvínculo, `HINOVA-<codigo>` no sync do SGA).
  // Só serve como IMEI quando é o número mesmo.
  const uniqueIdComoImei = /^\d{6,}$/.test(vehicle.uniqueId?.trim() ?? '')
    ? vehicle.uniqueId.trim()
    : null;
  const imei = showInstallLocation
    ? vehicle.device?.imei?.trim() || uniqueIdComoImei
    : null;

  return (
    <>
      <div
        className={cn(
          'w-[380px] max-w-[88vw] h-full glass-light border-l border-border/30 flex flex-col overflow-y-auto shadow-2xl',
          'animate-in slide-in-from-right duration-200',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/30">
          <h2 className="text-lg font-bold">{vehicle.plate}</h2>
          <div className="flex items-center gap-1">
            {onCollapse && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onCollapse}
                title="Recolher painel (libera o mapa)"
                aria-label="Recolher painel"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => selectVehicle(null)}
              title="Fechar e soltar o veículo"
              aria-label="Fechar detalhes"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
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
              {statusLabel}
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

          {/* Onde o rastreador foi escondido no veículo — informado pelo
              técnico na instalação. Vale ouro quando o carro é levado, por
              isso só o time interno vê: cliente final nunca. */}
          {showInstallLocation && (
            <div className="flex items-start gap-2 mt-3 pt-3 border-t border-border/20">
              <Wrench className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Rastreador instalado em
                </p>
                {installLocation ? (
                  <p className="text-sm font-medium leading-tight mt-1">
                    {installLocation}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground italic mt-1">
                    Local não informado
                  </p>
                )}
              </div>
            </div>
          )}
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
            {/* IMEI do rastreador vinculado: é por ele que se abre chamado,
                se manda comando SMS e se acha o equipamento no estoque. A rota
                do cliente final não recebe este campo. */}
            {imei && (
              <div className="col-span-2">
                <span className="text-muted-foreground text-xs">
                  IMEI do rastreador
                </span>
                <p className="font-medium font-mono text-xs">{imei}</p>
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
                  {/* Time interno vê o documento inteiro — é com ele que se
                      confere quem está no telefone. Cliente final continua
                      vendo só os últimos dígitos. */}
                  <p className="font-medium">
                    {showInstallLocation
                      ? formatCpfCnpj(vehicle.associate.cpf)
                      : maskCPF(vehicle.associate.cpf)}
                  </p>
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
          {canBlock && (
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
          )}
        </div>
      </div>

      <BlockConfirmModal
        open={canBlock && showBlockModal}
        onClose={() => setShowBlockModal(false)}
        vehicle={vehicle}
        isBlocking={!isBlocked}
      />
    </>
  );
}
