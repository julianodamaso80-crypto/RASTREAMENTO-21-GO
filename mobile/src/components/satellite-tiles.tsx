import { UrlTile } from 'react-native-maps';

// Mesmo satélite do dashboard: Esri World Imagery (nítido, grátis, sem API key)
// + camadas de referência (transporte e nomes de lugares) por cima.
const IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TRANSPORT =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
const BOUNDARIES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

/** Camadas de satélite Esri idênticas às do painel web. Use dentro de <MapView>. */
export function SatelliteTiles() {
  return (
    <>
      <UrlTile urlTemplate={IMAGERY} maximumZ={19} zIndex={-3} />
      <UrlTile urlTemplate={TRANSPORT} maximumZ={19} zIndex={-2} />
      <UrlTile urlTemplate={BOUNDARIES} maximumZ={19} zIndex={-1} />
    </>
  );
}
