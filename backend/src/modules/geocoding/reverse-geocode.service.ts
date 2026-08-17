import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Transforma coordenada em endereço que o operador lê.
 *
 * Existe porque o Traccar entrega latitude/longitude e nada mais — o campo
 * `address` das posições está vazio em 100% do que já foi gravado. Saber que o
 * rastreador está na "Estrada do Magarça, Guaratiba" é o que responde a
 * pergunta "onde ele está?" antes de instalar; um par de números não responde.
 *
 * Como funciona: quem chama pede o cache (`lookupCached`) e recebe na hora só o
 * que já foi resolvido antes. As coordenadas que faltam entram numa fila que
 * roda em segundo plano, uma por segundo — é o limite que a política de uso do
 * Nominatim (OpenStreetMap) impõe. Como a tela recarrega sozinha a cada 15s, o
 * endereço aparece na atualização seguinte sem nunca segurar a requisição.
 */
@Injectable()
export class ReverseGeocodeService {
  private readonly logger = new Logger(ReverseGeocodeService.name);

  /**
   * ~110 m por célula.
   *
   * Começou em 4 casas (~11 m) e isso funcionava só pra equipamento parado:
   * rastreador andando muda de coordenada a cada envio, cada uma virava uma
   * chave nova, e o endereço nunca chegava a aparecer — o operador via
   * "ONLINE" com o campo de endereço vazio. Com célula de ~110 m o mesmo
   * quarteirão reaproveita o endereço já resolvido.
   */
  private static readonly CASAS_DECIMAIS = 3;

  /** Política do OSM: no máximo uma chamada por segundo, com User-Agent seu. */
  private static readonly INTERVALO_MS = 1_100;

  /** Teto por rodada — a fila não pode crescer sem fim se o parque inteiro ligar. */
  private static readonly FILA_MAX = 2_000;

  private static readonly URL = 'https://nominatim.openstreetmap.org/reverse';
  private static readonly USER_AGENT =
    '21GO-Rastreamento/1.0 (https://trackgo.site)';

  private readonly fila = new Map<string, Coordenada>();
  private processando = false;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Endereços já conhecidos das coordenadas pedidas. O que não estiver aqui
   * entra na fila e aparece numa próxima chamada.
   */
  async lookupCached(
    coordenadas: Coordenada[],
  ): Promise<Map<string, string>> {
    const chaves = new Map<string, Coordenada>();
    for (const coord of coordenadas) {
      const chave = this.chave(coord);
      if (chave) chaves.set(chave, this.arredondar(coord));
    }
    if (chaves.size === 0) return new Map();

    const achados = await this.prisma.geoAddress.findMany({
      where: {
        OR: [...chaves.values()].map((c) => ({
          latKey: c.latitude,
          lngKey: c.longitude,
        })),
      },
      select: { latKey: true, lngKey: true, address: true },
    });

    const resultado = new Map<string, string>();
    for (const achado of achados) {
      resultado.set(
        this.chaveDeValores(achado.latKey, achado.lngKey)!,
        achado.address,
      );
    }

    for (const [chave, coord] of chaves) {
      if (!resultado.has(chave)) this.enfileirar(chave, coord);
    }

    return resultado;
  }

  /** Chave do cache pra uma coordenada crua — quem chama usa pra ler o Map. */
  chave(coord: Coordenada): string | null {
    const { latitude, longitude } = this.arredondar(coord);
    return this.chaveDeValores(latitude, longitude);
  }

  private chaveDeValores(lat: number, lng: number): string | null {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return `${lat},${lng}`;
  }

  private arredondar(coord: Coordenada): Coordenada {
    const fator = 10 ** ReverseGeocodeService.CASAS_DECIMAIS;
    return {
      latitude: Math.round(coord.latitude * fator) / fator,
      longitude: Math.round(coord.longitude * fator) / fator,
    };
  }

  private enfileirar(chave: string, coord: Coordenada): void {
    if (this.fila.has(chave)) return;
    if (this.fila.size >= ReverseGeocodeService.FILA_MAX) return;
    this.fila.set(chave, coord);
    void this.processarFila();
  }

  private async processarFila(): Promise<void> {
    if (this.processando) return;
    this.processando = true;
    try {
      while (this.fila.size > 0) {
        const [chave, coord] = this.fila.entries().next().value as [
          string,
          Coordenada,
        ];
        this.fila.delete(chave);
        await this.resolver(coord);
        await new Promise((r) =>
          setTimeout(r, ReverseGeocodeService.INTERVALO_MS),
        );
      }
    } finally {
      this.processando = false;
    }
  }

  /** Uma chamada ao Nominatim. Falha aqui não estoura pra tela — fica sem endereço. */
  private async resolver(coord: Coordenada): Promise<void> {
    const url =
      `${ReverseGeocodeService.URL}?format=jsonv2&zoom=18&addressdetails=1` +
      `&lat=${coord.latitude}&lon=${coord.longitude}`;

    try {
      const resposta = await fetch(url, {
        headers: {
          'User-Agent': ReverseGeocodeService.USER_AGENT,
          'Accept-Language': 'pt-BR',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!resposta.ok) {
        this.logger.warn(
          `Nominatim respondeu ${resposta.status} para ${coord.latitude},${coord.longitude}`,
        );
        return;
      }

      const corpo = (await resposta.json()) as NominatimResposta;
      const endereco = formatarEndereco(corpo);
      if (!endereco) return;

      await this.prisma.geoAddress.upsert({
        where: {
          latKey_lngKey: { latKey: coord.latitude, lngKey: coord.longitude },
        },
        create: {
          latKey: coord.latitude,
          lngKey: coord.longitude,
          address: endereco,
        },
        update: { address: endereco },
      });
    } catch (erro) {
      this.logger.warn(
        `Não consegui o endereço de ${coord.latitude},${coord.longitude}: ${
          erro instanceof Error ? erro.message : erro
        }`,
      );
    }
  }
}

export interface Coordenada {
  latitude: number;
  longitude: number;
}

interface NominatimResposta {
  display_name?: string;
  address?: Record<string, string | undefined>;
}

/**
 * "Estrada do Magarça - Guaratiba, Rio de Janeiro - RJ".
 *
 * Mesmo formato da referência: rua - bairro, cidade - UF. Cada pedaço que
 * faltar simplesmente sai, sem deixar hífen solto.
 */
export function formatarEndereco(corpo: NominatimResposta): string | null {
  const a = corpo.address ?? {};
  const rua = a.road ?? a.pedestrian ?? a.footway ?? a.neighbourhood ?? null;
  const bairro = a.suburb ?? a.city_district ?? a.village ?? null;
  const cidade = a.city ?? a.town ?? a.municipality ?? a.county ?? null;
  const uf = siglaEstado(a.state, a['ISO3166-2-lvl4']);

  const inicio = [rua, bairro].filter(Boolean).join(' - ');
  const fim = [cidade, uf].filter(Boolean).join(' - ');
  const completo = [inicio, fim].filter(Boolean).join(', ');

  if (completo) return completo;
  return corpo.display_name ?? null;
}

/** "BR-RJ" (padrão ISO do Nominatim) vira "RJ". */
function siglaEstado(
  estado: string | undefined,
  iso: string | undefined,
): string | null {
  if (iso && iso.includes('-')) return iso.split('-').pop() ?? null;
  return estado ?? null;
}
