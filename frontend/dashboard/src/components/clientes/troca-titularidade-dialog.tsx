'use client';

import { useState } from 'react';
import {
  Loader2,
  Search,
  UserRoundCog,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { clientsApi, stockApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import type { HinovaLookup } from '@/types/stock';

/** Ativo que está mudando de dono (dados só pra confirmação na tela). */
export interface TitularidadeAlvo {
  vehicleId: string;
  plate: string;
  donoAtual: string | null;
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-medium">{value?.trim() ? value : '—'}</p>
    </div>
  );
}

/**
 * Troca de titularidade — o carro foi vendido e o rastreador fica nele. Mesmo
 * fluxo do "Associar (SGA)" do Estoque: digita a placa, o SGA devolve o dono
 * atual do cadastro, e o ativo passa para ele. Sem técnico nem local: nada foi
 * instalado, só mudou o nome.
 */
export function TrocaTitularidadeDialog({
  alvo,
  onCancel,
  onDone,
}: {
  alvo: TitularidadeAlvo | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [placa, setPlaca] = useState('');
  const [lookup, setLookup] = useState<HinovaLookup | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [liberarInativo, setLiberarInativo] = useState(false);

  const { user } = useAuth();
  // Liberar troca com cadastro inativo é decisão de administrador — o backend
  // recusa de qualquer outra origem; aqui é só a tela acompanhando.
  const podeLiberarInativo =
    user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const reset = () => {
    setPlaca('');
    setLookup(null);
    setSearching(false);
    setSubmitting(false);
    setLiberarInativo(false);
  };

  const fechar = () => {
    reset();
    onCancel();
  };

  const handleSearch = async () => {
    const p = placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (p.length < 7) {
      toast.error('Digite a placa completa (7 caracteres) ou o chassi (17).');
      return;
    }
    setSearching(true);
    setLookup(null);
    setLiberarInativo(false);
    try {
      const res = await stockApi.sgaLookup(p);
      setLookup(res);
      if (!res.encontrado) {
        toast.error(res.motivo || 'Não localizei este veículo no SGA.');
      } else if (!res.ativo) {
        const situacao = res.situacao.descricao ?? 'INATIVA';
        toast.error(
          podeLiberarInativo
            ? `Placa ${situacao} no SGA — só com liberação de administrador.`
            : `Placa ${situacao} no SGA — troca bloqueada.`,
        );
      }
    } catch {
      toast.error('Erro ao consultar o SGA. Tente novamente.');
    } finally {
      setSearching(false);
    }
  };

  const motivoBloqueio =
    lookup?.encontrado && !lookup.ativo
      ? `Veículo ${lookup.situacao.descricao ?? 'INATIVO'} no SGA.`
      : null;
  const inativo = !!motivoBloqueio;
  const inativoLiberado = inativo && podeLiberarInativo && liberarInativo;
  const situacaoOk = !!lookup?.encontrado && (!inativo || inativoLiberado);
  // Placa consultada diferente da do ativo: a troca ainda é do mesmo carro
  // (ex.: placa nova no Mercosul), mas o operador precisa ver que está
  // renomeando o veículo, não escolhendo outro.
  const placaMudou =
    !!lookup?.encontrado &&
    !!alvo &&
    (lookup.veiculo.placa ?? placa).toUpperCase().replace(/[^A-Z0-9]/g, '') !==
      alvo.plate.toUpperCase().replace(/[^A-Z0-9]/g, '');

  const canConfirm = situacaoOk && !submitting;

  const handleConfirm = async () => {
    if (!alvo || !canConfirm) return;
    setSubmitting(true);
    const toastId = toast.loading('Trocando titularidade...');
    try {
      const r = await clientsApi.transferOwnership(alvo.vehicleId, {
        placa: placa.toUpperCase().replace(/[^A-Z0-9]/g, ''),
        ...(inativoLiberado ? { allowInactive: true } : {}),
      });
      toast.success(
        `${r.plate} agora é de ${r.to.name}${r.from ? ` (antes: ${r.from.name})` : ''}.`,
        { id: toastId },
      );
      reset();
      onDone();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string | string[] } } })
          ?.response?.data?.message || 'Erro ao trocar a titularidade.';
      toast.error(Array.isArray(msg) ? msg[0] : msg, { id: toastId });
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={!!alvo}
      onOpenChange={(aberto) => {
        if (!aberto && !submitting) fechar();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <UserRoundCog className="h-5 w-5 text-brand-orange-500" />
            Troca de titularidade
          </DialogTitle>
          <DialogDescription>
            O veículo <span className="font-semibold">{alvo?.plate}</span>
            {alvo?.donoAtual ? ` de ${alvo.donoAtual}` : ''} passa para o
            associado que o SGA devolver para a placa.{' '}
            {alvo?.vehicleId.startsWith('tag-')
              ? 'A TAG continua instalada.'
              : 'O rastreador continua instalado.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="troca-placa" required>
              Placa ou chassi do veículo (SGA)
            </Label>
            <div className="flex gap-2">
              <Input
                id="troca-placa"
                placeholder="ABC1D23 ou chassi"
                value={placa}
                onChange={(e) =>
                  setPlaca(e.target.value.toUpperCase().slice(0, 17))
                }
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="font-mono uppercase"
                autoComplete="off"
              />
              <Button type="button" onClick={handleSearch} disabled={searching}>
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                <span className="ml-1 hidden sm:inline">Buscar</span>
              </Button>
            </div>
          </div>

          {lookup?.encontrado && (
            <div
              className={
                'rounded-lg border p-3 space-y-3 ' +
                (inativo
                  ? 'border-red-500/40 bg-red-500/5'
                  : 'border-emerald-500/30 bg-emerald-500/5')
              }
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">
                  Novo titular (SGA)
                </span>
                {inativo ? (
                  <Badge className="bg-red-500/15 text-red-400 border border-red-500/30 text-xs">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {lookup.situacao.descricao ?? 'INATIVO'}
                  </Badge>
                ) : (
                  <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-xs">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    {lookup.situacao.descricao ?? 'ATIVO'}
                    {lookup.situacao.financeira
                      ? ` • ${lookup.situacao.financeira}`
                      : ''}
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
              {placaMudou && (
                <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  A placa consultada é diferente de {alvo?.plate}. O ativo passa
                  a usar a placa do SGA — confira se é o mesmo veículo.
                </p>
              )}
              {inativo &&
                (podeLiberarInativo ? (
                  <div className="space-y-2">
                    <p className="text-xs text-red-400">
                      {motivoBloqueio} Trocar assim mesmo é decisão do
                      administrador e fica registrada.
                    </p>
                    <label className="flex items-start gap-2 text-xs font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 cursor-pointer accent-brand-orange-500"
                        checked={liberarInativo}
                        onChange={(e) => setLiberarInativo(e.target.checked)}
                      />
                      <span>Liberar a troca assim mesmo</span>
                    </label>
                  </div>
                ) : (
                  <p className="text-xs text-red-400">
                    {motivoBloqueio} Só um administrador pode liberar esta troca.
                  </p>
                ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={fechar} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <UserRoundCog className="h-4 w-4 mr-1" />
            )}
            Confirmar troca
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
