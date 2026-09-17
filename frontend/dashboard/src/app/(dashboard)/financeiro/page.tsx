'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Trash2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { financialApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { SelectNative } from '@/components/ui/select-native';
import { EntryFormDialog } from '@/components/financial/entry-form-dialog';
import { StatusSelect } from '@/components/financial/status-select';
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
  { key: 'tudo', label: 'Tudo' },
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

type CellInputProps = {
  value: string;
  onSave: (value: string) => void;
  className?: string;
  uppercase?: boolean;
  type?: 'text' | 'number';
};

/** Célula que salva ao sair do campo, como na planilha. */
function CellInput(props: CellInputProps) {
  // A key recria o rascunho quando o valor salvo muda (ex.: reverteu por erro).
  return <CellInputDraft key={props.value} {...props} />;
}

function CellInputDraft({ value, onSave, className, uppercase, type = 'text' }: CellInputProps) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      type={type}
      min={type === 'number' ? 1 : undefined}
      value={draft}
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
      className={cn(
        'h-8 w-full bg-transparent px-2 text-sm text-slate-900 outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-brand-blue-500',
        className,
      )}
    />
  );
}

const TH = 'border border-slate-300 bg-slate-100 px-2 py-2 text-left text-xs font-semibold text-slate-700';
const TD = 'border border-slate-200 p-0';

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

  useEffect(() => {
    if (user && !canView) router.replace('/dashboard');
  }, [user, canView, router]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const { from, to } = limitesDoPeriodo(periodo, de, ate);
    try {
      setEntries(
        await financialApi.getAll({
          search: debounced,
          status,
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
  }, [debounced, status, month, periodo, de, ate]);

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
    <div className="flex h-full flex-col gap-3 overflow-auto p-4 md:p-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Wallet className="h-5 w-5 text-brand-orange-500" />
            Financeiro
          </h1>
          <p className="text-sm text-muted-foreground">
            Edite direto na planilha: salva ao sair da célula.
          </p>
        </div>
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Novo lançamento
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {PERIODOS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriodo(p.key)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
              periodo === p.key
                ? 'border-brand-blue-500 bg-brand-blue-500 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
            )}
          >
            {p.label}
          </button>
        ))}
        {periodo === 'intervalo' && (
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              aria-label="De"
              value={de}
              onChange={(e) => setDe(e.target.value)}
              className="h-9 w-[150px]"
            />
            <span className="text-sm text-muted-foreground">até</span>
            <Input
              type="date"
              aria-label="Até"
              value={ate}
              onChange={(e) => setAte(e.target.value)}
              className="h-9 w-[150px]"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_180px_200px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por placa, consultor ou ID do comprovante..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <SelectNative
          aria-label="Filtrar por mês"
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
        <SelectNative
          aria-label="Filtrar por situação"
          value={status}
          onChange={(e) => setStatus(e.target.value as FinancialStatus | '')}
        >
          <option value="">Todas as situações</option>
          {FINANCIAL_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {FINANCIAL_STATUS_META[s].label}
            </option>
          ))}
        </SelectNative>
      </div>

      <div className="flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-md border border-slate-300 bg-white">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={cn(TH, 'w-12 text-center')}>#</th>
                <th className={cn(TH, 'w-[210px]')}>Placa</th>
                <th className={cn(TH, 'w-[180px]')}>Situação financeira</th>
                <th className={cn(TH, 'w-[140px]')}>Mês</th>
                <th className={TH}>Nome consultor</th>
                <th className={TH}>ID do comprovante</th>
                <th className={cn(TH, 'w-[120px] text-center')}>Quantidade de placas</th>
                <th className={cn(TH, 'w-10')} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [1, 2, 3, 4, 5].map((i) => (
                  <tr key={i}>
                    <td colSpan={8} className="border border-slate-200 p-1">
                      <Skeleton className="h-6 w-full" />
                    </td>
                  </tr>
                ))
              ) : entries.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="border border-slate-200 py-10 text-center text-muted-foreground"
                  >
                    {semFiltro ? 'Nenhum lançamento cadastrado' : 'Nenhum lançamento nesse filtro'}
                  </td>
                </tr>
              ) : (
                entries.map((e, i) => (
                  <tr key={e.id} className="hover:bg-blue-50/60">
                    <td className="border border-slate-200 bg-slate-50 text-center text-xs text-slate-500">
                      {i + 1}
                    </td>
                    <td className={TD}>
                      <CellInput
                        value={e.plate}
                        uppercase
                        className="font-medium"
                        onSave={(v) =>
                          v ? patch(e, { plate: v }) : toast.error('A placa não pode ficar vazia')
                        }
                      />
                    </td>
                    <td className={TD}>
                      <StatusSelect value={e.status} onChange={(v) => patch(e, { status: v })} />
                    </td>
                    <td className={TD}>
                      <select
                        aria-label="Mês"
                        value={e.month ?? ''}
                        onChange={(ev) =>
                          patch(e, { month: ev.target.value ? Number(ev.target.value) : null })
                        }
                        className="h-8 w-full cursor-pointer bg-transparent px-1.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-inset focus:ring-brand-blue-500"
                      >
                        <option value="" />
                        {MONTHS.map((m, idx) => (
                          <option key={m} value={idx + 1}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={TD}>
                      <CellInput
                        value={e.consultantName ?? ''}
                        uppercase
                        onSave={(v) => patch(e, { consultantName: v || null })}
                      />
                    </td>
                    <td className={TD}>
                      <CellInput
                        value={e.receiptId ?? ''}
                        className="font-mono text-xs"
                        onSave={(v) => patch(e, { receiptId: v || null })}
                      />
                    </td>
                    <td className={TD}>
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
                    <td className="border border-slate-200 text-center">
                      <button
                        type="button"
                        aria-label={`Excluir lançamento da placa ${e.plate}`}
                        onClick={() => remove(e)}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-700">
          <span>
            Linhas: <strong>{entries.length.toLocaleString('pt-BR')}</strong>
          </span>
          <span>
            Placas: <strong>{totals.plates.toLocaleString('pt-BR')}</strong>
          </span>
          {FINANCIAL_STATUS_ORDER.map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: FINANCIAL_STATUS_META[s].bg }}
              />
              {FINANCIAL_STATUS_META[s].label}: <strong>{totals[s].toLocaleString('pt-BR')}</strong>
            </span>
          ))}
        </div>
      </div>

      <EntryFormDialog open={formOpen} onOpenChange={setFormOpen} onSaved={load} />
    </div>
  );
}
