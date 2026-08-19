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
 *
 * O cache reaproveita endereço por PROXIMIDADE REAL, não por célula de grade.
 * A versão anterior arredondava a coordenada a 3 casas (~110 m) e devolvia o
 * endereço do centro da célula: em 2 de 5 posições reais medidas em 19/08/2026
 * isso trocava a rua, e numa delas trocava até o bairro (Barra da Tijuca virava
 * Recreio dos Bandeirantes). Era a causa de "o mapa mostra uma rua e o texto
 * mostra outra". Agora cada linha guarda a coordenada que foi de fato
 * geocodificada e só é reaproveitada para pontos a até TOLERANCIA_M dela.
 */
@Injectable()
export class ReverseGeocodeService {
  private readonly logger = new Logger(ReverseGeocodeService.name);

  /**
   * ~11 m por célula. A célula é só o índice que permite achar candidatos com
   * uma busca por igualdade (rápida, usa o índice único); quem decide se o
   * endereço serve é a distância real até a coordenada guardada, não a célula.
   */
  private static readonly CASAS_DECIMAIS = 4;

  /**
   * Distância máxima entre o ponto pedido e o ponto que gerou o endereço.
   *
   * 5 m, e o número é medido, não estimado. Em 19/08/2026 varri 5/10/15/20/25 m
   * ao norte e ao sul de três veículos reais no Rio e perguntei a rua ao
   * Nominatim em cada ponto: a 5 m nenhum dos seis casos mudou de rua, a 10 m
   * um mudou, e a partir de 15 m quatro mudaram. Malha urbana densa não perdoa
   * mais que isso.
   *
   * A tolerância anterior era 25 m e foi exatamente o que fez a tela mostrar
   * "Rua Cristóvão de Barros" para um veículo que estava na Rua Piraquara: a
   * entrada de cache estava a 17,2 m. Aumentar este número reabre esse bug.
   */
  private static readonly TOLERANCIA_M = 5;

  /** Alcance da varredura: a célula do ponto e as 8 vizinhas (~33 m de raio). */
  private static readonly VIZINHANCA = [-1, 0, 1];

  /** Política do OSM: no máximo uma chamada por segundo, com User-Agent seu. */
  private static readonly INTERVALO_MS = 1_100;

  /** Teto por rodada — a fila não pode crescer sem fim se o parque inteiro ligar. */
  private static readonly FILA_MAX = 2_000;

  /**
   * Quanto tempo parar de chamar depois de levar 429.
   *
   * Sem isto o serviço entra em ciclo vicioso, e foi o que aconteceu em
   * 19/08/2026: o 429 impede gravar o endereço, o ponto continua sem cache, a
   * tela recarrega em 15 s e o enfileira de novo, e a nova tentativa renova o
   * bloqueio. Foram 25 respostas 429 em 3 minutos sem nenhum endereço resolvido.
   */
  private static readonly BACKOFF_429_MS = 10 * 60_000;

  private static readonly URL = 'https://nominatim.openstreetmap.org/reverse';
  private static readonly USER_AGENT =
    '21GO-Rastreamento/1.0 (https://trackgo.site)';

