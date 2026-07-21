'use client';

import { useEffect, useState } from 'react';
import { Loader2, HardHat } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { techniciansApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import type { Technician, TechnicianWithPassword } from '@/types/technician';

type Props = {
  technician: Technician | null; // null = criar
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onCreated: (data: TechnicianWithPassword) => void;
};

function maskCpfInput(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

function maskPhoneInput(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  }
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
}

/** Toggle simples — o projeto ainda não tem Switch no shadcn instalado. */
function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/40"
    >
      <span
        className={cn(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors',
          checked ? 'bg-brand-orange-500' : 'bg-muted-foreground/30',
        )}
      >
        <span
          className={cn(
            'h-4 w-4 rounded-full bg-white transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </span>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

export function TechnicianFormDialog({
  technician,
  open,
  onOpenChange,
  onSaved,
  onCreated,
}: Props) {
  const editing = !!technician;
  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [phone, setPhone] = useState('');
  const [canReceive, setCanReceive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(technician?.name ?? '');
    setCpf(technician ? maskCpfInput(technician.cpf) : '');
    setPhone(technician?.phone ? maskPhoneInput(technician.phone) : '');
    setCanReceive(technician?.canReceiveEquipment ?? true);
    setSaving(false);
  }, [open, technician]);

  const handleSubmit = async () => {
    if (name.trim().length < 3) {
      toast.error('Informe o nome completo do técnico.');
      return;
    }
    if (!editing && cpf.replace(/\D/g, '').length !== 11) {
      toast.error('Informe um CPF com 11 dígitos.');
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await techniciansApi.update(technician.id, {
          name: name.trim(),
          phone: phone.replace(/\D/g, '') || undefined,
          canReceiveEquipment: canReceive,
        });
        toast.success('Técnico atualizado');
        onSaved();
        onOpenChange(false);
      } else {
        const created = await techniciansApi.create({
          name: name.trim(),
          cpf: cpf.replace(/\D/g, ''),
          phone: phone.replace(/\D/g, '') || undefined,
          canReceiveEquipment: canReceive,
        });
        onSaved();
        onOpenChange(false);
        onCreated(created); // abre o dialog da senha provisória
      }
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Erro ao salvar técnico';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardHat className="h-5 w-5 text-brand-orange-500" />
            {editing ? 'Editar técnico' : 'Novo técnico'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tec-nome">Nome completo</Label>
            <Input
              id="tec-nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Iury Queiroz de Oliveira"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tec-cpf">CPF {editing && '(não editável)'}</Label>
              <Input
                id="tec-cpf"
                value={cpf}
                onChange={(e) => setCpf(maskCpfInput(e.target.value))}
                placeholder="000.000.000-00"
                inputMode="numeric"
                disabled={editing}
              />
              {!editing && (
                <p className="text-[11px] text-muted-foreground">
                  É com o CPF que ele entra no app de campo.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tec-fone">Celular</Label>
              <Input
                id="tec-fone"
                value={phone}
                onChange={(e) => setPhone(maskPhoneInput(e.target.value))}
                placeholder="(21) 99999-8888"
                inputMode="numeric"
              />
            </div>
          </div>

          <Toggle
            checked={canReceive}
            onChange={setCanReceive}
            label="Pode receber equipamentos"
            hint="Aparece na lista ao enviar rastreadores do estoque pro técnico."
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {editing ? 'Salvar' : 'Cadastrar e gerar senha'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
