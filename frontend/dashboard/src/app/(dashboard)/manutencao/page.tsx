'use client';

import { useEffect, useState } from 'react';
import { Wrench, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { maintenanceApi, type MaintenancePlan } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type Severity = 'UPCOMING' | 'DUE' | 'OVERDUE' | null;

interface PlanRow extends MaintenancePlan {
  severity?: Severity;
  vehicle?: { plate: string };
}

const SEVERITY_LABEL: Record<NonNullable<Severity>, string> = {
  UPCOMING: 'Próxima',
  DUE: 'No prazo',
  OVERDUE: 'Vencida',
};

const SEVERITY_COLOR: Record<NonNullable<Severity>, string> = {
  UPCOMING: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  DUE: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
  OVERDUE: 'bg-red-500/15 text-red-500 border-red-500/30',
};

export default function ManutencaoPage() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = (await maintenanceApi.list()) as PlanRow[];
      setPlans(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleMarkDone(id: string) {
    await maintenanceApi.markDone(id);
    load();
  }

  const grouped = {
    overdue: plans.filter((p) => p.severity === 'OVERDUE'),
    due: plans.filter((p) => p.severity === 'DUE'),
    upcoming: plans.filter((p) => p.severity === 'UPCOMING'),
    ok: plans.filter((p) => !p.severity),
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wrench className="h-6 w-6 text-emerald-500" />
            Manutenção
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Planos preditivos por KM, horas de motor e tempo. Avaliado todo dia às 4h.
          </p>
        </div>

        {loading && <div className="text-sm text-muted-foreground">Carregando…</div>}
        {error && <div className="text-sm text-destructive">{error}</div>}

        {!loading && !error && (
          <>
            <div className="grid grid-cols-4 gap-3">
              <SummaryCard label="Vencidas" count={grouped.overdue.length} accent="text-red-500" />
              <SummaryCard label="No prazo" count={grouped.due.length} accent="text-orange-500" />
              <SummaryCard label="Próximas" count={grouped.upcoming.length} accent="text-amber-500" />
              <SummaryCard label="Em dia" count={grouped.ok.length} accent="text-emerald-500" />
            </div>

            {(['overdue', 'due', 'upcoming'] as const).map((bucket) => {
              const rows = grouped[bucket];
              if (rows.length === 0) return null;
              const sev = bucket.toUpperCase() as NonNullable<Severity>;
              return (
                <Card key={bucket}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      {bucket === 'overdue' ? (
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                      ) : (
                        <Clock className="h-4 w-4" />
                      )}
                      {SEVERITY_LABEL[sev]} ({rows.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {rows.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between border rounded-md p-3 text-sm"
                      >
                        <div className="flex-1">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {p.vehicle?.plate ?? '—'} ·{' '}
                            {p.intervalKm ? `${p.intervalKm} km` : ''}
                            {p.intervalEngineHours ? ` · ${p.intervalEngineHours} h motor` : ''}
                            {p.intervalMonths ? ` · ${p.intervalMonths} meses` : ''}
                          </div>
                        </div>
                        <Badge variant="outline" className={SEVERITY_COLOR[sev]}>
                          {SEVERITY_LABEL[sev]}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-3 gap-1"
                          onClick={() => handleMarkDone(p.id)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Marcar feito
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })}

            {grouped.ok.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    Em dia ({grouped.ok.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {grouped.ok.map((p) => (
                    <div key={p.id} className="text-sm flex justify-between py-1">
                      <span>
                        <span className="font-medium">{p.name}</span>
                        <span className="text-muted-foreground"> · {p.vehicle?.plate ?? '—'}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {p.lastDoneAt
                          ? `Último: ${new Date(p.lastDoneAt).toLocaleDateString('pt-BR')}`
                          : 'Sem registro'}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {plans.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p>Nenhum plano de manutenção cadastrado.</p>
                <p className="text-xs mt-1">Crie planos por veículo via API (UI de criação em breve).</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, count, accent }: { label: string; count: number; accent: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold tabular-nums ${accent}`}>{count}</div>
      </CardContent>
    </Card>
  );
}
