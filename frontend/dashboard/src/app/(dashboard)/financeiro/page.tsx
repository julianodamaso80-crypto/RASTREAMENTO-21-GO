'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Loader2, Plus, Search, Trash2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { financialApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SelectNative } from '@/components/ui/select-native';
import { EntryFormDialog } from '@/components/financial/entry-form-dialog';
import { StatusSelect } from '@/components/financial/status-select';
import { ConsultantCombobox } from '@/components/financial/consultant-combobox';
import { ReceiptCell } from '@/components/financial/receipt-cell';
import {
  FINANCIAL_STATUS_META,
  FINANCIAL_STATUS_ORDER,
  MONTHS,
} from '@/components/financial/financial-meta';
import type {
  FinancialEntry,
  FinancialEntryPayload,
  FinancialStatus,
} from '@/types/financial';

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'];

type Periodo = 'tudo' | 'hoje' | 'ontem' | 'semana' | 'mes' | 'intervalo';

const PERIODOS: { key: Periodo; label: string }[] = [
  { key: 'tudo', label: 'Todo o período' },
  { key: 'hoje', label: 'Hoje' },
  { key: 'ontem', label: 'Ontem' },
  { key: 'semana', label: 'Esta semana' },
  { key: 'mes', label: 'Este mês' },
  { key: 'intervalo', label: 'Escolher datas' },
];

function inicioDoDia(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function somaDias(d: Date, dias: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dias);
}

/** `yyyy-mm-dd` do input de data → meia-noite local. */
function dataLocal(valor: string) {
  const [a, m, d] = valor.split('-').map(Number);
  return new Date(a, m - 1, d);
}

/** Limites do período no fuso de quem está olhando: `from` inclusivo, `to` exclusivo. */
function limitesDoPeriodo(
  periodo: Periodo,
  de: string,
  ate: string,
): { from?: Date; to?: Date } {
  const hoje = inicioDoDia(new Date());
  switch (periodo) {
    case 'hoje':
      return { from: hoje, to: somaDias(hoje, 1) };
    case 'ontem':
      return { from: somaDias(hoje, -1), to: hoje };
    case 'semana': {
      // Semana começa na segunda.
      const segunda = somaDias(hoje, -((hoje.getDay() + 6) % 7));
      return { from: segunda, to: somaDias(segunda, 7) };
    }
    case 'mes':
      return {
        from: new Date(hoje.getFullYear(), hoje.getMonth(), 1),
        to: new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1),
      };
    case 'intervalo':
      return {
        from: de ? dataLocal(de) : undefined,
        to: ate ? somaDias(dataLocal(ate), 1) : undefined,
      };
    default:
      return {};
  }
}

function apiError(err: unknown, fallback: string) {
  const msg =
    (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
      ?.message || fallback;
  toast.error(Array.isArray(msg) ? msg.join('. ') : msg);
}

/** Célula editável discreta: parece texto, vira campo ao passar o mouse ou focar. */
const CELL =
  'h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm outline-none transition-colors hover:border-border focus:border-brand-orange-500 focus:bg-background focus:ring-2 focus:ring-brand-orange-500/20';

type CellInputProps = {
  value: string;
  onSave: (value: string) => void;
  className?: string;
  placeholder?: string;
  uppercase?: boolean;
  type?: 'text' | 'number';
};

/** Salva ao sair do campo. */
function CellInput(props: CellInputProps) {
  // A key recria o rascunho quando o valor salvo muda (ex.: reverteu por erro).
  return <CellInputDraft key={props.value} {...props} />;
}

function CellInputDraft({
  value,
  onSave,
  className,
  placeholder,
  uppercase,
  type = 'text',
}: CellInputProps) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      type={type}
      min={type === 'number' ? 1 : undefined}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(uppercase ? e.target.value.toUpperCase() : e.target.value)}
      onBlur={() => {
        if (draft.trim() !== value) onSave(draft.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      className={cn(CELL, 'placeholder:text-muted-foreground/50', className)}
    />
  );
}

function Contador({
  ativo,
  onClick,
  rotulo,
  valor,
  ponto,
}: {
  ativo: boolean;
  onClick?: () => void;
  rotulo: string;
  valor: number;
  ponto?: string;
}) {
  const conteudo = (
    <>
      {ponto && <span className={cn('h-2 w-2 rounded-full', ponto)} />}
      <span className="text-[10px] text-muted-foreground md:text-xs">{rotulo}</span>
      <span className="text-sm font-bold md:text-lg">{valor.toLocaleString('pt-BR')}</span>
    </>
  );
  const classe = cn(
    'flex shrink-0 items-center gap-1.5 rounded-lg border bg-card px-2 py-1 md:gap-2 md:px-3 md:py-2',
    onClick && 'transition-colors hover:bg-muted/40',
    ativo && 'ring-2 ring-brand-orange-500/70',
  );
  if (!onClick) return <div className={classe}>{conteudo}</div>;
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo} className={classe}>
      {conteudo}
    </button>
  );
}

