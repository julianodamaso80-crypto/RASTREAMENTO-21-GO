'use client';

import { useEffect, useState, useRef } from 'react';

/**
 * Reverse geocoding via Nominatim (OpenStreetMap). Free, sem API key.
 *
 * Limites a respeitar (https://operations.osmfoundation.org/policies/nominatim/):
 * - Máx 1 req/segundo por origin
 * - User-Agent identificador OBRIGATÓRIO
 * - Cache agressivo no cliente (não bater pra cada update WS)
 *
 * Estratégia de cache:
 * - Refaz fetch apenas se a coordenada mudou >50m (haversine simplificado).
 *   Em movimento contínuo isso significa ~1 fetch a cada 50m percorridos,
 *   bem abaixo do limite.
 */

interface ReverseGeocodeResult {
  address: string | null;
  loading: boolean;
}

// Haversine simplificado: distância em metros entre 2 coords (precisão suficiente <10km)
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Formata o `display_name` longo do Nominatim em algo legível.
 * Ex: "Rua X, Bairro, Município, RJ" em vez do endereço completo de 8 linhas.
 */
function formatAddress(data: NominatimResponse): string {
  const a = data.address || {};
  const street = a.road || a.pedestrian || a.footway;
  const neighborhood = a.suburb || a.neighbourhood || a.quarter;
  const city = a.city || a.town || a.village || a.municipality;
  const state = a.state_code || a.state;

  const parts: string[] = [];
  if (street) parts.push(street);
  if (neighborhood) parts.push(neighborhood);
  if (city) parts.push(city);
  if (state) parts.push(state);

  if (parts.length === 0) return data.display_name || '';
  return parts.join(', ');
}

interface NominatimResponse {
  display_name?: string;
  address?: {
    road?: string;
    pedestrian?: string;
    footway?: string;
    suburb?: string;
    neighbourhood?: string;
    quarter?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state?: string;
    state_code?: string;
  };
}

export function useReverseGeocode(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): ReverseGeocodeResult {
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lastFetchRef = useRef<{ lat: number; lng: number; address: string } | null>(null);

  useEffect(() => {
    if (!latitude || !longitude) {
      setAddress(null);
      return;
    }

    // Cache: se mudou <50m da última busca, reutiliza endereço anterior.
    const last = lastFetchRef.current;
    if (last) {
      const d = distanceMeters(last.lat, last.lng, latitude, longitude);
      if (d < 50) {
        setAddress(last.address);
        return;
      }
    }

    const controller = new AbortController();
    setLoading(true);

    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&accept-language=pt-BR&zoom=18`;

    fetch(url, {
      signal: controller.signal,
      headers: {
        // Nominatim exige User-Agent identificável.
        // Browser bloqueia setar User-Agent custom, mas adicionar Referer ajuda.
        'Accept': 'application/json',
      },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<NominatimResponse>;
      })
      .then((data) => {
        const formatted = formatAddress(data);
        lastFetchRef.current = { lat: latitude, lng: longitude, address: formatted };
        setAddress(formatted);
      })
      .catch(() => {
        // Silencioso — sem endereço é OK, exibimos só coordenadas
      })
      .finally(() => {
        setLoading(false);
      });

    return () => controller.abort();
  }, [latitude, longitude]);

  return { address, loading };
}
