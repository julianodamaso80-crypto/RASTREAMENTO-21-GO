'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Bluetooth, Clock, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, formatRelativeTime } from '@/lib/utils';

/**
 * Onde a TAG foi vista pela última vez.
 *
 * Tela separada do `/mapa` de propósito: lá tudo é GPS ao vivo, aqui nada é.
 * A TAG só é vista quando alguém passa perto dela, e em 2 de cada 3 TAGs esse
 * avistamento tem mais de 30 dias. Misturar as duas coisas no mesmo mapa faria
 * o operador ler posição de meses atrás como se fosse agora — o erro que a
 * regra do projeto proíbe.
 *
 * Reusa o `TagTrailMap` (laranja, tracejado, círculo de precisão) com um único
 * ponto: a linguagem visual da TAG já está toda lá.
 */
const TagTrailMap = dynamic(
  () =>
    import('@/components/ble-tags/tag-trail-map').then((m) => ({
      default: m.TagTrailMap,
    })),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse bg-muted/30" />,
  },
);

/** Um mês. Acima disso a posição é histórico, não pista quente. */
const DIAS_FRIO = 30;
const DIAS_MORNO = 7;

function MapaDaTag() {
  const router = useRouter();
  const params = useSearchParams();

  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  const placa = params.get('placa') ?? '';
  const tag = params.get('tag') ?? '';
  const modelo = params.get('modelo') || 'TAG';
  const visto = params.get('visto');

  const temPonto = Number.isFinite(lat) && Number.isFinite(lng);
  const dias = visto
    ? (Date.now() - new Date(visto).getTime()) / 86_400_000
    : null;

  const corIdade =
    dias === null
      ? 'text-muted-foreground'
      : dias > DIAS_FRIO
        ? 'text-destructive'
        : dias > DIAS_MORNO
          ? 'text-amber-500'
          : 'text-brand-green-600';

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0"
            onClick={() => router.push('/tags-ativas')}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Voltar
          </Button>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 truncate font-semibold">
              <Bluetooth className="h-4 w-4 shrink-0 text-brand-orange-500" />
              {placa || 'Veículo sem placa'}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              <span>{modelo}</span>{' '}
              <span className="font-mono">{tag}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-sm">
          <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className={cn('font-medium', corIdade)}>
            {visto ? `vista ${formatRelativeTime(visto)}` : 'nunca foi vista'}
          </span>
        </div>
      </div>

      {/* O aviso fica FORA do mapa, sempre visível: não é rodapé de detalhe,
          é a diferença entre "o carro está aqui" e "o carro esteve aqui". */}
      {dias !== null && dias > DIAS_FRIO && (
        <p className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          Esta posição tem mais de {Math.floor(dias)} dias. É o último lugar
          onde alguém passou perto da TAG — não é onde o veículo está agora.
        </p>
      )}

      <div className="relative min-h-0 flex-1">
        {temPonto ? (
          <TagTrailMap
            segmentos={[
              {
                pontos: [
                  {
                    lat,
                    lng,
                    // A origem não informa o raio de confiança do avistamento;
                    // o mapa usa o padrão do componente em vez de inventar um.
                    accuracy: null,
                    seenAt: visto ?? new Date().toISOString(),
                    latenciaSeg: 0,
                  },
                ],
              },
            ]}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MapPin className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Esta TAG ainda não tem posição conhecida.
            </p>
          </div>
        )}
      </div>

      {temPonto && (
        <div className="flex items-center gap-1.5 border-t px-4 py-2 font-mono text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {lat.toFixed(6)}, {lng.toFixed(6)}
        </div>
      )}
    </div>
  );
}

export default function MapaDaTagPage() {
  // `useSearchParams` exige Suspense na rota — sem isso o build do Next falha.
  return (
    <Suspense fallback={<div className="h-full w-full animate-pulse bg-muted/30" />}>
      <MapaDaTag />
    </Suspense>
  );
}
