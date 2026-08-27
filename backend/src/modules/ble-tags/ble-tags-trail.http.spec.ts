import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BleTagsController } from './ble-tags.controller';
import { BleTagsService } from './ble-tags.service';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';

/**
 * As rotas novas por HTTP de verdade.
 *
 * O teste de service prova a regra; este prova o encanamento: a rota existe e
 * está mapeada, o DTO valida o que precisa validar, o tenant do JWT chega ao
 * service e o interceptor envelopa a resposta no formato que o frontend
 * espera (`{ data: ... }`). Errar qualquer um desses elos dá tela vazia sem
 * nenhum erro no console — o tipo de defeito que só aparece em produção.
 *
 * Sobe o Nest numa porta efêmera; não toca em banco (o service é dublê).
 */
jest.setTimeout(30_000);

const TENANT = 'tenant-do-jwt';
const TAG_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

const trailFalso = {
  segmentos: [
    {
      pontos: [
        {
          lat: -22.939,
          lng: -43.56,
          accuracy: 40,
          seenAt: new Date('2026-08-26T12:00:00Z'),
          latenciaSeg: 620,
        },
      ],
    },
  ],
  totalAvistamentos: 1,
};

const insightsFalso = {
  janelaDias: 7,
  totalAvistamentos: 120,
  locaisHabituais: [],
  pernoite: null,
  ultimaParada: null,
};

describe('rotas de trilha e histórico (HTTP)', () => {
  let app: INestApplication;
  let base: string;
  const service = {
    getTrail: jest.fn().mockResolvedValue(trailFalso),
    getInsights: jest.fn().mockResolvedValue(insightsFalso),
  };

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      controllers: [BleTagsController],
      providers: [
        { provide: BleTagsService, useValue: service },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
      ],
    }).compile();

    app = ref.createNestApplication();
    // Mesma configuração do main.ts: sem isso o teste validaria outra coisa.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    // O TenantGuard é global em produção; aqui o tenant entra direto na
    // request, que é exatamente o que o controller lê.
    app.use((req: Record<string, unknown>, _res: unknown, next: () => void) => {
      req.tenantId = TENANT;
      req.user = { id: 'user-1', role: 'ADMIN' };
      next();
    });
    await app.init();
    await app.listen(0);
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    service.getTrail.mockClear();
    service.getInsights.mockClear();
  });

  it('GET /ble-tags/:id/trail responde 200 no envelope { data }', async () => {
    const res = await fetch(`${base}/ble-tags/${TAG_ID}/trail`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.totalAvistamentos).toBe(1);
    expect(body.data.segmentos[0].pontos[0].latenciaSeg).toBe(620);
  });

  it('trail repassa a janela e o tenant do JWT ao service', async () => {
    await fetch(
      `${base}/ble-tags/${TAG_ID}/trail?from=2026-08-20T00:00:00.000Z&to=2026-08-27T00:00:00.000Z`,
    );

    expect(service.getTrail).toHaveBeenCalledWith(TAG_ID, TENANT, {
      from: '2026-08-20T00:00:00.000Z',
      to: '2026-08-27T00:00:00.000Z',
    });
  });

  it('trail recusa data que não é ISO8601', async () => {
    const res = await fetch(`${base}/ble-tags/${TAG_ID}/trail?from=ontem`);
    expect(res.status).toBe(400);
    expect(service.getTrail).not.toHaveBeenCalled();
  });

  it('trail recusa id que não é UUID', async () => {
    const res = await fetch(`${base}/ble-tags/nao-e-uuid/trail`);
    expect(res.status).toBe(400);
    expect(service.getTrail).not.toHaveBeenCalled();
  });

  it('trail recusa parâmetro desconhecido (whitelist do main.ts)', async () => {
    const res = await fetch(`${base}/ble-tags/${TAG_ID}/trail?tenantId=outro`);
    expect(res.status).toBe(400);
    expect(service.getTrail).not.toHaveBeenCalled();
  });

  it('GET /ble-tags/:id/insights responde 200 e converte days para número', async () => {
    const res = await fetch(`${base}/ble-tags/${TAG_ID}/insights?days=3`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.totalAvistamentos).toBe(120);
    expect(service.getInsights).toHaveBeenCalledWith(TAG_ID, TENANT, {
      days: 3,
    });
  });

  it('insights recusa janela fora do intervalo aceito', async () => {
    const res = await fetch(`${base}/ble-tags/${TAG_ID}/insights?days=999`);
    expect(res.status).toBe(400);
    expect(service.getInsights).not.toHaveBeenCalled();
  });

  it('insights sem days deixa o padrão para o service decidir', async () => {
    const res = await fetch(`${base}/ble-tags/${TAG_ID}/insights`);
    expect(res.status).toBe(200);
    expect(service.getInsights).toHaveBeenCalledWith(TAG_ID, TENANT, {});
  });
});
