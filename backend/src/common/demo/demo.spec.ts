import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { lastValueFrom, of, defer } from 'rxjs';
import { emDemo, rodarComoDemo, tenantDaDemo } from './demo-context';
import {
  DemoInterceptor,
  alteraAPropriaContaDemo,
  rotaProibidaNaDemo,
} from './demo.interceptor';
import { TenantGuard } from '../guards/tenant.guard';
import { TraccarService, PREFIXO_DEVICE_DEMO } from '../../modules/traccar/traccar.service';

/**
 * Empresa de demonstração: os botões funcionam, mas NADA sai para o mundo
 * real. Estes testes são a trava contra regressão — se alguém mexer no
 * TraccarService e esquecer o `emDemo()`, um carro de verdade pode ser
 * bloqueado por quem está só olhando a demonstração.
 */

function traccar() {
  const s = new TraccarService({ get: () => 'http://traccar.local' } as never);
  const cliente = (s as unknown as { client: Record<string, (...a: unknown[]) => unknown> }).client;
  const chamadas = {
    get: jest.spyOn(cliente, 'get' as never).mockResolvedValue({ data: [] } as never),
    post: jest.spyOn(cliente, 'post' as never).mockResolvedValue({ data: {}, status: 200 } as never),
    put: jest.spyOn(cliente, 'put' as never).mockResolvedValue({ data: {} } as never),
    delete: jest.spyOn(cliente, 'delete' as never).mockResolvedValue({ data: {} } as never),
  };
  return { s, chamadas };
}

describe('contexto da demonstração', () => {
  it('fora do contexto não é demo', () => {
    expect(emDemo()).toBe(false);
    expect(tenantDaDemo()).toBeNull();
  });

  it('dentro do contexto é demo, inclusive depois de um await', async () => {
    await rodarComoDemo('t-demo', async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(emDemo()).toBe(true);
      expect(tenantDaDemo()).toBe('t-demo');
    });
    expect(emDemo()).toBe(false);
  });
});

describe('TraccarService na demonstração não toca o Traccar', () => {
  it('comandos de bloqueio/desbloqueio e comando imediato', async () => {
    const { s, chamadas } = traccar();
    await rodarComoDemo('t', async () => {
      await s.sendCommand(123, 'engineStop');
      await expect(s.sendCommandNow(123, 'engineResume')).resolves.toEqual({ enviado: true });
    });
    expect(chamadas.post).not.toHaveBeenCalled();
  });

  it('criar, editar e apagar device e cerca', async () => {
    const { s, chamadas } = traccar();
    await rodarComoDemo('t', async () => {
      const d = await s.createDevice('ABC1D23', '359000000000001');
      expect(d.id).toBeLessThan(0);
      await s.updateDevice(5, { name: 'x' });
      await s.deleteDevice(5);
      const g = await s.createGeofence('Casa', 'CIRCLE (0 0, 10)');
      expect(g.id).toBeLessThan(0);
      await s.updateGeofence(g.id, 'Casa', 'x');
      await s.deleteGeofence(g.id);
      await s.linkDeviceGeofence(1, 2);
      await s.unlinkDeviceGeofence(1, 2);
      await s.linkDeviceToSessionUser(1);
      await s.createUser('a@b.c', 'x', 'A');
    });
    expect(chamadas.post).not.toHaveBeenCalled();
    expect(chamadas.put).not.toHaveBeenCalled();
    expect(chamadas.delete).not.toHaveBeenCalled();
  });

  it('IMEI real digitado na demo nunca encontra o aparelho de verdade', async () => {
    const { s, chamadas } = traccar();
    await rodarComoDemo('t', async () => {
      await expect(s.getDeviceByUniqueId('869137080340854')).resolves.toBeNull();
    });
    expect(chamadas.get).not.toHaveBeenCalled();
  });

  it('rastreador simulado da própria demo continua visível', async () => {
    const { s, chamadas } = traccar();
    chamadas.get.mockResolvedValue({ data: [{ id: 9, uniqueId: `${PREFIXO_DEVICE_DEMO}01` }] } as never);
    await rodarComoDemo('t', async () => {
      await expect(s.getDeviceByUniqueId(`${PREFIXO_DEVICE_DEMO}01`)).resolves.toMatchObject({ id: 9 });
    });
  });

  it('id falso (negativo) nunca vira consulta de posição', async () => {
    const { s, chamadas } = traccar();
    await rodarComoDemo('t', async () => {
      await expect(s.getPositions(-5)).resolves.toEqual([]);
      await expect(s.getPositions()).resolves.toEqual([]);
    });
    expect(chamadas.get).not.toHaveBeenCalled();
  });

  it('fora da demo o comando sai normalmente', async () => {
    const { s, chamadas } = traccar();
    await s.sendCommand(123, 'engineStop');
    expect(chamadas.post).toHaveBeenCalledTimes(1);
  });
});

