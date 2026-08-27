'use client';

import { MapPin, Moon, ParkingCircle, Info } from 'lucide-react';
import type { InsightsResposta } from '@/types/ble-tag';
import { frasePernoite, fraseUltimaParada } from './tag-historico-frases';

/**
 * Histórico escrito da TAG.
 *
 * As frases moram em tag-historico-frases.ts — o vocabulário é regra, não
 * decoração, e tem teste próprio garantindo que ninguém escreva "motor
 * desligado" numa TAG que não tem ignição.
 */

function Cartao({
  icone,
  titulo,
  texto,
  destaque = false,
}: {
  icone: React.ReactNode;
  titulo: string;
  texto: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        destaque ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border'
      }`}
    >
      <h4 className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
        {icone}
        {titulo}
      </h4>
      <p className="text-sm leading-relaxed text-muted-foreground">{texto}</p>
    </div>
  );
}

interface TagInsightsPanelProps {
  data: InsightsResposta;
  /** Injetável para teste; na tela é sempre o relógio real. */
  agora?: Date;
}

export function TagInsightsPanel({ data, agora }: TagInsightsPanelProps) {
  const momento = agora ?? new Date();

  if (data.totalAvistamentos === 0) {
    return (
      <div className="rounded-lg border border-border p-4">
        <h4 className="mb-1.5 text-sm font-semibold">Sem histórico ainda</h4>
        <p className="text-sm text-muted-foreground">
          Nenhum avistamento nos últimos {data.janelaDias} dias. A TAG depende
          de um aparelho passar perto dela para ser localizada.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.ultimaParada && (
        <Cartao
          destaque
          icone={<ParkingCircle className="h-4 w-4 text-emerald-500" />}
          titulo="Onde parou por último"
          texto={fraseUltimaParada(data.ultimaParada, momento)}
        />
      )}

      {data.pernoite && (
        <Cartao
          icone={<Moon className="h-4 w-4 text-blue-400" />}
          titulo="Local de pernoite"
          texto={frasePernoite(data.pernoite)}
        />
      )}

      {data.locaisHabituais.length > 0 && (
        <div className="rounded-lg border border-border p-4">
          <h4 className="mb-2.5 flex items-center gap-2 text-sm font-semibold">
            <MapPin className="h-4 w-4 text-emerald-500" />
            Locais habituais
          </h4>
          <ul className="space-y-2.5">
            {data.locaisHabituais.map((h, i) => (
              <li key={`${h.centroLat}-${h.centroLng}-${i}`} className="text-sm">
                <span className="font-medium text-foreground">
                  {h.endereco ?? 'Local sem endereço identificado'}
                </span>
                <span className="block text-muted-foreground">
                  visto {h.totalAvistamentos}
                  {'×'} em {h.diasDistintos}{' '}
                  {h.diasDistintos === 1 ? 'dia' : 'dias'}
                  {h.faixaHorariaTexto && `, sobretudo entre ${h.faixaHorariaTexto}`}
                  {' '}({h.participacaoPct}% dos avistamentos)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Padrões observados nos últimos {data.janelaDias} dias, sobre{' '}
          {data.totalAvistamentos} avistamentos. A posição da TAG não é
          contínua: ela é vista quando um aparelho passa perto, então há
          intervalos sem informação.
        </span>
      </p>
    </div>
  );
}
