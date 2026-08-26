'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bluetooth,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  RadioTower,
  RefreshCw,
  Search,
  Signal,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { bleTagsApi } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/auth-context';
import { canSeeInstallLocation } from '@/lib/manageable-routes';
import {
  cn,
  formatCpfCnpj,
  formatDateOnlyBR,
  formatRelativeTime,
  maskCPF,
} from '@/lib/utils';
import type { ActiveTagRow, ActiveTagsResponse } from '@/types/ble-tag';

const TAMANHOS_PAGINA = [20, 60, 140, 200];

type Filtro = 'TODOS' | 'RASTREADOR_E_TAG' | 'SO_TAG';

const MODELO_LABEL: Record<string, string> = {
  BLE_KTAG: 'K-Tag',
  BLE_REDTAG: 'RedTag',
  BLE_AIRTAG_GENERIC: 'AirTag',
};

export default function TagsAtivasPage() {
  const { user } = useAuth();
  // Mesma régua do documento no card do ativo: inteiro só pro time interno.
  const podeVerDocumento = canSeeInstallLocation(user?.role);

  const [resposta, setResposta] = useState<ActiveTagsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [filtro, setFiltro] = useState<Filtro>('TODOS');
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const primeiraCarga = useRef(true);

  const carregar = useCallback(async () => {
    if (primeiraCarga.current) setCarregando(true);
    try {
      setResposta(
        await bleTagsApi.getActive({
          page,
          perPage,
          search: busca.trim() || undefined,
          tipo: filtro === 'TODOS' ? undefined : filtro,
        }),
      );
    } catch {
      toast.error('Não consegui carregar as TAGs.');
    } finally {
      setCarregando(false);
      primeiraCarga.current = false;
    }
  }, [page, perPage, busca, filtro]);

  // Busca digitada não pode disparar uma consulta por tecla.
  useEffect(() => {
    const timer = setTimeout(() => void carregar(), 400);
    return () => clearTimeout(timer);
  }, [carregar]);

  const meta = resposta?.meta;
  const linhas = resposta?.data ?? [];

  const trocarFiltro = (novo: Filtro) => {
    setFiltro(novo);
    setPage(1);
  };

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Bluetooth className="h-6 w-6 text-brand-orange-500" />
            TAGs Ativas
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Um card por veículo com TAG contratada e cliente ativo — fonte: SGA
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void carregar()}
          disabled={carregando}
        >
          <RefreshCw className={cn('h-4 w-4', carregando && 'animate-spin')} />
          <span className="ml-2">Atualizar</span>
        </Button>
      </div>

      {/* Os três recortes são também o filtro: o operador clica no número que
          quer ver, em vez de procurar um seletor separado. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Cartao
          rotulo="Veículos com TAG"
          valor={(meta?.comRastreador ?? 0) + (meta?.soTag ?? 0)}
          ativo={filtro === 'TODOS'}
          onClick={() => trocarFiltro('TODOS')}
        />
        <Cartao
          rotulo="Rastreador + TAG"
          valor={meta?.comRastreador ?? 0}
          ativo={filtro === 'RASTREADOR_E_TAG'}
          onClick={() => trocarFiltro('RASTREADOR_E_TAG')}
        />
        <Cartao
          rotulo="Só TAG"
          valor={meta?.soTag ?? 0}
          ativo={filtro === 'SO_TAG'}
          onClick={() => trocarFiltro('SO_TAG')}
          cor="text-brand-orange-500"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPage(1);
            }}
            placeholder="Buscar por nome, CPF, placa ou chassi..."
            className="pl-9"
          />
        </div>
        <select
          value={perPage}
          onChange={(e) => {
            setPerPage(Number(e.target.value));
            setPage(1);
          }}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          {TAMANHOS_PAGINA.map((n) => (
            <option key={n} value={n}>
              {n} por página
            </option>
          ))}
        </select>
        {meta && (
          <span className="text-sm text-muted-foreground">
            {meta.total.toLocaleString('pt-BR')} no total · página {meta.page} de{' '}
            {meta.totalPages}
          </span>
        )}
      </div>

      {carregando ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : linhas.length === 0 ? (
        <div className="rounded-lg border bg-card py-12 text-center">
          <Bluetooth className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-medium">
            Nenhum veículo com TAG neste filtro
          </h3>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            A lista vem do SGA: entra quem tem adesão com TAG e está com o
            cliente ativo.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {linhas.map((linha) => (
              <CardTag
                key={linha.id}
                linha={linha}
                podeVerDocumento={podeVerDocumento}
              />
            ))}
          </div>

          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={meta.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </Button>
              <span className="px-2 text-sm text-muted-foreground">
                {meta.page} / {meta.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={meta.page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Cartao({
  rotulo,
  valor,
  ativo,
  onClick,
  cor,
}: {
  rotulo: string;
  valor: number;
  ativo: boolean;
  onClick: () => void;
  cor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40',
        ativo && 'border-brand-orange-500/60 bg-brand-orange-500/5',
      )}
    >
      <p className="text-sm text-muted-foreground">{rotulo}</p>
      <p className={cn('mt-1 text-3xl font-bold', cor)}>
        {valor.toLocaleString('pt-BR')}
      </p>
    </button>
  );
}

/**
 * Um card por veículo com TAG. O que o atendimento precisa quando o telefone
 * toca: de quem é, qual carro, e se a TAG é o único equipamento — porque nesse
 * caso não há rastreamento por GPS pra oferecer.
 */
function CardTag({
  linha,
  podeVerDocumento,
}: {
  linha: ActiveTagRow;
  podeVerDocumento: boolean;
}) {
  const soTag = linha.tipo === 'SO_TAG';

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 bg-muted/30 px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold leading-tight">
            <span className="truncate">
              {linha.brandModel || 'Modelo não informado'}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-muted-foreground">
              {linha.plate || linha.chassi}
            </span>
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {linha.tag ? (
              <span className="font-mono">
                <span className="font-sans">
                  {MODELO_LABEL[linha.tag.model] ?? 'TAG'}
                </span>{' '}
                {linha.tag.imei}
                {linha.tag.macAddress && (
                  <>
                    {' · '}
                    <span className="font-sans">MAC</span>{' '}
                    {linha.tag.macAddress}
                  </>
                )}
              </span>
            ) : (
              'TAG não cadastrada no 21 GO — número e MAC desconhecidos'
            )}
          </p>
        </div>

        <span
          className={cn(
            'shrink-0 rounded px-2 py-0.5 text-[11px] font-bold',
            soTag
              ? 'bg-brand-orange-500/15 text-brand-orange-500'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {soTag ? 'SÓ TAG' : 'RASTREADOR + TAG'}
        </span>
      </div>

      <div className="space-y-1.5 px-4 py-3 text-sm">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5">
            <User className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{linha.associateName}</span>
          </span>
          {linha.cpf && (
            <span className="font-mono text-xs">
              CPF{' '}
              {podeVerDocumento ? formatCpfCnpj(linha.cpf) : maskCPF(linha.cpf)}
            </span>
          )}
        </p>

        {linha.tag ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="flex items-center gap-1.5 text-brand-green-600">
              <Signal className="h-3.5 w-3.5 shrink-0" />
              {linha.tag.lastSeenAt
                ? `Vista ${formatRelativeTime(linha.tag.lastSeenAt)}`
                : 'Cadastrada, ainda sem detecção'}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3 w-3" />
              cadastrada no 21 GO
            </span>
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <RadioTower className="h-3.5 w-3.5 shrink-0" />
            {linha.vehicleId
              ? 'Veículo já existe aqui; falta cadastrar a TAG em Dispositivos'
              : 'Veículo ainda não cadastrado no 21 GO'}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t px-4 py-2 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        {linha.contractDate
          ? `Contrato de ${formatDateOnlyBR(linha.contractDate)}`
          : 'Data de contrato não informada'}
      </div>
    </div>
  );
}
