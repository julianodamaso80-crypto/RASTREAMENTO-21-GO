import { useEffect, useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { Marker } from 'react-native-maps';
import { Vehicle } from '@/lib/api';
import { markerSource, vehicleStatus } from '@/lib/vehicle-visual';

/**
 * Marcador realista de veículo — mesma leitura visual do dashboard web:
 * desenho vista-de-cima (carro x moto) girando na direção real do GPS, com
 * anel colorido por status e "pulso" quando em movimento.
 *
 * `tracksViewChanges` fica ligado só por um instante a cada mudança visual;
 * mantê-lo sempre ligado redesenha o marcador a cada frame (drena bateria e
 * é reprovado no review da Apple). A chave visual reativa o redraw só quando
 * cor/tipo/rumo mudam.
 */
export function VehicleMarker({
  vehicle,
  onPress,
}: {
  vehicle: Vehicle;
  onPress?: () => void;
}) {
  const p = vehicle.position;
  const st = vehicleStatus(vehicle);
  const course = p?.course ?? 0;
  const visualKey = `${st.color}|${vehicle.vehicleType}|${st.moving}|${Math.round(course)}`;

  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    setTracks(true);
    const t = setTimeout(() => setTracks(false), 700);
    return () => clearTimeout(t);
  }, [visualKey]);

  if (!p) return null;

  return (
    <Marker
      coordinate={{ latitude: p.latitude, longitude: p.longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={onPress}
      title={vehicle.plate}
      description={st.label}
      tracksViewChanges={tracks}
    >
      <View style={styles.wrap}>
        {st.moving && (
          <View style={[styles.pulse, { backgroundColor: st.color }]} />
        )}
        <View style={[styles.ring, { borderColor: st.color }]} />
        <Image
          source={markerSource(vehicle.vehicleType)}
          style={[styles.img, { transform: [{ rotate: `${course}deg` }] }]}
          resizeMode="contain"
        />
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    position: 'absolute',
    width: 54,
    height: 54,
    borderRadius: 27,
    opacity: 0.3,
  },
  ring: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 3,
    backgroundColor: 'rgba(15,23,42,0.25)',
  },
  img: {
    width: 38,
    height: 38,
  },
});