  private readonly fila = new Map<string, Coordenada>();
  private processando = false;
  /** Instante em que o Nominatim pode ser chamado de novo. Ver `aguardarVez`. */
  private slotLivreEm = 0;
  /** Enquanto este instante não passar, ninguém fala com o Nominatim. Ver `resolver`. */
  private bloqueadoAte = 0;
  /** Quantos pedidos de tela estão esperando — a fila de fundo cede a vez. */
  private prioritarios = 0;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Endereços já conhecidos das coordenadas pedidas. O que não estiver aqui
   * entra na fila e aparece numa próxima chamada.
   */
  async lookupCached(
    coordenadas: Coordenada[],
    toleranciaM: number = ReverseGeocodeService.TOLERANCIA_M,
    enfileirarFaltantes = true,
  ): Promise<Map<string, string>> {
    /** Chave de grade do ponto pedido -> coordenada crua dele. */
    const pedidos = new Map<string, Coordenada>();
    for (const coord of coordenadas) {
      const chave = this.chave(coord);
      if (chave) pedidos.set(chave, coord);
    }
    if (pedidos.size === 0) return new Map();

    // Varre a célula do ponto e as 8 vizinhas: o endereço pode ter sido
    // resolvido a 12 m dali, do outro lado da borda da célula.
    const celulas = new Map<string, { latitude: number; longitude: number }>();
    const passo = 1 / 10 ** ReverseGeocodeService.CASAS_DECIMAIS;
    for (const coord of pedidos.values()) {
      const centro = this.arredondar(coord);
      for (const dl of ReverseGeocodeService.VIZINHANCA) {
        for (const dg of ReverseGeocodeService.VIZINHANCA) {
          const c = this.arredondar({
            latitude: centro.latitude + dl * passo,
            longitude: centro.longitude + dg * passo,
          });
          const k = this.chaveDeValores(c.latitude, c.longitude);
          if (k) celulas.set(k, { latitude: c.latitude, longitude: c.longitude });
        }
      }
    }

    const achados = await this.prisma.geoAddress.findMany({
      where: {
        OR: [...celulas.values()].map((c) => ({
          latKey: c.latitude,
          lngKey: c.longitude,
        })),
      },
      select: {
        latKey: true,
        lngKey: true,
        lat: true,
        lng: true,
        address: true,
      },
    });

    // Para cada ponto pedido, o endereço mais próximo dentro da tolerância.
    const resultado = new Map<string, string>();
    for (const [chave, coord] of pedidos) {
      let melhor: { distancia: number; address: string } | null = null;
      for (const achado of achados) {
        const distancia = distanciaMetros(
          coord.latitude,
          coord.longitude,
          achado.lat ?? achado.latKey,
          achado.lng ?? achado.lngKey,
        );
        if (distancia > toleranciaM) continue;
        if (!melhor || distancia < melhor.distancia) {
          melhor = { distancia, address: achado.address };
        }
      }
      if (melhor) resultado.set(chave, melhor.address);
      else if (enfileirarFaltantes) this.enfileirar(chave, coord);
    }

    return resultado;
  }

