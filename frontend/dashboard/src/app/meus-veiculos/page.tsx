'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Car, History, Loader2, Lock, LockOpen, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HistoricoDoVeiculo } from '@/components/historico/historico-do-veiculo';
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

/** Mesma regra do app: quem manda é o relé informado pelo rastreador; sem a informação vale o que o sistema gravou. */
function estadoBloqueio(v: AssociateVehicle): 'BLOQUEADO' | 'BLOQUEIO_PENDENTE' | 'DESBLOQUEIO_PENDENTE' | null {
  const doRastreador = v.position?.blocked ?? null;
  const comandado = v.status === 'BLOCKED';
  if (doRastreador === true) return comandado ? 'BLOQUEADO' : 'DESBLOQUEIO_PENDENTE';
  if (doRastreador === false) return comandado ? 'BLOQUEIO_PENDENTE' : null;
  return comandado ? 'BLOQUEADO' : null;
}

const ROTULO_BLOQUEIO = {
  BLOQUEADO: 'Bloqueado',
  BLOQUEIO_PENDENTE: 'Bloqueio enviado, aguardando o rastreador',
  DESBLOQUEIO_PENDENTE: 'Desbloqueio enviado, aguardando o rastreador',
};

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
  const [historicoDe, setHistoricoDe] = useState<AssociateVehicle | null>(null);
  const [enviandoBloqueio, setEnviandoBloqueio] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setVeiculos(await associateApi.vehicles());
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } }).response?.status === 401) sair();
    }
  }, []);

  async function alternarBloqueio(v: AssociateVehicle) {
    const bloquear = v.status !== 'BLOCKED';
    const ok = window.confirm(
      bloquear
        ? `Bloquear o veículo ${v.plate}? Ele vai parar de funcionar. Se estiver em movimento, pode desligar no meio da via.`
        : `Desbloquear o veículo ${v.plate}? Ele volta a funcionar normalmente.`,
    );
    if (!ok) return;
    setEnviandoBloqueio(v.id);
    try {
      const r = await associateApi.setBlocked(v.id, bloquear);
      toast.success(
        r.queued
          ? `O rastreador está sem conexão agora. O veículo será ${bloquear ? 'bloqueado' : 'desbloqueado'} assim que ele se comunicar.`
          : `${bloquear ? 'Bloqueio' : 'Desbloqueio'} enviado. A confirmação aparece aqui em alguns minutos.`,
      );
      await carregar();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status;
      toast.error(
        status === 403
          ? 'O bloqueio não está liberado para este veículo. Fale com a 21 Go.'
          : 'Não conseguimos enviar o comando agora. Tente de novo em instantes.',
      );
    } finally {
      setEnviandoBloqueio(null);
    }
  }

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
                <div
                  key={v.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelecionado(v.id)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      setSelecionado(v.id);
                    }
                  }}
                  className={`flex w-full cursor-pointer gap-3 border-b px-4 py-3 text-left hover:bg-muted/50 ${
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
                    {estadoBloqueio(v) ? (
                      <div className="mt-1 text-xs font-semibold text-amber-600">
                        {ROTULO_BLOQUEIO[estadoBloqueio(v)!]}
                      </div>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          setHistoricoDe(v);
                        }}
                      >
                        <History className="mr-1.5 h-3.5 w-3.5" /> Histórico
                      </Button>
                      {v.blockerAccessAllowed ? (
                        <Button
                          variant={v.status === 'BLOCKED' ? 'outline' : 'destructive'}
                          size="sm"
                          className="h-7"
                          disabled={enviandoBloqueio === v.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            alternarBloqueio(v);
                          }}
                        >
                          {enviandoBloqueio === v.id ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : v.status === 'BLOCKED' ? (
                            <LockOpen className="mr-1.5 h-3.5 w-3.5" />
                          ) : (
                            <Lock className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          {v.status === 'BLOCKED' ? 'Desbloquear veículo' : 'Bloquear veículo'}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </aside>
        <main className="min-h-0 flex-1">
          <Mapa veiculos={veiculos ?? []} selecionado={selecionado} />
        </main>
      </div>

      <Dialog open={!!historicoDe} onOpenChange={(aberto) => !aberto && setHistoricoDe(null)}>
        <DialogContent className="max-h-[92dvh] w-[96vw] max-w-4xl overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Histórico · {historicoDe?.plate}</DialogTitle>
          </DialogHeader>
          {historicoDe && (
            <HistoricoDoVeiculo
              carregarDia={(dia) => associateApi.journey(historicoDe.id, dia)}
              carregarRelatorio={(from, to, tipo) =>
                associateApi.historyReport(historicoDe.id, from, to, tipo)
              }
              diasViagens={30}
              diasConsulta={31}
              nomeArquivo={`historico-${historicoDe.plate}`}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
