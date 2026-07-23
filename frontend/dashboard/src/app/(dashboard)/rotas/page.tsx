'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Route as RouteIcon,
  Radio,
  Tag,
  MapPin,
  Send,
  X,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { routesApi, techniciansApi } from '@/lib/api';
import { CARTO_VOYAGER_URL } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import type { InstallationCluster, InstallationRoute } from '@/types/route';
import type { Technician } from '@/types/technician';

/**
 * Rota inteligente: o operador vê os bolsões de pendências no mapa, escolhe um,
 * ajusta quantas paradas e envia a rota ordenada pro técnico. As coordenadas
 * vêm do geocoding por CEP feito no sync das pendências.
 */
export default function RotasPage() {
  const [clusters, setClusters] = useState<InstallationCluster[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [routes, setRoutes] = useState<InstallationRoute[]>([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<InstallationCluster | null>(null);
  const [stops, setStops] = useState(10);
  const [technicianId, setTechnicianId] = useState('');
  const [sending, setSending] = useState(false);

  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  const load = useCallback(async () => {
    try {
      const [cl, tec, rt] = await Promise.all([
        routesApi.getClusters(60),
        techniciansApi.getAll(),
        routesApi.getRoutes(),
      ]);
      setClusters(cl);
      setTechnicians(tec.filter((t) => t.active && t.canReceiveEquipment));
      setRoutes(rt);
    } catch {
      toast.error('Erro ao carregar as rotas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Inicializa o mapa uma vez.
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: CARTO_VOYAGER_URL,
      center: [-43.4, -22.9], // RJ; o fitBounds ajusta quando os dados chegam
      zoom: 9,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Redesenha os bolsões quando mudam.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (!clusters.length) return;

      const bounds = new maplibregl.LngLatBounds();
      const maxCount = Math.max(...clusters.map((c) => c.count));

      for (const c of clusters) {
        const size = 22 + Math.round((c.count / maxCount) * 34); // 22–56px
        const el = document.createElement('div');
        el.style.cssText = `width:${size}px;height:${size}px;border-radius:9999px;
          display:flex;align-items:center;justify-content:center;cursor:pointer;
          font-weight:700;font-size:${size > 38 ? 13 : 11}px;color:#fff;
          background:rgba(249,115,22,0.85);border:2px solid #fff;
          box-shadow:0 1px 4px rgba(0,0,0,.4)`;
        el.textContent = String(c.count);
        el.title = `${c.neighborhood ?? c.city ?? 'Bolsão'} · ${c.count} instalações · raio ${c.radiusKm}km`;
        el.onclick = () => {
          setSelected(c);
          setStops(Math.min(10, c.count));
          map.flyTo({ center: [c.center.lng, c.center.lat], zoom: 12 });
        };
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([c.center.lng, c.center.lat])
          .addTo(map);
        markersRef.current.push(marker);
        bounds.extend([c.center.lng, c.center.lat]);
      }
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, maxZoom: 12 });
    };

    if (map.loaded()) draw();
    else map.once('load', draw);
  }, [clusters]);

  async function enviar() {
    if (!selected || !technicianId) return;
    setSending(true);
    try {
      const pendingIds = selected.pendingIds.slice(0, stops);
      const rota = await routesApi.create(technicianId, pendingIds);
      const tec = technicians.find((t) => t.id === technicianId);
      toast.success(
        `Rota com ${rota.stops.length} paradas enviada pra ${tec?.name ?? 'técnico'}`,
      );
      setSelected(null);
      setTechnicianId('');
      await load();
    } catch {
      toast.error('Falha ao montar a rota');
    } finally {
      setSending(false);
    }
  }

  const totalInstalacoes = useMemo(
    () => clusters.reduce((n, c) => n + c.count, 0),
    [clusters],
  );

  return (
    <div className="flex flex-col h-full min-w-0 p-4 md:p-6 gap-4 overflow-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <RouteIcon className="h-5 w-5 text-brand-orange-500" />
            Rota Inteligente
          </h1>
          <p className="text-sm text-muted-foreground">
            {clusters.length} bolsões · {totalInstalacoes} instalações geolocalizadas ·
            clique num bolsão pra montar a rota
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 shrink-0">
        {/* Mapa */}
        <Card className="lg:col-span-2 overflow-hidden">
          <div ref={mapContainer} className="h-[460px] w-full" />
        </Card>

        {/* Painel lateral */}
        <div className="flex flex-col gap-3">
          {loading ? (
            <Skeleton className="h-[460px] w-full rounded-lg" />
          ) : selected ? (
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold flex items-center gap-1.5">
                      <MapPin className="h-4 w-4 text-brand-orange-500" />
                      {selected.neighborhood ?? selected.city ?? 'Bolsão'}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {selected.count} instalações · raio {selected.radiusKm} km
                    </p>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-md bg-brand-orange-500/10 text-brand-orange-500 px-2 py-1">
                    <Radio className="h-3 w-3" /> {selected.tracker} rastreador
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 text-sky-400 px-2 py-1">
                    <Tag className="h-3 w-3" /> {selected.tag} TAG
                  </span>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Paradas na rota: <strong className="text-foreground">{stops}</strong>
                  </label>
                  <Slider
                    min={1}
                    max={selected.count}
                    value={[stops]}
                    onValueChange={(v) => setStops(v[0])}
                    className="mt-2"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Técnico
                  </label>
                  <SelectNative
                    value={technicianId}
                    onChange={(e) => setTechnicianId(e.target.value)}
                    className="mt-1"
                  >
                    <option value="">Escolha um técnico</option>
                    {technicians.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </SelectNative>
                  {technicians.length === 0 && (
                    <p className="text-[11px] text-amber-500 mt-1">
                      Nenhum técnico ativo apto a receber. Cadastre em Técnicos.
                    </p>
                  )}
                </div>

                <Button
                  className="w-full"
                  onClick={enviar}
                  disabled={!technicianId || sending}
                >
                  <Send className="h-4 w-4" />
                  {sending ? 'Enviando...' : `Montar e enviar (${stops})`}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center h-full">
                <RouteIcon className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Clique num bolsão no mapa pra montar a rota
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Rotas já enviadas */}
      <div className="shrink-0">
        <h2 className="text-sm font-semibold mb-2">Rotas enviadas</h2>
        {routes.filter((r) => r.status !== 'CANCELLED').length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma rota enviada ainda.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {routes
              .filter((r) => r.status !== 'CANCELLED')
              .map((r) => {
                const feitas = r.stops.filter((s) => s.status === 'DONE').length;
                return (
                  <Card key={r.id}>
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">
                          {r.technician?.name ?? 'Técnico'}
                        </span>
                        <span
                          className={cn(
                            'text-[10px] rounded px-1.5 py-0.5 border',
                            r.status === 'DONE'
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : 'bg-amber-500/15 text-amber-400 border-amber-500/30',
                          )}
                        >
                          {r.status === 'DONE' ? 'Concluída' : 'Em campo'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        <Check className="h-3 w-3" />
                        {feitas}/{r.stops.length} instaladas
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
