import { tagsDaAba } from './tags-no-mapa';
import type { TagNoMapa } from '@/types/tag-map';

const tag = (id: string, extra: Partial<TagNoMapa> = {}): TagNoMapa => ({
  id,
  serialNumber: id,
  plate: id,
  associateName: 'X',
  model: null,
  vehicleType: 'CAR',
  latitude: -22.8,
  longitude: -43.2,
  accuracyM: 50,
  seenAt: '2026-10-10T18:10:50Z',
  ...extra,
});

// Dono, 28/10/2026: TAG de cliente INADIMPLENTE abria pela busca do topo e o
// Mapa dizia "Nenhum veículo encontrado".
describe('tagsDaAba — TAG fora da lista de Clientes Ativos', () => {
  const normal = tag('a');
  const oculta = tag('b', { foraDaLista: 'Cliente INADIMPLENTE no SGA' });
  const comRastreador = tag('c', { comRastreador: true });
  const todas = [normal, oculta, comRastreador];

  it('sem busca fica fora de Todos e da aba TAG (totais iguais a Clientes Ativos)', () => {
    expect(tagsDaAba(todas, 'all', false).map((t) => t.id)).toEqual(['a']);
    expect(tagsDaAba(todas, 'tag', false).map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('buscada aparece em Todos e na aba TAG', () => {
    expect(tagsDaAba(todas, 'all', true).map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(tagsDaAba(todas, 'tag', true).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('nunca entra nas abas de estado do rastreador', () => {
    expect(tagsDaAba(todas, 'online', true)).toEqual([]);
  });
});
