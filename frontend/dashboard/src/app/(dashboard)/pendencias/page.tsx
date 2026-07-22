'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardList,
  Search,
  Download,
  RefreshCw,
  Radio,
  Tag,
  Wallet,
  Phone,
  MapPin,
} from 'lucide-react';
import { toast } from 'sonner';
import { installationPendingsApi } from '@/lib/api';
import { cn, formatRelativeTime } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  InstallationPending,
  InstallationPendingStats,
  PendingType,
} from '@/types/installation-pending';

/**
 * Fila de instalação pendente vinda do SGA Hinova.
 *
 * A pendência é o campo "Tipo de Adesão" do veículo no SGA:
 * 1 = pendente instalação de rastreador, 10 = pendente instalação de TAG.
 * Um cron espelha pra cá — a tela nunca consulta o SGA ao vivo (a varredura
 * completa leva minutos).
 */

/** Valor a partir do qual o veículo é considerado de alta exposição. */
const VALOR_ALTO = 50000;
/** Dias de espera a partir dos quais a pendência é considerada atrasada. */
const DIAS_ATRASADO = 30;

type Prioridade = 'CRITICA' | 'ALTA' | 'NORMAL';

function prioridadeDe(p: InstallationPending): Prioridade {
  const caro = p.protectedValue >= VALOR_ALTO;
  const antigo = p.daysPending > DIAS_ATRASADO;
  if (caro && antigo) return 'CRITICA';
  if (caro || antigo) return 'ALTA';
  return 'NORMAL';
}

