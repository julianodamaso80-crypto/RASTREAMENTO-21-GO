'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { consultantsApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { cn, formatDateBR, formatRelativeTime } from '@/lib/utils';
import {
  buscar,
  indexar,
  liderancasEncontradas,
  normalizar,
  type MotivoBusca,
} from '@/lib/busca-consultores';
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
  Consultant,
  ConsultantBase,
  ConsultantStatusFilter,
} from '@/types/consultant';

/**
 * Consultores da 21 GO, copiados do Power CRM pelo servidor a cada 30 minutos.
 *
 * A base inteira vem numa chamada só e fica em memória: busca, filtros, página e
 * ficha são instantâneos. A busca ordena por relevância e tolera grafia trocada
 * (ver lib/busca-consultores). Endereço não aparece porque o Power não tem.
 */

const POR_PAGINA = 100;

/** Sobrevive à troca de tela dentro do painel. Só memória: some ao recarregar a página. */
let baseEmMemoria: ConsultantBase | null = null;

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

/** Conta quantos têm cada valor de um campo, do mais comum para o menos. */
function contar(lista: Consultant[], campo: (c: Consultant) => string | null) {
  const mapa = new Map<string, number>();
  for (const c of lista) {
    const v = campo(c);
    if (v) mapa.set(v, (mapa.get(v) ?? 0) + 1);
  }
  return [...mapa.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'));
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
  consultor: c,
  equipe,
  lastSyncAt,
  onClose,
  onVerEquipe,
}: {
  consultor: Consultant | null;
  equipe: number;
  lastSyncAt: string | null;
  onClose: () => void;
  onVerEquipe: (nomeDoLider: string) => void;
}) {
  const whatsapp = whatsappDe(c?.mobile ?? null);

  return (
    <Sheet open={!!c} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        {c && (
          <>
            <SheetHeader>
              <SheetTitle>{c.name}</SheetTitle>
              <SheetDescription>
                {`${c.officeLabel ?? 'Sem cargo'} · Power #${c.powerId}`}
              </SheetDescription>
            </SheetHeader>

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
                {equipe > 0 && (
                  <Button size="sm" variant="outline" onClick={() => onVerEquipe(c.nickname ?? c.name)}>
                    <Users className="h-4 w-4" />
                    Equipe ({equipe})
                  </Button>
                )}
              </div>

              <section className="grid gap-4 sm:grid-cols-2">
                <Campo label="Celular">{formatTelefone(c.mobile)}</Campo>
                <Campo label="Telefone">{formatTelefone(c.phone)}</Campo>
                <div className="sm:col-span-2">
                  <Campo label="E-mail">{c.email}</Campo>
                </div>
                <Campo label="CPF / CNPJ">{formatDocumento(c.document)}</Campo>
                <Campo label="Nome de tratamento">{c.nickname}</Campo>
              </section>

              <section className="grid gap-4 sm:grid-cols-2 border-t border-border pt-4">
                <Campo label="Cargo">{c.officeLabel}</Campo>
                <Campo label="Grupo">{c.permissionGroup}</Campo>
                <Campo label="Quem chamou">
                  {c.managerName && (
                    <button
                      type="button"
                      onClick={() => onVerEquipe(c.managerName as string)}
                      className="text-left text-brand-orange-500 hover:underline"
                      title="Ver todos que essa pessoa chamou"
                    >
                      {c.managerName}
                    </button>
                  )}
                </Campo>
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
                Dados do Power CRM
                {lastSyncAt && ` · copiado ${formatRelativeTime(lastSyncAt)}`}. O Power não
                tem endereço de consultor.
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

const MOTIVO_TEXTO: Record<MotivoBusca, (c: Consultant) => string> = {
  'quem-chamou': (c) => `Chamado por ${c.managerName}`,
  cooperativa: (c) => `Cooperativa ${c.cooperative}`,
  filial: (c) => `Filial ${c.branch}`,
};

export default function ConsultoresPage() {
  const { user } = useAuth();
  const podeAtualizar = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const [base, setBase] = useState<ConsultantBase | null>(() => baseEmMemoria);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ConsultantStatusFilter | ''>('');
  const [office, setOffice] = useState('');
  const [cooperativa, setCooperativa] = useState('');
  const [quemChamou, setQuemChamou] = useState('');
  const [page, setPage] = useState(0);
  const [aberto, setAberto] = useState<Consultant | null>(null);

  const carregar = useCallback(async () => {
    try {
      const nova = await consultantsApi.all();
      baseEmMemoria = nova;
      setBase(nova);
    } catch {
      toast.error('Erro ao carregar consultores');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const todos = useMemo(() => base?.items ?? [], [base]);
  const indice = useMemo(() => indexar(todos), [todos]);

  /** Tamanho da equipe de cada um, pelo nome de tratamento (é o que "quem chamou" guarda). */
  const equipePorNome = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const c of todos) {
      if (c.managerName) {
        const chave = normalizar(c.managerName);
        mapa.set(chave, (mapa.get(chave) ?? 0) + 1);
      }
    }
    return mapa;
  }, [todos]);
  const equipeDe = useCallback(
    (c: Consultant) =>
      Math.max(equipePorNome.get(normalizar(c.nickname)) ?? 0, equipePorNome.get(normalizar(c.name)) ?? 0),
    [equipePorNome],
  );

  const resultadosBusca = useMemo(() => buscar(indice, search), [indice, search]);

  // Cada filtro testado à parte: os números de uma lista contam com a busca e os OUTROS filtros.
  const quemChamouNorm = normalizar(quemChamou.trim());
  const passa = useMemo(
    () => ({
      status: (c: Consultant) => !status || c.active === (status === 'ativo'),
      office: (c: Consultant) => !office || c.office === Number(office),
      cooperativa: (c: Consultant) => !cooperativa || c.cooperative === cooperativa,
      quemChamou: (c: Consultant) => !quemChamouNorm || normalizar(c.managerName).includes(quemChamouNorm),
    }),
    [status, office, cooperativa, quemChamouNorm],
  );
  type Filtro = keyof typeof passa;
  const aplicar = useCallback(
    (exceto?: Filtro) =>
      resultadosBusca.filter((r) =>
        (Object.keys(passa) as Filtro[]).every((k) => k === exceto || passa[k](r.consultor)),
      ),
    [resultadosBusca, passa],
  );

  const filtrados = useMemo(() => aplicar(), [aplicar]);
  const opcoes = useMemo(() => {
    const semStatus = aplicar('status').map((r) => r.consultor);
    return {
      ativos: semStatus.filter((c) => c.active).length,
      bloqueados: semStatus.filter((c) => !c.active).length,
      cargos: contar(aplicar('office').map((r) => r.consultor), (c) =>
        c.office === null ? null : `${c.office}|${c.officeLabel ?? `Cargo ${c.office}`}`,
      ),
      cooperativas: contar(aplicar('cooperativa').map((r) => r.consultor), (c) => c.cooperative),
      chamadores: contar(aplicar('quemChamou').map((r) => r.consultor), (c) => c.managerName),
    };
  }, [aplicar]);

  const totais = useMemo(
    () => ({ ativos: todos.filter((c) => c.active).length, bloqueados: todos.filter((c) => !c.active).length }),
    [todos],
  );

  const liderancas = useMemo(
    () => (search.trim() ? liderancasEncontradas(resultadosBusca, todos) : []),
    [search, resultadosBusca, todos],
  );

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaAtual = Math.min(page, totalPaginas - 1);
  const visiveis = filtrados.slice(paginaAtual * POR_PAGINA, (paginaAtual + 1) * POR_PAGINA);
  const temFiltro = !!(search || status || office || cooperativa || quemChamou);

  function limpar() {
    setSearch('');
    setStatus('');
    setOffice('');
    setCooperativa('');
    setQuemChamou('');
    setPage(0);
  }

  function verEquipe(nomeDoLider: string) {
    setSearch('');
    setQuemChamou(nomeDoLider);
    setPage(0);
    setAberto(null);
  }

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
      await carregar();
    } catch {
      toast.error('Não consegui iniciar a atualização');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col h-full min-w-0 p-4 md:p-6 gap-4 overflow-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Contact className="h-5 w-5 text-brand-orange-500" />
            Consultores
          </h1>
          <p className="text-sm text-muted-foreground">
            Todos os consultores do Power CRM · o servidor atualiza sozinho a cada 30 minutos
            {base?.lastSyncAt && ` · atualizado ${formatRelativeTime(base.lastSyncAt)}`}
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
            {base ? (
              <p className="mt-2 text-2xl font-bold tabular-nums">{totais.ativos.toLocaleString('pt-BR')}</p>
            ) : (
              <Skeleton className="mt-2 h-8 w-20" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Bloqueados</span>
              <UserX className="h-4 w-4 text-muted-foreground" />
            </div>
            {base ? (
              <p className="mt-2 text-2xl font-bold tabular-nums">{totais.bloqueados.toLocaleString('pt-BR')}</p>
            ) : (
              <Skeleton className="mt-2 h-8 w-20" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Busque por nome, apelido, e-mail, CPF, celular, quem chamou ou cooperativa..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="pl-9 pr-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setPage(0);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Limpar busca"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <SelectNative
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ConsultantStatusFilter | '');
              setPage(0);
            }}
          >
            <option value="">Ativos e bloqueados ({(opcoes.ativos + opcoes.bloqueados).toLocaleString('pt-BR')})</option>
            <option value="ativo">Só ativos ({opcoes.ativos.toLocaleString('pt-BR')})</option>
            <option value="bloqueado">Só bloqueados ({opcoes.bloqueados.toLocaleString('pt-BR')})</option>
          </SelectNative>
          <SelectNative
            value={office}
            onChange={(e) => {
              setOffice(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Todos os cargos</option>
            {opcoes.cargos.map(([chave, n]) => {
              const [codigo, rotulo] = chave.split('|');
              return (
                <option key={codigo} value={codigo}>
                  {rotulo} ({n.toLocaleString('pt-BR')})
                </option>
              );
            })}
          </SelectNative>
          <SelectNative
            value={cooperativa}
            onChange={(e) => {
              setCooperativa(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Todas as cooperativas</option>
            {opcoes.cooperativas.map(([nome, n]) => (
              <option key={nome} value={nome}>
                {nome} ({n.toLocaleString('pt-BR')})
              </option>
            ))}
          </SelectNative>
          <div className="relative">
            <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              list="lista-quem-chamou"
              placeholder="Quem chamou (equipe de...)"
              value={quemChamou}
              onChange={(e) => {
                setQuemChamou(e.target.value);
                setPage(0);
              }}
              className="pl-9 pr-9"
            />
            {quemChamou && (
              <button
                type="button"
                onClick={() => {
                  setQuemChamou('');
                  setPage(0);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Limpar quem chamou"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <datalist id="lista-quem-chamou">
              {opcoes.chamadores.slice(0, 300).map(([nome, n]) => (
                <option key={nome} value={nome}>
                  {`${n} na equipe`}
                </option>
              ))}
            </datalist>
          </div>
        </div>

        {(liderancas.length > 0 || temFiltro) && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {liderancas.map((l) => (
              <button
                key={l.consultor.id}
                type="button"
                onClick={() => verEquipe(l.consultor.nickname ?? l.consultor.name)}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand-orange-500/40 bg-brand-orange-500/10 px-3 py-1 text-brand-orange-500 hover:bg-brand-orange-500/20"
              >
                <Users className="h-3.5 w-3.5" />
                {l.consultor.name} chamou {l.equipe.toLocaleString('pt-BR')} · ver equipe
              </button>
            ))}
            {temFiltro && (
              <button type="button" onClick={limpar} className="text-muted-foreground underline-offset-2 hover:underline">
                Limpar tudo
              </button>
            )}
          </div>
        )}
      </div>

      {!base ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : visiveis.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Contact className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhum consultor encontrado</p>
            {temFiltro ? (
              <button type="button" onClick={limpar} className="text-xs text-brand-orange-500 mt-1 hover:underline">
                Limpar busca e filtros
              </button>
            ) : (
              !base.lastSyncAt && (
                <p className="text-xs text-muted-foreground mt-1">
                  A lista ainda não foi copiada do Power. A primeira cópia sai sozinha em instantes.
                </p>
              )
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
                {visiveis.map(({ consultor: c, motivo }) => (
                  <tr
                    key={c.id}
                    onClick={() => setAberto(c)}
                    className="cursor-pointer hover:bg-muted/20"
                  >
                    <td className="px-3 py-2">
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.officeLabel ?? '—'}
                        {motivo && (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px]">
                            {MOTIVO_TEXTO[motivo](c)}
                          </span>
                        )}
                      </p>
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

      {base && filtrados.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {filtrados.length.toLocaleString('pt-BR')} consultores
            {search.trim() && ' · mais relevantes primeiro'} · página {paginaAtual + 1} de {totalPaginas}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={paginaAtual === 0} onClick={() => setPage(paginaAtual - 1)}>
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={paginaAtual + 1 >= totalPaginas}
              onClick={() => setPage(paginaAtual + 1)}
            >
              Próxima
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <FichaConsultor
        consultor={aberto}
        equipe={aberto ? equipeDe(aberto) : 0}
        lastSyncAt={base?.lastSyncAt ?? null}
        onClose={() => setAberto(null)}
        onVerEquipe={verEquipe}
      />
    </div>
  );
}
