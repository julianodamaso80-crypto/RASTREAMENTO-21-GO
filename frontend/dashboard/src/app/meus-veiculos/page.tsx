'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Car, Loader2, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BASEMAPS, MAP_CENTER, STATUS_COLORS } from '@/lib/constants';
import {
  getDisplayStatus,
  getVehicleStatusLabel,
  ignicaoTexto,
  ultimaAtualizacao,
} from '@/lib/utils';
import type { DisplayStatus } from '@/types/vehicle';
import {
  associateApi,
  type AssociateMe,
  type AssociateVehicle,
} from '@/lib/associate-api';

const ATUALIZA_MS = 30_000;

function sair() {
  associateApi.logout();
  window.location.href = '/login';
}

function quando(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Estado da comunicação com a régua da RedeVeiculos (ONLINE, OFFLINE...). */
function estadoDe(v: AssociateVehicle): DisplayStatus {
  return getDisplayStatus({
    lastUpdate: v.connection?.lastUpdate ?? '',
    positionTime: v.position?.fixTime ?? null,
    latitude: v.position?.latitude ?? 0,
    longitude: v.position?.longitude ?? 0,
    vehicleStatus: v.status ?? 'ACTIVE',
    vehicleType: v.vehicleType ?? 'CAR',
  });
}

/** Primeiro acesso: a senha ainda é o CPF/CNPJ e precisa ser trocada, como no app. */
function TrocarSenha({ onPronto }: { onPronto: () => void }) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (nova.length < 6) return toast.error('A nova senha precisa ter ao menos 6 caracteres.');
    if (nova !== confirma) return toast.error('As senhas não conferem.');
    setSalvando(true);
    try {
      await associateApi.changePassword(atual, nova);
      toast.success('Senha alterada.');
      onPronto();
    } catch (err: unknown) {
      const m = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(m || 'Não foi possível trocar a senha.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 pt-16">
      <h1 className="text-xl font-bold">Crie sua senha</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        No primeiro acesso a senha é o seu CPF ou CNPJ. Escolha uma senha nova para continuar.
      </p>
      <form onSubmit={salvar} className="mt-6 space-y-3">
        <Input type="password" placeholder="Senha atual (seu CPF ou CNPJ)" value={atual} onChange={(e) => setAtual(e.target.value)} />
        <Input type="password" placeholder="Nova senha" value={nova} onChange={(e) => setNova(e.target.value)} />
        <Input type="password" placeholder="Repita a nova senha" value={confirma} onChange={(e) => setConfirma(e.target.value)} />
        <Button type="submit" disabled={salvando} className="w-full">
          {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar senha'}
        </Button>
      </form>
    </div>
  );
}

function Mapa({
  veiculos,
  selecionado,
}: {
  veiculos: AssociateVehicle[];
  selecionado: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const marcadores = useRef<maplibregl.Marker[]>([]);
  const enquadrou = useRef(false);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    if (!box.current) return;
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
    };
  }, []);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !pronto) return;
    marcadores.current.forEach((mk) => mk.remove());
    const comPosicao = veiculos.filter((v) => v.position);
    marcadores.current = comPosicao.map((v) =>
      new maplibregl.Marker({ color: STATUS_COLORS[estadoDe(v)] })
        .setLngLat([v.position!.longitude, v.position!.latitude])
        .setPopup(new maplibregl.Popup({ offset: 24 }).setText(v.plate))
        .addTo(m),
    );
    if (!enquadrou.current && comPosicao.length) {
      enquadrou.current = true;
      const b = new maplibregl.LngLatBounds();
      comPosicao.forEach((v) => b.extend([v.position!.longitude, v.position!.latitude]));
      m.fitBounds(b, { padding: 60, maxZoom: 16, duration: 0 });
    }
  }, [veiculos, pronto]);

  useEffect(() => {
    const v = veiculos.find((x) => x.id === selecionado);
    if (v?.position && mapa.current) {
      mapa.current.flyTo({ center: [v.position.longitude, v.position.latitude], zoom: 16 });
    }
    // Só reage à troca de seleção; a atualização periódica não pode puxar a câmera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionado]);

  return <div ref={box} className="h-full w-full" />;
}

export default function MeusVeiculosPage() {
  const [me, setMe] = useState<AssociateMe | null>(null);
  const [veiculos, setVeiculos] = useState<AssociateVehicle[] | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setVeiculos(await associateApi.vehicles());
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } }).response?.status === 401) sair();
    }
  }, []);

  useEffect(() => {
    if (!associateApi.getToken()) {
      window.location.href = '/login';
      return;
    }
    associateApi.me().then(setMe).catch(sair);
  }, []);

  useEffect(() => {
    if (!me || me.mustChangePassword) return;
    const primeira = setTimeout(carregar, 0);
    const t = setInterval(carregar, ATUALIZA_MS);
    return () => {
      clearTimeout(primeira);
      clearInterval(t);
    };
  }, [me, carregar]);

  if (!me) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (me.mustChangePassword) {
    return <TrocarSenha onPronto={() => setMe({ ...me, mustChangePassword: false })} />;
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <div className="text-sm text-muted-foreground">Olá,</div>
          <div className="font-semibold">{me.name}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={sair}>
          <LogOut className="mr-2 h-4 w-4" /> Sair
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="max-h-[40dvh] overflow-y-auto border-b md:max-h-none md:w-80 md:border-b-0 md:border-r">
          {veiculos === null ? (
            <div className="p-4 text-sm text-muted-foreground">Carregando…</div>
          ) : veiculos.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Nenhum veículo encontrado.</div>
          ) : (
            veiculos.map((v) => {
              const estado = estadoDe(v);
              const cor = STATUS_COLORS[estado];
              return (
                <button
                  key={v.id}
                  onClick={() => setSelecionado(v.id)}
                  className={`flex w-full gap-3 border-b px-4 py-3 text-left hover:bg-muted/50 ${
                    selecionado === v.id ? 'bg-muted' : ''
                  }`}
                >
                  <Car className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{v.plate}</span>
                      {/* Selo colorido como o da Rede: ONLINE, S/RESP, S/GPS, SLEEP, OFFLINE. */}
                      <span
                        className="rounded px-1.5 text-[10px] font-bold tracking-wide text-white"
                        style={{ backgroundColor: cor }}
                      >
                        {getVehicleStatusLabel(estado)}
                      </span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[v.brand, v.model, v.color].filter(Boolean).join(' · ')}
                    </div>
                    {v.position ? (
                      <>
                        <div className="mt-1 truncate text-xs">{v.position.address || 'Endereço indisponível'}</div>
                        <div className="text-xs text-muted-foreground">
                          Ignição {ignicaoTexto(estado, v.position.ignition === true)} ·{' '}
                          {estado === 'offline' ? 0 : Math.round(v.position.speed)} km/h · GPS {quando(v.position.fixTime)}
                        </div>
                      </>
                    ) : (
                      <div className="mt-1 text-xs text-muted-foreground">Sem posição ainda</div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {ultimaAtualizacao(v.connection?.lastUpdate ?? '')}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </aside>
        <main className="min-h-0 flex-1">
          <Mapa veiculos={veiculos ?? []} selecionado={selecionado} />
        </main>
      </div>
    </div>
  );
}
