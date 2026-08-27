'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bluetooth,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
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
  const router = useRouter();
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

  /**
   * O botão fica em todos os cards, mas só navega quando existe posição pra
   * mostrar. Abrir um mapa vazio seria pior do que dizer o motivo: o operador
   * ficaria procurando um pino que não existe.
   */
  const abrirNoMapa = (linha: ActiveTagRow) => {
    // Nesta tela o assunto é a TAG: o ponto dela vem primeiro, mesmo quando o
    // veículo também tem rastreador. Quem quer o GPS ao vivo tem o /mapa.
    const tag = linha.tagEspelho;
    if (tag?.latitude != null && tag?.longitude != null) {
      const q = new URLSearchParams({
        lat: String(tag.latitude),
        lng: String(tag.longitude),
        placa: linha.plate || linha.chassi || '',
        tag: tag.identificador,
        modelo: tag.modelo ?? '',
        ...(tag.seenAt ? { visto: tag.seenAt } : {}),
      });
      router.push(`/tags-ativas/mapa?${q}`);
      return;
    }

    if (linha.ultimaPosicao) {
      router.push(
        `/mapa?placa=${encodeURIComponent(linha.plate || linha.chassi || '')}`,
      );
      return;
    }

    toast.info(
      linha.tipo === 'SO_TAG'
        ? 'Essa TAG ainda não foi vista. Ela só aparece quando alguém passa perto com iPhone.'
        : 'Sem posição aqui: a TAG nunca foi vista e o rastreador não está no 21 GO.',
      { description: `${linha.plate || linha.chassi} · ${linha.associateName}` },
    );
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
                onMapa={() => abrirNoMapa(linha)}
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

/** Um mês. Acima disso a posição da TAG é histórico, não pista quente. */
const DIAS_FRIO = 30;
/** Uma semana: ainda é notícia, mas o carro pode ter saído de lá. */
const DIAS_MORNO = 7;

/**
 * A idade do avistamento é a informação mais importante do card da TAG, então
 * ela nunca aparece discreta.
 *
 * A TAG só é vista quando alguém com iPhone passa perto: em 2 de cada 3 TAGs o
 * último avistamento tem mais de 30 dias. Mostrar a coordenada sem a idade
 * faria o operador ler posição de meses atrás como se fosse agora.
 */
function IdadeDaTag({ seenAt }: { seenAt: string | null }) {
  if (!seenAt) {
    return <span className="text-muted-foreground">nunca foi vista</span>;
  }

  const dias = (Date.now() - new Date(seenAt).getTime()) / 86_400_000;
  const cor =
    dias > DIAS_FRIO
      ? 'text-destructive'
      : dias > DIAS_MORNO
        ? 'text-amber-500'
        : 'text-brand-green-600';

  return (
    <span className={cn('font-medium', cor)}>
      vista {formatRelativeTime(seenAt)}
      {dias > DIAS_FRIO && ' · posição antiga'}
    </span>
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
  onMapa,
}: {
  linha: ActiveTagRow;
  podeVerDocumento: boolean;
  onMapa: () => void;
}) {
  const soTag = linha.tipo === 'SO_TAG';
  const pos = linha.ultimaPosicao;
  const espelho = linha.tagEspelho;
  const temPontoTag = espelho?.latitude != null && espelho?.longitude != null;

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
            ) : espelho ? (
              // A TAG não está cadastrada aqui, mas sabemos qual é pelo espelho
              // da plataforma de origem. É o caso da esmagadora maioria.
              <span className="font-mono">
                <span className="font-sans">
                  {espelho.modelo ?? 'TAG'}
                </span>{' '}
                {espelho.identificador}
              </span>
            ) : (
              'TAG não identificada — sem número no 21 GO nem no espelho'
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              'rounded px-2 py-0.5 text-[11px] font-bold',
              soTag
                ? 'bg-brand-orange-500/15 text-brand-orange-500'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {soTag ? 'SÓ TAG' : 'RASTREADOR + TAG'}
          </span>
          <Button
            size="sm"
            variant="outline"
            className={cn(
              'h-8',
              !temPontoTag && !pos && 'text-muted-foreground',
            )}
            onClick={onMapa}
            title={
              temPontoTag
                ? 'Ver onde a TAG foi vista pela última vez'
                : pos
                  ? 'A TAG nunca foi vista — abre a posição do rastreador'
                  : 'Sem posição de TAG nem de rastreador — clique para saber por quê'
            }
          >
            <MapPin className="mr-1 h-3.5 w-3.5" />
            Abrir no mapa
          </Button>
        </div>
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

        {/* Onde está: hoje isso só existe pelo rastreador do veículo. Dizer de
            quem é a posição evita a leitura errada de que a TAG foi localizada. */}
        {pos ? (
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="flex min-w-0 items-start gap-1.5 text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate">
                  {pos.address ??
                    `${pos.latitude.toFixed(5)}, ${pos.longitude.toFixed(5)}`}
                </span>
                <span className="text-xs">
                  pelo rastreador ·{' '}
                  {pos.fixTime ? formatRelativeTime(pos.fixTime) : 'sem horário'}
                  {!pos.confiavel && ' · posição sem confirmação de GPS'}
                </span>
              </span>
            </p>
          </div>
        ) : null}

        {/* Onde a TAG foi vista. Linha separada da do rastreador de propósito:
            são dois equipamentos, dois carimbos de tempo, e confundir os dois
            esconderia um roubo em andamento. */}
        {temPontoTag ? (
          <p className="flex min-w-0 items-start gap-1.5 text-muted-foreground">
            <Bluetooth className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-orange-500" />
            <span className="min-w-0">
              <span className="block truncate font-mono text-xs">
                {espelho!.latitude!.toFixed(5)}, {espelho!.longitude!.toFixed(5)}
              </span>
              <span className="text-xs">
                pela TAG · <IdadeDaTag seenAt={espelho!.seenAt} />
              </span>
            </span>
          </p>
        ) : !pos ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {soTag
              ? 'Sem localização: o veículo só tem TAG e ela ainda não foi vista'
              : 'Sem localização: nem o rastreador nem a TAG têm posição aqui'}
          </p>
        ) : null}

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
