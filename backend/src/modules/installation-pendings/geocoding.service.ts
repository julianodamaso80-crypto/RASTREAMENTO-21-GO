import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface Coordenada {
  lat: number;
  lng: number;
  source: 'awesomeapi' | 'nominatim';
}

export interface EnderecoParaGeocode {
  cep: string;
  street?: string | null;
  number?: string | null;
  city?: string | null;
  state?: string | null;
}

/**
 * Converte CEP em coordenada, com cache permanente em `cep_coordinates`.
 *
 * Primária: AwesomeAPI por CEP (testada 2026-07-23: 100% de cobertura na base,
 * nível de rua, grátis, sem chave). Fallback: Nominatim por rua+número (rate
 * limit 1 req/s, só pro resíduo que a AwesomeAPI não cobrir).
 *
 * BrasilAPI foi descartada: devolve cidade/bairro mas não coordenada.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  /** Educado com a AwesomeAPI: ~6 req/s. */
  private static readonly PAUSA_AWESOME_MS = 160;
  /** Nominatim exige no máximo 1 req/s. */
  private static readonly PAUSA_NOMINATIM_MS = 1100;
  private static readonly TIMEOUT_MS = 10_000;

  constructor(private prisma: PrismaService) {}

  private static normalizarCep(cep: string): string {
    return (cep || '').replace(/\D/g, '');
  }

  /**
   * Resolve uma lista de endereços, aproveitando o cache. Retorna um mapa
   * cep→coordenada com o que conseguiu. Best-effort: CEP que nenhuma fonte
   * resolve simplesmente não entra no mapa (o chamador trata como "sem local").
   */
  async resolverLote(
    enderecos: EnderecoParaGeocode[],
  ): Promise<Map<string, Coordenada>> {
    const porCep = new Map<string, EnderecoParaGeocode>();
    for (const e of enderecos) {
      const cep = GeocodingService.normalizarCep(e.cep);
      if (cep.length === 8 && !porCep.has(cep)) porCep.set(cep, e);
    }

    const resultado = new Map<string, Coordenada>();

    // 1) Cache
    const cacheados = await this.prisma.cepCoordinate.findMany({
      where: { cep: { in: [...porCep.keys()] } },
    });
    for (const c of cacheados) {
      resultado.set(c.cep, {
        lat: c.lat,
        lng: c.lng,
        source: c.source as Coordenada['source'],
      });
      porCep.delete(c.cep);
    }

    if (porCep.size === 0) return resultado;
    this.logger.log(`Geocoding: ${porCep.size} CEPs novos (cache cobriu ${cacheados.length}).`);

    // 2) Resolve os que faltam e grava no cache
    for (const [cep, endereco] of porCep) {
      const coord =
        (await this.viaAwesome(cep)) ?? (await this.viaNominatim(endereco));
      if (!coord) continue;

      resultado.set(cep, coord);
      try {
        await this.prisma.cepCoordinate.upsert({
          where: { cep },
          create: { cep, ...coord },
          update: {},
        });
      } catch {
        // corrida entre dois syncs: outro já gravou, tudo bem
      }
    }

    return resultado;
  }

  private async viaAwesome(cep: string): Promise<Coordenada | null> {
    await GeocodingService.dormir(GeocodingService.PAUSA_AWESOME_MS);
    try {
      const r = await fetch(`https://cep.awesomeapi.com.br/json/${cep}`, {
        signal: AbortSignal.timeout(GeocodingService.TIMEOUT_MS),
      });
      if (!r.ok) return null;
      const d = (await r.json()) as { lat?: string; lng?: string };
      const lat = Number(d.lat);
      const lng = Number(d.lng);
      if (!GeocodingService.coordValida(lat, lng)) return null;
      return { lat, lng, source: 'awesomeapi' };
    } catch {
      return null;
    }
  }

  private async viaNominatim(
    e: EnderecoParaGeocode,
  ): Promise<Coordenada | null> {
    if (!e.street) return null;
    await GeocodingService.dormir(GeocodingService.PAUSA_NOMINATIM_MS);
    try {
      const params = new URLSearchParams({
        format: 'json',
        limit: '1',
        country: 'Brazil',
        street: [e.number, e.street].filter(Boolean).join(' '),
        city: e.city ?? '',
        state: e.state ?? '',
      });
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?${params}`,
        {
          headers: { 'User-Agent': '21go-rota/1.0 (contato@trackgo.site)' },
          signal: AbortSignal.timeout(GeocodingService.TIMEOUT_MS),
        },
      );
      if (!r.ok) return null;
      const arr = (await r.json()) as Array<{ lat: string; lon: string }>;
      if (!arr.length) return null;
      const lat = Number(arr[0].lat);
      const lng = Number(arr[0].lon);
      if (!GeocodingService.coordValida(lat, lng)) return null;
      return { lat, lng, source: 'nominatim' };
    } catch {
      return null;
    }
  }

  /** Sanidade: dentro do bounding box aproximado do Brasil. */
  private static coordValida(lat: number, lng: number): boolean {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat < 6 &&
      lat > -34 &&
      lng < -34 &&
      lng > -74
    );
  }

  private static dormir(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
