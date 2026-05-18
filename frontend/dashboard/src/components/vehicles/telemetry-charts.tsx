'use client';

import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { analyticsApi, type BehaviorPeriod, type TelemetryPoint } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function TelemetryCharts({ vehicleId }: { vehicleId: string }) {
  const [period, setPeriod] = useState<BehaviorPeriod>('24h');
  const [data, setData] = useState<TelemetryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    analyticsApi
      .getTelemetry(vehicleId, period)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Falha ao carregar telemetria');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vehicleId, period]);

  const series = useMemo(() => {
    return data.map((p) => ({
      t: new Date(p.deviceTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      speed: p.speed,
      rpm: p.rpm,
      fuel: p.fuel,
      temperature: p.temperature,
      powerVolts: p.powerVolts,
    }));
  }, [data]);

  const hasRpm = data.some((p) => p.rpm !== null);
  const hasFuel = data.some((p) => p.fuel !== null);
  const hasTemp = data.some((p) => p.temperature !== null);
  const hasVolts = data.some((p) => p.powerVolts !== null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Telemetria</CardTitle>
        <Tabs value={period} onValueChange={(v) => setPeriod(v as BehaviorPeriod)}>
          <TabsList className="h-8">
            <TabsTrigger value="24h" className="text-xs">24h</TabsTrigger>
            <TabsTrigger value="7d" className="text-xs">7d</TabsTrigger>
            <TabsTrigger value="30d" className="text-xs">30d</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading && <div className="text-sm text-muted-foreground py-6">Carregando…</div>}
        {error && <div className="text-sm text-destructive py-6">{error}</div>}
        {!loading && !error && data.length === 0 && (
          <div className="text-sm text-muted-foreground py-6">
            Sem dados de telemetria no período. Rastreador pode não estar reportando esses atributos.
          </div>
        )}
        {!loading && !error && data.length > 0 && (
          <>
            <Chart title="Velocidade (km/h)" data={series} dataKey="speed" color="#10b981" />
            {hasRpm && <Chart title="RPM" data={series} dataKey="rpm" color="#3b82f6" />}
            {hasFuel && <Chart title="Combustível" data={series} dataKey="fuel" color="#f59e0b" />}
            {hasTemp && <Chart title="Temperatura (°C)" data={series} dataKey="temperature" color="#ef4444" />}
            {hasVolts && <Chart title="Tensão da bateria (V)" data={series} dataKey="powerVolts" color="#8b5cf6" />}
            {!hasRpm && !hasFuel && !hasTemp && !hasVolts && (
              <div className="text-xs text-muted-foreground">
                Apenas velocidade disponível — rastreador deste veículo não envia RPM/combustível/temperatura.
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Chart({
  title,
  data,
  dataKey,
  color,
}: {
  title: string;
  data: Array<Record<string, unknown>>;
  dataKey: string;
  color: string;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-2">{title}</div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="t" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} width={36} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#cbd5e1' }}
          />
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
