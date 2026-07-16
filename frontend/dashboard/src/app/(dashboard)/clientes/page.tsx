'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Users,
  Search,
  Car,
  Radio,
  Wrench,
  MapPin,
  Phone,
  Mail,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDateOnlyBR } from '@/lib/utils';
import { clientsApi } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { ActiveClient } from '@/types/stock';

function formatCpf(cpf: string): string {
  const d = (cpf ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return cpf;
}

export default function ClientesPage() {
  const [clients, setClients] = useState<ActiveClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      setClients(await clientsApi.getActive(search || undefined));
    } catch {
      toast.error('Erro ao carregar clientes');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const totalVehicles = clients.reduce((n, c) => n + c.vehicles.length, 0);

  return (
    <div className="flex flex-col h-full p-4 md:p-6 gap-4 overflow-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Users className="h-5 w-5 text-brand-orange-500" />
            Clientes Ativos
          </h1>
          <p className="text-sm text-muted-foreground">
            Clientes com rastreador instalado e vinculado ao SGA
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
            <span className="text-xs text-muted-foreground">Clientes</span>
            <span className="text-lg font-bold">{clients.length}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
            <span className="text-xs text-muted-foreground">Veículos</span>
            <span className="text-lg font-bold">{totalVehicles}</span>
          </div>
        </div>
      </div>

      {/* Busca */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Buscar por nome, CPF/CNPJ ou placa..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhum cliente ativo ainda</p>
            <p className="text-xs text-muted-foreground mt-1">
              Associe um rastreador do <strong>Estoque</strong> a uma placa do SGA
              para ele aparecer aqui.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {clients.map((c) => (
            <Card key={c.id}>
              <CardContent className="p-4">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Users className="h-4 w-4 text-brand-orange-500 shrink-0" />
                      {c.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      CPF/CNPJ: {formatCpf(c.cpf)}
                      {c.hinovaCode ? ` • SGA ${c.hinovaCode}` : ''}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                      {c.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {c.phone}
                        </span>
                      )}
                      {c.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" /> {c.email}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    Desde {formatDateOnlyBR(c.createdAt)}
                  </span>
                </div>

                {/* Veículos do cliente */}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {c.vehicles.map((v) => (
                    <div
                      key={v.id}
                      className="rounded-lg border bg-muted/20 p-3 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold flex items-center gap-1.5">
                          <Car className="h-4 w-4 text-muted-foreground" />
                          {v.plate}
                        </span>
                        <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px]">
                          {v.status}
                        </Badge>
                      </div>
                      {v.model && (
                        <p className="text-xs text-muted-foreground mt-0.5">{v.model}</p>
                      )}
                      {v.device && (
                        <div className="mt-2 space-y-1 text-xs text-muted-foreground border-t pt-2">
                          <p className="flex items-center gap-1.5 font-mono">
                            <Radio className="h-3 w-3" /> {v.device.imei}
                          </p>
                          {v.device.installedBy && (
                            <p className="flex items-center gap-1.5">
                              <Wrench className="h-3 w-3" /> {v.device.installedBy}
                            </p>
                          )}
                          {v.device.installLocation && (
                            <p className="flex items-center gap-1.5">
                              <MapPin className="h-3 w-3" /> {v.device.installLocation}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
