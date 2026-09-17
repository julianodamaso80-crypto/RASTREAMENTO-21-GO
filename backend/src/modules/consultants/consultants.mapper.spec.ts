import {
  coletaCompleta,
  dataDoPower,
  paraLinha,
  type UsuarioPower,
} from './consultants.mapper';

const TENANT = 'tenant-1';

/**
 * Formato copiado de uma resposta real de POST /company/userListFilter
 * (17/09/2026), com nome, e-mail, CPF e telefones trocados por fictícios.
 */
function usuario(over: Partial<UsuarioPower> = {}): UsuarioPower {
  return {
    id: 183142,
    name: 'Fulano Tratamento',
    fullName: 'Fulano de Tal da Silva',
    email: 'fulano@exemplo.com',
    registration: '123.456.789-09',
    office: 4,
    officeString: 'Consultor',
    branchString: '21GO! PROTEÇÃO PATRIMONIAL',
    cooperativeString: 'Cooperativa - Rio de Janeiro',
    active: true,
    responsibleUser: 'Beltrano Gerente',
    statusString: 'Ativo',
    isLeader: false,
    hinovaPayId: null,
    userId: 298425,
    companyId: 252,
    companyUserPhone: '',
    companyUserMobile: '(21) 99999-0000',
    createdAt: '05/03/2026 14:20',
    lastAccess: '',
    blockedAt: '',
    groupPermission: 'Consultores Externos',
    leader: false,
    ...over,
  };
}

describe('dataDoPower', () => {
  it('lê "dd/MM/yyyy HH:mm" como horário de Brasília', () => {
    expect(dataDoPower('05/03/2026 14:20')?.toISOString()).toBe(
      '2026-03-05T17:20:00.000Z',
    );
  });

  it('string vazia ou lixo vira null, não data inventada', () => {
    expect(dataDoPower('')).toBeNull();
    expect(dataDoPower(null)).toBeNull();
    expect(dataDoPower('ontem')).toBeNull();
    expect(dataDoPower('31/02/2026 10:00')).toBeNull();
  });
});

describe('paraLinha', () => {
  it('usa o nome completo e guarda o de tratamento à parte', () => {
    const l = paraLinha(usuario(), TENANT);
    expect(l.name).toBe('Fulano de Tal da Silva');
    expect(l.nickname).toBe('Fulano Tratamento');
  });

  it('cai no nome de tratamento quando o completo vem vazio', () => {
    expect(paraLinha(usuario({ fullName: '' }), TENANT).name).toBe('Fulano Tratamento');
  });

  it('documento só com dígitos; vazio vira null', () => {
    expect(paraLinha(usuario(), TENANT).document).toBe('12345678909');
    expect(paraLinha(usuario({ registration: '' }), TENANT).document).toBeNull();
  });

  it('telefone vazio vira null e o preenchido fica só com dígitos (a busca casa por número)', () => {
    const l = paraLinha(usuario(), TENANT);
    expect(l.phone).toBeNull();
    expect(l.mobile).toBe('21999990000');
  });

  it('bloqueado carrega a data do bloqueio', () => {
    const l = paraLinha(
      usuario({ active: false, statusString: 'Bloqueado', blockedAt: '10/09/2026 08:00' }),
      TENANT,
    );
    expect(l.active).toBe(false);
    expect(l.statusLabel).toBe('Bloqueado');
    expect(l.blockedAt?.toISOString()).toBe('2026-09-10T11:00:00.000Z');
  });

  it('mapeia cargo, filial, cooperativa, grupo e quem chamou', () => {
    const l = paraLinha(usuario(), TENANT);
    expect(l).toMatchObject({
      tenantId: TENANT,
      powerId: 183142,
      email: 'fulano@exemplo.com',
      office: 4,
      officeLabel: 'Consultor',
      branch: '21GO! PROTEÇÃO PATRIMONIAL',
      cooperative: 'Cooperativa - Rio de Janeiro',
      permissionGroup: 'Consultores Externos',
      managerName: 'Beltrano Gerente',
    });
    expect(l.powerCreatedAt?.toISOString()).toBe('2026-03-05T17:20:00.000Z');
    expect(l.lastAccessAt).toBeNull();
  });
});

describe('coletaCompleta', () => {
  it('só autoriza marcar removidos quando veio tudo o que o Power anunciou', () => {
    expect(coletaCompleta(4225, 4225)).toBe(true);
    expect(coletaCompleta(4226, 4225)).toBe(true);
  });

  it('coleta pela metade nunca apaga ninguém', () => {
    expect(coletaCompleta(3000, 4225)).toBe(false);
    expect(coletaCompleta(0, 0)).toBe(false);
  });
});
