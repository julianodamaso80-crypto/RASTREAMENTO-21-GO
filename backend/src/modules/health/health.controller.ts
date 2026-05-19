import { Controller, Get, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { TraccarService } from '../traccar/traccar.service';

interface HealthCheck {
  ok: boolean;
  durationMs?: number;
  message?: string;
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly bootedAt = new Date();

  constructor(
    private prisma: PrismaService,
    private traccarService: TraccarService,
  ) {}

  @Public()
  @Get()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Healthcheck público (DB + Traccar + uptime)',
    description:
      'Endpoint sem autenticação para load balancer / EasyPanel detectar falhas. Retorna 200 mesmo se um sub-check estiver degradado — quem decide é o consumidor olhando o JSON.',
  })
  async check() {
    const [db, traccar] = await Promise.all([
      this.checkDb(),
      this.checkTraccar(),
    ]);

    const traccarSession = this.traccarService.getSessionCookie() !== null;

    return {
      ok: db.ok && traccar.ok,
      version: {
        gitSha: process.env.GIT_SHA ?? 'undefined',
        builtAt: process.env.BUILD_TIME ?? 'undefined',
      },
      checks: {
        db,
        traccar,
        traccarSession: { ok: traccarSession },
      },
      uptimeSeconds: Math.floor(
        (Date.now() - this.bootedAt.getTime()) / 1000,
      ),
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDb(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, durationMs: Date.now() - start };
    } catch (error) {
      return {
        ok: false,
        durationMs: Date.now() - start,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async checkTraccar(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      await this.traccarService.getServer();
      return { ok: true, durationMs: Date.now() - start };
    } catch (error) {
      return {
        ok: false,
        durationMs: Date.now() - start,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
