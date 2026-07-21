'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  HardHat,
  Search,
  Plus,
  MoreVertical,
  Pencil,
  KeyRound,
  Boxes,
  Power,
  Trash2,
  Loader2,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn, formatDateBR } from '@/lib/utils';
import { techniciansApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TechnicianFormDialog } from '@/components/technicians/technician-form-dialog';
import { TechnicianPasswordDialog } from '@/components/technicians/technician-password-dialog';
import type {
  Technician,
  TechnicianAssignment,
  TechnicianWithPassword,
} from '@/types/technician';

function formatCpf(cpf: string): string {
  const d = (cpf || '').replace(/\D/g, '');
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function formatPhone(phone: string | null): string {
  const d = (phone || '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone || '—';
}

export default function TecnicosPage() {
  const { user } = useAuth();
  const canManage =
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'ADMIN' ||
    user?.role === 'OPERATOR';
  const canDelete = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Technician | null>(null);
  const [passwordData, setPasswordData] = useState<TechnicianWithPassword | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);

  const [assignmentsOf, setAssignmentsOf] = useState<Technician | null>(null);
  const [assignments, setAssignments] = useState<TechnicianAssignment[] | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    try {
      setTechnicians(await techniciansApi.getAll(debounced || undefined));
    } catch {
      toast.error('Erro ao carregar técnicos');
    } finally {
      setLoading(false);
    }
  }, [debounced]);

  useEffect(() => {
    load();
  }, [load]);

  const totalEmCampo = technicians.reduce((acc, t) => acc + t.assignedCount, 0);
  const totalInstalacoes = technicians.reduce((acc, t) => acc + t.installCount, 0);
  const totalAtivos = technicians.filter((t) => t.active).length;

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (t: Technician) => {
    setEditing(t);
    setFormOpen(true);
  };

  const showPassword = (data: TechnicianWithPassword) => {
    setPasswordData(data);
    setPasswordOpen(true);
  };

  const handleResetPassword = async (t: Technician) => {
    if (!confirm(`Gerar uma nova senha para ${t.name}? A senha atual deixa de valer.`)) {
      return;
    }
    try {
      showPassword(await techniciansApi.resetPassword(t.id));
      await load();
    } catch {
      toast.error('Erro ao resetar senha');
    }
  };

  const handleToggleActive = async (t: Technician) => {
    try {
      await techniciansApi.update(t.id, { active: !t.active });
      toast.success(t.active ? 'Técnico desativado' : 'Técnico reativado');
      await load();
    } catch {
      toast.error('Erro ao alterar o técnico');
    }
  };

  const handleDelete = async (t: Technician) => {
    if (!confirm(`Excluir o técnico ${t.name}?`)) return;
    try {
      await techniciansApi.remove(t.id);
      toast.success('Técnico excluído');
      await load();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Erro ao excluir técnico';
      toast.error(msg);
    }
  };

  const openAssignments = async (t: Technician) => {
    setAssignmentsOf(t);
    setAssignments(null);
    try {
      setAssignments(await techniciansApi.assignments(t.id));
    } catch {
      toast.error('Erro ao carregar os equipamentos do técnico');
      setAssignmentsOf(null);
    }
  };

  return (
    <div className="flex flex-col h-full p-4 md:p-6 gap-4 overflow-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <HardHat className="h-5 w-5 text-brand-orange-500" />
            Técnicos
          </h1>
          <p className="text-sm text-muted-foreground">
            Cadastre o instalador, envie rastreadores pro login dele e acompanhe as instalações
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" />
            Novo técnico
          </Button>
        )}
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-lg bg-brand-orange-500/15 p-2">
              <HardHat className="h-5 w-5 text-brand-orange-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Técnicos ativos</p>
              <p className="text-2xl font-bold">{totalAtivos}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-lg bg-amber-500/15 p-2">
              <Boxes className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Equipamentos em campo</p>
              <p className="text-2xl font-bold">{totalEmCampo}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-lg bg-emerald-500/15 p-2">
              <Wrench className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Instalações finalizadas</p>
              <p className="text-2xl font-bold">{totalInstalacoes}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Busca */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Buscar por nome ou CPF..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : technicians.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <HardHat className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">
              {debounced ? 'Nenhum técnico encontrado' : 'Nenhum técnico cadastrado'}
            </p>
            {!debounced && (
              <p className="text-xs text-muted-foreground mt-1">
                Clique em <strong>Novo técnico</strong> para cadastrar o primeiro
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {technicians.map((t) => (
            <Card key={t.id} className={cn(!t.active && 'opacity-60')}>
              <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold truncate">{t.name}</span>
                    {!t.active && (
                      <Badge className="text-[10px] border bg-slate-500/15 text-slate-400 border-slate-500/30">
                        inativo
                      </Badge>
                    )}
                    {!t.canReceiveEquipment && t.active && (
                      <Badge className="text-[10px] border bg-slate-500/15 text-slate-400 border-slate-500/30">
                        não recebe equipamento
                      </Badge>
                    )}
                    {t.mustChangePassword && (
                      <Badge className="text-[10px] border bg-blue-500/15 text-blue-400 border-blue-500/30">
                        senha provisória
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 font-mono">
                    {formatCpf(t.cpf)} · {formatPhone(t.phone)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {t.lastLoginAt
                      ? `Último acesso ${formatDateBR(t.lastLoginAt)}`
                      : 'Nunca acessou o app'}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openAssignments(t)}
                    className="rounded-lg border px-3 py-1.5 text-center transition-colors hover:bg-muted/40"
                  >
                    <span className="block text-lg font-bold leading-none">
                      {t.assignedCount}
                    </span>
                    <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                      em campo
                    </span>
                  </button>
                  <div className="rounded-lg border px-3 py-1.5 text-center">
                    <span className="block text-lg font-bold leading-none">
                      {t.installCount}
                    </span>
                    <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                      instalações
                    </span>
                  </div>

                  {canManage && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            aria-label="Ações"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem onClick={() => openEdit(t)}>
                          <Pencil className="h-4 w-4" /> Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openAssignments(t)}>
                          <Boxes className="h-4 w-4" /> Ver equipamentos
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleResetPassword(t)}>
                          <KeyRound className="h-4 w-4" /> Resetar senha
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggleActive(t)}>
                          <Power className="h-4 w-4" />
                          {t.active ? 'Desativar' : 'Reativar'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={!canDelete}
                          onClick={() => canDelete && handleDelete(t)}
                        >
                          <Trash2 className="h-4 w-4" /> Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TechnicianFormDialog
        technician={editing}
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={load}
        onCreated={showPassword}
      />

      <TechnicianPasswordDialog
        data={passwordData}
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
      />

      {/* Equipamentos reservados */}
      <Dialog
        open={!!assignmentsOf}
        onOpenChange={(o) => !o && setAssignmentsOf(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-brand-orange-500" />
              Equipamentos com {assignmentsOf?.name}
            </DialogTitle>
          </DialogHeader>
          {assignments === null ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : assignments.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum equipamento reservado. Envie pelo Estoque.
            </p>
          ) : (
            <div className="max-h-80 overflow-auto space-y-2">
              {assignments.map((a) => (
                <div key={a.id} className="rounded-lg border px-3 py-2">
                  <p className="font-mono text-sm">{a.imei}</p>
                  <p className="text-xs text-muted-foreground">
                    {[a.operator, a.line, a.server].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
