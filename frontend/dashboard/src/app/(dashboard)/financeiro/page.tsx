'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRightLeft,
  CircleCheck,
  FileWarning,
  Hash,
  Plus,
  Search,
  Trash2,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { financialApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { SelectNative } from '@/components/ui/select-native';
import { EntryFormDialog } from '@/components/financial/entry-form-dialog';
import { StatCard3D } from '@/components/financial/stat-card-3d';
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

const STATUS_ICON = {
  MIGRATION: ArrowRightLeft,
  PAID_PIX: CircleCheck,
  NO_RECEIPT: FileWarning,
} as const;

function apiError(err: unknown, fallback: string) {
  const msg =
    (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
      ?.message || fallback;
  toast.error(Array.isArray(msg) ? msg.join('. ') : msg);
}

type CellInputProps = {
  value: string;
  onSave: (value: string) => void;
  placeholder?: string;
  className?: string;
  uppercase?: boolean;
  type?: 'text' | 'number';
};

/** Célula de texto que salva ao sair do campo, como na planilha. */
function CellInput(props: CellInputProps) {
  // A key recria o rascunho quando o valor salvo muda (ex.: reverteu por erro).
  return <CellInputDraft key={props.value} {...props} />;
}

function CellInputDraft({
  value,
  onSave,
  placeholder,
  className,
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
      className={
        'h-9 w-full rounded-md border border-transparent bg-transparent px-2 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 hover:border-white/10 hover:bg-white/5 focus:border-brand-orange-500 focus:bg-slate-950/60 ' +
        (className ?? '')
      }
    />
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
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    if (user && !canView) router.replace('/dashboard');
  }, [user, canView, router]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    try {
      setEntries(await financialApi.getAll({ search: debounced, month }));
    } catch (err) {
      apiError(err, 'Erro ao carregar o financeiro');
    } finally {
      setLoading(false);
    }
  }, [debounced, month]);

  useEffect(() => {
    if (canView) load();
  }, [load, canView]);

  // Os cartões contam o mês e a busca escolhidos; a situação só filtra a tabela,
  // senão escolher uma situação zeraria os cartões das outras duas.
  const totals = useMemo(() => {
    const t = { MIGRATION: 0, PAID_PIX: 0, NO_RECEIPT: 0, plates: 0 };
    for (const e of entries) {
      t[e.status] += 1;
      t.plates += e.plateCount;
    }
    return t;
  }, [entries]);

  const rows = status ? entries.filter((e) => e.status === status) : entries;

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
    <div className="flex h-full flex-col gap-5 overflow-auto p-4 md:p-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
            style={{
              background: 'linear-gradient(145deg, #f5a849, #d97f10)',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,.5), 0 4px 0 #9a5a08, 0 12px 24px -8px #c0700a',
            }}
          >
            <Wallet className="h-6 w-6 text-white drop-shadow" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Financeiro</h1>
            <p className="text-sm text-muted-foreground">
              Conferência de pagamentos por placa. Edite direto na tabela: salva ao sair do campo.
            </p>
          </div>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Novo lançamento
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {FINANCIAL_STATUS_ORDER.map((s) => {
          const meta = FINANCIAL_STATUS_META[s];
          return (
            <StatCard3D
              key={s}
              label={meta.label}
              value={totals[s]}
              hint={status === s ? 'Filtrando a tabela · toque para limpar' : 'Lançamentos · toque para filtrar'}
              icon={STATUS_ICON[s]}
              from={meta.from}
              to={meta.to}
              edge={meta.edge}
              active={status === s}
              onClick={() => setStatus((cur) => (cur === s ? '' : s))}
            />
          );
        })}
        <StatCard3D
          label="Quantidade de placas"
          value={totals.plates}
          hint={`Em ${entries.length.toLocaleString('pt-BR')} lançamentos`}
          icon={Hash}
          from="#4257a3"
          to="#293c82"
          edge="#172353"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px_220px]">
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

      <div
        className="shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900 to-slate-950"
        style={{
          boxShadow:
            '0 1px 0 rgba(255,255,255,.06) inset, 0 10px 0 -5px rgba(2,6,23,.95), 0 28px 50px -20px rgba(0,0,0,.85)',
        }}
      >
        {loading ? (
          <div className="space-y-2 p-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-11 w-full rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Wallet className="mb-3 h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">
              {entries.length ? 'Nenhum lançamento com esse filtro' : 'Nenhum lançamento cadastrado'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="bg-gradient-to-b from-brand-blue-500 to-brand-blue-700 text-left text-[11px] font-bold uppercase tracking-wider text-white/90">
                  <th className="px-3 py-3">Placa</th>
                  <th className="px-3 py-3">Situação financeira</th>
                  <th className="px-3 py-3">Mês</th>
                  <th className="px-3 py-3">Nome consultor</th>
                  <th className="px-3 py-3">ID do comprovante</th>
                  <th className="px-3 py-3 text-center">Quantidade de placas</th>
                  <th className="w-12 px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((e, i) => (
                  <tr
                    key={e.id}
                    className={
                      'transition-colors hover:bg-brand-orange-500/[0.06] ' +
                      (i % 2 ? 'bg-white/[0.02]' : '')
                    }
                  >
                    <td className="border-t border-white/5 px-2 py-1.5">
                      <CellInput
                        value={e.plate}
                        uppercase
                        className="font-mono font-bold tracking-wide"
                        onSave={(v) =>
                          v ? patch(e, { plate: v }) : toast.error('A placa não pode ficar vazia')
                        }
                      />
                    </td>
                    <td className="border-t border-white/5 px-2 py-1.5">
                      <StatusSelect value={e.status} onChange={(v) => patch(e, { status: v })} />
                    </td>
                    <td className="border-t border-white/5 px-2 py-1.5">
                      <SelectNative
                        aria-label="Mês"
                        value={e.month ?? ''}
                        onChange={(ev) =>
                          patch(e, { month: ev.target.value ? Number(ev.target.value) : null })
                        }
                        className="min-w-[140px] border-transparent bg-transparent font-semibold hover:border-white/10"
                      >
                        <option value="">—</option>
                        {MONTHS.map((m, idx) => (
                          <option key={m} value={idx + 1}>
                            {m}
                          </option>
                        ))}
                      </SelectNative>
                    </td>
                    <td className="border-t border-white/5 px-2 py-1.5">
                      <CellInput
                        value={e.consultantName ?? ''}
                        placeholder="—"
                        onSave={(v) => patch(e, { consultantName: v || null })}
                      />
                    </td>
                    <td className="border-t border-white/5 px-2 py-1.5">
                      <CellInput
                        value={e.receiptId ?? ''}
                        placeholder="—"
                        className="font-mono text-xs"
                        onSave={(v) => patch(e, { receiptId: v || null })}
                      />
                    </td>
                    <td className="border-t border-white/5 px-2 py-1.5">
                      <CellInput
                        type="number"
                        value={String(e.plateCount)}
                        className="text-center font-bold"
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
                    <td className="border-t border-white/5 px-2 py-1.5 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Excluir lançamento da placa ${e.plate}`}
                        className="text-slate-500 hover:text-red-400"
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
      </div>

      <EntryFormDialog open={formOpen} onOpenChange={setFormOpen} onSaved={load} />
    </div>
  );
}
