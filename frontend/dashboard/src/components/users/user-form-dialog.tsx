'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldCheck, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { usersApi } from '@/lib/api';
import {
  MANAGEABLE_ROUTES,
  DEFAULT_ROUTES_BY_ROLE,
  ROLE_LABEL,
  ROLE_DESCRIPTION,
  type ManageableRouteKey,
} from '@/lib/manageable-routes';
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
import type { Role } from '@/types/auth';
import type { ManagedUser, UserWithPassword } from '@/types/user';

type Props = {
  user: ManagedUser | null; // null = criar
  /** Perfil de quem está criando — só Super Admin concede Super Admin. */
  actorRole: Role | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onCreated: (data: UserWithPassword) => void;
};

const SELECTABLE_ROLES: Role[] = ['ADMIN', 'OPERATOR', 'VIEWER'];

export function UserFormDialog({
  user,
  actorRole,
  open,
  onOpenChange,
  onSaved,
  onCreated,
}: Props) {
  const editing = !!user;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('OPERATOR');
  const [routes, setRoutes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const roleOptions = useMemo(
    () =>
      actorRole === 'SUPER_ADMIN'
        ? ([...SELECTABLE_ROLES, 'SUPER_ADMIN'] as Role[])
        : SELECTABLE_ROLES,
    [actorRole],
  );

  // Telas que o perfil escolhido consegue ver — o resto nem aparece pra marcar.
  const availableRoutes = useMemo(
    () =>
      MANAGEABLE_ROUTES.filter((r) =>
        DEFAULT_ROUTES_BY_ROLE[role]?.includes(r.key),
      ),
    [role],
  );

  useEffect(() => {
    if (!open) return;
    setName(user?.name ?? '');
    setEmail(user?.email ?? '');
    const nextRole = user?.role ?? 'OPERATOR';
    setRole(nextRole);
    setRoutes(
      user?.allowedRoutes?.length
        ? user.allowedRoutes
        : [...(DEFAULT_ROUTES_BY_ROLE[nextRole] ?? [])],
    );
    setSaving(false);
  }, [open, user]);

  const changeRole = (next: Role) => {
    setRole(next);
    // Ao trocar de perfil, mantém só o que o novo perfil enxerga.
    const allowed = DEFAULT_ROUTES_BY_ROLE[next] ?? [];
    setRoutes((prev) => {
      const kept = prev.filter((r) => allowed.includes(r as ManageableRouteKey));
      return kept.length ? kept : [...allowed];
    });
  };

  const toggleRoute = (key: string) => {
    setRoutes((prev) =>
      prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key],
    );
  };

  const allSelected = routes.length === availableRoutes.length;
  const toggleAll = () =>
    setRoutes(allSelected ? [] : availableRoutes.map((r) => r.key));

  const handleSubmit = async () => {
    if (name.trim().length < 3) {
      toast.error('Informe o nome completo.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      toast.error('Informe um e-mail válido — é com ele que a pessoa entra.');
      return;
    }
    if (routes.length === 0) {
      toast.error('Marque pelo menos uma tela.');
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await usersApi.update(user.id, {
          name: name.trim(),
          role,
          allowedRoutes: routes,
        });
        toast.success('Acesso atualizado');
        onSaved();
        onOpenChange(false);
      } else {
        const created = await usersApi.create({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role,
          allowedRoutes: routes,
        });
        onSaved();
        onOpenChange(false);
        onCreated(created); // abre o cartão com as credenciais
      }
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || 'Erro ao salvar o acesso';
      toast.error(Array.isArray(msg) ? msg.join('. ') : msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-brand-orange-500" />
            {editing ? `Editar acesso de ${user.name}` : 'Novo acesso'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="user-nome">Nome completo</Label>
              <Input
                id="user-nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Maria Souza"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-email">
                E-mail {editing && '(não editável)'}
              </Label>
              <Input
                id="user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="maria@empresa.com.br"
                disabled={editing}
              />
              {!editing && (
                <p className="text-[11px] text-muted-foreground">
                  É o login dela no painel.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Perfil</Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {roleOptions.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => changeRole(r)}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors',
                    role === r
                      ? 'border-brand-orange-500 bg-brand-orange-500/10'
                      : 'hover:bg-muted/40',
                  )}
                >
                  <span className="block text-sm font-semibold">
                    {ROLE_LABEL[r]}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {ROLE_DESCRIPTION[r]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Telas liberadas ({routes.length})</Label>
              <Button variant="ghost" size="sm" onClick={toggleAll}>
                {allSelected ? 'Desmarcar todas' : 'Marcar todas'}
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {availableRoutes.map((r) => {
                const checked = routes.includes(r.key);
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => toggleRoute(r.key)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                      checked
                        ? 'border-brand-orange-500/60 bg-brand-orange-500/10'
                        : 'hover:bg-muted/40',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                        checked
                          ? 'border-brand-orange-500 bg-brand-orange-500 text-white'
                          : 'border-muted-foreground/40',
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {editing ? 'Salvar' : 'Criar acesso e gerar senha'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
