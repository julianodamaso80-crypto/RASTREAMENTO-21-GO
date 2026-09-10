import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AssociateAuthService } from './associate-auth.service';
import { PasswordResetService } from '../auth/password-reset.service';
import { WhatsappService } from '../notifications/whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Trava o contrato que o app publicado nas lojas já consome. O binário não será
 * rebuildado agora: qualquer mudança de forma aqui quebra cliente real.
 */
describe('Contrato de recuperação do associado', () => {
  let service: AssociateAuthService;
  let associado: Record<string, unknown>;
  let enviados: string[];

  beforeEach(async () => {
    enviados = [];
    associado = {
      id: 'a-1',
      cpf: '08577590780',
      phone: '21999998888',
      resetCodeHash: null,
      resetCodeExpiresAt: null,
      resetCodeAttempts: 0,
      resetCodeSentAt: null,
    };
    const prisma = {
      $queryRaw: jest.fn(async () => [{ id: 'a-1' }]),
      associate: {
        findFirst: jest.fn(async () => associado),
        update: jest.fn(
          async ({ data }: { data: Record<string, unknown> }) => {
            associado = { ...associado, ...data };
            return associado;
          },
        ),
      },
    };
    const whatsapp = {
      habilitado: true,
      enviarCodigo: jest.fn(async (_tel: string, codigo: string) => {
        enviados.push(codigo);
        return { enviado: true };
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        AssociateAuthService,
        PasswordResetService,
        { provide: PrismaService, useValue: prisma },
        { provide: WhatsappService, useValue: whatsapp },
        { provide: JwtService, useValue: { sign: () => 'jwt' } },
      ],
    }).compile();
    service = mod.get(AssociateAuthService);
  });

  it('devolve message, sentTo e canUseWhatsapp', async () => {
    const res = await service.forgotPassword('08577590780');

    expect(Object.keys(res).sort()).toEqual([
      'canUseWhatsapp',
      'message',
      'sentTo',
    ]);
    expect(res.sentTo).toBe('*****-8888');
    expect(res.message).toContain('Se esse CPF estiver cadastrado');
  });

  it('CPF fora do formato devolve a resposta genérica, sem enviar', async () => {
    const res = await service.forgotPassword('123');

    expect(res.sentTo).toBeNull();
    expect(res.message).toContain('Se esse CPF estiver cadastrado');
    expect(enviados).toHaveLength(0);
  });

  it('redefine a senha com o código recebido', async () => {
    await service.forgotPassword('08577590780');
    const res = await service.resetPasswordWithCode(
      '08577590780',
      enviados[0],
      'senhaDoCliente1',
    );

    expect(res).toEqual({ ok: true });
    expect(associado.mustChangePassword).toBe(false);
  });

  it('recusa senha igual ao CPF, com a mensagem que o app mostra', async () => {
    await service.forgotPassword('08577590780');

    await expect(
      service.resetPasswordWithCode('08577590780', enviados[0], '08577590780'),
    ).rejects.toThrow('A nova senha não pode ser o seu CPF. Escolha outra.');
  });

  it('pelo WhatsApp: acha o associado e manda o código pro número dele', async () => {
    const res = await service.forgotPasswordByPhone('(21) 99999-8888');

    expect(enviados[0]).toMatch(/^\d{6}$/);
    expect(res.sentTo).toBe('*****-8888');
    expect(res.message).toContain('Se esse WhatsApp estiver cadastrado');
  });

  it('pelo WhatsApp: continua recusando senha igual ao CPF do cadastro', async () => {
    await service.forgotPasswordByPhone('21999998888');

    await expect(
      service.resetPasswordWithCodeByPhone(
        '21999998888',
        enviados[0],
        '085.775.907-80',
      ),
    ).rejects.toThrow('A nova senha não pode ser o seu CPF. Escolha outra.');
  });
});
