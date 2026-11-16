import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../../modules/prisma/prisma.service';

const VALIDADE_MS = 60_000;

/**
 * Quais tenants são de demonstração. Usado pelos crons (que não têm contexto
 * de requisição) para não tocar Traccar/SGA/WhatsApp em nome da demo, e pelo
 * despachante de notificações para não mandar e-mail/push de verdade.
 */
@Injectable()
export class DemoTenantsService {
  private cache: { ids: Set<string>; em: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async idsDemo(): Promise<Set<string>> {
    if (this.cache && Date.now() - this.cache.em < VALIDADE_MS) {
      return this.cache.ids;
    }
    const linhas = await this.prisma.tenant.findMany({
      where: { isDemo: true },
      select: { id: true },
    });
    const ids = new Set(linhas.map((l) => l.id));
    this.cache = { ids, em: Date.now() };
    return ids;
  }

  async ehDemo(tenantId: string | null | undefined): Promise<boolean> {
    if (!tenantId) return false;
    return (await this.idsDemo()).has(tenantId);
  }

  /** Filtro Prisma para "tenant que NÃO é demonstração". */
  async filtroForaDaDemo(): Promise<{ notIn: string[] } | undefined> {
    const ids = [...(await this.idsDemo())];
    return ids.length ? { notIn: ids } : undefined;
  }
}

@Global()
@Module({
  providers: [DemoTenantsService],
  exports: [DemoTenantsService],
})
export class DemoModule {}
