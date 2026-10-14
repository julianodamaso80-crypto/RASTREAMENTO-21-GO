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
  geradoEm: number;
}

function etagDe(lista: unknown[]): string {
  const hash = createHash('sha1').update(JSON.stringify(lista)).digest('hex');
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
 * por tenant a cada `FROTA_PAINEL_CACHE_MS`, com o etag já calculado.
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
    return this.cache.obter(`frota:${tenantId}`, this.cacheMs, () =>
      this.montar(tenantId),
    );
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
    if (ids.size > 0) {
      const [todosDevices, todasPosicoes] = await Promise.all([
        this.traccar.getDevices(),
        this.traccar.getPositions(),
      ]);
      devices = todosDevices.filter((d) => ids.has(d.id));
      positions = todasPosicoes.filter((p) => ids.has(p.deviceId));
    }

    return {
      devices,
      positions,
      etagDevices: etagDe(devices),
      etagPositions: etagDe(positions),
      geradoEm: Date.now(),
    };
  }
}
