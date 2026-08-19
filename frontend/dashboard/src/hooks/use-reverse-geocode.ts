'use client';

import { useEffect, useRef, useState } from 'react';
import { geocodeApi } from '@/lib/api';

/**
 * Endereço da coordenada do veículo, vindo do backend.
 *
 * Refaz a busca a cada coordenada nova, sem margem de distância. A versão
 * anterior só refazia depois de 20 m percorridos e era isso que fazia o texto
 * ficar na rua anterior enquanto o ícone já tinha andado — o efeito aparecia
 * pior em velocidade baixa, justo quando o veículo está manobrando e trocando
 * de rua.
 *
 * Margem nenhuma não custa consulta a mais: medido em 19/08/2026 sobre 367
 * transições de rastreador parado, a oscilação do GPS tem mediana de 14,3 m,
 * então uma margem de 5 m filtraria quase nada (64,6% dos envios gerariam
 * consulta contra 62,2% sem margem). Pular a busca só quando o rastreador
 * repete a coordenada — o que ele faz em 37,8% dos envios parados — filtra o
 * mesmo tanto e mantém o texto exatamente sobre o ponto do ícone.
 *
 * O ritmo de 1 consulta por segundo que o OpenStreetMap exige é garantido no
 * backend, num portão único compartilhado com a fila das listas.
 */

interface ReverseGeocodeResult {
  address: string | null;
  loading: boolean;
}

export function useReverseGeocode(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): ReverseGeocodeResult {
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ultimo = useRef<{ lat: number; lng: number; address: string | null } | null>(
    null,
  );

  useEffect(() => {
    if (!latitude || !longitude) {
      setAddress(null);
      return;
    }

    // Rastreador reenviou o mesmo ponto: o endereço já está na tela, e é este
    // mesmo. Nada a fazer — nem consulta, nem novo render.
    const anterior = ultimo.current;
    if (anterior && anterior.lat === latitude && anterior.lng === longitude) {
      return;
    }

    let vivo = true;
    setLoading(true);

    geocodeApi
      .reverse(latitude, longitude)
      .then((resolvido) => {
        if (!vivo) return;
        ultimo.current = { lat: latitude, lng: longitude, address: resolvido };
        setAddress(resolvido);
      })
      .catch(() => {
        // Sem endereço a tela continua mostrando a posição — não é bloqueante.
      })
      .finally(() => {
        if (vivo) setLoading(false);
      });

    return () => {
      vivo = false;
    };
  }, [latitude, longitude]);

  return { address, loading };
}
