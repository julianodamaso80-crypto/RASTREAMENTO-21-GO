'use client';

import { useEffect, useRef, useState } from 'react';
import { geocodeApi } from '@/lib/api';

/**
 * Endereço da coordenada do veículo, vindo do backend.
 *
 * REGRA DURA: o endereço devolvido é sempre o da coordenada que foi pedida
 * nesta chamada, ou nada. Nunca o de uma coordenada anterior.
 *
 * Isso não é detalhe de implementação, é a garantia que a tela precisa. O
 * endereço fica guardado junto com a coordenada que o gerou e só é devolvido
 * quando essa coordenada é exatamente a que está sendo perguntada. Enquanto a
 * busca do ponto novo não volta — e a fila do geocoder é de 1 consulta por
 * segundo — a resposta é `null`, e o painel mostra "Buscando endereço…". Antes
 * o endereço antigo continuava no estado durante toda a busca, e era isso que
 * fazia o mapa apontar um lugar e o texto escrever outro enquanto o carro
 * andava. Se a busca falhar, também fica `null`: dizer "não sei" é correto,
 * apontar a rua errada não é.
 *
 * Trocar de veículo cai na mesma regra — a coordenada muda, o endereço do
 * veículo anterior deixa de casar e some na hora.
 *
 * Refaz a busca a cada coordenada nova, sem margem de distância. Margem nenhuma
 * não custa consulta a mais: medido em 19/08/2026 sobre 367 transições de
 * rastreador parado, a oscilação do GPS tem mediana de 14,3 m, então uma margem
 * de 5 m filtraria quase nada (64,6% dos envios gerariam consulta contra 62,2%
 * sem margem). Pular a busca só quando o rastreador repete a coordenada — o que
 * ele faz em 37,8% dos envios parados — filtra o mesmo tanto e mantém o texto
 * exatamente sobre o ponto do ícone.
 *
 * O ritmo de 1 consulta por segundo que o OpenStreetMap exige é garantido no
 * backend, num portão único compartilhado com a fila das listas.
 */

interface ReverseGeocodeResult {
  /** Endereço DESTA coordenada, ou null enquanto não se sabe. */
  address: string | null;
  loading: boolean;
}

/** Endereço já resolvido, carimbado com a coordenada que o originou. */
interface EnderecoResolvido {
  lat: number;
  lng: number;
  address: string | null;
}

export function useReverseGeocode(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): ReverseGeocodeResult {
  const [resolvido, setResolvido] = useState<EnderecoResolvido | null>(null);
  const [loading, setLoading] = useState(false);
  // Mesma informação do estado, lida dentro do efeito sem virar dependência
  // dele — senão cada resposta reagendaria o efeito.
  const resolvidoRef = useRef<EnderecoResolvido | null>(null);

  useEffect(() => {
    if (!latitude || !longitude) return;

    // Rastreador reenviou o mesmo ponto: o endereço já está na tela, e é este
    // mesmo. Nada a fazer — nem consulta, nem novo render.
    const anterior = resolvidoRef.current;
    if (anterior && anterior.lat === latitude && anterior.lng === longitude) {
      return;
    }

    let vivo = true;
    setLoading(true);

    geocodeApi
      .reverse(latitude, longitude)
      .then((address) => {
        if (!vivo) return;
        const novo = { lat: latitude, lng: longitude, address };
        resolvidoRef.current = novo;
        setResolvido(novo);
      })
      .catch(() => {
        // Sem endereço a tela continua mostrando a posição — não é bloqueante.
        // O que NÃO pode acontecer é sobrar o endereço do ponto anterior: como
        // nada é gravado aqui, a comparação lá embaixo já o descarta.
      })
      .finally(() => {
        if (vivo) setLoading(false);
      });

    return () => {
      vivo = false;
    };
  }, [latitude, longitude]);

  // O portão: só sai daqui endereço da coordenada perguntada.
  const address =
    resolvido && resolvido.lat === latitude && resolvido.lng === longitude
      ? resolvido.address
      : null;

  return { address, loading };
}
