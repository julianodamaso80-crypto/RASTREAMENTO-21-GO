'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Boxes,
  Search,
  Upload,
  Loader2,
  Trash2,
  FileSpreadsheet,
  MoreVertical,
  UserCheck,
  MapPin,
  SignalHigh,
  HardHat,
  ListPlus,
  Wrench,
  Send,
  Ban,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn, formatDateOnlyBR } from '@/lib/utils';
import { stockApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';
import { AssociateStockDialog } from '@/components/stock/associate-stock-dialog';
import { AssignTechnicianDialog } from '@/components/stock/assign-technician-dialog';
import type { StockItem, StockStats } from '@/types/stock';

// Cor do badge por status (case-insensitive, com fallback neutro).
function statusColor(status: string | null): string {
  const s = (status ?? '').toUpperCase();
  if (s === 'ATIVO' || s === 'ACTIVE') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  if (s === 'INATIVO' || s === 'CANCELADO') return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
  if (s === 'SUSPENSO' || s === 'BLOQUEADO') return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
}

export default function EstoquePage() {
  const { user } = useAuth();
  const canManage =
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'ADMIN' ||
    user?.role === 'OPERATOR';
  const canDelete = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const [items, setItems] = useState<StockItem[]>([]);
  const [stats, setStats] = useState<StockStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [assignmentFilter, setAssignmentFilter] = useState('');
  const [associItem, setAssociItem] = useState<StockItem | null>(null);
  const [associOpen, setAssociOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignItems, setAssignItems] = useState<StockItem[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadStock = useCallback(async () => {
    try {
      const params: Record<string, string | number> = { perPage: 100 };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (assignmentFilter) params.assignment = assignmentFilter;
      const res = await stockApi.getAll(params);
      setItems(res.data);
      setSelected(new Set()); // recarregou a lista, seleção antiga não vale mais
    } catch {
      toast.error('Erro ao carregar estoque');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, assignmentFilter]);

  const loadStats = useCallback(async () => {
    try {
      setStats(await stockApi.getStats());
    } catch {
      /* silencioso */
    }
  }, []);

  useEffect(() => {
    loadStock();
  }, [loadStock]);
  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reimportar o mesmo arquivo
    if (!file) return;

    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      toast.error('Envie uma planilha .xlsx, .xls ou .csv');
      return;
    }

    setImporting(true);
    const toastId = toast.loading(`Importando "${file.name}"...`);
    try {
      const res = await stockApi.import(file);
      toast.success(
        `Importação concluída: ${res.imported} novos, ${res.updated} atualizados` +
          (res.skipped ? `, ${res.skipped} ignorados` : ''),
        { id: toastId },
      );
      await Promise.all([loadStock(), loadStats()]);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || 'Erro ao importar planilha';
      toast.error(msg, { id: toastId });
    } finally {
      setImporting(false);
    }
  };

  const openAssociate = (item: StockItem) => {
    setAssociItem(item);
    setAssociOpen(true);
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((i) => i.id)),
    );
  };

  const selectedItems = items.filter((i) => selected.has(i.id));

  const openAssign = (list: StockItem[]) => {
    setAssignItems(list);
    setAssignOpen(true);
  };

  const handleUnassign = async () => {
    const comTecnico = selectedItems.filter((i) => i.assignedTechnician);
    if (comTecnico.length === 0) {
      toast.info('Nenhum dos selecionados está com técnico.');
      return;
    }
    if (!confirm(`Cancelar a reserva de ${comTecnico.length} equipamento(s)?`)) return;
    try {
      const res = await stockApi.unassign(comTecnico.map((i) => i.id));
      toast.success(`${res.ok} equipamento(s) devolvido(s) ao estoque livre`);
      await loadStock();
    } catch {
      toast.error('Erro ao cancelar a reserva');
    }
  };

  const handleDelete = async (item: StockItem) => {
    if (!confirm(`Remover o rastreador ${item.imei} do estoque?`)) return;
    try {
      await stockApi.delete(item.id);
      toast.success('Item removido do estoque');
      await Promise.all([loadStock(), loadStats()]);
    } catch {
      toast.error('Erro ao remover item');
    }
  };

  const soon = () => toast.info('Disponível em breve (próxima atualização).');

  return (
    <div className="flex flex-col h-full p-4 md:p-6 gap-4 overflow-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Boxes className="h-5 w-5 text-brand-orange-500" />
            Estoque
          </h1>
          <p className="text-sm text-muted-foreground">
            Rastreadores disponíveis — associe a um cliente do SGA ou importe a planilha
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={handleFileSelected}
        />
        <Button
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
        >
          {importing ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Upload className="h-4 w-4 mr-1" />
          )}
          {importing ? 'Importando...' : 'Importar planilha'}
        </Button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
            <span className="text-xs text-muted-foreground">Total</span>
            <span className="text-lg font-bold">{stats.total}</span>
          </div>
          {stats.byStatus.map((s) => (
            <div
              key={s.status}
              className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2"
            >
              <Badge className={cn('text-xs border', statusColor(s.status))}>
                {s.status}
              </Badge>
              <span className="text-lg font-bold">{s.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Buscar por IMEI, ICCID, linha ou operadora..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="sm:w-48">
          <SelectNative
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Todos os status</option>
            {stats?.byStatus.map((s) => (
              <option key={s.status} value={s.status}>
                {s.status}
              </option>
            ))}
          </SelectNative>
        </div>
        <div className="sm:w-44">
          <SelectNative
            value={assignmentFilter}
            onChange={(e) => setAssignmentFilter(e.target.value)}
          >
            <option value="">Todos</option>
            <option value="free">Livres</option>
            <option value="assigned">Com técnico</option>
          </SelectNative>
        </div>
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhum rastreador no estoque</p>
            <p className="text-xs text-muted-foreground mt-1">
              Clique em <strong>Importar planilha</strong> para carregar seus
              rastreadores
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                {canManage && (
                  <th className="px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos"
                      className="h-4 w-4 cursor-pointer accent-brand-orange-500"
                      checked={items.length > 0 && selected.size === items.length}
                      onChange={toggleAll}
                    />
                  </th>
                )}
                <th className="px-3 py-2 font-medium">IMEI</th>
                <th className="px-3 py-2 font-medium">ICCID</th>
                <th className="px-3 py-2 font-medium">Linha</th>
                <th className="px-3 py-2 font-medium">Operadora</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Server</th>
                <th className="px-3 py-2 font-medium">Técnico</th>
                <th className="px-3 py-2 font-medium">Ativação</th>
                {canManage && <th className="px-3 py-2 text-right font-medium">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className={cn(
                    'border-b last:border-0 hover:bg-muted/30 transition-colors',
                    selected.has(item.id) && 'bg-brand-orange-500/5',
                  )}
                >
                  {canManage && (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${item.imei}`}
                        className="h-4 w-4 cursor-pointer accent-brand-orange-500"
                        checked={selected.has(item.id)}
                        onChange={() => toggleOne(item.id)}
                      />
                    </td>
                  )}
                  <td className="px-3 py-2 font-mono text-xs">{item.imei}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {item.iccid ?? '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {item.line ?? '—'}
                  </td>
                  <td className="px-3 py-2">{item.operator ?? '—'}</td>
                  <td className="px-3 py-2">
                    {item.status ? (
                      <Badge
                        className={cn('text-xs border', statusColor(item.status))}
                      >
                        {item.status}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {item.server ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    {item.assignedTechnician ? (
                      <Badge className="text-xs border bg-amber-500/15 text-amber-400 border-amber-500/30">
                        <HardHat className="h-3 w-3 mr-1" />
                        {item.assignedTechnician.name.split(' ')[0]}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {item.activatedAt ? formatDateOnlyBR(item.activatedAt) : '—'}
                  </td>
                  {canManage && (
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => openAssociate(item)}
                        >
                          <UserCheck className="h-3.5 w-3.5 mr-1" />
                          Associar (SGA)
                        </Button>
                        <StockRowMenu
                          item={item}
                          canDelete={canDelete}
                          onAssociate={() => openAssociate(item)}
                          onAssign={() => openAssign([item])}
                          onDelete={() => handleDelete(item)}
                          onSoon={soon}
                        />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length >= 100 && (
        <p className="text-xs text-muted-foreground text-center">
          Mostrando os primeiros 100 itens. Use a busca para refinar.
        </p>
      )}

      {/* Barra de ações em lote — só aparece com algo selecionado */}
      {canManage && selected.size > 0 && (
        <div className="sticky bottom-0 z-10 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3 shadow-lg">
          <span className="text-sm font-medium">
            {selected.size} equipamento(s) selecionado(s)
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Limpar
            </Button>
            <Button size="sm" variant="outline" onClick={handleUnassign}>
              <Ban className="h-4 w-4 mr-1" />
              Cancelar reserva
            </Button>
            <Button size="sm" onClick={() => openAssign(selectedItems)}>
              <HardHat className="h-4 w-4 mr-1" />
              Enviar pro técnico
            </Button>
          </div>
        </div>
      )}

      <AssignTechnicianDialog
        items={assignItems}
        open={assignOpen}
        onOpenChange={setAssignOpen}
        onAssigned={() => Promise.all([loadStock(), loadStats()])}
      />

      <AssociateStockDialog
        item={associItem}
        open={associOpen}
        onOpenChange={setAssociOpen}
        onAssociated={() => Promise.all([loadStock(), loadStats()])}
      />
    </div>
  );
}

// Menu de ações por rastreador — espelha as 10 opções da referência (RedeVeiculos).
// Fase 1: "Associar cliente e ativo" e "Remover equipamento" funcionais; as demais
// entram nas próximas fases (aparecem desabilitadas com selo "em breve").
function StockRowMenu({
  item,
  canDelete,
  onAssociate,
  onAssign,
  onDelete,
  onSoon,
}: {
  item: StockItem;
  canDelete: boolean;
  onAssociate: () => void;
  onAssign: () => void;
  onDelete: () => void;
  onSoon: () => void;
}) {
  const Soon = () => (
    <DropdownMenuShortcut className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
      em breve
    </DropdownMenuShortcut>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Ações">
            <MoreVertical className="h-4 w-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem disabled onClick={onSoon}>
          <MapPin className="h-4 w-4" /> Abrir no mapa <Soon />
        </DropdownMenuItem>
        <DropdownMenuItem disabled onClick={onSoon}>
          <SignalHigh className="h-4 w-4" /> Validar instalação <Soon />
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAssociate}>
          <UserCheck className="h-4 w-4" /> Associar um cliente e ativo
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAssign}>
          <HardHat className="h-4 w-4" />
          {item.assignedTechnician ? 'Trocar o técnico' : 'Disponibilizar no login do técnico'}
        </DropdownMenuItem>
        <DropdownMenuItem disabled onClick={onSoon}>
          <ListPlus className="h-4 w-4" /> Adicionar à lista de pendência <Soon />
        </DropdownMenuItem>
        <DropdownMenuItem disabled onClick={onSoon}>
          <Wrench className="h-4 w-4" /> Colocar em manutenção <Soon />
        </DropdownMenuItem>
        <DropdownMenuItem disabled onClick={onSoon}>
          <Send className="h-4 w-4" /> Enviar SMS Comandos <Soon />
        </DropdownMenuItem>
        <DropdownMenuItem disabled onClick={onSoon}>
          <Ban className="h-4 w-4" /> Indisponibilizar para uso <Soon />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled onClick={onSoon}>
          <AlertTriangle className="h-4 w-4" /> Equipamento perdido <Soon />
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={!canDelete}
          onClick={canDelete ? onDelete : onSoon}
        >
          <Trash2 className="h-4 w-4" /> Remover equipamento
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
