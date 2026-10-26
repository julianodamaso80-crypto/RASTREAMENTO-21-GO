'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Crosshair, Loader2, MapPin, Navigation } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { BASEMAPS, MAP_CENTER, VEHICLE_ICONS } from '@/lib/constants';
import { linkGoogleMaps, type LocalizacaoPublica } from '@/lib/compartilhar-localizacao';

const ATUALIZA_MS = 20_000;

function hora(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'ok'; dados: LocalizacaoPublica }
  | { tipo: 'expirado' }
  | { tipo: 'nao-encontrado' };

export default function LocalizacaoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });
  const box = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const marcador = useRef<maplibregl.Marker | null>(null);
  const imagem = useRef<HTMLImageElement | null>(null);
  const enquadrou = useRef(false);
  const [pronto, setPronto] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/public/localizacao/${encodeURIComponent(token)}`,
        { cache: 'no-store' },
      );
      if (r.status === 410) return setEstado({ tipo: 'expirado' });
      if (r.status === 404) return setEstado({ tipo: 'nao-encontrado' });
      if (!r.ok) return; // falha passageira: mantém o que já está na tela
      const json = await r.json();
      const dados = (json?.data ?? json) as LocalizacaoPublica;
      // O prazo pode vencer com a página aberta.
      if (new Date(dados.expiresAt).getTime() <= Date.now()) return setEstado({ tipo: 'expirado' });
      setEstado({ tipo: 'ok', dados });
    } catch {
      // Sem rede no momento: tenta de novo no próximo ciclo.
    }
  }, [token]);

  useEffect(() => {
    const primeira = setTimeout(carregar, 0);
    const t = setInterval(carregar, ATUALIZA_MS);
    return () => {
      clearTimeout(primeira);
      clearInterval(t);
    };
  }, [carregar]);

  const temMapa = estado.tipo === 'ok';
  useEffect(() => {
    if (!temMapa || !box.current || mapa.current) return;
    const m = new maplibregl.Map({
      container: box.current,
      style: BASEMAPS[0].url,
      center: MAP_CENTER,
      zoom: 11,
    });
    m.addControl(new maplibregl.NavigationControl(), 'top-right');
    m.on('load', () => setPronto(true));
    mapa.current = m;
    return () => {
      m.remove();
      mapa.current = null;
      marcador.current = null;
      enquadrou.current = false;
      setPronto(false);
    };
  }, [temMapa]);

  const pos = estado.tipo === 'ok' ? estado.dados.position : null;
  const tipoVeiculo = estado.tipo === 'ok' ? estado.dados.vehicleType : 'CAR';

  useEffect(() => {
    const m = mapa.current;
    if (!m || !pronto || !pos) return;
    if (!marcador.current) {
      const el = document.createElement('div');
      const img = document.createElement('img');
      img.src = VEHICLE_ICONS[tipoVeiculo === 'MOTORCYCLE' ? 'MOTORCYCLE' : 'CAR'];
      img.alt = '';
      img.style.width = '36px';
      img.style.height = '36px';
      img.style.objectFit = 'contain';
      el.appendChild(img);
      imagem.current = img;
      marcador.current = new maplibregl.Marker({ element: el })
        .setLngLat([pos.longitude, pos.latitude])
        .addTo(m);
    } else {
      marcador.current.setLngLat([pos.longitude, pos.latitude]);
    }
    if (imagem.current) imagem.current.style.transform = `rotate(${pos.course || 0}deg)`;
    if (!enquadrou.current) {
      enquadrou.current = true;
      m.jumpTo({ center: [pos.longitude, pos.latitude], zoom: 16 });
    }
  }, [pos, pronto, tipoVeiculo]);

  function centralizar() {
    if (pos && mapa.current) {
      mapa.current.flyTo({ center: [pos.longitude, pos.latitude], zoom: 16 });
    }
  }

  if (estado.tipo === 'carregando') {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (estado.tipo !== 'ok') {
    return (
      <div className="mx-auto flex h-dvh max-w-sm flex-col items-center justify-center px-6 text-center">
        <MapPin className="mb-3 h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-bold">
          {estado.tipo === 'expirado' ? 'Este link expirou' : 'Link não encontrado'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {estado.tipo === 'expirado'
            ? 'O prazo de compartilhamento acabou ou foi cancelado. Peça um link novo a quem te enviou.'
            : 'Confira se o link foi copiado inteiro.'}
        </p>
      </div>
    );
  }

  const d = estado.dados;
  const descricao = [d.brand, d.model, d.color].filter(Boolean).join(' · ');

  return (
    <div className="flex h-dvh flex-col">
      <header className="border-b px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-lg font-bold">{d.plate}</div>
          <div className="text-xs text-muted-foreground">Link válido até {hora(d.expiresAt)}</div>
        </div>
        {descricao && <div className="text-xs text-muted-foreground">{descricao}</div>}
      </header>

      <main className="relative min-h-0 flex-1">
        <div ref={box} className="h-full w-full" />
        {!pos && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 px-6 text-center text-sm text-muted-foreground">
            O rastreador ainda não enviou uma posição de GPS. A página atualiza sozinha.
          </div>
        )}
      </main>

      {pos && (
        <footer className="space-y-2 border-t px-4 py-3">
          <div className="text-sm">
            {pos.address || `${pos.latitude.toFixed(6)}, ${pos.longitude.toFixed(6)}`}
          </div>
          <div className="text-xs text-muted-foreground">
            {pos.speed} km/h · posição do GPS em {hora(pos.fixTime)}
            {d.lastUpdate ? ` · última comunicação ${hora(d.lastUpdate)}` : ''}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <a
              className={buttonVariants({ variant: 'default' })}
              href={linkGoogleMaps(pos.latitude, pos.longitude)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Navigation className="mr-1.5 h-4 w-4" /> Abrir no Google Maps
            </a>
            <Button variant="outline" onClick={centralizar}>
              <Crosshair className="mr-1.5 h-4 w-4" /> Centralizar
            </Button>
          </div>
        </footer>
      )}
    </div>
  );
}
