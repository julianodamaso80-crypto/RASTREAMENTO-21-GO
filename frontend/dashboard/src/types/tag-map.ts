/**
 * TAG de cliente no Mapa — um veículo que só tem TAG (sem rastreador nosso).
 *
 * É tudo o que a TAG sabe dizer: onde foi vista, quando e com que precisão.
 * Não existe ignição, velocidade, bloqueio nem "online": a posição é SEMPRE
 * passado, porque a TAG só é vista quando um iPhone passa perto dela.
 */
export interface TagNoMapa {
  /** `tag-<id do vínculo>` — o mesmo id do card em Clientes Ativos. */
  id: string;
  serialNumber: string;
  /** Onde a TAG foi escondida no veículo (segredo interno, como no rastreador). */
  installLocation?: string | null;
  plate: string;
  associateName: string;
  model: string | null;
  vehicleType: string;
  latitude: number | null;
  longitude: number | null;
  /** Raio de confiança da rede Find My, em metros. */
  accuracyM: number | null;
  /** Quando a TAG foi vista pela última vez (ISO). */
  seenAt: string | null;
  /**
   * Quando o coletor perguntou à rede Find My pela última vez (ISO), por
   * qualquer TAG. Separa "ninguém viu a TAG" de "ninguém perguntou".
   */
  redeConsultadaEm?: string | null;
  /**
   * O carro também tem rastreador nosso. A TAG aparece na aba TAG e na busca,
   * mas fica fora do total de "Todos" — o carro já conta pelo rastreador.
   */
  comRastreador?: boolean;
  /** Outras TAGs do mesmo carro: o ponto é um só, a busca acha por qualquer uma. */
  outrosSeriais?: string[];
  /** As mesmas outras TAGs, com o local de cada uma, para o painel. */
  outrasTags?: Array<{ serialNumber: string; installLocation: string | null }>;
}

/** Os perfis que enxergam TAG — espelho de `PERFIS_QUE_VEEM_TAG` no backend. */
export const PERFIS_QUE_VEEM_TAG = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'];
