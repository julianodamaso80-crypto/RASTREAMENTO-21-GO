'use client';

import { useEffect, useRef, useState } from 'react';
import { geocodeApi } from '@/lib/api';

/**
 * Endereço da coordenada do veículo, vindo do backend.
 *
 * Antes o navegador chamava o Nominatim direto e só refazia a busca depois de
 * 50 m percorridos. Como os envios do rastreador chegam de 25 a 47 m um do
 * outro, o ícone andava e o texto continuava na rua anterior — era isso que
 * fazia o mapa e o endereço escrito discordarem. Além disso o formato aqui era
 * diferente do que o Estoque monta no servidor para a mesma posição.
 *
 * Agora existe uma fonte só: o backend, com o cache por proximidade real e a
 * fila de 1 req/s que a política do OpenStreetMap exige. Aqui fica apenas o
 * que é de tela — não refazer a busca enquanto o veículo não saiu do lugar.
 */

interface ReverseGeocodeResult {
  address: string | null;
  loading: boolean;
}

/**
 * Abaixo disso é o GPS parado oscilando, não o veículo andando. Acima, pode já
 * ser outra rua — e o backend tem a resposta em cache na maioria das vezes.
 */
const MIN_DESLOCAMENTO_M = 20;

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function useReverseGeocode(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): ReverseGeocodeResult {
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lastFetchRef = useRef<{ lat: number; lng: number; address: string | null } | null>(
    null,
  );

  useEffect(() => {
    if (!latitude || !longitude) {
      setAddress(null);
      return;
    }

    const last = lastFetchRef.current;
    if (last && distanceMeters(last.lat, last.lng, latitude, longitude) < MIN_DESLOCAMENTO_M) {
      setAddress(last.address);
      return;
    }

    let alive = true;
    setLoading(true);

    geocodeApi
      .reverse(latitude, longitude)
      .then((resolvido) => {
        if (!alive) return;
        lastFetchRef.current = { lat: latitude, lng: longitude, address: resolvido };
        setAddress(resolvido);
      })
      .catch(() => {
        // Sem endereço a tela continua mostrando a posição — não é bloqueante.
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [latitude, longitude]);

  return { address, loading };
}
