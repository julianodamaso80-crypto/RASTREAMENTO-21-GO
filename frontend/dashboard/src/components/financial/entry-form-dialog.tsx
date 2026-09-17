'use client';

import { useEffect, useState } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { financialApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectNative } from '@/components/ui/select-native';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { FinancialStatus } from '@/types/financial';
import { MONTHS } from './financial-meta';
import { StatusSelect } from './status-select';

export function EntryFormDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [plate, setPlate] = useState('');
  const [status, setStatus] = useState<FinancialStatus>('PAID_PIX');
  const [month, setMonth] = useState<string>(String(new Date().getMonth() + 1));
  const [consultantName, setConsultantName] = useState('');
  const [receiptId, setReceiptId] = useState('');
  const [plateCount, setPlateCount] = useState('1');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPlate('');
    setStatus('PAID_PIX');
    setMonth(String(new Date().getMonth() + 1));
    setConsultantName('');
    setReceiptId('');
    setPlateCount('1');
  }, [open]);

  const save = async () => {
    if (!plate.trim()) {
      toast.error('Informe a placa');
      return;
    }
    const qtd = Number(plateCount);
    if (!Number.isInteger(qtd) || qtd < 1) {
      toast.error('Quantidade de placas precisa ser 1 ou mais');
      return;
    }
    setSaving(true);
    try {
      await financialApi.create({
        plate: plate.trim().toUpperCase(),
        status,
        month: month ? Number(month) : null,
        consultantName: consultantName.trim() || null,
        receiptId: receiptId.trim() || null,
        plateCount: qtd,
      });
      toast.success('Lançamento salvo');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message || 'Erro ao salvar o lançamento';
      toast.error(Array.isArray(msg) ? msg.join('. ') : msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-brand-orange-500" />
            Novo lançamento
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="fin-placa">Placa</Label>
            <Input
              id="fin-placa"
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="Ex.: SRL5A25"
              autoFocus
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Situação financeira</Label>
            <StatusSelect value={status} onChange={setStatus} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fin-mes">Mês</Label>
            <SelectNative id="fin-mes" value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">Sem mês</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </SelectNative>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fin-qtd">Quantidade de placas</Label>
            <Input
              id="fin-qtd"
              type="number"
              min={1}
              value={plateCount}
              onChange={(e) => setPlateCount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="fin-consultor">Nome consultor</Label>
            <Input
              id="fin-consultor"
              value={consultantName}
              onChange={(e) => setConsultantName(e.target.value)}
              placeholder="Ex.: RAMON PONTES ARAUJO"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="fin-comprovante">ID do comprovante</Label>
            <Input
              id="fin-comprovante"
              value={receiptId}
              onChange={(e) => setReceiptId(e.target.value)}
              placeholder="Ex.: E18236120202609021756s12ddb5002f"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
