'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Activity,
  Bell,
  Gauge,
  Wrench,
  Trophy,
  History,
  MessageSquare,
  Lock,
  Unlock,
  MapPin,
  Power,
  Satellite,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { vehiclesApi, alertsApi, analyticsApi, maintenanceApi, type VehicleScore, type MaintenancePlan } from '@/lib/api';
import { ALERT_TYPE_LABELS, ALERT_TYPE_COLORS, type Alert } from '@/types/alert';
import type { Vehicle, VehicleWithTracking } from '@/types/vehicle';
import { BehaviorCard } from '@/components/vehicles/behavior-card';
import { TelemetryCharts } from '@/components/vehicles/telemetry-charts';
import { TripReplay } from '@/components/vehicles/trip-replay';
import { BlockConfirmModal } from '@/components/vehicles/block-confirm-modal';
import { useTracking } from '@/contexts/tracking-context';
import { formatRelativeTime } from '@/lib/utils';

export default function VehicleCockpitPage() {
  const params = useParams();
  const router = useRouter();
  const vehicleId = params?.id as string;
  const { vehicles: trackedVehicles } = useTracking();

  const [vehicleBase, setVehicleBase] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [tab, setTab] = useState<string>('overview');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    vehiclesApi
      .getById(vehicleId)
      .then((v) => !cancelled && setVehicleBase(v))
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  // Versão "live" do veículo via TrackingContext (com posição, ignição, satélites em tempo real)
  const liveVehicle = trackedVehicles.find((v) => v.id === vehicleId) ?? null;
  const vehicle = liveVehicle ?? (vehicleBase as VehicleWithTracking | null);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando veículo…</div>;
  }
  if (error || !vehicle) {
    return (
      <div className="p-6 space-y-3">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Voltar
        </Button>
        <p className="text-sm text-destructive">Falha ao carregar veículo: {error ?? 'não encontrado'}.</p>
      </div>
    );
  }

  const isBlocked = vehicle.status === 'BLOCKED';

  return (
    <div className="h-full overflow-y-auto">
      {/* Cabeçalho fixo do cockpit */}
      <div className="border-b border-border/30 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="px-6 py-4 flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">{vehicle.plate}</h1>
              <Badge variant="outline" className="uppercase">
                {vehicle.status}
              </Badge>
              {vehicle.associate?.name && (
                <span className="text-sm text-muted-foreground">
                  Cliente: <span className="font-medium text-foreground">{vehicle.associate.name}</span>
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {vehicle.brand} {vehicle.model} {vehicle.year ? `· ${vehicle.year}` : ''}{' '}
              {vehicle.color ? `· ${vehicle.color}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={isBlocked ? 'default' : 'destructive'}
              size="sm"
              onClick={() => setShowBlockModal(true)}
              className={isBlocked ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            >
              {isBlocked ? (
                <>
                  <Unlock className="h-4 w-4 mr-2" />
                  Desbloquear
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4 mr-2" />
                  Bloquear
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="px-6 py-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="overview" className="gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              Visão geral
            </TabsTrigger>
            <TabsTrigger value="alerts" className="gap-1.5">
              <Bell className="h-3.5 w-3.5" />
              Alertas
            </TabsTrigger>
            <TabsTrigger value="behavior" className="gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              Comportamento
            </TabsTrigger>
            <TabsTrigger value="telemetry" className="gap-1.5">
              <Gauge className="h-3.5 w-3.5" />
              Telemetria
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5">
              <History className="h-3.5 w-3.5" />
              Histórico
            </TabsTrigger>
            <TabsTrigger value="score" className="gap-1.5">
              <Trophy className="h-3.5 w-3.5" />
              Score
            </TabsTrigger>
            <TabsTrigger value="maintenance" className="gap-1.5">
              <Wrench className="h-3.5 w-3.5" />
              Manutenção
            </TabsTrigger>
            <TabsTrigger value="commands" className="gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Comandos
            </TabsTrigger>
          </TabsList>

          <div className="mt-4">
            <TabsContent value="overview">
              <OverviewTab vehicle={vehicle} vehicleId={vehicleId} />
            </TabsContent>
            <TabsContent value="alerts">
              <AlertsTab vehicleId={vehicleId} />
            </TabsContent>
            <TabsContent value="behavior">
              <BehaviorCard vehicleId={vehicleId} />
            </TabsContent>
            <TabsContent value="telemetry">
              <TelemetryCharts vehicleId={vehicleId} />
            </TabsContent>
            <TabsContent value="history">
              <HistoryTab vehicleId={vehicleId} />
            </TabsContent>
            <TabsContent value="score">
              <ScoreTab vehicleId={vehicleId} />
            </TabsContent>
            <TabsContent value="maintenance">
              <MaintenanceTab vehicleId={vehicleId} />
            </TabsContent>
            <TabsContent value="commands">
              <CommandsTab vehicleId={vehicleId} />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <BlockConfirmModal
        open={showBlockModal}
        onClose={() => setShowBlockModal(false)}
        vehicle={vehicle}
        isBlocking={!isBlocked}
      />
    </div>
  );
}

function OverviewTab({ vehicle, vehicleId }: { vehicle: VehicleWithTracking; vehicleId: string }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4 text-red-400" />
            Posição atual
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <div>
            <span className="text-muted-foreground">Endereço:</span>{' '}
            <span className="font-medium">{vehicle.address ?? '—'}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-muted-foreground text-xs">Velocidade</span>
              <p className="font-semibold">{vehicle.speed?.toFixed(0) ?? 0} km/h</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Ignição</span>
              <p className="font-semibold flex items-center gap-1">
                <Power className={`h-3.5 w-3.5 ${vehicle.ignition ? 'text-emerald-500' : 'text-gray-500'}`} />
                {vehicle.ignition ? 'Ligada' : 'Desligada'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Satélites</span>
              <p className="font-semibold flex items-center gap-1">
                <Satellite className="h-3.5 w-3.5 text-blue-400" />
                {vehicle.satellites ?? 0}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Última atualização</span>
              <p className="font-semibold">{vehicle.lastUpdate ? formatRelativeTime(vehicle.lastUpdate) : '—'}</p>
            </div>
          </div>
          <Separator className="my-2" />
          <p className="text-xs text-muted-foreground font-mono">
            {vehicle.latitude?.toFixed(5)}, {vehicle.longitude?.toFixed(5)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Cliente</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          {vehicle.associate ? (
            <>
              <div>
                <span className="text-muted-foreground text-xs">Nome</span>
                <p className="font-semibold">{vehicle.associate.name}</p>
              </div>
              {vehicle.associate.phone && (
                <div>
                  <span className="text-muted-foreground text-xs">Telefone</span>
                  <p>{vehicle.associate.phone}</p>
                </div>
              )}
              {vehicle.associate.cpf && (
                <div>
                  <span className="text-muted-foreground text-xs">CPF</span>
                  <p className="text-xs font-mono">{vehicle.associate.cpf}</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-xs italic">Sem associado vinculado</p>
          )}
        </CardContent>
      </Card>

      <div className="lg:col-span-3">
        <BehaviorCard vehicleId={vehicleId} />
      </div>
    </div>
  );
}

function AlertsTab({ vehicleId }: { vehicleId: string }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    alertsApi
      .byVehicle(vehicleId, 100)
      .then((r) => !cancelled && setAlerts(r.data))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Histórico de alertas</CardTitle>
      </CardHeader>
      <CardContent>
        {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!loading && alerts.length === 0 && (
          <p className="text-sm text-muted-foreground">Sem alertas registrados pra este veículo.</p>
        )}
        {!loading && alerts.length > 0 && (
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-start gap-3 p-3 border rounded-md text-sm">
                <div
                  className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                  style={{ backgroundColor: ALERT_TYPE_COLORS[a.type] }}
                />
                <div className="flex-1">
                  <div className="font-medium">{ALERT_TYPE_LABELS[a.type] ?? a.type}</div>
                  <div className="text-xs text-muted-foreground">{a.message}</div>
                </div>
                <span className="text-xs text-muted-foreground">{formatRelativeTime(a.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HistoryTab({ vehicleId }: { vehicleId: string }) {
  const [from] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  const [to] = useState(() => new Date().toISOString());
  return (
    <div className="space-y-4">
      <TripReplay vehicleId={vehicleId} from={from} to={to} />
    </div>
  );
}

function ScoreTab({ vehicleId }: { vehicleId: string }) {
  const [score, setScore] = useState<VehicleScore | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    analyticsApi
      .getScore(vehicleId)
      .then((s) => !cancelled && setScore(s))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  if (loading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!score) return <p className="text-sm text-muted-foreground">Score ainda não calculado.</p>;

  const color = score.totalScore >= 80 ? 'text-emerald-500' : score.totalScore >= 60 ? 'text-amber-500' : 'text-red-500';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Score do condutor (30 dias)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-3">
          <span className={`text-6xl font-bold tabular-nums ${color}`}>{score.totalScore}</span>
          <span className="text-muted-foreground text-sm">/ 100</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {score.kmAnalyzed.toFixed(1)} km analisados nos últimos {score.periodDays} dias
        </p>
        <Separator />
        <div className="grid grid-cols-2 gap-3 text-sm">
          <ScoreLine label="Velocidade" value={score.breakdown.speed} />
          <ScoreLine label="Frenagem" value={score.breakdown.harshBrake} />
          <ScoreLine label="Aceleração" value={score.breakdown.harshAccel} />
          <ScoreLine label="Idle" value={score.breakdown.idle} />
          <ScoreLine label="Noturno" value={score.breakdown.night} />
          <ScoreLine label="Consistência" value={score.breakdown.consistency} />
        </div>
      </CardContent>
    </Card>
  );
}

function ScoreLine({ label, value }: { label: string; value: number }) {
  const c = value >= 80 ? 'bg-emerald-500' : value >= 60 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 bg-muted rounded overflow-hidden">
        <div className={`h-full ${c}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function MaintenanceTab({ vehicleId }: { vehicleId: string }) {
  const [plans, setPlans] = useState<MaintenancePlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    maintenanceApi
      .list(vehicleId)
      .then((p) => !cancelled && setPlans(p))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Planos de manutenção deste veículo</CardTitle>
      </CardHeader>
      <CardContent>
        {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!loading && plans.length === 0 && (
          <p className="text-sm text-muted-foreground">Sem planos cadastrados. (Em breve: criar plano por aqui.)</p>
        )}
        {!loading && plans.length > 0 && (
          <div className="space-y-2">
            {plans.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-3 border rounded-md text-sm">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.intervalKm ? `${p.intervalKm} km` : ''}
                    {p.intervalEngineHours ? ` · ${p.intervalEngineHours} h motor` : ''}
                    {p.intervalMonths ? ` · ${p.intervalMonths} meses` : ''}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => maintenanceApi.markDone(p.id)}>
                  Marcar feito
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CommandsTab({ vehicleId }: { vehicleId: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Comandos SMS</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Comandos SMS específicos do dispositivo (bloqueio, desbloqueio, reset, configuração de servidor) — em breve por aqui. Por enquanto, use a tela <a className="underline" href="/dispositivos">Dispositivos</a>.
        </p>
      </CardContent>
    </Card>
  );
}
