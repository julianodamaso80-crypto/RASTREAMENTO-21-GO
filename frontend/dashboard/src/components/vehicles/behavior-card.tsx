'use client';

import { useEffect, useState } from 'react';
import { Activity, Power, Clock, Gauge, AlertTriangle, MoonStar } from 'lucide-react';
import { analyticsApi, type BehaviorReport, type BehaviorPeriod } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const PERIOD_LABEL: Record<BehaviorPeriod, string> = {
  '24h': 'Hoje',
  '7d': '7 dias',
  '30d': '30 dias',
};

function formatDuration(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

export function BehaviorCard({ vehicleId }: { vehicleId: string }) {
  const [period, setPeriod] = useState<BehaviorPeriod>('7d');
  const [data, setData] = useState<BehaviorReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    analyticsApi
      .getBehavior(vehicleId, period)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Falha ao carregar comportamento');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vehicleId, period]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-500" />
          Comportamento
        </CardTitle>
        <Tabs value={period} onValueChange={(v) => setPeriod(v as BehaviorPeriod)}>
          <TabsList className="h-8">
            <TabsTrigger value="24h" className="text-xs">Hoje</TabsTrigger>
            <TabsTrigger value="7d" className="text-xs">7d</TabsTrigger>
            <TabsTrigger value="30d" className="text-xs">30d</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {loading && <div className="text-sm text-muted-foreground py-6">Carregando…</div>}
        {error && <div className="text-sm text-destructive py-6">{error}</div>}
        {!loading && !error && data && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Metric icon={<Power className="h-3.5 w-3.5" />} label="Ligou o carro" value={`${data.ignitionCycles}×`} />
              <Metric icon={<Clock className="h-3.5 w-3.5" />} label="Motor ligado" value={formatDuration(data.engineMinutes)} />
              <Metric icon={<Gauge className="h-3.5 w-3.5" />} label="KM rodados" value={`${data.distanceKm.toFixed(1)} km`} />
              <Metric icon={<Gauge className="h-3.5 w-3.5" />} label="Vel. máx" value={`${data.maxSpeedKmh} km/h`} />
              <Metric icon={<Clock className="h-3.5 w-3.5" />} label="Tempo dirigindo" value={formatDuration(data.drivingMinutes)} />
              <Metric icon={<Clock className="h-3.5 w-3.5" />} label="Parado ligado (idle)" value={formatDuration(data.idleMinutes)} />
              <Metric
                icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                label="Excessos"
                value={String(data.speedExcessCount)}
              />
              <Metric
                icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                label="Frenagens bruscas"
                value={String(data.harshBrakeCount)}
              />
              <Metric
                icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                label="Aceler. bruscas"
                value={String(data.harshAccelCount)}
              />
              <Metric
                icon={<MoonStar className="h-3.5 w-3.5 text-indigo-500" />}
                label="Direção noturna"
                value={`${data.nightDriveKm.toFixed(1)} km`}
              />
            </div>
            <Heatmap data={data.hourlyHeatmap} />
            <div className="text-xs text-muted-foreground">
              Período: {PERIOD_LABEL[data.period]}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Heatmap({ data }: { data: number[][] }) {
  const maxVal = Math.max(1, ...data.flat());
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">Perfil de uso (minutos com motor ligado)</div>
      <div className="grid gap-px" style={{ gridTemplateColumns: '36px repeat(24, 1fr)' }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="text-[9px] text-muted-foreground text-center">
            {h % 6 === 0 ? h : ''}
          </div>
        ))}
        {data.map((row, di) => (
          <>
            <div key={`d${di}`} className="text-[10px] text-muted-foreground self-center pr-1">{days[di]}</div>
            {row.map((v, hi) => {
              const intensity = v / maxVal;
              return (
                <div
                  key={`${di}-${hi}`}
                  title={`${days[di]} ${hi}h: ${v} min`}
                  className="aspect-square rounded-sm"
                  style={{ backgroundColor: `rgba(16, 185, 129, ${0.08 + intensity * 0.85})` }}
                />
              );
            })}
          </>
        ))}
      </div>
    </div>
  );
}
