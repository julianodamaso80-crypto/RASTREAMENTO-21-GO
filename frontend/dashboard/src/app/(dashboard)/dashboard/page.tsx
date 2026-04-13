'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  Activity,
  AlertTriangle,
  Car,
  Gauge,
  Bell,
  Map as MapIcon,
  Radio,
  BarChart3,
  Hexagon,
  ArrowRight,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
} from 'recharts';
import { useTracking } from '@/contexts/tracking-context';
import { STATUS_COLORS, STATUS_LABELS } from '@/lib/constants';
import { DASHBOARD_CONFIG } from '@/lib/dashboard.config';
import { ALERT_TYPE_LABELS, ALERT_TYPE_COLORS } from '@/types/alert';
import { formatRelativeTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

const MiniHeatmap = dynamic(
  () => import('@/components/dashboard/mini-heatmap').then((m) => m.MiniHeatmap),
  { ssr: false, loading: () => <div className="w-full h-full bg-muted/20 animate-pulse rounded-lg" /> },
);

type Severity = 'ok' | 'warning' | 'critical' | 'neutral';

const SEVERITY_STYLES: Record<Severity, { text: string; bg: string; border: string; icon: string }> = {
  ok: {
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    icon: 'text-emerald-400',
  },
  warning: {
    text: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/20',
    icon: 'text-yellow-400',
  },
  critical: {
    text: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    icon: 'text-red-400',
  },
  neutral: {
    text: 'text-muted-foreground',
    bg: 'bg-muted/20',
    border: 'border-border/40',
    icon: 'text-muted-foreground',
  },
};

function KpiCard({
  label,
  value,
  sublabel,
  icon: Icon,
  severity,
  href,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  severity: Severity;
  href?: string;
}) {
  const s = SEVERITY_STYLES[severity];

  const content = (
    <div
      className={cn(
        'glass-light rounded-xl p-5 border transition-all duration-200 h-full',
        s.border,
        href && 'hover:border-emerald-500/40 hover:bg-muted/30 cursor-pointer group',
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={cn('p-2 rounded-lg', s.bg)}>
          <Icon className={cn('h-5 w-5', s.icon)} />
        </div>
        {href && (
          <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
      <div className={cn('text-3xl font-bold tabular-nums', s.text)}>{value}</div>
      <div className="text-sm text-muted-foreground mt-1">{label}</div>
      {sublabel && <div className="text-xs text-muted-foreground/70 mt-1">{sublabel}</div>}
    </div>
  );

  if (href) return <Link href={href}>{content}</Link>;
  return content;
}

const SHORTCUTS = [
  { href: '/', label: 'Mapa ao vivo', icon: MapIcon },
  { href: '/alertas', label: 'Alertas', icon: Bell },
  { href: '/dispositivos', label: 'Dispositivos', icon: Radio },
  { href: '/relatorios', label: 'Relatórios', icon: BarChart3 },
  { href: '/geofencing', label: 'Geofences', icon: Hexagon },
];

export default function DashboardHomePage() {
  const { vehicles, statusCounts, alerts, isSocketConnected, isLoading } = useTracking();

  // Alertas na janela configurada (default 24h)
  const alerts24h = useMemo(() => {
    const cutoff = Date.now() - DASHBOARD_CONFIG.ALERTS_WINDOW_HOURS * 60 * 60 * 1000;
    return alerts.filter((a) => new Date(a.createdAt).getTime() >= cutoff);
  }, [alerts]);

  // Severidade do card "Online"
  const onlinePct = statusCounts.total > 0
    ? ((statusCounts.moving + statusCounts.stopped) / statusCounts.total) * 100
    : 0;
  const onlineSeverity: Severity =
    statusCounts.total === 0
      ? 'neutral'
      : onlinePct >= DASHBOARD_CONFIG.ONLINE_OK_PCT
        ? 'ok'
        : onlinePct >= DASHBOARD_CONFIG.ONLINE_WARNING_PCT
          ? 'warning'
          : 'critical';

  const offlineSeverity: Severity = statusCounts.offline > 0 ? 'warning' : 'ok';
  const alertsSeverity: Severity =
    statusCounts.alert > 0
      ? 'critical'
      : alerts24h.length > DASHBOARD_CONFIG.ALERTS_24H_WARNING
        ? 'warning'
        : 'ok';

  // Pie chart — distribuição por status
  const pieData = useMemo(
    () => [
      { name: STATUS_LABELS.moving, value: statusCounts.moving, color: STATUS_COLORS.moving },
      { name: STATUS_LABELS.stopped, value: statusCounts.stopped, color: STATUS_COLORS.stopped },
      { name: STATUS_LABELS.alert, value: statusCounts.alert, color: STATUS_COLORS.alert },
      { name: STATUS_LABELS.offline, value: statusCounts.offline, color: STATUS_COLORS.offline },
    ].filter((d) => d.value > 0),
    [statusCounts],
  );

  // Bar chart — top N veículos por velocidade atual (DASHBOARD_CONFIG.TOP_N)
  const topSpeedData = useMemo(
    () =>
      [...vehicles]
        .filter((v) => v.speed > 0)
        .sort((a, b) => b.speed - a.speed)
        .slice(0, DASHBOARD_CONFIG.TOP_N)
        .map((v) => ({ plate: v.plate, speed: Math.round(v.speed) })),
    [vehicles],
  );

  // Line chart — alertas por hora na janela configurada
  const alertsPerHour = useMemo(() => {
    const window = DASHBOARD_CONFIG.ALERTS_WINDOW_HOURS;
    const buckets = new Array(window).fill(0).map((_, i) => {
      const hoursAgo = window - 1 - i;
      const label = hoursAgo === 0 ? 'agora' : `${hoursAgo}h`;
      return { hour: label, count: 0, ts: Date.now() - hoursAgo * 60 * 60 * 1000 };
    });
    alerts24h.forEach((a) => {
      const ageHours = Math.floor((Date.now() - new Date(a.createdAt).getTime()) / (60 * 60 * 1000));
      const idx = window - 1 - ageHours;
      if (idx >= 0 && idx < window) buckets[idx].count++;
    });
    return buckets;
  }, [alerts24h]);

  // Últimos eventos (alerts ordenados por mais recente)
  const latestEvents = useMemo(
    () => alerts.slice(0, DASHBOARD_CONFIG.LATEST_EVENTS_COUNT),
    [alerts],
  );

  if (isLoading) {
    return (
      <div className="p-6 h-full flex items-center justify-center">
        <div className="text-muted-foreground">Carregando dashboard...</div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-y-auto h-full">
      {/* Header + atalhos */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
            <span
              className={cn(
                'inline-block w-2 h-2 rounded-full',
                isSocketConnected ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500',
              )}
            />
            {isSocketConnected ? 'Tempo real conectado' : 'Desconectado'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {SHORTCUTS.map((s) => {
            const Icon = s.icon;
            return (
              <Link
                key={s.href}
                href={s.href}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 hover:bg-muted/60 text-sm text-muted-foreground hover:text-foreground border border-border/40 transition-colors"
              >
                <Icon className="h-4 w-4" />
                {s.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Veículos online"
          value={`${statusCounts.moving + statusCounts.stopped}/${statusCounts.total}`}
          sublabel={statusCounts.total > 0 ? `${onlinePct.toFixed(0)}% da frota` : 'Sem veículos'}
          icon={Activity}
          severity={onlineSeverity}
          href="/"
        />
        <KpiCard
          label="Em movimento"
          value={statusCounts.moving}
          sublabel={`${statusCounts.stopped} parados agora`}
          icon={Car}
          severity={statusCounts.moving > 0 ? 'ok' : 'neutral'}
          href="/"
        />
        <KpiCard
          label={`Alertas (${DASHBOARD_CONFIG.ALERTS_WINDOW_HOURS}h)`}
          value={alerts24h.length}
          sublabel={statusCounts.alert > 0 ? `${statusCounts.alert} crítico(s) agora` : 'Sem alertas ativos'}
          icon={AlertTriangle}
          severity={alertsSeverity}
          href="/alertas"
        />
        <KpiCard
          label="Veículos offline"
          value={statusCounts.offline}
          sublabel={statusCounts.offline === 0 ? 'Tudo conectado' : 'Verifique dispositivos'}
          icon={Gauge}
          severity={offlineSeverity}
          href="/dispositivos"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Pie: status da frota */}
        <div className="glass-light rounded-xl p-5 border border-border/40">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">Status da frota</h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'rgba(15,23,42,0.95)',
                    border: '1px solid rgba(148,163,184,0.2)',
                    borderRadius: '8px',
                    color: '#e2e8f0',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
              Sem dados
            </div>
          )}
          <div className="flex flex-wrap gap-3 mt-2 justify-center text-xs">
            {pieData.map((d) => (
              <div key={d.name} className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: d.color }} />
                <span className="text-muted-foreground">{d.name}</span>
                <span className="font-semibold">{d.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bar: top velocidades */}
        <div className="glass-light rounded-xl p-5 border border-border/40">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">
            Top {DASHBOARD_CONFIG.TOP_N} — velocidade atual (km/h)
          </h3>
          {topSpeedData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topSpeedData} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
                <XAxis type="number" stroke="#94a3b8" fontSize={11} />
                <YAxis type="category" dataKey="plate" stroke="#94a3b8" fontSize={11} width={70} />
                <Tooltip
                  cursor={{ fill: 'rgba(148,163,184,0.05)' }}
                  contentStyle={{
                    background: 'rgba(15,23,42,0.95)',
                    border: '1px solid rgba(148,163,184,0.2)',
                    borderRadius: '8px',
                    color: '#e2e8f0',
                  }}
                />
                <Bar dataKey="speed" fill="#10b981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
              Nenhum veículo em movimento
            </div>
          )}
        </div>

        {/* Line: alertas por hora */}
        <div className="glass-light rounded-xl p-5 border border-border/40">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">
            Alertas por hora ({DASHBOARD_CONFIG.ALERTS_WINDOW_HOURS}h)
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={alertsPerHour} margin={{ left: -20, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
              <XAxis dataKey="hour" stroke="#94a3b8" fontSize={10} interval={3} />
              <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: 'rgba(15,23,42,0.95)',
                  border: '1px solid rgba(148,163,184,0.2)',
                  borderRadius: '8px',
                  color: '#e2e8f0',
                }}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#ef4444"
                strokeWidth={2}
                dot={{ fill: '#ef4444', r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom row: eventos + mini-mapa */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Últimos eventos */}
        <div className="glass-light rounded-xl p-5 border border-border/40 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-muted-foreground">Últimos eventos</h3>
            <Link
              href="/alertas"
              className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
            >
              Ver todos <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {latestEvents.length > 0 ? (
            <div className="divide-y divide-border/30">
              {latestEvents.map((e) => (
                <div key={e.id} className="py-2.5 flex items-center gap-3">
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ background: ALERT_TYPE_COLORS[e.type] }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {e.vehicle?.plate || 'Veículo'}
                      </span>
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          color: ALERT_TYPE_COLORS[e.type],
                          background: `${ALERT_TYPE_COLORS[e.type]}1a`,
                        }}
                      >
                        {ALERT_TYPE_LABELS[e.type]}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{e.message}</div>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">
                    {formatRelativeTime(e.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Nenhum evento recente
            </div>
          )}
        </div>

        {/* Mini heatmap */}
        <div className="glass-light rounded-xl p-5 border border-border/40">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">Concentração da frota</h3>
          <div className="h-[300px]">
            <MiniHeatmap vehicles={vehicles} />
          </div>
        </div>
      </div>
    </div>
  );
}
