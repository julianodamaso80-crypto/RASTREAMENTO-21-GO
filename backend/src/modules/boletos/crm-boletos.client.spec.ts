import { CrmBoletosClient } from './crm-boletos.client';

function client(fetchFake: jest.Mock) {
  const config = {
    get: (k: string) =>
      ({ 'crm.baseUrl': 'https://crm.test/api', 'crm.token': 'segredo' })[k],
  } as any;
  return new CrmBoletosClient(config, fetchFake as unknown as typeof fetch);
}

describe('CrmBoletosClient.buscarPorCpf', () => {
  it('manda o segredo no header e devolve a lista', async () => {
    const f = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ boletos: [{ nossoNumero: '1', status: 'disponivel' }] }),
    });
    const r = await client(f).buscarPorCpf('11144477735');
    expect(f.mock.calls[0][0]).toContain('cpf=11144477735');
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer segredo');
    expect(r).toHaveLength(1);
  });

  it('CRM fora do ar devolve lista vazia, nunca explode', async () => {
    const f = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(client(f).buscarPorCpf('11144477735')).resolves.toEqual([]);
  });

  it('CRM respondendo 500 devolve lista vazia', async () => {
    const f = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(client(f).buscarPorCpf('11144477735')).resolves.toEqual([]);
  });
});

describe('CrmBoletosClient.baixarPdf', () => {
  it('so aceita conteudo que e PDF de verdade', async () => {
    const html = Buffer.from('<html>O prazo para emissao deste boleto expirou</html>');
    const f = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => html.buffer.slice(html.byteOffset, html.byteOffset + html.length),
    });
    // O link responde 200 mesmo morto: só o conteúdo prova (medido no CRM em 07/08/2026).
    await expect(client(f).baixarPdf('https://hinova.test/b.pdf')).resolves.toBeNull();
  });

  it('devolve o buffer quando e PDF', async () => {
    const pdf = Buffer.from('%PDF-1.4 conteudo');
    const f = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.length),
    });
    const r = await client(f).baixarPdf('https://hinova.test/b.pdf');
    expect(r?.subarray(0, 4).toString()).toBe('%PDF');
  });
});
