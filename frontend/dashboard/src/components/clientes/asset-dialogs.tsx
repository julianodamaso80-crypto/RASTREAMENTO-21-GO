'use client';

import { useEffect, useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { techniciansApi } from '@/lib/api';
import type { Technician } from '@/types/technician';

/** Senha temporária recém-gerada — aparece uma vez só. */
export interface SenhaTemporaria {
  nome: string;
  senha: string;
}

/** Rastreador em processo de retirada (dados só pra confirmação na tela). */
export interface RetiradaAlvo {
  deviceId: string;
  imei: string;
  plate: string;
  cliente: string;
}

/** Ativo cujo técnico está sendo corrigido. */
export interface TecnicoAlvo {
  vehicleId: string;
  plate: string;
  tecnicoAtual: string | null;
}

/**
 * A senha aparece uma única vez — no banco fica só o hash. Fechou, não volta.
 */
export function SenhaTemporariaDialog({
  senha,
  onClose,
}: {
  senha: SenhaTemporaria | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={!!senha}
      onOpenChange={(aberto) => {
        if (!aberto) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Senha temporária de {senha?.nome}</DialogTitle>
          <DialogDescription>
            Passe essa senha pro cliente. Ela aparece só agora — depois de
            fechar, nem o sistema consegue mostrar de novo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-4">
          <code className="flex-1 text-center font-mono text-2xl font-bold tracking-widest">
            {senha?.senha}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!senha) return;
              navigator.clipboard.writeText(senha.senha);
              toast.success('Senha copiada');
            }}
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            Copiar
          </Button>
        </div>

        <p className="rounded-md border border-sky-500/30 bg-sky-500/10 p-2 text-sm text-sky-200">
          O cliente entra no app com o CPF e essa senha. Na hora, o app pede pra
          ele criar a senha definitiva dele.
        </p>

        <DialogFooter>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Retirada do rastreador: o veículo sai do rastreamento e o aparelho volta pro
 * estoque disponível. Confirmação explícita porque o carro deixa de ser
 * monitorado no mesmo instante.
 */
export function RetirarRastreadorDialog({
  alvo,
  salvando,
  onCancel,
  onConfirm,
}: {
  alvo: RetiradaAlvo | null;
  salvando: boolean;
  onCancel: () => void;
  onConfirm: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (alvo) setMotivo('');
  }, [alvo]);

  return (
    <Dialog
      open={!!alvo}
      onOpenChange={(aberto) => {
        if (!aberto && !salvando) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Retirar rastreador</DialogTitle>
          <DialogDescription>
            O rastreador{' '}
            <span className="font-mono font-semibold">{alvo?.imei}</span> vai
            sair do veículo{' '}
            <span className="font-semibold">{alvo?.plate}</span> de{' '}
            {alvo?.cliente}.
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-sm text-amber-200">
          O veículo deixa de ser rastreado imediatamente e o aparelho volta pro
          estoque disponível. O histórico de posições é preservado.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="motivo-retirada">Motivo (opcional)</Label>
          <Input
            id="motivo-retirada"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: cliente cancelou o plano"
            maxLength={200}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(motivo.trim())}
            disabled={salvando}
          >
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar retirada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Corrige quem instalou. Importa porque a contagem por técnico e a auditoria de
 * um lote com defeito saem daqui.
 */
export function AlterarTecnicoDialog({
  alvo,
  salvando,
  onCancel,
  onConfirm,
}: {
  alvo: TecnicoAlvo | null;
  salvando: boolean;
  onCancel: () => void;
  onConfirm: (technicianId: string) => void;
}) {
  const [tecnicos, setTecnicos] = useState<Technician[]>([]);
  const [selecionado, setSelecionado] = useState('');
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!alvo) return;
    setSelecionado('');
    setCarregando(true);
    techniciansApi
      .getAll()
      .then(setTecnicos)
      .catch(() => toast.error('Não consegui carregar os técnicos.'))
      .finally(() => setCarregando(false));
  }, [alvo]);

  return (
    <Dialog
      open={!!alvo}
      onOpenChange={(aberto) => {
        if (!aberto && !salvando) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Alterar técnico</DialogTitle>
          <DialogDescription>
            Quem instalou o rastreador do veículo{' '}
            <span className="font-semibold">{alvo?.plate}</span>.
            {alvo?.tecnicoAtual
              ? ` Hoje está registrado como ${alvo.tecnicoAtual}.`
              : ' Hoje não há técnico registrado.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="tecnico-instalacao">Técnico</Label>
          <select
            id="tecnico-instalacao"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={selecionado}
            onChange={(e) => setSelecionado(e.target.value)}
            disabled={carregando || salvando}
          >
            <option value="">
              {carregando ? 'Carregando...' : 'Selecione o técnico'}
            </option>
            {tecnicos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            onClick={() => onConfirm(selecionado)}
            disabled={!selecionado || salvando}
          >
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
