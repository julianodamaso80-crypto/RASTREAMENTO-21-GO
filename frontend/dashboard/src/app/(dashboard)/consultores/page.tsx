'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Contact,
  Search,
  RefreshCw,
  Phone,
  Mail,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { consultantsApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { cn, formatDateBR, formatRelativeTime } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type {
  ConsultantDetail,
  ConsultantList,
  ConsultantStatusFilter,
} from '@/types/consultant';

/**
 * Consultores da 21 GO, copiados do Power CRM a cada 30 minutos.
 *
 * A tela lê a cópia no nosso banco, nunca o Power ao vivo. Endereço não aparece
 * porque o Power não tem esse campo.
 */

function formatTelefone(d: string | null): string | null {
  if (!d) return null;
  const n = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  if (n.length === 11) return n.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (n.length === 10) return n.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return d;
}

function whatsappDe(d: string | null): string | null {
  if (!d) return null;
  const n = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  return n.length === 10 || n.length === 11 ? `https://wa.me/55${n}` : null;
}

function formatDocumento(d: string | null): string {
  if (!d) return '—';
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d;
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge
      className={cn(
        'border text-[10px]',
        active
          ? 'bg-brand-green-500/15 text-brand-green-500 border-brand-green-500/30'
          : 'bg-red-500/15 text-red-400 border-red-500/30',
      )}
    >
      {active ? 'Ativo' : 'Bloqueado'}
    </Badge>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <div className="text-sm break-words">{children || '—'}</div>
    </div>
  );
}

