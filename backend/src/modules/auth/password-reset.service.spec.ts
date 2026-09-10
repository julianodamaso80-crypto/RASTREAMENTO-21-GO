import { Test } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  PasswordResetService,
  RepositorioReset,
  SujeitoReset,
} from './password-reset.service';
import { WhatsappService } from '../notifications/whatsapp.service';

/** Repositório de mentira: guarda um sujeito em memória e registra o que foi gravado. */
function repoFake(inicial: SujeitoReset | null) {
  let sujeito = inicial;
  const senhasGravadas: string[] = [];
  const repo: RepositorioReset = {
    buscar: async () => sujeito,
    gravarCodigo: async (_id, hash, expiraEm) => {
      sujeito = {
        ...(sujeito as SujeitoReset),
        resetCodeHash: hash,
        resetCodeExpiresAt: expiraEm,
        resetCodeAttempts: 0,
        resetCodeSentAt: new Date(),
      };
    },
    contarTentativa: async () => {
      sujeito = {
        ...(sujeito as SujeitoReset),
        resetCodeAttempts: (sujeito as SujeitoReset).resetCodeAttempts + 1,
      };
    },
    limparCodigo: async () => {
      sujeito = {
        ...(sujeito as SujeitoReset),
        resetCodeHash: null,
        resetCodeExpiresAt: null,
        resetCodeAttempts: 0,
      };
    },
    gravarSenha: async (_id, hash) => {
      senhasGravadas.push(hash);
    },
  };
  return { repo, senhasGravadas, atual: () => sujeito };
}

const SUJEITO: SujeitoReset = {
  id: 'id-1',
  phone: '21999998888',
  resetCodeHash: null,
  resetCodeExpiresAt: null,
  resetCodeAttempts: 0,
  resetCodeSentAt: null,
};

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let enviados: string[];

  beforeEach(async () => {
    enviados = [];
    const whatsapp = {
      habilitado: true,
      enviarCodigo: jest.fn(async (_tel: string, codigo: string) => {
        enviados.push(codigo);
        return { enviado: true };
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: WhatsappService, useValue: whatsapp },
      ],
    }).compile();
    service = mod.get(PasswordResetService);
  });

  it('envia código de 6 dígitos e devolve o telefone mascarado', async () => {
    const fake = repoFake({ ...SUJEITO });
    const res = await service.enviarCodigo(fake.repo, '08577590780', 'CPF');

    expect(enviados[0]).toMatch(/^\d{6}$/);
    expect(res.sentTo).toBe('*****-8888');
    expect(fake.atual()?.resetCodeHash).not.toBe(enviados[0]);
    expect(await bcrypt.compare(enviados[0], fake.atual()!.resetCodeHash!)).toBe(
      true,
    );
  });

  it('responde igual quando o identificador não existe', async () => {
    const semNinguem = repoFake(null);
    const inexistente = await service.enviarCodigo(
      semNinguem.repo,
      '00000000000',
      'CPF',
    );

    const comAlguem = repoFake({ ...SUJEITO });
    const existente = await service.enviarCodigo(
      comAlguem.repo,
      '08577590780',
      'CPF',
    );

    expect(inexistente.message).toBe(existente.message);
    expect(inexistente.sentTo).toBeNull();
  });

  it('responde igual quando existe mas não tem telefone', async () => {
    const semTel = repoFake({ ...SUJEITO, phone: null });
    const a = await service.enviarCodigo(semTel.repo, '08577590780', 'CPF');
    const vazio = repoFake(null);
    const b = await service.enviarCodigo(vazio.repo, '00000000000', 'CPF');

    expect(a.message).toBe(b.message);
    expect(a.sentTo).toBeNull();
    expect(enviados).toHaveLength(0);
  });

  it('recusa segundo envio dentro de 2 minutos', async () => {
    const fake = repoFake({ ...SUJEITO, resetCodeSentAt: new Date() });
    const res = await service.enviarCodigo(fake.repo, '08577590780', 'CPF');

    expect(enviados).toHaveLength(0);
    expect(res.message).toContain('dois minutos');
  });

  it('redefine a senha com o código certo', async () => {
    const fake = repoFake({ ...SUJEITO });
    await service.enviarCodigo(fake.repo, '08577590780', 'CPF');

    const res = await service.redefinirSenha(
      fake.repo,
      '08577590780',
      enviados[0],
      'senhaNova1',
    );

    expect(res).toEqual({ ok: true });
    expect(await bcrypt.compare('senhaNova1', fake.senhasGravadas[0])).toBe(true);
    expect(fake.atual()?.resetCodeHash).toBeNull();
  });

  it('conta a tentativa errada e mata o código na quinta', async () => {
    const fake = repoFake({ ...SUJEITO });
    await service.enviarCodigo(fake.repo, '08577590780', 'CPF');

    for (let i = 0; i < 5; i += 1) {
      await expect(
        service.redefinirSenha(fake.repo, '08577590780', '000000', 'senhaNova1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect(fake.atual()?.resetCodeHash).toBeNull();
  });

  it('recusa código expirado', async () => {
    const fake = repoFake({
      ...SUJEITO,
      resetCodeHash: await bcrypt.hash('123456', 10),
      resetCodeExpiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      service.redefinirSenha(fake.repo, '08577590780', '123456', 'senhaNova1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa senha curta', async () => {
    const fake = repoFake({ ...SUJEITO });
    await service.enviarCodigo(fake.repo, '08577590780', 'CPF');

    await expect(
      service.redefinirSenha(fake.repo, '08577590780', enviados[0], 'abc'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aplica a validação extra de quem chamou', async () => {
    const fake = repoFake({ ...SUJEITO });
    await service.enviarCodigo(fake.repo, '08577590780', 'CPF');

    await expect(
      service.redefinirSenha(
        fake.repo,
        '08577590780',
        enviados[0],
        '08577590780',
        () => {
          throw new BadRequestException(
            'A nova senha não pode ser o seu CPF. Escolha outra.',
          );
        },
      ),
    ).rejects.toThrow('A nova senha não pode ser o seu CPF. Escolha outra.');
  });
});
