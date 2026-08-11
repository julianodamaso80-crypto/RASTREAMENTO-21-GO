'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { clientsApi } from '@/lib/api';
import type { AssetsSummary } from '@/types/assets';

const SEMANAS = [
  { value: 0, label: 'Esta semana' },
  { value: 1, label: 'Semana anterior' },
  { value: 2, label: 'Duas semanas atrás' },
  { value: 3, label: 'Três semanas atrás' },
  { value: 4, label: 'Quatro semanas atrás' },
];

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Composição da frota e ritmo de instalação. */
export function AssetsAnalytics() {
  const [summary, setSummary] = useState<AssetsSummary | null>(null);
  const [semana, setSemana] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [diaAberto, setDiaAberto] = useState<number>(new Date().getDay());

  useEffect(() => {
    setCarregando(true);
    clientsApi
      .getAssetsSummary(semana)
      .then(setSummary)
      .catch(() => toast.error('Não consegui carregar as análises.'))
      .finally(() => setCarregando(false));
  }, [semana]);

  if (carregando && !summary) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }
  if (!summary) return null;

  const dia = summary.week.days[diaAberto];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Composição da frota */}
      <Card>
        <CardContent className="p-4">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Quantidade por tipo do ativo
          </h2>

          <ul className="mt-3 space-y-3">
            {summary.byType.map((t) => (
              <li key={t.type} className="flex items-center gap-3">
                <Image
                  src={
                    t.type === 'MOTORCYCLE'
                      ? '/markers/moto-top.png'
                      : '/markers/car-top.png'
                  }
                  alt=""
                  width={28}
                  height={28}
                  className="h-7 w-7 shrink-0 object-contain"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {t.type === 'MOTORCYCLE' ? 'Moto' : 'Carro'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Representam {t.pct.toFixed(1)}% da frota
                  </p>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-brand-orange-500"
                      style={{ width: `${t.pct}%` }}
                    />
                  </div>
                </div>
                <strong className="text-lg tabular-nums">{t.count}</strong>
              </li>
            ))}
            {summary.byType.length === 0 && (
              <li className="py-6 text-center text-sm text-muted-foreground">
                Nenhum ativo instalado ainda.
              </li>
            )}
          </ul>

          <p className="mt-4 border-t pt-3 text-lg font-bold">
            {summary.total} {summary.total === 1 ? 'ativo' : 'ativos'}
          </p>
        </CardContent>
      </Card>

      {/* Ritmo de instalação */}
      <Card>
        <CardContent className="p-4">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Instalações nos últimos 6 meses
          </h2>
          <MiniBarras data={summary.byMonth} />

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <h3 className="text-sm font-semibold text-muted-foreground">
              Instalações realizadas em:
            </h3>
            <select
              className="h-8 rounded-md border bg-background px-2 text-xs"
              value={semana}
              onChange={(e) => {
                setSemana(Number(e.target.value));
                setDiaAberto(new Date().getDay());
              }}
            >
              {SEMANAS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <p className="mt-2 text-2xl font-bold">
            {summary.week.total}{' '}
            <span className="text-sm font-normal text-muted-foreground">
              {summary.week.total === 1
                ? 'instalação realizada'
                : 'instalações realizadas'}
            </span>
          </p>

          <div className="mt-3 flex gap-1">
            {summary.week.days.map((d, i) => (
              <button
                key={d.date}
                type="button"
                onClick={() => setDiaAberto(i)}
                className={cn(
                  'flex-1 rounded-md border px-1 py-1.5 text-center text-xs transition-colors',
                  i === diaAberto
                    ? 'border-brand-orange-500 bg-brand-orange-500/10 text-brand-orange-400'
                    : 'text-muted-foreground hover:bg-muted/50',
                )}
              >
                <span className="block">{DIAS[i]}</span>
                <span className="block font-semibold tabular-nums">
                  {d.count}
                </span>
              </button>
            ))}
          </div>

          {dia && (
            <div className="mt-3">
              <p className="text-xs font-semibold">
                {dia.count} {dia.count === 1 ? 'ativo' : 'ativos'} ·{' '}
                {new Date(dia.date).toLocaleDateString('pt-BR', {
                  weekday: 'short',
                  day: '2-digit',
                  month: '2-digit',
                })}
              </p>
              <ul className="mt-2 max-h-56 space-y-2 overflow-auto pr-1">
                {dia.items.map((item) => (
                  <li
                    key={item.vehicleId}
                    className="rounded-md border bg-muted/20 p-2 text-xs"
                  >
                    <p className="font-medium">
                      {[item.brand, item.model].filter(Boolean).join(' ') ||
                        'Modelo não informado'}{' '}
                      <span className="font-mono text-muted-foreground">
                        {item.plate}
                      </span>
                    </p>
                    <p className="font-mono text-muted-foreground">
                      {item.imei}
                    </p>
                    {item.associateName && (
                      <p className="text-muted-foreground">
                        {item.associateName}
                      </p>
                    )}
                  </li>
                ))}
                {dia.items.length === 0 && (
                  <li className="py-4 text-center text-muted-foreground">
                    Nenhuma instalação neste dia.
                  </li>
                )}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Barras dos 6 meses. Sem biblioteca de gráfico: são seis números, e um
 * `div` com altura proporcional conta a mesma história.
 */
function MiniBarras({ data }: { data: Array<{ month: string; count: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <div className="mt-3 flex h-28 items-end gap-2">
      {data.map((d) => (
        <div key={d.month} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-xs font-medium tabular-nums">{d.count}</span>
          <div
            className="w-full rounded-t bg-brand-orange-500/70"
            style={{ height: `${Math.max(4, (d.count / max) * 72)}px` }}
            title={`${d.count} instalações`}
          />
          <span className="text-[10px] text-muted-foreground">
            {rotuloMes(d.month)}
          </span>
        </div>
      ))}
    </div>
  );
}

function rotuloMes(month: string): string {
  const [ano, mes] = month.split('-').map(Number);
  if (!ano || !mes) return month;
  return new Date(ano, mes - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'short' })
    .replace('.', '');
}