function FichaConsultor({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  // Um consultor por montagem (a página passa key={id}): nada a zerar aqui.
  const [c, setC] = useState<ConsultantDetail | null>(null);

  useEffect(() => {
    if (!id) return;
    consultantsApi
      .get(id)
      .then(setC)
      .catch(() => toast.error('Não consegui abrir a ficha do consultor'));
  }, [id]);

  const celular = formatTelefone(c?.mobile ?? null);
  const fixo = formatTelefone(c?.phone ?? null);
  const whatsapp = whatsappDe(c?.mobile ?? null);

  return (
    <Sheet open={!!id} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{c?.name ?? 'Consultor'}</SheetTitle>
          <SheetDescription>
            {c ? `${c.officeLabel ?? 'Sem cargo'} · Power #${c.powerId}` : 'Carregando...'}
          </SheetDescription>
        </SheetHeader>

        {!c ? (
          <div className="space-y-3 px-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-5 px-4 pb-6">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge active={c.active} />
              {c.blockedAt && (
                <span className="text-xs text-muted-foreground">
                  bloqueado em {formatDateBR(c.blockedAt)}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {whatsapp && (
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: 'sm' })}>
                    <MessageCircle className="h-4 w-4" />
                    WhatsApp
                  </a>
              )}
              {c.mobile && (
                <a href={`tel:${c.mobile}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                    <Phone className="h-4 w-4" />
                    Ligar
                  </a>
              )}
              {c.email && (
                <a href={`mailto:${c.email}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                    <Mail className="h-4 w-4" />
                    E-mail
                  </a>
              )}
            </div>

            <section className="grid gap-4 sm:grid-cols-2">
              <Campo label="Celular">{celular}</Campo>
              <Campo label="Telefone">{fixo}</Campo>
              <div className="sm:col-span-2">
                <Campo label="E-mail">{c.email}</Campo>
              </div>
              <Campo label="CPF / CNPJ">{formatDocumento(c.document)}</Campo>
              <Campo label="Nome de tratamento">{c.nickname}</Campo>
            </section>

            <section className="grid gap-4 sm:grid-cols-2 border-t border-border pt-4">
              <Campo label="Cargo">{c.officeLabel}</Campo>
              <Campo label="Grupo">{c.permissionGroup}</Campo>
              <Campo label="Quem chamou">{c.managerName}</Campo>
              <Campo label="Filial">{c.branch}</Campo>
              <div className="sm:col-span-2">
                <Campo label="Cooperativa">{c.cooperative}</Campo>
              </div>
            </section>

            <section className="grid gap-4 sm:grid-cols-2 border-t border-border pt-4">
              <Campo label="Cadastrado no Power">
                {c.powerCreatedAt ? formatDateBR(c.powerCreatedAt) : null}
              </Campo>
              <Campo label="Último acesso ao Power">
                {c.lastAccessAt ? formatDateBR(c.lastAccessAt) : 'Nunca acessou'}
              </Campo>
            </section>

            <p className="text-xs text-muted-foreground">
              Dados do Power CRM · copiado {formatRelativeTime(c.syncedAt)}. O Power não tem
              endereço de consultor.
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function ConsultoresPage() {
  const { user } = useAuth();
  const podeAtualizar = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const [data, setData] = useState<ConsultantList | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ConsultantStatusFilter | ''>('');
  const [office, setOffice] = useState('');
  const [page, setPage] = useState(0);
  const [aberto, setAberto] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const lista = await consultantsApi.list({
        search: search || undefined,
        status: status || undefined,
        office: office ? Number(office) : undefined,
        page,
      });
      setData(lista);
    } catch {
      toast.error('Erro ao carregar consultores');
    } finally {
      setLoading(false);
    }
  }, [search, status, office, page]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  // Filtro novo sempre volta pra primeira página.
  useEffect(() => {
    setPage(0);
  }, [search, status, office]);

  async function handleSync() {
    try {
      const r = await consultantsApi.startSync();
      toast.info(r.alreadyRunning ? 'Já está atualizando.' : 'Buscando no Power — leva menos de um minuto.');
      setSyncing(true);
      const inicio = Date.now();
      while (Date.now() - inicio < 5 * 60 * 1000) {
        await new Promise((res) => setTimeout(res, 3000));
        const s = await consultantsApi.syncStatus().catch(() => null);
        if (!s || s.syncing) continue;
        if (s.lastError) toast.error(`Falhou: ${s.lastError}`);
        else toast.success(`${s.lastTotal ?? 0} consultores atualizados do Power`);
        break;
      }
      await load();
    } catch {
      toast.error('Não consegui iniciar a atualização');
    } finally {
      setSyncing(false);
    }
  }

  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex flex-col h-full min-w-0 p-4 md:p-6 gap-4 overflow-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Contact className="h-5 w-5 text-brand-orange-500" />
            Consultores
          </h1>
          <p className="text-sm text-muted-foreground">
            Todos os consultores do Power CRM · atualiza sozinho a cada 30 minutos
            {data?.lastSyncAt && ` · atualizado ${formatRelativeTime(data.lastSyncAt)}`}
          </p>
        </div>
        {podeAtualizar && (
          <Button size="sm" onClick={handleSync} disabled={syncing} className="shrink-0">
            <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
            {syncing ? 'Atualizando...' : 'Atualizar do Power'}
          </Button>
        )}
      </div>

      <div className="grid gap-3 grid-cols-2 shrink-0 max-w-xl">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Ativos</span>
              <UserCheck className="h-4 w-4 text-brand-orange-500" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {(data?.stats.active ?? 0).toLocaleString('pt-BR')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Bloqueados</span>
              <UserX className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {(data?.stats.blocked ?? 0).toLocaleString('pt-BR')}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Nome, e-mail, CPF ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <SelectNative value={status} onChange={(e) => setStatus(e.target.value as ConsultantStatusFilter | '')}>
          <option value="">Ativos e bloqueados</option>
          <option value="ativo">Só ativos</option>
          <option value="bloqueado">Só bloqueados</option>
        </SelectNative>
        <SelectNative value={office} onChange={(e) => setOffice(e.target.value)}>
          <option value="">Todos os cargos</option>
          {data?.offices.map((o) => (
            <option key={o.office} value={o.office}>
              {o.label} ({o.count.toLocaleString('pt-BR')})
            </option>
          ))}
        </SelectNative>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Contact className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhum consultor nesse filtro</p>
            {!data?.lastSyncAt && (
              <p className="text-xs text-muted-foreground mt-1">
                A lista ainda não foi copiada do Power. A primeira cópia sai sozinha em instantes.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Consultor</th>
                  <th className="px-3 py-2 text-left font-medium">Celular</th>
                  <th className="px-3 py-2 text-left font-medium hidden md:table-cell">E-mail</th>
                  <th className="px-3 py-2 text-left font-medium hidden lg:table-cell">Cooperativa</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.items.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setAberto(c.id)}
                    className="cursor-pointer hover:bg-muted/20"
                  >
                    <td className="px-3 py-2">
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.officeLabel ?? '—'}</p>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {formatTelefone(c.mobile) ?? '—'}
                    </td>
                    <td className="px-3 py-2 hidden md:table-cell max-w-[260px] truncate" title={c.email ?? ''}>
                      {c.email ?? '—'}
                    </td>
                    <td className="px-3 py-2 hidden lg:table-cell max-w-[240px] truncate" title={c.cooperative ?? ''}>
                      {c.cooperative ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge active={c.active} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {data.total.toLocaleString('pt-BR')} consultores · página {page + 1} de {totalPaginas}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page + 1 >= totalPaginas}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <FichaConsultor key={aberto ?? 'fechada'} id={aberto} onClose={() => setAberto(null)} />
    </div>
  );
}
