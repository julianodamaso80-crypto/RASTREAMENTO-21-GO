'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Battery,
  Bell,
  Car,
  CircleAlert,
  Clock,
  Route,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';
import { dashboardApi } from '@/lib/api';
import type { DashboardOverview, DashboardPeriod } from '@/types/dashboard';
import { PERIOD_LABELS } from '@/types/dashboard';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { PeriodFilter } from '@/components/dashboard/period-filter';
import { Badge } from '@/components/ui/badge';
import { SafeChart } from '@/components/ui/safe-chart';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const REFRESH_MS = 60_000;
const PERIOD_KEY = 'dashboard.period';

const CHART_COLORS = {
  online: '#bfd741',
  offline: '#64748b',
  alerta: '#ef4444',
  line: '#5b7ac4',
  bar: '#f7963d',
};

function readStoredPeriod(): DashboardPeriod {
  if (typeof window === 'undefined') return 'today';
  const stored = localStorage.getItem(PERIOD_KEY);
  if (stored === 'today' || stored === '7d' || stored === '30d') return stored;
  return 'today';
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return 'nunca';
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 5) return 'agora';
  if (sec < 60) return `há ${sec}s`;
  if (sec < 3600) return `há ${Math.floor(sec / 60)}min`;
  if (sec < 86400) return `há ${Math.floor(sec / 3600)}h`;
  return `há ${Math.floor(sec / 86400)}d`;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(n);
}

function formatBucket(label: string, period: DashboardPeriod): string {
  const d = new Date(label);
  // Força timezone Brasil — independe do fuso do browser do operador.
  if (period === 'today') {
    return d.toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return d.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
  });
}