export default function FinanceiroPage() {
  const { user } = useAuth();
  const router = useRouter();
  const canView = !!user && ADMIN_ROLES.includes(user.role);

  const [entries, setEntries] = useState<FinancialEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<FinancialStatus | ''>('');
  const [month, setMonth] = useState<number | ''>('');
  const [periodo, setPeriodo] = useState<Periodo>('tudo');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [baixando, setBaixando] = useState(false);

  useEffect(() => {
    if (user && !canView) router.replace('/dashboard');
  }, [user, canView, router]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // A situação filtra só na tela: os contadores de cima continuam mostrando as três.
  const load = useCallback(async () => {
    const { from, to } = limitesDoPeriodo(periodo, de, ate);
    try {
      setEntries(
        await financialApi.getAll({
          search: debounced,
          month,
          from: from?.toISOString(),
          to: to?.toISOString(),
        }),
      );
    } catch (err) {
      apiError(err, 'Erro ao carregar o financeiro');
    } finally {
      setLoading(false);
    }
  }, [debounced, month, periodo, de, ate]);

  useEffect(() => {
    if (canView) load();
  }, [load, canView]);

  const totals = useMemo(() => {
    const t = { MIGRATION: 0, PAID_PIX: 0, NO_RECEIPT: 0, plates: 0 };
    for (const e of entries) {
      t[e.status] += 1;
      t.plates += e.plateCount;
    }
    return t;
  }, [entries]);

  const rows = status ? entries.filter((e) => e.status === status) : entries;
  const semFiltro = periodo === 'tudo' && !debounced && !status && !month;

  const patch = async (entry: FinancialEntry, payload: FinancialEntryPayload) => {
    const before = entries;
    setEntries((list) => list.map((e) => (e.id === entry.id ? { ...e, ...payload } : e)));
    try {
      await financialApi.update(entry.id, payload);
    } catch (err) {
      setEntries(before);
      apiError(err, 'Erro ao salvar a alteração');
    }
  };

  /** Baixa o PDF do que está filtrado na tela — mesmo período, busca e mês. */
  const exportarPdf = async () => {
    const { from, to } = limitesDoPeriodo(periodo, de, ate);
    setBaixando(true);
    try {
      const blob = await financialApi.relatorioPdf({
        search: debounced,
        status,
        month,
        from: from?.toISOString(),
        to: to?.toISOString(),
        periodo: PERIODOS.find((p) => p.key === periodo)?.label,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `financeiro-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      toast.error('Erro ao gerar o relatório');
    } finally {
      setBaixando(false);
    }
  };

  const remove = async (entry: FinancialEntry) => {
    if (!confirm(`Excluir o lançamento da placa ${entry.plate}?`)) return;
    try {
      await financialApi.remove(entry.id);
      setEntries((list) => list.filter((e) => e.id !== entry.id));
      toast.success('Lançamento excluído');
    } catch (err) {
      apiError(err, 'Erro ao excluir o lançamento');
    }
  };

  if (!canView) return null;

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4 md:p-6">
      <div className="flex shrink-0 flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Wallet className="h-5 w-5 text-brand-orange-500" />
            Financeiro
          </h1>
          <p className="text-sm text-muted-foreground">
            Conferência de pagamentos por placa. Clique na célula para editar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={exportarPdf}
            disabled={baixando || loading}
          >
            {baixando ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1 h-4 w-4" />
            )}
            Exportar PDF
          </Button>
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Novo lançamento
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 gap-2 overflow-x-auto pb-1">
        <Contador
          ativo={status === ''}
          onClick={() => setStatus('')}
          rotulo="Todos"
          valor={entries.length}
        />
        {FINANCIAL_STATUS_ORDER.map((s) => (
          <Contador
            key={s}
            ativo={status === s}
            onClick={() => setStatus(status === s ? '' : s)}
            rotulo={FINANCIAL_STATUS_META[s].label}
            valor={totals[s]}
            ponto={FINANCIAL_STATUS_META[s].dot}
          />
        ))}
        <Contador ativo={false} rotulo="Placas" valor={totals.plates} />
      </div>

      <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por placa, consultor ou ID do comprovante..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="sm:w-44">
          <SelectNative
            aria-label="Período"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value as Periodo)}
          >
            {PERIODOS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </SelectNative>
        </div>
        {periodo === 'intervalo' && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              aria-label="De"
              value={de}
              onChange={(e) => setDe(e.target.value)}
              className="sm:w-[150px]"
            />
            <span className="text-xs text-muted-foreground">até</span>
            <Input
              type="date"
              aria-label="Até"
              value={ate}
              onChange={(e) => setAte(e.target.value)}
              className="sm:w-[150px]"
            />
          </div>
        )}
        <div className="sm:w-44">
          <SelectNative
            aria-label="Mês"
            value={month}
            onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Todos os meses</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </SelectNative>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Wallet className="mb-3 h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">
              {semFiltro ? 'Nenhum lançamento cadastrado' : 'Nenhum lançamento nesse filtro'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[1210px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="w-[130px] px-3 py-2 font-medium">Placa</th>
                <th className="w-[200px] px-3 py-2 font-medium">Situação financeira</th>
                <th className="w-[130px] px-3 py-2 font-medium">Mês</th>
                <th className="px-3 py-2 font-medium">Nome consultor</th>
                <th className="w-[150px] px-3 py-2 font-medium">Contato</th>
                <th className="px-3 py-2 font-medium">ID do comprovante</th>
                <th className="w-[110px] px-3 py-2 text-center font-medium">Qtd. de placas</th>
                <th className="w-[130px] px-3 py-2 font-medium">Comprovante</th>
                <th className="w-12 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b transition-colors last:border-0 hover:bg-muted/30">
                  <td className="px-1.5 py-1.5">
                    <CellInput
                      value={e.plate}
                      uppercase
                      className="font-mono text-xs font-semibold"
                      onSave={(v) =>
                        v ? patch(e, { plate: v }) : toast.error('A placa não pode ficar vazia')
                      }
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <StatusSelect
                      value={e.status}
                      onChange={(v) => patch(e, { status: v })}
                      className="w-full min-w-[172px]"
                    />
                  </td>
                  <td className="px-1.5 py-1.5">
                    <select
                      aria-label="Mês"
                      value={e.month ?? ''}
                      onChange={(ev) =>
                        patch(e, { month: ev.target.value ? Number(ev.target.value) : null })
                      }
                      className={cn(CELL, 'cursor-pointer text-xs [&>option]:bg-popover')}
                    >
                      <option value="">—</option>
                      {MONTHS.map((m, idx) => (
                        <option key={m} value={idx + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1.5 py-1.5">
                    <ConsultantCombobox
                      key={e.consultantName ?? ''}
                      value={e.consultantName ?? ''}
                      placeholder="—"
                      className={cn(CELL, 'placeholder:text-muted-foreground/50')}
                      onCommit={(c, daLista) =>
                        patch(
                          e,
                          daLista
                            ? { consultantName: c.name || null, consultantContact: c.contact }
                            : { consultantName: c.name || null },
                        )
                      }
                    />
                  </td>
                  <td className="px-1.5 py-1.5">
                    <CellInput
                      value={e.consultantContact ?? ''}
                      placeholder="—"
                      className="font-mono text-xs"
                      onSave={(v) => patch(e, { consultantContact: v || null })}
                    />
                  </td>
                  <td className="px-1.5 py-1.5">
                    <CellInput
                      value={e.receiptId ?? ''}
                      placeholder="—"
                      className="font-mono text-xs text-muted-foreground"
                      onSave={(v) => patch(e, { receiptId: v || null })}
                    />
                  </td>
                  <td className="px-1.5 py-1.5">
                    <CellInput
                      type="number"
                      value={String(e.plateCount)}
                      className="text-center"
                      onSave={(v) => {
                        const n = Number(v);
                        if (!Number.isInteger(n) || n < 1) {
                          toast.error('Quantidade de placas precisa ser 1 ou mais');
                          return;
                        }
                        patch(e, { plateCount: n });
                      }}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <ReceiptCell
                      entry={e}
                      onChange={(atualizado) =>
                        setEntries((list) =>
                          list.map((x) => (x.id === atualizado.id ? atualizado : x)),
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Excluir lançamento da placa ${e.plate}`}
                      className="h-8 w-8 text-muted-foreground hover:text-red-500"
                      onClick={() => remove(e)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EntryFormDialog open={formOpen} onOpenChange={setFormOpen} onSaved={load} />
    </div>
  );
}
