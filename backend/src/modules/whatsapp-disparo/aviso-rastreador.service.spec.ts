import axios from 'axios';
import { AvisoRastreadorService, parametrosInstalado } from './aviso-rastreador.service';

jest.mock('axios');
const post = axios.post as jest.Mock;

function montar(cfg: Record<string, string | undefined>) {
  return new AvisoRastreadorService({ get: (k: string) => cfg[k] } as never);
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
});
