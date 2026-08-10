export interface GoogleTileSource {
  provider: 'google';
  tiles: string[];
  tileSize: number;
  /** Abaixo deste zoom o mapa fica no Esri (grátis) — economia por faixa. */
  minzoom: number;
  maxzoom: number;
  attribution: string;
  /** epoch ms — sessão do Google expira em ~2 semanas. */
  expiresAt: number;
}
