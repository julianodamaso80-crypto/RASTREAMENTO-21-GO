'use client';

import { useEffect, useState } from 'react';
import { Trophy, Gauge, AlertTriangle, MoonStar, Activity } from 'lucide-react';
import { scoringApi, type RankingRow } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

function scoreColor(score: number) {
  if (score >= 80) return 'text-emerald-500';
  if (score >= 60) return 'text-amber-500';
  if (score >= 40) return 'text-orange-500';
  return 'text-red-500';
}

function scoreBg(score: number) {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-amber-500';
  if (score >= 40) return 'bg-orange-500';
  return 'bg-red-500';
}

export default function CondutoresPage() {
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    scoringApi
      .ranking(100)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const avg = rows.length
    ? Math.round(rows.reduce((s, r) => s + r.totalScore, 0) / rows.length)
    : 0;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Trophy className="h-6 w-6 text-emerald-500" />
            Ranking de condutores
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Score 0-100 baseado em velocidade, frenagem, aceleração, idle, direção noturna e consistência.
            Recalculado todo dia às 5h sobre os últimos 30 dias.
          </p>
        </div>

        {loading && <div className="text-sm text-muted-foreground">Carregando…</div>}
        {error && <div className="text-sm text-destructive">{error}</div>}

        {!loading && !error && rows.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p>Nenhum score calculado ainda.</p>
            <p className="text-xs mt-1">
              Scores são gerados após o primeiro dia com posições persistidas.
            </p>
          </div>
        )}

        {!loading && !error && rows.length > 0 && (
          <>
            <div className="grid grid-cols-4 gap-3">
              <Summary label="Veículos" value={String(rows.length)} />
              <Summary label="Score médio" value={String(avg)} accent={scoreColor(avg)} />
              <Summary
                label="Top score"
                value={String(rows[0]?.totalScore ?? '—')}
                accent={scoreColor(rows[0]?.totalScore ?? 0)}
              />
              <Summary
                label="Menor score"
                value={String(rows[rows.length - 1]?.totalScore ?? '—')}
                accent={scoreColor(rows[rows.length - 1]?.totalScore ?? 0)}
              />
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Top {rows.length}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {rows.map((r, i) => (
                    <div key={r.vehicleId} className="border rounded-md p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 text-center text-sm font-semibold text-muted-foreground">
                          #{i + 1}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium">{r.plate}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.brand} {r.model} · {r.kmAnalyzed.toFixed(0)} km analisados
                          </div>
                        </div>
                        <div className={`text-2xl font-bold tabular-nums ${scoreColor(r.totalScore)}`}>
                          {r.totalScore}
                        </div>
                      </div>
                      <div className="mt-2">
                        <div className="h-1.5 bg-muted rounded overflow-hidden">
                          <div
                            className={`h-full ${scoreBg(r.totalScore)} transition-all`}
                            style={{ width: `${r.totalScore}%` }}
                          />
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-6 gap-2 text-[10px]">
                        <BreakdownCell icon={<Gauge className="h-3 w-3" />} label="Vel" value={r.breakdown.speed} />
                        <BreakdownCell
                          icon={<AlertTriangle className="h-3 w-3" />}
                          label="Freio"
                          value={r.breakdown.harshBrake}
                        />
                        <BreakdownCell
                          icon={<AlertTriangle className="h-3 w-3" />}
                          label="Acel"
                          value={r.breakdown.harshAccel}
                        />
                        <BreakdownCell
                          icon={<Activity className="h-3 w-3" />}
                          label="Idle"
                          value={r.breakdown.idle}
                        />
                        <BreakdownCell
                          icon={<MoonStar className="h-3 w-3" />}
                          label="Noite"
                          value={r.breakdown.night}
                        />
                        <BreakdownCell
                          icon={<Activity className="h-3 w-3" />}
                          label="Consist."
                          value={r.breakdown.consistency}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Summary({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold tabular-nums ${accent ?? ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function BreakdownCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-1 rounded bg-muted/40">
      <div className="flex items-center gap-1 text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <span className={`font-semibold ${scoreColor(value)}`}>{value}</span>
    </div>
  );
}
