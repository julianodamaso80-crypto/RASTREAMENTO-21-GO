'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HardHat, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { stockApi, techniciansApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SelectNative } from '@/components/ui/select-native';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import type { StockItem } from '@/types/stock';
import type { Technician } from '@/types/technician';

type Props = {
  items: StockItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
};

/**
 * Envia equipamentos do estoque pro login de um técnico. Sempre em lote — um
 * único item selecionado é só um lote de tamanho 1.
 */
export function AssignTechnicianDialog({ items, open, onOpenChange, onAssigned }: Props) {
  const [technicians, setTechnicians] = useState<Technician[] | null>(null);
  const [technicianId, setTechnicianId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTechnicianId('');
    setTechnicians(null);
    techniciansApi
      .getAll()
      .then((all) => setTechnicians(all.filter((t) => t.active && t.canReceiveEquipment)))
      .catch(() => {
        toast.error('Erro ao carregar técnicos');
        setTechnicians([]);
      });
  }, [open]);

  const handleSubmit = async () => {
    if (!technicianId) {
      toast.error('Escolha o técnico que vai receber.');
      return;
    }
    const nome = technicians?.find((t) => t.id === technicianId)?.name ?? 'o técnico';

    setSaving(true);
    try {
      const res = await stockApi.assign(
        items.map((i) => i.id),
        technicianId,
      );
      if (res.skipped.length === 0) {
        toast.success(`${res.ok} equipamento(s) reservado(s) para ${nome}`);
      } else {
        toast.warning(
          `${res.ok} reservado(s). ${res.skipped.length} não: ` +
            res.skipped
              .slice(0, 3)
              .map((s) => `${s.imei} (${s.motivo})`)
              .join(', ') +
            (res.skipped.length > 3 ? '…' : ''),
        );
      }
      onAssigned();
      onOpenChange(false);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Erro ao reservar equipamentos';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardHat className="h-5 w-5 text-brand-orange-500" />
            Enviar pro técnico
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="text-sm">
              <strong>{items.length}</strong> equipamento(s) selecionado(s)
            </p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground break-all">
              {items
                .slice(0, 4)
                .map((i) => i.imei)
                .join(', ')}
              {items.length > 4 && ` +${items.length - 4}`}
            </p>
          </div>

          {technicians === null ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : technicians.length === 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p className="text-xs text-amber-200">
                Nenhum técnico habilitado a receber equipamentos.{' '}
                <Link href="/tecnicos" className="underline">
                  Cadastre um técnico
                </Link>{' '}
                primeiro.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="tec-select">Técnico</Label>
              <SelectNative
                id="tec-select"
                value={technicianId}
                onChange={(e) => setTechnicianId(e.target.value)}
              >
                <option value="">Selecione o técnico</option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.assignedCount} em campo)
                  </option>
                ))}
              </SelectNative>
              <p className="text-[11px] text-muted-foreground">
                Ele vê os equipamentos ao entrar em <strong>/tecnico</strong> pelo celular.
                Ao finalizar a instalação, o equipamento sai da lista dele.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || !technicianId || !technicians?.length}
          >
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
