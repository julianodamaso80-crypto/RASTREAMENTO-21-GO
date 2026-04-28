'use client';

import { useEffect, useMemo, useState } from 'react';
import { Tag, Wifi, WifiOff, RefreshCw, Bluetooth } from 'lucide-react';
import { toast } from 'sonner';
import { useTracking } from '@/contexts/tracking-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelativeTime } from '@/lib/utils';
import type { BleTag } from '@/types/ble-tag';

const MODEL_LABELS: Record<BleTag['model'], string> = {
  BLE_KTAG: 'K-Tag',
  BLE_REDTAG: 'RedTag',
  BLE_AIRTAG_GENERIC: 'AirTag (genérica)',
};

function rssiQuality(rssi: number): { label: string; color: string } {
  if (rssi >= -55) return { label: 'Excelente', color: 'text-emerald-400' };
  if (rssi >= -70) return { label: 'Bom', color: 'text-emerald-300' };
  if (rssi >= -85) return { label: 'Médio', color: 'text-amber-400' };
  return { label: 'Fraco', color: 'text-red-400' };
}

function isOnline(lastConnection: string | null): boolean {
  if (!lastConnection) return false;
  const diff = Date.now() - new Date(lastConnection).getTime();
  return diff < 5 * 60 * 1000; // online se detectou nos últimos 5min
}

export default function EtiquetasBlePage() {
  const { bleTags, refreshBleTags, isSocketConnected } = useTracking();
  const [refreshing, setRefreshing] = useState(false);
  const [, forceRender] = useState(0);

  // Re-renderiza a cada 30s pra atualizar "tempo desde última detecção"
  useEffect(() => {
    const id = setInterval(() => forceRender((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Carrega na primeira renderização
  useEffect(() => {
    refreshBleTags();
  }, [refreshBleTags]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshBleTags();
      toast.success('Lista atualizada');
    } catch {
      toast.error('Erro ao atualizar');
    } finally {
      setRefreshing(false);
    }
  };

  const onlineCount = useMemo(
    () => bleTags.filter((t) => isOnline(t.lastConnection)).length,
    [bleTags],
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Tag className="h-6 w-6 text-brand-orange-500" />
            Etiquetas BLE
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            TAGs Bluetooth (K-Tag, RedTag, AirTag) detectadas pelo scanner local.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={isSocketConnected ? 'default' : 'secondary'}
            className="flex items-center gap-1"
          >
            {isSocketConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {isSocketConnected ? 'Tempo real' : 'Offline'}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            <span className="ml-2">Atualizar</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{bleTags.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Detectadas (5min)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-emerald-400">{onlineCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Sem detecção</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-muted-foreground">
              {bleTags.length - onlineCount}
            </div>
          </CardContent>
        </Card>
      </div>

      {bleTags.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Bluetooth className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Nenhuma TAG cadastrada</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Cadastre uma TAG em <span className="font-medium">Dispositivos</span> com modelo
              <span className="font-medium"> BLE_KTAG</span>, <span className="font-medium">BLE_REDTAG</span> ou
              <span className="font-medium"> BLE_AIRTAG_GENERIC</span>. Em seguida, rode o scanner Python
              em <code className="text-xs bg-muted px-1 rounded">poc-ktag-findmy/scanner/</code>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">TAGs cadastradas</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">TAG</th>
                    <th className="px-4 py-3 font-medium">Modelo</th>
                    <th className="px-4 py-3 font-medium">Veículo</th>
                    <th className="px-4 py-3 font-medium">RSSI</th>
                    <th className="px-4 py-3 font-medium">Scanner</th>
                    <th className="px-4 py-3 font-medium">Última detecção</th>
                  </tr>
                </thead>
                <tbody>
                  {bleTags.map((tag) => {
                    const lastSighting = tag.bleSightings?.[0];
                    const online = isOnline(tag.lastConnection);
                    const quality = lastSighting ? rssiQuality(lastSighting.rssi) : null;

                    return (
                      <tr key={tag.id} className="border-b border-border/30 hover:bg-muted/20">
                        <td className="px-4 py-3">
                          <div className="font-medium flex items-center gap-2">
                            <span
                              className={
                                online
                                  ? 'h-2 w-2 rounded-full bg-emerald-400 animate-pulse'
                                  : 'h-2 w-2 rounded-full bg-muted-foreground/40'
                              }
                            />
                            {tag.brand || 'TAG'} {tag.imei}
                          </div>
                          {tag.notes && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {tag.notes}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline">{MODEL_LABELS[tag.model]}</Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {tag.vehicle ? (
                            <span>
                              {tag.vehicle.plate}{' '}
                              <span className="text-xs">
                                ({tag.vehicle.brand} {tag.vehicle.model})
                              </span>
                            </span>
                          ) : (
                            <span className="text-xs italic">não vinculada</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {lastSighting && quality ? (
                            <div>
                              <div className={`font-mono text-xs ${quality.color}`}>
                                {lastSighting.rssi} dBm
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {quality.label}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {lastSighting?.scannerSource || '—'}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {tag.lastConnection ? (
                            <span className={online ? 'text-emerald-400' : 'text-muted-foreground'}>
                              {formatRelativeTime(tag.lastConnection)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground italic">nunca</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
