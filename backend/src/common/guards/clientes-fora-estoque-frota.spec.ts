import { Test } from '@nestjs/testing';
import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import request from 'supertest';

// O stock.service puxa o pdfkit (ausente neste ambiente); aqui só importa o guard.
jest.mock('../../modules/stock/stock.service', () => ({ StockService: class {} }));

import { StockController } from '../../modules/stock/stock.controller';
import { StockService } from '../../modules/stock/stock.service';
import { TraccarController } from '../../modules/traccar/traccar.controller';
import { TraccarService } from '../../modules/traccar/traccar.service';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { FrotaPainelService } from '../../modules/traccar/frota-painel.service';

let papel = 'OPERATOR';
class AuthFalso implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    req.user = { id: 'u1', role: papel };
    req.tenantId = 't1';
    return true;
  }
}

const rotas = [
  '/stock',
  '/stock/stats',
  '/stock/connectivity',
  '/stock/map',
  '/traccar/devices',
  '/traccar/positions',
  '/traccar/positions/1/history?from=2026-01-01&to=2026-01-02',
];

describe('CLIENT fora de /stock/* e /traccar/*', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const vazio = () => Promise.resolve([]);
    const mod = await Test.createTestingModule({
      controllers: [StockController, TraccarController],
      providers: [
        {
          provide: StockService,
          useValue: { findAll: vazio, stats: vazio, connectivity: vazio, map: vazio },
        },
        { provide: TraccarService, useValue: {} },
        {
          provide: PrismaService,
          useValue: {
            vehicle: { findMany: vazio, findFirst: () => Promise.resolve(null) },
          },
        },
        { provide: FrotaPainelService, useValue: { ligado: false } },
      ],
    })
      .overrideGuard(AuthFalso)
      .useValue(new AuthFalso())
      .compile();
    app = mod.createNestApplication();
    app.useGlobalGuards(new AuthFalso());
    await app.init();
  });

  afterAll(() => app.close());

  it.each(rotas)('CLIENT recebe 403 em %s', async (rota) => {
    papel = 'CLIENT';
    await request(app.getHttpServer()).get(rota).expect(403);
  });

  it.each(['VIEWER', 'OPERATOR', 'ADMIN', 'SUPER_ADMIN'])(
    '%s não leva 403 nas rotas de leitura',
    async (p) => {
      papel = p;
      for (const rota of rotas) {
        const res = await request(app.getHttpServer()).get(rota);
        expect([rota, res.status === 403]).toEqual([rota, false]);
      }
    },
  );
});