export default function DashboardOverviewPage() {
  const [period, setPeriod] = useState<DashboardPeriod>('today');
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number>(Date.now());
  const [, setTick] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    setPeriod(readStoredPeriod());
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(PERIOD_KEY, period);
    }
  }, [period]);

  const fetchOverview = useCallback(
    async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      try {
        const res = await dashboardApi.getOverview(period);
        if (!mountedRef.current) return;
        setData(res);
        setError(null);
        setLastFetch(Date.now());
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : 'Erro ao carregar dashboard');
      } finally {
        if (mountedRef.current && showSpinner) setLoading(false);
      }
    },
    [period],
  );

  useEffect(() => {
    mountedRef.current = true;
    fetchOverview(true);
    return () => {
      mountedRef.current = false;
    };
  }, [fetchOverview]);

  useEffect(() => {
    const id = setInterval(() => fetchOverview(false), REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchOverview]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const kpis = data?.kpis;
  const charts = data?.charts;
  const tables = data?.tables;

  const fleetPie = useMemo(() => {
    if (!charts) return [];
    return [
      { name: 'Online', value: charts.fleetStatus.online, color: CHART_COLORS.online },
      { name: 'Offline', value: charts.fleetStatus.offline, color: CHART_COLORS.offline },
      { name: 'Com alerta', value: charts.fleetStatus.alerta, color: CHART_COLORS.alerta },
    ].filter((d) => d.value > 0);
  }, [charts]);

  const timeSeriesData = useMemo(() => {
    if (!charts) return [];
    return charts.alertsTimeSeries.map((b) => ({
      ...b,
      display: formatBucket(b.label, period),
    }));
  }, [charts, period]);

  const updatedAgo = formatTimeAgo(new Date(lastFetch).toISOString());

  return (
    <div className="flex flex-col h-full p-4 md:p-6 gap-4 overflow-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            Visão geral da frota · atualizado {updatedAgo} · auto-refresh 60s
          </p>
        </div>
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
          {error} — tentando novamente em breve.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          loading={loading}
          label="Total de veículos"
          value={formatNumber(kpis?.totalVehicles.value ?? 0)}
          icon={Car}
          tone="default"
          hint={
            kpis?.totalVehicles.diffMonth != null
              ? `${kpis.totalVehicles.diffMonth >= 0 ? '+' : ''}${kpis.totalVehicles.diffMonth} vs mês anterior`
              : 'Cadastrados na frota'
          }
          href="/dispositivos"
          emptyLabel="Nenhum veículo cadastrado"
        />
        <KpiCard
          loading={loading}
          label="Online agora"
          value={formatNumber(kpis?.onlineNow.value ?? 0)}
          icon={Wifi}
          tone="success"
          hint={kpis ? `${kpis.onlineNow.percentOfTotal}% da frota` : undefined}
          href="/dispositivos"
          emptyLabel="Nenhum veículo online"
        />
        <KpiCard
          loading={loading}
          label="Offline >1h"
          value={formatNumber(kpis?.offlineOver1h.value ?? 0)}
          icon={WifiOff}
          tone={kpis && kpis.offlineOver1h.value > 0 ? 'warning' : 'default'}
          hint="Sem transmissão recente"
          href="/dispositivos"
          emptyLabel="Todos comunicando"
        />
        <KpiCard
          loading={loading}
          label="Alertas 24h"
          value={formatNumber(kpis?.alerts24h.value ?? 0)}
          icon={Bell}
          tone={kpis && kpis.alerts24h.value > 0 ? 'info' : 'default'}
          hint={kpis ? 'Hover pra ver tipos' : undefined}
          tooltipContent={
            kpis && kpis.alerts24h.value > 0 ? (
              <div className="text-xs space-y-0.5">
                {Object.entries(kpis.alerts24h.byType).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between gap-3">
                    <span>{type}</span>
                    <span className="tabular-nums">{count}</span>
                  </div>
                ))}
              </div>
            ) : undefined
          }
          href="/alertas"
          emptyLabel="Sem alertas no período"
        />
        <KpiCard
          loading={loading}
          label={`Km rodados (${PERIOD_LABELS[period].toLowerCase()})`}
          value={formatNumber(kpis?.kmInPeriod.value ?? 0)}
          suffix="km"
          icon={Route}
          tone="info"
          hint="Soma da distância da frota"
          emptyLabel="Sem dados do Traccar"
        />
        <KpiCard
          loading={loading}
          label="Alertas críticos abertos"
          value={formatNumber(kpis?.criticalOpen.value ?? 0)}
          icon={CircleAlert}
          tone={kpis && kpis.criticalOpen.value > 0 ? 'danger' : 'default'}
          hint="SOS não lidos"
          href="/alertas"
          emptyLabel="Nenhum crítico aberto"
        />
        <KpiCard
          loading={loading}
          label="Bateria <20%"
          value={formatNumber(kpis?.lowBattery.value ?? 0)}
          icon={Battery}
          tone={kpis && kpis.lowBattery.value > 0 ? 'warning' : 'default'}
          hint="Dispositivos c/ bateria baixa"
          href="/dispositivos"
          emptyLabel="Todas saudáveis"
        />
        <KpiCard
          loading={loading}
          label="Sem comunicação >24h"
          value={formatNumber(kpis?.noCommOver24h.value ?? 0)}
          icon={Clock}
          tone={kpis && kpis.noCommOver24h.value > 0 ? 'danger' : 'default'}
          hint="Investigar urgente"
          href="/dispositivos"
          emptyLabel="Frota comunicando"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Alertas no período</CardTitle>
          </CardHeader>
          <CardContent className="h-56 overflow-x-auto">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : timeSeriesData.length === 0 ? (
              <EmptyChart label="Sem alertas registrados no período" />
            ) : (
              <SafeChart>
                <LineChart data={timeSeriesData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="display" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} allowDecimals={false} />
                  <RechartsTooltip
                    contentStyle={{
                      background: 'rgba(15, 23, 42, 0.95)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke={CHART_COLORS.line}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </SafeChart>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Status da frota</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : fleetPie.length === 0 ? (
              <EmptyChart label="Sem veículos cadastrados" />
            ) : (
              <SafeChart>
                <PieChart>
                  <Pie
                    data={fleetPie}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="55%"
                    outerRadius="80%"
                    paddingAngle={2}
                  >
                    {fleetPie.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{
                      background: 'rgba(15, 23, 42, 0.95)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    wrapperStyle={{ fontSize: 11 }}
                  />
                </PieChart>
              </SafeChart>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top 10 veículos por km no período</CardTitle>
          </CardHeader>
          <CardContent className="h-64 overflow-x-auto">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : !charts || charts.topKmVehicles.length === 0 ? (
              <EmptyChart label="Sem dados de distância disponíveis" />
            ) : (
              <SafeChart>
                <BarChart
                  data={charts.topKmVehicles}
                  layout="vertical"
                  margin={{ top: 8, right: 24, left: 8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                  <XAxis type="number" stroke="#64748b" fontSize={11} />
                  <YAxis
                    type="category"
                    dataKey="plate"
                    stroke="#64748b"
                    fontSize={11}
                    width={80}
                  />
                  <RechartsTooltip
                    formatter={(value) => [`${value} km`, 'Distância']}
                    contentStyle={{
                      background: 'rgba(15, 23, 42, 0.95)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="km" fill={CHART_COLORS.bar} radius={[0, 4, 4, 0]} />
                </BarChart>
              </SafeChart>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Últimos eventos</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : !tables || tables.recentEvents.length === 0 ? (
              <EmptyRow label="Sem eventos no período" />
            ) : (
              <ul className="divide-y divide-border/40">
                {tables.recentEvents.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted/30"
                  >
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {e.type}
                    </Badge>
                    <span className="font-mono text-xs shrink-0">{e.plate ?? '—'}</span>
                    <span className="flex-1 truncate text-muted-foreground">{e.message}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatTimeAgo(e.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Precisam de atenção</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : !tables || tables.needsAttention.length === 0 ? (
              <EmptyRow label="Nenhum veículo precisa de atenção" positive />
            ) : (
              <ul className="divide-y divide-border/40">
                {tables.needsAttention.map((v) => (
                  <li
                    key={v.vehicleId}
                    className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted/30 cursor-pointer"
                    onClick={() => {
                      window.location.href = '/dispositivos';
                    }}
                  >
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <span className="font-mono text-xs shrink-0">{v.plate}</span>
                    <span className="flex-1 truncate text-muted-foreground">{v.reason}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatTimeAgo(v.lastSeen)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
      {label}
    </div>
  );
}

function EmptyRow({ label, positive }: { label: string; positive?: boolean }) {
  return (
    <div
      className={cn(
        'p-6 text-center text-xs',
        positive ? 'text-brand-green-500' : 'text-muted-foreground',
      )}
    >
      {label}
    </div>
  );
}
