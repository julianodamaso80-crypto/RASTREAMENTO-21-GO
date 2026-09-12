import { CrmBoletosClient } from './crm-boletos.client';

function client() {
  const config = {
    get: (k: string) =>
      ({ 'crm.baseUrl': 'https://crm.test/api', 'crm.token': 'segredo' })[k],
  } as any;
  return new CrmBoletosClient(config);
}

function mockFetch(impl: jest.Mock) {
  return jest.spyOn(global, 'fetch').mockImplementation(impl as any);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('CrmBoletosClient.buscarPorCpf', () => {
  it('manda o CPF no header x-cpf (nao mais querystring) e devolve boletos + foraDoPrazo', async () => {
    const f = mockFetch(
      jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          boletos: [{ nossoNumero: '1', status: 'disponivel' }],
          foraDoPrazo: 2,
        }),
      }),
    );
    const r = await client().buscarPorCpf('11144477735');
    expect(f.mock.calls[0][0]).not.toContain('cpf=');
    expect((f.mock.calls[0][1] as any).headers.Authorization).toBe('Bearer segredo');
    expect((f.mock.calls[0][1] as any).headers['x-cpf']).toBe('11144477735');
    expect(r?.boletos).toHaveLength(1);
    expect(r?.foraDoPrazo).toBe(2);
  });

  // CRM fora do ar (achado C1): `null` é o único jeito de dizer "não sei" pro
  // robô, que trata `[]` como "não deve nada" e apagaria o espelho inteiro.
  it('CRM fora do ar devolve null, nunca [] — nunca explode', async () => {
    mockFetch(jest.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(client().buscarPorCpf('11144477735')).resolves.toBeNull();
  });

  it('CRM respondendo 500 devolve null', async () => {
    mockFetch(jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    await expect(client().buscarPorCpf('11144477735')).resolves.toBeNull();
  });

  it('JSON fora do contrato (sem a chave boletos) devolve null', async () => {
    mockFetch(jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await expect(client().buscarPorCpf('11144477735')).resolves.toBeNull();
  });

  it('sem CRM_API_URL/CRM_INTEGRACAO_TOKEN configurados devolve null, nao []', async () => {
    const config = { get: () => undefined } as any;
    await expect(new (require('./crm-boletos.client').CrmBoletosClient)(config).buscarPorCpf('1'))
      .resolves.toBeNull();
  });

  it('legitimamente sem boleto nenhum devolve boletos: [] (nao null)', async () => {
    mockFetch(
      jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ boletos: [], foraDoPrazo: 0 }),
      }),
    );
    await expect(client().buscarPorCpf('11144477735')).resolves.toEqual({
      boletos: [],
      foraDoPrazo: 0,
    });
  });
});

describe('CrmBoletosClient.baixarPdf', () => {
  it('so aceita conteudo que e PDF de verdade', async () => {
    const html = Buffer.from('<html>O prazo para emissao deste boleto expirou</html>');
    mockFetch(
      jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => html.buffer.slice(html.byteOffset, html.byteOffset + html.length),
      }),
    );
    // O link responde 200 mesmo morto: só o conteúdo prova (medido no CRM em 07/08/2026).
    await expect(client().baixarPdf('https://hinova.test/b.pdf')).resolves.toBeNull();
  });

  it('devolve o buffer quando e PDF', async () => {
    const pdf = Buffer.from('%PDF-1.4 conteudo');
    mockFetch(
      jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.length),
      }),
    );
    const r = await client().baixarPdf('https://hinova.test/b.pdf');
    expect(r?.subarray(0, 4).toString()).toBe('%PDF');
  });
});
