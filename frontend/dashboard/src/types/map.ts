export interface GoogleTileSource {
  provider: 'google';
  tiles: string[];
  tileSize: number;
  maxzoom: number;
  attribution: string;
  /** epoch ms — sessão do Google expira em ~2 semanas. */
  expiresAt: number;
}
