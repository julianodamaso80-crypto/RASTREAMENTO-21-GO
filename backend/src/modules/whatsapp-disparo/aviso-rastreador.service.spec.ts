import axios from 'axios';
import { AvisoRastreadorService, erroTransitorio, parametrosInstalado } from './aviso-rastreador.service';

jest.mock('axios');
const post = axios.post as jest.Mock;

function montar(cfg: Record<string, string | undefined>) {
  const svc = new AvisoRastreadorService({ get: (k: string) => cfg[k] } as never);
  // Sem esperar de verdade entre as tentativas.
  jest.spyOn(svc as never, 'esperar').mockResolvedValue(undefined as never);
  return svc;
}

const LIGADO = {
  'whatsappDisparo.token': 'tk',
  'whatsappDisparo.phoneNumberId': '1375286115665354',
  'whatsappDisparo.templateInstalado': 'rastreador_instalado_21go',
  'whatsappDisparo.apiVersion': 'v24.0',
};

beforeEach(() => post.mockReset().mockResolvedValue({}));

describe('parametrosInstalado', () => {
  it('primeiro nome e primeira palavra do modelo, com só a inicial maiúscula', () => {
    expect(
      parametrosInstalado({ telefone: '', nome: 'MARIA DA SILVA', modelo: 'GOL 1.0 MI TOTAL FLEX', placa: 'ABC1D23' }),
    ).toEqual(['Maria', 'Gol', 'ABC1D23']);
  });

  it('nunca manda variável vazia', () => {
    expect(parametrosInstalado({ telefone: '', nome: '', modelo: null, placa: 'ABC1D23' })).toEqual([
      'cliente',
      'veículo',
      'ABC1D23',
    ]);
  });
});

describe('AvisoRastreadorService', () => {
  const aviso = { telefone: '(21) 99220-8062', nome: 'JULIANO D', modelo: 'ONIX 1.0', placa: 'ABC1D23' };

  it('envia o template para o número com DDI', async () => {
    expect(await montar(LIGADO).avisarInstalado(aviso)).toBe(true);
    const [url, corpo] = post.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v24.0/1375286115665354/messages');
    expect(corpo.to).toBe('5521992208062');
    expect(corpo.template.name).toBe('rastreador_instalado_21go');
    expect(corpo.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      'Juliano',
      'Onix',
      'ABC1D23',
    ]);
  });

  it('desligado sem token não envia nada', async () => {
    expect(await montar({ ...LIGADO, 'whatsappDisparo.token': undefined }).avisarInstalado(aviso)).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('cliente sem telefone não envia', async () => {
    expect(await montar(LIGADO).avisarInstalado({ ...aviso, telefone: null })).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('erro da Meta não derruba a ativação', async () => {
    post.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 400 } }));
    await expect(montar(LIGADO).avisarInstalado(aviso)).resolves.toBe(false);
  });

  it('timeout de conexão com a Meta: tenta de novo e entrega', async () => {
    post
      .mockRejectedValueOnce(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }))
      .mockResolvedValueOnce({});
    expect(await montar(LIGADO).avisarInstalado(aviso)).toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('Meta fora do ar (5xx) ou limitando (429): três tentativas e desiste', async () => {
    post.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 503 } }));
    expect(await montar(LIGADO).avisarInstalado(aviso)).toBe(false);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('erro do pedido (4xx) não é repetido', async () => {
    post.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 400 } }));
    expect(await montar(LIGADO).avisarInstalado(aviso)).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('resposta que não voltou não é repetida: a Meta pode ter aceitado', async () => {
    post.mockRejectedValue(Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' }));
    expect(await montar(LIGADO).avisarInstalado(aviso)).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('erroTransitorio', () => {
  it('só quando é certo que a mensagem não saiu', () => {
    expect(erroTransitorio({ code: 'ETIMEDOUT' })).toBe(true);
    expect(erroTransitorio({ response: { status: 429 } })).toBe(true);
    expect(erroTransitorio({ response: { status: 500 } })).toBe(true);
    expect(erroTransitorio({ response: { status: 400 } })).toBe(false);
    expect(erroTransitorio({ code: 'ECONNRESET' })).toBe(false);
    expect(erroTransitorio(new Error('x'))).toBe(false);
  });
});
