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
}

/** Os perfis que enxergam TAG — espelho de `PERFIS_QUE_VEEM_TAG` no backend. */
export const PERFIS_QUE_VEEM_TAG = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'];
