'use client';

import { useEffect, useRef, useState } from 'react';
import { geocodeApi } from '@/lib/api';

/**
 * Endereço de VÁRIAS coordenadas ao mesmo tempo — o painel dos marcados.
 *
 * Vale aqui a MESMA regra dura do `useReverseGeocode` de um ponto só: o
 * endereço devolvido é sempre o da coordenada perguntada, ou nada. Cada
 * resposta fica guardada carimbada com a coordenada que a gerou, e só sai
 * daqui quando essa coordenada é exatamente a que está sendo perguntada
 * agora. Veículo que andou volta a "Buscando endereço…" até o endereço novo
 * chegar — dizer "não sei" é correto, apontar a rua anterior não é, e o mapa
 * e o texto têm que bater sempre.
 *
 * O cache é por coordenada, não por veículo: carro parado repete o mesmo par
 * de números e não gera consulta nenhuma; dois marcados no mesmo pátio
 * compartilham a mesma entrada.
 *
 * Sobre volume: cada endereço é um `GET /geocode/reverse`, o mesmo endpoint do
 * painel de um veículo. O geocoder próprio não tem portão de 1/s (só o
 * Nominatim, que é o fallback), então lote é viável. Ainda assim as consultas
 * saem de {@link CONCORRENCIA} em {@link CONCORRENCIA}: se o dia estiver ruim e
 * o fallback público entrar, 20 chamadas simultâneas viram 20 esperas de 1,1 s
 * empilhadas dentro do backend.
 */

/** Quantas consultas em voo ao mesmo tempo. */
const CONCORRENCIA = 4;

export interface PontoGeocode {
  id: string;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
}

export interface EnderecoDoPonto {
  /** Endereço DESTA coordenada, ou null enquanto não se sabe. */
  address: string | null;
  loading: boolean;
}

/** Chave do cache: a coordenada crua, com o mesmo texto que foi consultado. */
function chave(lat: number, lng: number): string {
  return `${lat},${lng}`;
}

export function useReverseGeocodeMany(
  pontos: PontoGeocode[],
): Map<string, EnderecoDoPonto> {
  /** coordenada -> endereço resolvido (ou null quando a busca falhou). */
  const [cache, setCache] = useState<Map<string, string | null>>(new Map());
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  /** Coordenadas com consulta em voo — não pede a mesma duas vezes. */
  const emVooRef = useRef<Set<string>>(new Set());
  /** Falso depois que o painel sai de cena — aí a resposta não tem onde cair. */
  const montadoRef = useRef(true);
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  // Só as coordenadas entram na dependência do efeito. A lista de pontos é
  // recriada a cada atualização de posição de QUALQUER veículo do parque; sem
  // isso o efeito rodaria ~1x/s à toa.
  const assinatura = pontos
    .map((p) =>
      p.latitude != null && p.longitude != null
        ? chave(p.latitude, p.longitude)
        : '',
    )
    .join(';');

  useEffect(() => {
    // Cópia local do Set: o ref pode ter sido trocado quando a limpeza rodar,
    // e é ESTE conjunto que precisa devolver as coordenadas desta rodada.
    const emVoo = emVooRef.current;
    const faltando = assinatura
      .split(';')
      .filter((k) => k && !cacheRef.current.has(k) && !emVoo.has(k));
    if (faltando.length === 0) return;

    faltando.forEach((k) => emVoo.add(k));

    // Fila com no máximo CONCORRENCIA consultas em voo: cada "trabalhador"
    // puxa a próxima coordenada da lista até acabar.
    const fila = [...faltando];
    const trabalhador = async () => {
      for (;;) {
        const k = fila.shift();
        if (!k) return;
        const [lat, lng] = k.split(',').map(Number);
        let endereco: string | null = null;
        try {
          endereco = await geocodeApi.reverse(lat, lng);
        } catch {
          // Sem endereço a linha continua mostrando placa e estado — a falha
          // não é bloqueante. O que não pode é herdar o endereço de outro
          // ponto, e como a gravação é por coordenada isso não acontece.
        }
        emVoo.delete(k);
        // Não descarta por causa de troca de dependência: o efeito reroda
        // toda vez que QUALQUER marcado anda, e abortar ali jogaria fora a
        // consulta dos outros — que nunca chegaria a lugar nenhum se eles
        // andassem com frequência. A resposta é do PONTO, não da rodada:
        // guardá-la é sempre correto, e a leitura lá embaixo só a entrega a
        // quem estiver perguntando por essa coordenada.
        if (!montadoRef.current) return;
        setCache((prev) => {
          const proximo = new Map(prev);
          proximo.set(k, endereco);
          return proximo;
        });
      }
    };

    void Promise.all(
      Array.from({ length: Math.min(CONCORRENCIA, fila.length) }, trabalhador),
    );
  }, [assinatura]);

  const resultado = new Map<string, EnderecoDoPonto>();
  for (const p of pontos) {
    if (p.latitude == null || p.longitude == null) {
      resultado.set(p.id, { address: null, loading: false });
      continue;
    }
    const k = chave(p.latitude, p.longitude);
    // O portão: só sai daqui endereço da coordenada perguntada.
    const temResposta = cache.has(k);
    resultado.set(p.id, {
      address: temResposta ? (cache.get(k) ?? null) : null,
      loading: !temResposta,
    });
  }
  return resultado;
}