const PRIORIDADE_ESTILO: Record<Prioridade, { label: string; classe: string }> = {
  CRITICA: {
    label: 'Crítica',
    classe: 'bg-red-500/15 text-red-400 border-red-500/30',
  },
  ALTA: {
    label: 'Alta',
    classe: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
  NORMAL: {
    label: 'Normal',
    classe: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  },
};

const moeda = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

function formatCpf(cpf: string | null): string {
  const d = (cpf ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return cpf ?? '';
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  destaque,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Radio;
  destaque?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {label}
          </span>
          <Icon
            className={cn(
              'h-4 w-4',
              destaque ? 'text-brand-orange-500' : 'text-muted-foreground',
            )}
          />
        </div>
        <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

export default function PendenciasPage() {
  const [rows, setRows] = useState<InstallationPending[]>([]);
  const [stats, setStats] = useState<InstallationPendingStats | null>(null);
  const [cities, setCities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [days, setDays] = useState(60);
  const [type, setType] = useState<PendingType | ''>('');
  const [city, setCity] = useState('');
  const [search, setSearch] = useState('');

  const filters = useMemo(
    () => ({
      days,
      type: type || undefined,
      city: city || undefined,
      search: search || undefined,
    }),
    [days, type, city, search],
  );

  const load = useCallback(async () => {
    try {
      const [lista, totais] = await Promise.all([
        installationPendingsApi.getAll(filters),
        installationPendingsApi.getStats(days),
      ]);
      setRows(lista);
      setStats(totais);
    } catch {
      toast.error('Erro ao carregar pendências de instalação');
    } finally {
      setLoading(false);
    }
  }, [filters, days]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    installationPendingsApi.getCities().then(setCities).catch(() => setCities([]));
  }, []);

  async function handleSync() {
    setSyncing(true);
    toast.info('Varrendo o SGA — leva alguns minutos.');
    try {
      const r = await installationPendingsApi.sync();
      toast.success(
        `${r.total} pendências atualizadas (${r.tracker} rastreador, ${r.tag} TAG) em ${r.duration}`,
      );
      await load();
      setCities(await installationPendingsApi.getCities());
    } catch {
      toast.error('Falha ao sincronizar com o SGA');
    } finally {
      setSyncing(false);
    }
  }

  async function handleExport() {
    try {
      const blob = await installationPendingsApi.exportXlsx(filters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pendentes-instalacao-${days}dias.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Falha ao exportar');
    }
  }

  return (
    <div className="flex flex-col h-full p-4 md:p-6 gap-4 overflow-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-brand-orange-500" />
            Pendentes de Instalação
          </h1>
          <p className="text-sm text-muted-foreground">
            Rastreadores e TAGs contratados no SGA que ainda não foram instalados
            {stats?.lastSyncAt && ` · atualizado ${formatRelativeTime(stats.lastSyncAt)}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!rows.length}>
            <Download className="h-4 w-4" />
            Exportar
          </Button>
          <Button size="sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
            {syncing ? 'Sincronizando...' : 'Atualizar do SGA'}
          </Button>
        </div>
      </div>

      {/* Totais */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total pendente"
          value={String(stats?.total ?? 0)}
          hint={`Contratos dos últimos ${days} dias`}
          icon={ClipboardList}
          destaque
        />
        <StatCard
          label="Rastreador"
          value={String(stats?.tracker ?? 0)}
          hint="Aguardando instalação"
          icon={Radio}
        />
        <StatCard
          label="TAG"
          value={String(stats?.tag ?? 0)}
          hint="Aguardando instalação"
          icon={Tag}
        />
        <StatCard
          label="Patrimônio exposto"
          value={moeda(stats?.exposedValue ?? 0)}
          hint="Valor protegido sem equipamento"
          icon={Wallet}
        />
      </div>

      {/* Filtros */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Placa, nome ou CPF..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <SelectNative value={type} onChange={(e) => setType(e.target.value as PendingType | '')}>
          <option value="">Rastreador e TAG</option>
          <option value="TRACKER">Só rastreador</option>
          <option value="TAG">Só TAG</option>
        </SelectNative>
        <SelectNative value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
          <option value="30">Últimos 30 dias</option>
          <option value="60">Últimos 60 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="3650">Todo o histórico</option>
        </SelectNative>
        <SelectNative value={city} onChange={(e) => setCity(e.target.value)}>
          <option value="">Todas as cidades</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </SelectNative>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ClipboardList className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhuma pendência nesse filtro</p>
            <p className="text-xs text-muted-foreground mt-1">
              Se a fila nunca foi carregada, clique em <strong>Atualizar do SGA</strong>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Prioridade</th>
                  <th className="px-3 py-2 text-left font-medium">Pendência</th>
                  <th className="px-3 py-2 text-left font-medium">Placa</th>
                  <th className="px-3 py-2 text-left font-medium">Cliente</th>
                  <th className="px-3 py-2 text-left font-medium">Veículo</th>
                  <th className="px-3 py-2 text-left font-medium">Local</th>
                  <th className="px-3 py-2 text-right font-medium">Valor protegido</th>
                  <th className="px-3 py-2 text-right font-medium">Parado há</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((p) => {
                  const prioridade = prioridadeDe(p);
                  const estilo = PRIORIDADE_ESTILO[prioridade];
                  return (
                    <tr key={p.id} className="hover:bg-muted/20">
                      <td className="px-3 py-2">
                        <Badge className={cn('border text-[10px]', estilo.classe)}>
                          {estilo.label}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          {p.pendingType === 'TRACKER' ? (
                            <Radio className="h-3.5 w-3.5 text-brand-orange-500" />
                          ) : (
                            <Tag className="h-3.5 w-3.5 text-sky-400" />
                          )}
                          {p.pendingType === 'TRACKER' ? 'Rastreador' : 'TAG'}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono font-semibold">{p.plate}</td>
                      <td className="px-3 py-2">
                        <p className="font-medium">{p.associateName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatCpf(p.cpf)}
                          {p.phone && (
                            <span className="inline-flex items-center gap-1 ml-2">
                              <Phone className="h-3 w-3" />
                              {p.phone}
                            </span>
                          )}
                        </p>
                      </td>
                      <td className="px-3 py-2 max-w-[280px]">
                        <p className="truncate" title={p.brandModel}>
                          {p.brandModel}
                        </p>
                        {p.vehicleType && (
                          <p className="text-xs text-muted-foreground truncate">
                            {p.vehicleType}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {p.city && (
                          <span className="inline-flex items-center gap-1 text-xs">
                            <MapPin className="h-3 w-3 text-muted-foreground" />
                            {p.city}
                          </span>
                        )}
                        {p.neighborhood && (
                          <p className="text-xs text-muted-foreground">{p.neighborhood}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {moeda(p.protectedValue)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span
                          className={cn(
                            'font-semibold',
                            p.daysPending > DIAS_ATRASADO && 'text-amber-400',
                          )}
                        >
                          {p.daysPending}d
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {p.contractDate.split('-').reverse().join('/')}
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Mostrando {rows.length} pendências. Ordem: maior valor protegido primeiro,
          desempatando pelo que está parado há mais tempo.
        </p>
      )}
    </div>
  );
}