  /**
   * Endereço da coordenada exata, esperando a resposta.
   *
   * Existe para a tela que mostra UM ponto (o painel do veículo aberto no
   * mapa): ali dá para segurar a requisição, e o operador não pode ver o texto
   * de uma posição antiga enquanto o ícone já andou. O caminho em lote
   * (`lookupCached`) continua sendo o certo para listas.
   */
  async lookupNow(coord: Coordenada): Promise<string | null> {
    const chave = this.chave(coord);
    if (!chave) return null;

    // Tolerância ZERO: aqui o endereço vai aparecer ao lado da coordenada e do
    // ícone no mapa, então ele tem que ser desta coordenada, não de um vizinho.
    // Só reaproveita cache de coordenada idêntica — que é o caso do veículo
    // parado, cujo rastreador repete o mesmo par de números.
    // Sem enfileirar: quem resolve este ponto é a linha de baixo, agora. Deixar
    // `lookupCached` enfileirar também fazia a fila de fundo chamar o Nominatim
    // pelo MESMO ponto em paralelo — duas consultas para um endereço só, e o
    // dobro de consumo do limite do OpenStreetMap vindo do painel.
    const cache = await this.lookupCached([coord], 0, false);
    const doCache = cache.get(chave);
    if (doCache) return doCache;

    this.prioritarios++;
    try {
      return await this.resolver(coord);
    } finally {
      this.prioritarios--;
    }
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
        // Alguém está com o painel aberto esperando um endereço: a lista do
        // estoque pode esperar mais um instante, quem está olhando não.
        if (this.prioritarios > 0) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        const [chave, coord] = this.fila.entries().next().value as [
          string,
          Coordenada,
        ];
        this.fila.delete(chave);
        // O ritmo de 1 chamada por vez é do portão em `resolver`, que vale
        // também para os pedidos de tela — senão os dois caminhos somados
        // passariam do limite do OpenStreetMap.
        await this.resolver(coord);
      }
    } finally {
      this.processando = false;
    }
  }

  /**
   * Segura a chamada até o próximo horário livre.
   *
   * O OpenStreetMap permite uma consulta por segundo por aplicação, e existem
   * dois caminhos que chamam o Nominatim: a fila de fundo (listas) e o pedido
   * direto da tela (`lookupNow`). Antes cada um tinha seu próprio ritmo, então
   * somados podiam passar do limite e levar bloqueio. Agora os dois reservam
   * horário no mesmo portão.
   */
  private async aguardarVez(): Promise<void> {
    const { esperaMs, novoSlotLivreEm } = proximoSlot(
      Date.now(),
      this.slotLivreEm,
      ReverseGeocodeService.INTERVALO_MS,
    );
    this.slotLivreEm = novoSlotLivreEm;
    if (esperaMs > 0) await new Promise((r) => setTimeout(r, esperaMs));
  }

  /**
   * Uma chamada ao Nominatim, na coordenada EXATA. Falha aqui não estoura pra
   * tela — fica sem endereço.
   */
  private async resolver(coord: Coordenada): Promise<string | null> {
    // De castigo: insistir só renova o bloqueio e não resolve endereço nenhum.
    if (Date.now() < this.bloqueadoAte) return null;

    await this.aguardarVez();

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
      if (resposta.status === 429) {
        // O serviço pede para esperar; `Retry-After` vem em segundos quando vem.
        const pedido = Number(resposta.headers.get('retry-after')) * 1_000;
        const espera = Number.isFinite(pedido) && pedido > 0
          ? pedido
          : ReverseGeocodeService.BACKOFF_429_MS;
        this.bloqueadoAte = Date.now() + espera;
        // A fila acumulada seria só uma sequência de tentativas negadas.
        this.fila.clear();
        this.logger.warn(
          `Nominatim recusou por excesso de chamadas — pausando o geocoder por ${Math.round(
            espera / 1000,
          )}s e limpando a fila`,
        );
        return null;
      }
      if (!resposta.ok) {
        this.logger.warn(
          `Nominatim respondeu ${resposta.status} para ${coord.latitude},${coord.longitude}`,
        );
        return null;
      }

      const corpo = (await resposta.json()) as NominatimResposta;
      const endereco = formatarEndereco(corpo);
      if (!endereco) return null;

      const celula = this.arredondar(coord);
      await this.prisma.geoAddress.upsert({
        where: {
          latKey_lngKey: { latKey: celula.latitude, lngKey: celula.longitude },
        },
        create: {
          latKey: celula.latitude,
          lngKey: celula.longitude,
          lat: coord.latitude,
          lng: coord.longitude,
          address: endereco,
        },
        update: {
          lat: coord.latitude,
          lng: coord.longitude,
          address: endereco,
        },
      });
      return endereco;
    } catch (erro) {
      this.logger.warn(
        `Não consegui o endereço de ${coord.latitude},${coord.longitude}: ${
          erro instanceof Error ? erro.message : erro
        }`,
      );
      return null;
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

/**
 * Metros entre duas coordenadas (haversine). Precisão de sobra na escala de
 * dezenas de metros, que é onde a decisão de reaproveitar o cache acontece.
 */
export function distanciaMetros(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Quando a próxima chamada ao Nominatim pode sair.
 *
 * Pura de propósito: o ritmo de 1 por segundo é a regra que mais custa caro se
 * quebrar (bloqueio do OpenStreetMap para o projeto inteiro) e precisa de teste
 * sem depender de relógio.
 */
export function proximoSlot(
  agora: number,
  slotLivreEm: number,
  intervaloMs: number,
): { esperaMs: number; novoSlotLivreEm: number } {
  const inicio = Math.max(agora, slotLivreEm);
  return { esperaMs: inicio - agora, novoSlotLivreEm: inicio + intervaloMs };
}
