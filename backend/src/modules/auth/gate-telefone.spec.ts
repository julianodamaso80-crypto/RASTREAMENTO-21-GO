import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { WhatsappService } from '../notifications/whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { TraccarService } from '../traccar/traccar.service';

/**
 * O popup de cadastro do WhatsApp bloqueia a navegação. Se o canal de envio
 * estiver desligado, exigir a verificação tranca todo mundo fora do sistema —
 * a pessoa não tem como receber o código para se livrar do popup.
 *
 * Por isso a exigência acompanha o canal: só vale quando dá para enviar.
 */
describe('Gate de verificação de telefone', () => {
  async function servico(whatsappHabilitado: boolean) {
    const usuario = {
      id: 'u-1',
      email: 'operador@21go.com.br',
      name: 'Operador',
      role: 'ADMIN',
      tenantId: 't-1',
      allowedRoutes: [],
      phone: null,
      phoneVerifiedAt: null,
      tenant: {
        id: 't-1',
        name: '21 GO',
        slug: '21go',
        logoUrl: null,
        primaryColor: null,
      },
      createdAt: new Date(),
    };
    const mod = await Test.createTestingModule({
      providers: [
        AuthService,
        PasswordResetService,
        {
          provide: PrismaService,
          useValue: { user: { findUnique: jest.fn(async () => usuario) } },
        },
        {
          provide: WhatsappService,
          useValue: { habilitado: whatsappHabilitado, enviarCodigo: jest.fn() },
        },
        { provide: EmailService, useValue: {} },
        { provide: TraccarService, useValue: {} },
        { provide: JwtService, useValue: { sign: () => 'jwt' } },
      ],
    }).compile();
    return mod.get(AuthService);
  }

  it('não exige verificação quando o WhatsApp está desligado', async () => {
    const service = await servico(false);
    const me = await service.me('u-1');

    expect(me.phoneVerified).toBe(false);
    // Sem canal de envio, exigir travaria o usuário fora do painel.
    expect(me.phoneVerificationRequired).toBe(false);
  });

  it('exige verificação quando o WhatsApp está ligado', async () => {
    const service = await servico(true);
    const me = await service.me('u-1');

    expect(me.phoneVerified).toBe(false);
    expect(me.phoneVerificationRequired).toBe(true);
  });
});
