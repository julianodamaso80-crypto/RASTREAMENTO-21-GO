import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';

export type MapBasemapType = 'satellite' | 'roadmap';

const CREATE_SESSION_URL = 'https://tile.googleapis.com/v1/createSession';
const TILE_URL = 'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}';
const VIEWPORT_URL = 'https://tile.googleapis.com/tile/v1/viewport';

/** Renova a sessão 24h antes de expirar — o token do Google dura ~2 semanas. */
const RENEW_MARGIN_MS = 24 * 60 * 60 * 1000;

interface GoogleSessionResponse {
  session: string;
  expiry: string; // epoch em segundos, como string
  tileWidth: number;
  tileHeight: number;
  imageFormat: string;
}

interface CachedSession {
  token: string;
  tileSize: number;
  expiresAt: number;
}

export interface MapTileSource {
  provider: 'google';
  tiles: string[];
  /** Área coberta por tile em CSS px. Com highDpi a imagem vem 2x maior. */
  tileSize: number;
  /**
   * Abaixo deste zoom o mapa usa o Esri (grátis). Medição de uma sessão real
   * de operador: 31% dos tiles ficam em z>=20 — é só nessa faixa que o Esri
   * não tem imagery e o Google faz diferença. Cobrar só aí corta ~2/3 da conta.
   */
  minzoom: number;
  maxzoom: number;
  attribution: string;
  expiresAt: number;
}

/**
 * Integração com a Map Tiles API (2D) do Google.
 *
 * Por que não usar o Maps JavaScript API: o mapa inteiro do dashboard é
 * MapLibre (markers, geofences, rotas, replay). Consumir só os tiles mantém
 * todo esse código intacto e é permitido pela política do Google para
 * renderizadores de terceiros — desde que o logo e a atribuição apareçam.
 *
 * Regras da política que o código respeita:
 * - Sem cache/persistência dos tiles (proxy só do token, nunca da imagem).
 * - Atribuição do viewport buscada dinamicamente (getViewportAttribution).
 */
@Injectable()
export class MapService {
  private readonly logger = new Logger(MapService.name);
  private readonly apiKey = process.env.GOOGLE_MAPS_API_KEY ?? '';
  private readonly highDpi = process.env.GOOGLE_MAPS_HIGH_DPI !== 'false';
  /**
   * 0 = Google em todos os zooms. É o default desde que o satélite do Google
   * virou um botão próprio: quem clica nele quer a imagem dele, e ver a foto
   * velha esticada parece defeito. Quem quer economizar usa "Satélite grátis".
   * Subir pra 20 volta a cobrar só onde o Esri não tem imagery.
   */
  private readonly minZoom = Number(process.env.GOOGLE_MAPS_MIN_ZOOM ?? 0);
  /**
   * A chave deve ser restrita a "Websites" no Google Cloud, senão vaza pela
   * URL do tile. Só que essa restrição olha o header Referer, que servidor
   * nenhum manda sozinho — sem isto o createSession leva 403 mesmo com a
   * chave certa. Aqui o backend se identifica com o mesmo domínio do painel.
   */
  private readonly referrer = process.env.GOOGLE_MAPS_REFERRER ?? 'https://trackgo.site/';
  private readonly sessions = new Map<MapBasemapType, CachedSession>();
  private readonly inFlight = new Map<MapBasemapType, Promise<CachedSession>>();

  get isEnabled(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Devolve o source raster pronto pro MapLibre. O front cai no Esri quando
   * isto lança — mapa nunca pode ficar em branco.
   */
  async getTileSource(type: MapBasemapType): Promise<MapTileSource> {
    const session = await this.getSession(type);

    return {
      provider: 'google',
      tiles: [`${TILE_URL}?session=${session.token}&key=${this.apiKey}`],
      // A imagem highDpi vem 512px cobrindo a mesma área de um tile 256:
      // declarar 256 mantém o nível de zoom certo e dobra a nitidez em tela retina.
      tileSize: 256,
      minzoom: Number.isFinite(this.minZoom) ? this.minZoom : 20,
      maxzoom: 22,
      attribution: 'Google',
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Atribuição obrigatória do viewport atual. Segundo a doc, esta chamada
   * não consome cota de tiles.
   */
  async getViewportAttribution(params: {
    zoom: number;
    north: number;
    south: number;
    east: number;
    west: number;
  }): Promise<{ copyright: string; maxZoomRects?: unknown[] }> {
    const session = await this.getSession('satellite');

    const { data } = await axios.get(VIEWPORT_URL, {
      params: { session: session.token, key: this.apiKey, ...params },
      headers: { Referer: this.referrer },
      timeout: 10_000,
    });

    return { copyright: data?.copyright ?? 'Google', maxZoomRects: data?.maxZoomRects };
  }

  private async getSession(type: MapBasemapType): Promise<CachedSession> {
    if (!this.isEnabled) {
      throw new ServiceUnavailableException(
        'GOOGLE_MAPS_API_KEY não configurada — satélite do Google indisponível',
      );
    }

    const cached = this.sessions.get(type);
    if (cached && cached.expiresAt - RENEW_MARGIN_MS > Date.now()) return cached;

    // Sem lock, um pico de requests criaria N sessões desnecessárias.
    const pending = this.inFlight.get(type);
    if (pending) return pending;

    const promise = this.createSession(type).finally(() => this.inFlight.delete(type));
    this.inFlight.set(type, promise);
    return promise;
  }

  private async createSession(type: MapBasemapType): Promise<CachedSession> {
    try {
      const { data } = await axios.post<GoogleSessionResponse>(
        CREATE_SESSION_URL,
        {
          mapType: type,
          language: 'pt-BR',
          region: 'BR',
          // satélite + layerRoadmap = híbrido (imagem com ruas e rótulos),
          // que é o visual do concorrente.
          ...(type === 'satellite' ? { layerTypes: ['layerRoadmap'] } : {}),
          ...(this.highDpi ? { highDpi: true, scale: 'scaleFactor2x' } : {}),
        },
        {
          params: { key: this.apiKey },
          headers: { Referer: this.referrer },
          timeout: 15_000,
        },
      );

      const session: CachedSession = {
        token: data.session,
        tileSize: data.tileWidth ?? 256,
        expiresAt: Number(data.expiry) * 1000,
      };

      this.sessions.set(type, session);
      this.logger.log(
        `Sessão Google Tiles (${type}) criada — expira em ${new Date(session.expiresAt).toISOString()}`,
      );
      return session;
    } catch (error) {
      const detail =
        axios.isAxiosError(error) && error.response
          ? `${error.response.status} ${JSON.stringify(error.response.data)}`
          : (error as Error).message;
      this.logger.error(`Falha ao criar sessão Google Tiles (${type}): ${detail}`);
      throw new ServiceUnavailableException('Não foi possível iniciar a sessão de mapa do Google');
    }
  }
}
