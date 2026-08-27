'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Bluetooth, RefreshCw, Navigation } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { bleTagsApi } from '@/lib/api';
import { TagTrailMap } from '@/components/ble-tags/tag-trail-map';
import { TagInsightsPanel } from '@/components/ble-tags/tag-insights-panel';
import type {
  BleTag,
  TrailResposta,
  InsightsResposta,
} from '@/types/ble-tag';

const PERIODOS = [
  { label: 'Hoje', dias: 1 },
  { label: '3 dias', dias: 3 },
  { label: '7 dias', dias: 7 },
];

const MODEL_LABELS: Record<string, string> = {
  BLE_KTAG: 'K-Tag',
  BLE_REDTAG: 'RedTag',
  BLE_AIRTAG_GENERIC: 'AirTag (genérica)',
};

export default function TagDetalhePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [dias, setDias] = useState(7);
  const [tag, setTag] = useState<BleTag | null>(null);
  const [trail, setTrail] = useState<TrailResposta | null>(null);
  const [insights, setInsights] = useState<InsightsResposta | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const desde = new Date(Date.now() - dias * 86400000).toISOString();
    const [t, tr, ins] = await Promise.allSettled([
      bleTagsApi.getById(id),
      bleTagsApi.getTrail(id, { from: desde }),
      bleTagsApi.getInsights(id, dias),
    ]);

    if (t.status === 'fulfilled') setTag(t.value);
    if (tr.status === 'fulfilled') setTrail(tr.value);
    if (ins.status === 'fulfilled') setInsights(ins.value);

    if (t.status === 'rejected') {
      toast.error('Não foi possível carregar esta TAG.');
    }
    setCarregando(false);
  }, [id, dias]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /**
   * Rota até o último avistamento. É o atalho de quem vai buscar o veículo:
   * abre o Google Maps traçando o caminho de onde a pessoa está até o ponto.
   */
  const ultimoPonto = trail?.segmentos.at(-1)?.pontos.at(-1) ?? null;
  function abrirRota() {
    if (!ultimoPonto) return;
    window.open(
      `https://www.google.com/maps/dir/My+Location/${ultimoPonto.lat},${ultimoPonto.lng}`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <Bluetooth className="h-5 w-5 text-emerald-500" />
              {tag?.vehicle?.plate ?? tag?.imei ?? 'TAG'}
            </h1>
            {tag && (
              <p className="text-sm text-muted-foreground">
                {MODEL_LABELS[tag.model] ?? tag.model} · {tag.imei}
                {tag.vehicle &&
                  ` · ${tag.vehicle.brand ?? ''} ${tag.vehicle.model ?? ''}`.trimEnd()}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {ultimoPonto && (
            <Button variant="outline" size="sm" onClick={abrirRota}>
              <Navigation className="mr-1.5 h-4 w-4" />
              Traçar rota até aqui
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void carregar()}
            disabled={carregando}
          >
            <RefreshCw
              className={`mr-1.5 h-4 w-4 ${carregando ? 'animate-spin' : ''}`}
            />
            Atualizar
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            {PERIODOS.map((p) => (
              <Button
                key={p.dias}
                variant={dias === p.dias ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDias(p.dias)}
              >
                {p.label}
              </Button>
            ))}
            {trail && (
              <Badge variant="secondary" className="ml-1">
                {trail.totalAvistamentos}{' '}
                {trail.totalAvistamentos === 1 ? 'avistamento' : 'avistamentos'}
              </Badge>
            )}
          </div>

          <div className="h-[480px]">
            {carregando && !trail ? (
              <Skeleton className="h-full w-full rounded-lg" />
            ) : trail && trail.totalAvistamentos > 0 ? (
              <TagTrailMap segmentos={trail.segmentos} />
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
                Nenhum avistamento no período escolhido. A TAG aparece no mapa
                quando um aparelho passa perto dela.
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            A linha é tracejada de propósito: entre um avistamento e o seguinte
            ninguém observou o caminho. Onde a TAG ficou sem ser vista, a linha
            quebra. O círculo em volta de cada ponto é o raio de precisão
            informado pela rede.
          </p>
        </div>

        <div className="lg:col-span-1">
          {carregando && !insights ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-32 w-full rounded-lg" />
            </div>
          ) : insights ? (
            <TagInsightsPanel data={insights} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Não foi possível carregar o histórico.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
