'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Search,
  Plus,
  MoreVertical,
  Pencil,
  KeyRound,
  Power,
  Trash2,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn, formatDateBR } from '@/lib/utils';
import { usersApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import {
  MANAGEABLE_ROUTES,
  DEFAULT_ROUTES_BY_ROLE,
  ROLE_LABEL,
  ROLES_THAT_MANAGE_USERS,
} from '@/lib/manageable-routes';
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
import { UserFormDialog } from '@/components/users/user-form-dialog';
import { UserCredentialsDialog } from '@/components/users/user-credentials-dialog';
import type { ManagedUser, UserWithPassword } from '@/types/user';

const ROLE_BADGE: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  ADMIN: 'bg-brand-orange-500/15 text-brand-orange-400 border-brand-orange-500/30',
  OPERATOR: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  VIEWER: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  CLIENT: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

const ROUTE_LABEL = new Map<string, string>(
  MANAGEABLE_ROUTES.map((r) => [r.key, r.label]),
);

function describeRoutes(u: ManagedUser): string {
  const total = DEFAULT_ROUTES_BY_ROLE[u.role]?.length ?? 0;
  if (!u.allowedRoutes.length) return `Todas as telas do perfil (${total})`;
  if (u.allowedRoutes.length === total) return `Todas as telas do perfil (${total})`;
  return u.allowedRoutes
    .map((r) => ROUTE_LABEL.get(r) ?? r)
    .join(' · ');
}

export default function UsuariosPage() {
  const { user: currentUser } = useAuth();
  const router = useRouter();
  const canManage =
    !!currentUser && ROLES_THAT_MANAGE_USERS.includes(currentUser.role);

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [credentials, setCredentials] = useState<UserWithPassword | null>(null);
  const [credentialsOpen, setCredentialsOpen] = useState(false);

  useEffect(() => {
    if (currentUser && !canManage) router.replace('/dashboard');
  }, [currentUser, canManage, router]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    try {
      setUsers(await usersApi.getAll(debounced || undefined));
    } catch {
      toast.error('Erro ao carregar os acessos');
    } finally {
      setLoading(false);
    }
  }, [debounced]);

  useEffect(() => {
    if (canManage) load();
  }, [load, canManage]);

  const totalAtivos = users.filter((u) => u.active).length;
  const totalAdmins = users.filter(
    (u) => u.role === 'ADMIN' || u.role === 'SUPER_ADMIN',
  ).length;

  const showCredentials = (data: UserWithPassword) => {
    setCredentials(data);
    setCredentialsOpen(true);
  };

  const apiError = (err: unknown, fallback: string) => {
    const msg =
      (err as { response?: { data?: { message?: string | string[] } } })?.response
        ?.data?.message || fallback;
    toast.error(Array.isArray(msg) ? msg.join('. ') : msg);
  };

  const handleResetPassword = async (u: ManagedUser) => {
    if (
      !confirm(
        `Gerar uma senha nova para ${u.name}? A senha atual deixa de funcionar na hora.`,
      )
    ) {
      return;
    }
    try {
      showCredentials(await usersApi.resetPassword(u.id));
      await load();
    } catch (err) {
      apiError(err, 'Erro ao gerar a senha');
    }
  };

  const handleToggleActive = async (u: ManagedUser) => {
    try {
      await usersApi.update(u.id, { active: !u.active });
      toast.success(u.active ? 'Acesso bloqueado' : 'Acesso liberado');
      await load();
    } catch (err) {
      apiError(err, 'Erro ao alterar o acesso');
    }
  };

  const handleDelete = async (u: ManagedUser) => {
    if (!confirm(`Excluir o acesso de ${u.name}? Ela não entra mais no painel.`))
      return;
    try {
      await usersApi.remove(u.id);
      toast.success('Acesso excluído');
      await load();
    } catch (err) {
      apiError(err, 'Erro ao excluir o acesso');
    }
  };

  if (!canManage) return null;

  return (
    <div className="flex flex-col h-full p-4 md:p-6 gap-4 overflow-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Users className="h-5 w-5 text-brand-orange-500" />
            Usuários e acessos
          </h1>
          <p className="text-sm text-muted-foreground">
            Crie o acesso, escolha as telas que a pessoa enxerga e copie o
            login e a senha pra enviar
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Novo acesso
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-lg bg-brand-orange-500/15 p-2">
              <Users className="h-5 w-5 text-brand-orange-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Acessos cadastrados</p>
              <p className="text-2xl font-bold">{users.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-lg bg-emerald-500/15 p-2">
              <UserCheck className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Liberados</p>
              <p className="text-2xl font-bold">{totalAtivos}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-lg bg-purple-500/15 p-2">
              <ShieldCheck className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Administradores</p>
              <p className="text-2xl font-bold">{totalAdmins}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Buscar por nome ou e-mail..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">
              {debounced ? 'Nenhum acesso encontrado' : 'Nenhum acesso cadastrado'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {users.map((u) => {
            const isSelf = u.id === currentUser?.id;
            return (
              <Card key={u.id} className={cn(!u.active && 'opacity-60')}>
                <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">{u.name}</span>
                      <Badge
                        className={cn('text-[10px] border', ROLE_BADGE[u.role])}
                      >
                        {ROLE_LABEL[u.role]}
                      </Badge>
                      {isSelf && (
                        <Badge className="text-[10px] border bg-slate-500/15 text-slate-300 border-slate-500/30">
                          você
                        </Badge>
                      )}
                      {!u.active && (
                        <Badge className="text-[10px] border bg-red-500/15 text-red-300 border-red-500/30">
                          bloqueado
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 font-mono break-all">
                      {u.email}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {describeRoutes(u)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Criado em {formatDateBR(u.createdAt)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleResetPassword(u)}
                      disabled={isSelf}
                    >
                      <KeyRound className="h-4 w-4 mr-1" />
                      Gerar nova senha e copiar
                    </Button>

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
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem
                          onClick={() => {
                            setEditing(u);
                            setFormOpen(true);
                          }}
                          disabled={isSelf}
                        >
                          <Pencil className="h-4 w-4" /> Editar permissões
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleToggleActive(u)}
                          disabled={isSelf}
                        >
                          <Power className="h-4 w-4" />
                          {u.active ? 'Bloquear acesso' : 'Liberar acesso'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleDelete(u)}
                          disabled={isSelf}
                          className="text-red-400"
                        >
                          <Trash2 className="h-4 w-4" /> Excluir acesso
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <UserFormDialog
        user={editing}
        actorRole={currentUser?.role}
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={load}
        onCreated={showCredentials}
      />
      <UserCredentialsDialog
        data={credentials}
        open={credentialsOpen}
        onOpenChange={setCredentialsOpen}
      />
    </div>
  );
}