describe('rotas da demonstração', () => {
  it.each([
    ['POST', '/api/v1/tenants'],
    ['DELETE', '/api/v1/tenants/abc'],
    ['GET', '/api/v1/admin/deleted/tenant'],
    ['POST', '/api/v1/admin/restore/tenant/abc'],
  ])('%s %s é proibida', (m, c) => expect(rotaProibidaNaDemo(m, c)).toBe(true));

  it.each([
    ['GET', '/api/v1/tenants'],
    ['PATCH', '/api/v1/tenants/abc'],
    ['GET', '/api/v1/admin/deleted/vehicle'],
    ['POST', '/api/v1/vehicles/abc/block'],
  ])('%s %s é liberada', (m, c) => expect(rotaProibidaNaDemo(m, c)).toBe(false));

  it('a conta demo não troca a própria senha nem se apaga', () => {
    expect(alteraAPropriaContaDemo('POST', '/api/v1/auth/change-password', 'u1')).toBe(true);
    expect(alteraAPropriaContaDemo('PATCH', '/api/v1/users/u1', 'u1')).toBe(true);
    expect(alteraAPropriaContaDemo('DELETE', '/api/v1/users/u1', 'u1')).toBe(true);
    expect(alteraAPropriaContaDemo('POST', '/api/v1/users/u1/reset-password', 'u1')).toBe(true);
  });

  it('usuário criado pelo visitante dentro da demo continua editável', () => {
    expect(alteraAPropriaContaDemo('PATCH', '/api/v1/users/u2', 'u1')).toBe(false);
    expect(alteraAPropriaContaDemo('DELETE', '/api/v1/users/u2', 'u1')).toBe(false);
    expect(alteraAPropriaContaDemo('GET', '/api/v1/users/u1', 'u1')).toBe(false);
  });
});

function contexto(req: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('DemoInterceptor', () => {
  const demoTenants = { ehDemo: jest.fn(async (t: string) => t === 't-demo') };
  const interceptor = new DemoInterceptor(demoTenants as never);

  it('abre o contexto e força o tenant do corpo para o da demo', async () => {
    const req = {
      user: { id: 'u1', isDemo: true, tenantId: 't-demo' },
      body: { tenantId: 't-21go' },
      method: 'POST',
      path: '/api/v1/users',
      url: '/api/v1/users',
    };
    const visto = await lastValueFrom(
      await interceptor.intercept(contexto(req), {
        handle: () => defer(() => of({ demo: emDemo(), tenant: tenantDaDemo() })),
      }),
    );
    expect(visto).toEqual({ demo: true, tenant: 't-demo' });
    expect(req.body.tenantId).toBe('t-demo');
  });

  it('associado/técnico de tenant demo também entra no contexto', async () => {
    const req = { tenantId: 't-demo', method: 'POST', path: '/api/v1/app/x', url: '/api/v1/app/x' };
    const visto = await lastValueFrom(
      await interceptor.intercept(contexto(req), { handle: () => defer(() => of(emDemo())) }),
    );
    expect(visto).toBe(true);
  });

  it('usuário de empresa real segue fora do contexto', async () => {
    const req = { user: { id: 'u9', tenantId: 't-21go' }, tenantId: 't-21go', method: 'GET', url: '/x' };
    const visto = await lastValueFrom(
      await interceptor.intercept(contexto(req), { handle: () => defer(() => of(emDemo())) }),
    );
    expect(visto).toBe(false);
  });

  it('recusa criar empresa nova', async () => {
    const req = { user: { id: 'u1', isDemo: true, tenantId: 't-demo' }, method: 'POST', path: '/api/v1/tenants', url: '/api/v1/tenants' };
    await expect(
      interceptor.intercept(contexto(req), { handle: () => of(null) }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('TenantGuard', () => {
  it('demo ignora x-tenant-id mesmo sendo SUPER_ADMIN', () => {
    const req: Record<string, unknown> = {
      user: { role: 'SUPER_ADMIN', isDemo: true, tenantId: 't-demo' },
      headers: { 'x-tenant-id': 't-21go' },
    };
    new TenantGuard().canActivate(contexto(req));
    expect(req.tenantId).toBe('t-demo');
  });

  it('SUPER_ADMIN real continua podendo usar x-tenant-id', () => {
    const req: Record<string, unknown> = {
      user: { role: 'SUPER_ADMIN', tenantId: 't-21go' },
      headers: { 'x-tenant-id': 't-outra' },
    };
    new TenantGuard().canActivate(contexto(req));
    expect(req.tenantId).toBe('t-outra');
  });
});
