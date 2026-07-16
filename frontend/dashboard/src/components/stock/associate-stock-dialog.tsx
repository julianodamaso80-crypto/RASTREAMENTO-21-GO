'use client';

import { useState } from 'react';
import { Loader2, Search, UserCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { hinovaApi, stockApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import type { StockItem, HinovaLookup } from '@/types/stock';

type Props = {
  item: StockItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssociated: () => void;
};

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value?.trim() ? value : '—'}</p>
    </div>
  );
}

export function AssociateStockDialog({ item, open, onOpenChange, onAssociated }: Props) {
  const [placa, setPlaca] = useState('');
  const [lookup, setLookup] = useState<HinovaLookup | null>(null);
  const [searching, setSearching] = useState(false);
  const [technicianName, setTechnicianName] = useState('');
  const [installLocation, setInstallLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setPlaca('');
    setLookup(null);
    setSearching(false);
    setTechnicianName('');
    setInstallLocation('');
    setSubmitting(false);
  };

  const handleClose = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const handleSearch = async () => {
    const p = placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (p.length < 7) {
      toast.error('Digite a placa completa (7 caracteres).');
      return;
    }
    setSearching(true);
    setLookup(null);
    try {
      const res = await hinovaApi.lookup(p);
      setLookup(res);
      if (!res.encontrado) {
        toast.error(res.motivo || 'Placa não encontrada no SGA.');
      } else if (!res.ativo) {
        toast.error('Placa INATIVA no SGA — vínculo bloqueado.');
      }
    } catch {
      toast.error('Erro ao consultar o SGA. Tente novamente.');
    } finally {
      setSearching(false);
    }
  };

  const canActivate =
    !!lookup?.encontrado &&
    !!lookup?.ativo &&
    technicianName.trim().length > 0 &&
    installLocation.trim().length > 0 &&
    !submitting;

  const handleActivate = async () => {
    if (!item || !canActivate) return;
    setSubmitting(true);
    const toastId = toast.loading('Ativando cliente...');
    try {
      await stockApi.associate(item.id, {
        placa: placa.toUpperCase().replace(/[^A-Z0-9]/g, ''),
        technicianName: technicianName.trim(),
        installLocation: installLocation.trim(),
      });
      toast.success('Cliente ativado! Rastreador vinculado e movido para Clientes Ativos.', {
        id: toastId,
      });
      reset();
      onAssociated();
      onOpenChange(false);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Erro ao ativar o cliente.';
      toast.error(Array.isArray(msg) ? msg[0] : msg, { id: toastId });
      setSubmitting(false);
    }
  };

  const inativo = lookup?.encontrado && !lookup.ativo;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-brand-orange-500" />
            Associar cliente e ativo
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {item && (
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
              <span className="text-muted-foreground">Rastreador:</span>{' '}
              <span className="font-mono">{item.imei}</span>
              {item.line ? <span className="text-muted-foreground"> • linha {item.line}</span> : null}
            </div>
          )}

          {/* Busca de placa no SGA */}
          <div className="space-y-1.5">
            <Label htmlFor="assoc-placa" required>Placa do veículo (SGA)</Label>
            <div className="flex gap-2">
              <Input
                id="assoc-placa"
                placeholder="ABC1D23"
                value={placa}
                onChange={(e) => setPlaca(e.target.value.toUpperCase().slice(0, 8))}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="font-mono uppercase"
                autoComplete="off"
              />
              <Button type="button" onClick={handleSearch} disabled={searching}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                <span className="ml-1 hidden sm:inline">Buscar</span>
              </Button>
            </div>
          </div>

          {/* Resultado do SGA */}
          {lookup?.encontrado && (
            <div
              className={
                'rounded-lg border p-3 space-y-3 ' +
                (inativo ? 'border-red-500/40 bg-red-500/5' : 'border-emerald-500/30 bg-emerald-500/5')
              }
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">Dados do SGA</span>
                {inativo ? (
                  <Badge className="bg-red-500/15 text-red-400 border border-red-500/30 text-xs">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {lookup.situacao.descricao ?? 'INATIVO'}
                  </Badge>
                ) : (
                  <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-xs">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    {lookup.situacao.descricao ?? 'ATIVO'}
                    {lookup.situacao.financeira ? ` • ${lookup.situacao.financeira}` : ''}
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cliente" value={lookup.cliente.nome} />
                <Field label="CPF/CNPJ" value={lookup.cliente.cpf} />
                <Field label="Placa" value={lookup.veiculo.placa} />
                <Field label="Chassi" value={lookup.veiculo.chassi} />
                <Field label="Modelo" value={lookup.veiculo.modelo} />
                <Field label="Vencimento" value={lookup.situacao.dataVencimento} />
              </div>
              {inativo && (
                <p className="text-xs text-red-400">
                  Veículo INATIVO no SGA. O vínculo só é permitido para veículos ATIVOS.
                </p>
              )}
            </div>
          )}

          {/* Dados da instalação — obrigatórios */}
          {lookup?.encontrado && lookup.ativo && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="assoc-tec" required>Técnico que instalou</Label>
                <Input
                  id="assoc-tec"
                  placeholder="Nome do técnico"
                  value={technicianName}
                  onChange={(e) => setTechnicianName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="assoc-local" required>Local de instalação</Label>
                <Input
                  id="assoc-local"
                  placeholder="Ex: atrás do porta-luvas"
                  value={installLocation}
                  onChange={(e) => setInstallLocation(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Cancelar</Button>
          <Button onClick={handleActivate} disabled={!canActivate}>
            {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <UserCheck className="h-4 w-4 mr-1" />}
            Ativar cliente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
