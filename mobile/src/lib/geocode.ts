import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

// Reverse geocoding (coordenada -> nome da rua) client-side.
// No iOS usa o CLGeocoder da Apple, que NÃO exige permissão de localização
// (só traduz uma coordenada em endereço; não acessa a posição do aparelho).
// Cache em memória por coordenada arredondada (~11 m) pra evitar refazer a
// mesma consulta a cada polling.
const cache = new Map<string, string | null>();

function key(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<string | null> {
  const k = key(lat, lng);
  if (cache.has(k)) return cache.get(k) ?? null;
  try {
    const results = await Location.reverseGeocodeAsync({
      latitude: lat,
      longitude: lng,
    });
    const r = results[0];
    if (!r) {
      cache.set(k, null);
      return null;
    }
    // "Rua, Nº · Bairro · Cidade — UF" — mesma riqueza de detalhe do dashboard.
    const street = [r.street, r.streetNumber].filter(Boolean).join(', ');
    const neighborhood = r.district || r.subregion || null;
    const city = r.city || r.subregion || null;
    const uf = r.region || null;
    const cityUf = [city, uf].filter(Boolean).join(' — ');
    const label =
      [street || r.name, neighborhood, cityUf].filter(Boolean).join(' · ') ||
      r.city ||
      null;
    cache.set(k, label);
    return label;
  } catch {
    return null;
  }
}

/** Hook: devolve o endereço da coordenada, atualizando quando ela muda. */
export function useAddress(lat?: number | null, lng?: number | null): string | null {
  const [address, setAddress] = useState<string | null>(null);
  const rk = lat != null && lng != null ? key(lat, lng) : null;
  useEffect(() => {
    if (lat == null || lng == null) {
      setAddress(null);
      return;
    }
    let alive = true;
    reverseGeocode(lat, lng).then((a) => {
      if (alive) setAddress(a);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rk]);
  return address;
}
