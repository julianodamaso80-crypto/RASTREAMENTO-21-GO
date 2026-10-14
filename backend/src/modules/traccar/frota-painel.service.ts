import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheCompartilhado } from '../../common/cache/cache-compartilhado';
import {
  TraccarService,
  TraccarDevice,
  TraccarPosition,
} from './traccar.service';

export interface FrotaPainel {
  devices: TraccarDevice[];
  positions: TraccarPosition[];
  etagDevices: string;
  etagPositions: string;
  /** Início da busca mais antiga no Traccar que entrou nesta frota. */
  geradoEm: number;
  /** Erro original do Traccar; o controller de `/devices` relança. */
  erroDevices?: unknown;
  erroPositions?: unknown;
}

/** Resultado com erro volta a ser tentado logo, sem segurar a falha. */
const TTL_COM_ERRO_MS = 1_000;

function etagDe(tenantId: string, lista: unknown[]): string {
  const hash = createHash('sha1')
    .update(`${tenantId}\n`)
    .update(JSON.stringify(lista))
    .digest('hex');
  return `W/"${hash.slice(0, 20)}"`;
}

const semWeak = (tag: string) => (tag.startsWith('W/') ? tag.slice(2) : tag);

/** `If-None-Match` pode trazer uma lista separada por vírgula; `*` não conta. */
export function etagCasa(inm: string | undefined, etag: string): boolean {
  if (!inm) return false;
  const alvo = semWeak(etag);
  return inm.split(',').some((t) => semWeak(t.trim()) === alvo);
}

/**
 * Frota do painel (`/traccar/devices` e `/traccar/positions`) montada uma vez
 * por tenant, com o etag já calculado. A idade conta desde a busca no Traccar
 * (que já é compartilhada por 2 s), então o dado nunca passa de
 * `FROTA_PAINEL_CACHE_MS` somando os dois caches.
 */
@Injectable()
export class FrotaPainelService {
  /** `FROTA_PAINEL_CACHE_MS`; 0 = desligado, o controller segue o caminho antigo. */
  private readonly cacheMs: number;
  private readonly cache = new CacheCompartilhado<FrotaPainel>({
    maxEntradas: 50,
    timeoutMs: 30_000,
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly traccar: TraccarService,
  ) {
    const ms = Number.parseInt(process.env.FROTA_PAINEL_CACHE_MS ?? '', 10);
    this.cacheMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  }

  get ligado(): boolean {
    return this.cacheMs > 0;
  }

  frotaDoTenant(tenantId: string): Promise<FrotaPainel> {
    if (!this.ligado) return this.montar(tenantId);
    return this.cache.obter(
      `frota:${tenantId}`,
      (f) => this.ttlRestante(f),
      () => this.montar(tenantId),
    );
  }

  /** O cache grava com `expiraEm = agora + ttl`, logo expira em `geradoEm + cacheMs`. */
  private ttlRestante(f: FrotaPainel): number {
    const restante = Math.max(0, this.cacheMs - (Date.now() - f.geradoEm));
    return 'erroDevices' in f || 'erroPositions' in f
      ? Math.min(restante, TTL_COM_ERRO_MS)
      : restante;
  }

  private async montar(tenantId: string): Promise<FrotaPainel> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { tenantId, traccarDeviceId: { not: null }, deletedAt: null },
      select: { traccarDeviceId: true },
    });
    const ids = new Set<number>();
    for (const v of vehicles) {
      if (v.traccarDeviceId !== null) ids.add(v.traccarDeviceId);
    }

    let devices: TraccarDevice[] = [];
    let positions: TraccarPosition[] = [];
    const erros: Pick<FrotaPainel, 'erroDevices' | 'erroPositions'> = {};
    let geradoEm = Date.now();
    if (ids.size > 0) {
      const pedidoDevices = this.traccar.getDevices();
      const pedidoPositions = this.traccar.getPositions();
      // Lido logo depois de pedir, para ser a busca cuja promessa recebemos.
      const buscaDevices = this.traccar.frotaBuscadaEm('/devices');
      const buscaPositions = this.traccar.frotaBuscadaEm('/positions');
      const [rDevices, rPositions] = await Promise.allSettled([
        pedidoDevices,
        pedidoPositions,
      ]);
      const buscas: number[] = [];
      if (rDevices.status === 'fulfilled') {
        devices = rDevices.value.filter((d) => ids.has(d.id));
        if (buscaDevices !== null) buscas.push(buscaDevices);
      } else {
        erros.erroDevices = rDevices.reason;
      }
      if (rPositions.status === 'fulfilled') {
        positions = rPositions.value.filter((p) => ids.has(p.deviceId));
        if (buscaPositions !== null) buscas.push(buscaPositions);
      } else {
        erros.erroPositions = rPositions.reason;
      }
      if (buscas.length > 0) geradoEm = Math.min(...buscas);
    }

    return {
      devices,
      positions,
      etagDevices: etagDe(tenantId, devices),
      etagPositions: etagDe(tenantId, positions),
      geradoEm,
      ...erros,
    };
  }
}
