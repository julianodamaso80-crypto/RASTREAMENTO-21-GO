'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  HardHat,
  Loader2,
  LogOut,
  KeyRound,
  Boxes,
  ChevronRight,
  ArrowLeft,
  Search,
  SignalHigh,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { techApi } from '@/lib/tech-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SelectNative } from '@/components/ui/select-native';
import type { TechAssignment, TechMe } from '@/types/tech';
import type { HinovaLookup } from '@/types/stock';

const LOCAIS_INSTALACAO = [
  'Painel',
  'Coluna de direção',
  'Banco do motorista',
  'Porta-luvas',
  'Compartimento do motor',
  'Para-choque traseiro',
];

function maskCpf(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

function apiMessage(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
    fallback
  );
}

export default function TecnicoPage() {
  const [booting, setBooting] = useState(true);
  const [me, setMe] = useState<TechMe | null>(null);
  const [assignments, setAssignments] = useState<TechAssignment[] | null>(null);
  const [installing, setInstalling] = useState<TechAssignment | null>(null);

  const loadMe = useCallback(async () => {
    if (!techApi.getToken()) {
      setMe(null);
      setBooting(false);
      return;
    }
    try {
      setMe(await techApi.me());
    } catch {
      techApi.logout();
      setMe(null);
    } finally {
      setBooting(false);
    }
  }, []);

  const loadAssignments = useCallback(async () => {
    try {
      setAssignments(await techApi.assignments());
    } catch {
      toast.error('Erro ao carregar seus equipamentos');
      setAssignments([]);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (me && !me.mustChangePassword) loadAssignments();
  }, [me, loadAssignments]);

  const handleLogout = () => {
    techApi.logout();
    setMe(null);
    setAssignments(null);
    setInstalling(null);
  };

  if (booting) {
    return (
      <div className="space-y-3 pt-10">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }

  if (!me) return <LoginScreen onLogged={loadMe} />;

  if (me.mustChangePassword) {
    return <ChangePasswordScreen name={me.name} onDone={loadMe} onLogout={handleLogout} />;
  }

  if (installing) {
    return (
      <InstallScreen
        item={installing}
        onBack={() => setInstalling(null)}
        onFinished={() => {
          setInstalling(null);
          loadAssignments();
        }}
      />
    );
  }

  return (
    <AssignmentsScreen
      me={me}
      assignments={assignments}
      onRefresh={loadAssignments}
      onInstall={setInstalling}
      onLogout={handleLogout}
    />
  );
}

/* ------------------------------- Login ---------------------------------- */

function LoginScreen({ onLogged }: { onLogged: () => void }) {
  const [cpf, setCpf] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cpf.replace(/\D/g, '').length !== 11) {
      toast.error('Digite o CPF completo.');
      return;
    }
    setLoading(true);
    try {
      const res = await techApi.login(cpf.replace(/\D/g, ''), password);
      techApi.setToken(res.accessToken);
      onLogged();
    } catch (err) {
      toast.error(apiMessage(err, 'CPF ou senha inválidos'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[80dvh] flex-col justify-center">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-orange-500/15">
          <HardHat className="h-7 w-7 text-brand-orange-500" />
        </div>
        <h1 className="text-2xl font-bold">Área do técnico</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Entre com seu CPF para ver os equipamentos que estão com você
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cpf">CPF</Label>
          <Input
            id="cpf"
            value={cpf}
            onChange={(e) => setCpf(maskCpf(e.target.value))}
            placeholder="000.000.000-00"
            inputMode="numeric"
            autoComplete="username"
            className="h-12 text-lg"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="senha">Senha</Label>
          <Input
            id="senha"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Senha que o escritório enviou"
            autoComplete="current-password"
            className="h-12 text-lg"
          />
        </div>
        <Button type="submit" className="h-12 w-full text-base" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
          Entrar
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Esqueceu a senha? Peça uma nova ao escritório.
      </p>
    </div>
  );
}

/* --------------------------- Troca de senha ------------------------------ */

function ChangePasswordScreen({
  name,
  onDone,
  onLogout,
}: {
  name: string;
  onDone: () => void;
  onLogout: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 6) {
      toast.error('A nova senha precisa ter ao menos 6 caracteres.');
      return;
    }
    if (next !== confirm) {
      toast.error('As duas senhas novas não são iguais.');
      return;
    }
    setLoading(true);
    try {
      await techApi.changePassword(current, next);
      toast.success('Senha alterada');
      onDone();
    } catch (err) {
      toast.error(apiMessage(err, 'Não consegui trocar a senha'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[80dvh] flex-col justify-center">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-orange-500/15">
          <KeyRound className="h-7 w-7 text-brand-orange-500" />
        </div>
        <h1 className="text-xl font-bold">Olá, {name.split(' ')[0]}!</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Crie uma senha sua antes de continuar
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="atual">Senha que você recebeu</Label>
          <Input
            id="atual"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="h-12 text-lg"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nova">Nova senha</Label>
          <Input
            id="nova"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="Mínimo 6 caracteres"
            className="h-12 text-lg"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="conf">Repita a nova senha</Label>
          <Input
            id="conf"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="h-12 text-lg"
          />
        </div>
        <Button type="submit" className="h-12 w-full text-base" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
          Salvar e continuar
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={onLogout}>
          Sair
        </Button>
      </form>
    </div>
  );
}

/* ------------------------- Lista de equipamentos ------------------------- */

function AssignmentsScreen({
  me,
  assignments,
  onRefresh,
  onInstall,
  onLogout,
}: {
  me: TechMe;
  assignments: TechAssignment[] | null;
  onRefresh: () => void;
  onInstall: (item: TechAssignment) => void;
  onLogout: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Técnico</p>
          <h1 className="truncate text-xl font-bold">{me.name}</h1>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onRefresh} aria-label="Atualizar">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} aria-label="Sair">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3">
        <Boxes className="h-5 w-5 text-brand-orange-500" />
        <div>
          <p className="text-xs text-muted-foreground">Equipamentos com você</p>
          <p className="text-2xl font-bold leading-none">
            {assignments?.length ?? '—'}
          </p>
        </div>
      </div>

      {assignments === null ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : assignments.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Boxes className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              Nenhum equipamento reservado pra você
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Fale com o escritório para receber os rastreadores
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {assignments.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onInstall(a)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border bg-card px-4 py-4 text-left transition-colors active:bg-muted/60"
            >
              <div className="min-w-0">
                <p className="font-mono text-base font-semibold">{a.imei}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[a.operator, a.line, a.server].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------- Tela de instalação -------------------------- */

function InstallScreen({
  item,
  onBack,
  onFinished,
}: {
  item: TechAssignment;
  onBack: () => void;
  onFinished: () => void;
}) {
  const [placa, setPlaca] = useState('');
  const [lookup, setLookup] = useState<HinovaLookup | null>(null);
  const [searching, setSearching] = useState(false);
  const [local, setLocal] = useState('');
  const [localOutro, setLocalOutro] = useState('');
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  const localFinal = local === 'Outro' ? localOutro.trim() : local;
  const podeFinalizar = !!lookup?.encontrado && !!lookup?.ativo && localFinal.length >= 3;

  const buscar = async () => {
    const p = placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (p.length < 7) {
      toast.error('Digite a placa completa.');
      return;
    }
    setSearching(true);
    setLookup(null);
    try {
      const res = await techApi.lookup(p);
      setLookup(res);
      if (!res.encontrado) toast.error(res.motivo || 'Placa não encontrada no SGA.');
      else if (!res.ativo) toast.error('Placa inativa no SGA — vínculo bloqueado.');
    } catch (err) {
      toast.error(apiMessage(err, 'Erro ao consultar o SGA'));
    } finally {
      setSearching(false);
    }
  };

  const verificarSinal = async () => {
    setChecking(true);
    try {
      const res = await techApi.signal(item.id);
      if (res.online) toast.success('Rastreador comunicando agora');
      else if (res.lastUpdate)
        toast.warning(
          `Sem comunicação agora. Última posição: ${new Date(res.lastUpdate).toLocaleString('pt-BR')}`,
        );
      else toast.warning(res.motivo || 'Rastreador ainda não comunicou');
    } catch (err) {
      toast.error(apiMessage(err, 'Erro ao verificar o sinal'));
    } finally {
      setChecking(false);
    }
  };

  const finalizar = async () => {
    setSaving(true);
    try {
      const res = await techApi.finish(item.id, {
        placa: placa.toUpperCase().replace(/[^A-Z0-9]/g, ''),
        installLocation: localFinal,
      });
      toast.success(`Instalação finalizada — ${res.placa}`);
      onFinished();
    } catch (err) {
      toast.error(apiMessage(err, 'Não consegui finalizar a instalação'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} aria-label="Voltar">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Instalando</p>
          <p className="truncate font-mono text-sm font-semibold">{item.imei}</p>
        </div>
      </div>

      {/* Placa */}
      <div className="space-y-1.5">
        <Label htmlFor="placa">Placa do veículo</Label>
        <div className="flex gap-2">
          <Input
            id="placa"
            value={placa}
            onChange={(e) => {
              setPlaca(e.target.value.toUpperCase());
              setLookup(null);
            }}
            placeholder="ABC1D23"
            autoCapitalize="characters"
            className="h-12 flex-1 font-mono text-lg tracking-widest"
          />
          <Button onClick={buscar} disabled={searching} className="h-12 px-4">
            {searching ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Search className="h-5 w-5" />
            )}
          </Button>
        </div>
      </div>

      {/* Resultado do SGA */}
      {lookup && !lookup.encontrado && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <p className="text-sm text-red-200">
            {lookup.motivo || 'Placa não encontrada no SGA.'}
          </p>
        </div>
      )}

      {lookup?.encontrado && !lookup.ativo && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-sm text-amber-200">
            Placa está {lookup.situacao.descricao || 'INATIVA'} no SGA — vínculo bloqueado.
            Fale com o escritório.
          </p>
        </div>
      )}

      {lookup?.encontrado && lookup.ativo && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
          <div className="mb-2 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span className="text-sm font-medium text-emerald-200">
              Cliente encontrado no SGA
            </span>
          </div>
          <p className="text-base font-semibold">{lookup.cliente.nome || '—'}</p>
          <p className="text-xs text-muted-foreground">
            {[lookup.veiculo.modelo, lookup.veiculo.placa].filter(Boolean).join(' · ')}
          </p>
          {lookup.situacao.descricao && (
            <Badge className="mt-2 border bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-[10px]">
              {lookup.situacao.descricao}
            </Badge>
          )}
        </div>
      )}

      {/* Local de instalação */}
      <div className="space-y-1.5">
        <Label htmlFor="local">Onde você instalou</Label>
        <SelectNative
          id="local"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          className="h-12"
        >
          <option value="">Selecione o local</option>
          {LOCAIS_INSTALACAO.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
          <option value="Outro">Outro</option>
        </SelectNative>
        {local === 'Outro' && (
          <Input
            value={localOutro}
            onChange={(e) => setLocalOutro(e.target.value)}
            placeholder="Descreva o local"
            className="h-12"
          />
        )}
      </div>

      <Button
        variant="outline"
        className="h-12 w-full"
        onClick={verificarSinal}
        disabled={checking}
      >
        {checking ? (
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        ) : (
          <SignalHigh className="mr-2 h-5 w-5" />
        )}
        Verificar sinal do rastreador
      </Button>

      <Button
        className={cn('h-14 w-full text-base font-semibold')}
        onClick={finalizar}
        disabled={!podeFinalizar || saving}
      >
        {saving && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
        Finalizar instalação
      </Button>

      {!podeFinalizar && (
        <p className="text-center text-xs text-muted-foreground">
          Consulte a placa no SGA e informe o local para liberar o botão.
        </p>
      )}
    </div>
  );
}
