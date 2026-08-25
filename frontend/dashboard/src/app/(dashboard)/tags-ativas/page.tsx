'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  Bluetooth,
  Clock,
  HardHat,
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
import type { ActiveBleTag } from '@/types/ble-tag';

/**
 * TAG só é vista quando um scanner Bluetooth passa perto — não há rede própria
 * como no rastreador GPS. Um dia sem detecção é rotina (carro na garagem);
 * mais que isso é o que merece olhar.
 */
const DETECCAO_RECENTE_H = 24;

/** O card mostra "vista há X" — sem recarregar, o texto envelhece e mente. */
const INTERVALO_ATUALIZACAO_MS = 60_000;

const MODELO_LABEL: Record<string, string> = {
  BLE_KTAG: 'K-Tag',
  BLE_REDTAG: 'RedTag',
  BLE_AIRTAG_GENERIC: 'AirTag',
};

function horasDesde(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return ms / 3_600_000;
}

/** Qualidade do sinal da última detecção — a distância é o que o RSSI diz. */
function qualidadeSinal(rssi: number | null): string | null {
  if (rssi === null) return null;
  if (rssi >= -60) return 'Excelente';
  if (rssi >= -75) return 'Bom';
  if (rssi >= -90) return 'Fraco';
  return 'Muito fraco';
}

export default function TagsAtivasPage() {
  const { user } = useAuth();
  // Mesma régua do documento no card do ativo: inteiro só pro time interno.
  const podeVerDocumento = canSeeInstallLocation(user?.role);

  const [tags, setTags] = useState<ActiveBleTag[]>([]);
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const primeiraCarga = useRef(true);

  const carregar = useCallback(async () => {
    if (primeiraCarga.current) setCarregando(true);
    try {
      setTags(await bleTagsApi.getActive());
    } catch {
      toast.error('Não consegui carregar as TAGs.');
    } finally {
      setCarregando(false);
      primeiraCarga.current = false;
    }
  }, []);

  useEffect(() => {
    void carregar();
    const timer = setInterval(() => void carregar(), INTERVALO_ATUALIZACAO_MS);
    return () => clearInterval(timer);
  }, [carregar]);

  const detectadas = useMemo(
    () =>
      tags.filter((t) => {
        const h = horasDesde(t.bleSightings?.[0]?.seenAt ?? t.lastConnection);
        return h !== null && h <= DETECCAO_RECENTE_H;
      }).length,
    [tags],
  );

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return tags;
    const digitos = termo.replace(/\D/g, '');
    return tags.filter((t) => {
      const texto = [
        t.imei,
        t.brand,
        t.vehicle?.plate,
        t.vehicle?.brand,
        t.vehicle?.model,
        t.vehicle?.associate?.name,
        t.bleSightings?.[0]?.macAddress,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (texto.includes(termo)) return true;
      const doc = (t.vehicle?.associate?.cpf ?? '').replace(/\D/g, '');
      return digitos.length > 0 && doc.includes(digitos);
    });
  }, [tags, busca]);

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Bluetooth className="h-6 w-6 text-brand-orange-500" />
            TAGs Ativas
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Um card por TAG em uso — vinculada a um veículo e instalada
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Contador rotulo="TAGs em uso" valor={tags.length} />
        <Contador
          rotulo={`Vistas nas últimas ${DETECCAO_RECENTE_H}h`}
          valor={detectadas}
          cor="text-brand-green-600"
        />
        <Contador
          rotulo="Sem detecção"
          valor={tags.length - detectadas}
          cor={tags.length - detectadas > 0 ? 'text-amber-400' : undefined}
        />
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, CPF, IMEI, placa, MAC ou modelo..."
          className="pl-9"
        />
      </div>

      {carregando ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : lista.length === 0 ? (
        <Vazio temTag={tags.length > 0} />
      ) : (
        <div className="space-y-3">
          {lista.map((tag) => (
            <CardTag
              key={tag.id}
              tag={tag}
              podeVerDocumento={podeVerDocumento}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Contador({
  rotulo,
  valor,
  cor,
}: {
  rotulo: string;
  valor: number;
  cor?: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-sm text-muted-foreground">{rotulo}</p>
      <p className={cn('mt-1 text-3xl font-bold', cor)}>{valor}</p>
    </div>
  );
}

function Vazio({ temTag }: { temTag: boolean }) {
  return (
    <div className="rounded-lg border bg-card py-12 text-center">
      <Bluetooth className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
      <h3 className="mb-2 text-lg font-medium">
        {temTag ? 'Nenhuma TAG com esse filtro' : 'Nenhuma TAG em uso ainda'}
      </h3>
      {!temTag && (
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          A TAG entra nesta lista quando é vinculada a um veículo em{' '}
          <span className="font-medium">Dispositivos</span>. Enquanto não tem
          veículo, ela fica em <span className="font-medium">Etiquetas BLE</span>.
        </p>
      )}
    </div>
  );
}

/**
 * Um card por TAG. A informação é a mesma que o atendimento precisa quando o
 * telefone toca: de quem é, em que carro está, e quando foi vista pela última
 * vez — que na TAG é o equivalente a "está comunicando".
 */
function CardTag({
  tag,
  podeVerDocumento,
}: {
  tag: ActiveBleTag;
  podeVerDocumento: boolean;
}) {
  const visto = tag.bleSightings?.[0];
  const seenAt = visto?.seenAt ?? tag.lastConnection;
  const horas = horasDesde(seenAt);
  const recente = horas !== null && horas <= DETECCAO_RECENTE_H;
  const veiculo = tag.vehicle;
  const modelo = [veiculo?.brand, veiculo?.model].filter(Boolean).join(' ');
  const tecnico = tag.installedByTechnician?.name ?? tag.installedBy ?? null;
  const qualidade = qualidadeSinal(visto?.rssi ?? null);

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-start justify-between gap-3 bg-muted/30 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <Image
            src={
              veiculo?.vehicleType === 'MOTORCYCLE'
                ? '/markers/moto-top.png'
                : '/markers/car-top.png'
            }
            alt={veiculo?.vehicleType === 'MOTORCYCLE' ? 'Moto' : 'Carro'}
            width={32}
            height={32}
            className="mt-0.5 h-8 w-8 shrink-0 object-contain"
          />
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold leading-tight">
              <span className="truncate">
                {modelo || 'Modelo não informado'}
              </span>
              {veiculo?.plate && (
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-muted-foreground">
                  {veiculo.plate}
                </span>
              )}
            </h3>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              <span className="font-sans">
                {MODELO_LABEL[tag.model] ?? 'TAG'}
              </span>{' '}
              {tag.imei}
              {visto?.macAddress && (
                <>
                  {' · '}
                  <span className="font-sans">MAC</span> {visto.macAddress}
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-1.5 px-4 py-3 text-sm">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5">
            <User className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {veiculo?.associate?.name ?? 'Sem cliente vinculado'}
            </span>
          </span>
          {veiculo?.associate?.cpf && (
            <span className="font-mono text-xs">
              CPF{' '}
              {podeVerDocumento
                ? formatCpfCnpj(veiculo.associate.cpf)
                : maskCPF(veiculo.associate.cpf)}
            </span>
          )}
        </p>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span
            className={cn(
              'flex items-center gap-1.5',
              recente ? 'text-brand-green-600' : 'text-amber-400',
            )}
          >
            <Signal className="h-3.5 w-3.5 shrink-0" />
            {seenAt ? `Vista ${formatRelativeTime(seenAt)}` : 'Nunca detectada'}
          </span>
          {qualidade && (
            <span className="text-xs text-muted-foreground">
              sinal {qualidade} ({visto?.rssi} dBm)
            </span>
          )}
          {visto?.scannerSource && (
            <span className="text-xs text-muted-foreground">
              por {visto.scannerSource}
            </span>
          )}
        </p>

        {tecnico && (
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <HardHat className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{tecnico}</span>
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t px-4 py-2 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        {tag.installedAt
          ? `Instalada em ${formatDateOnlyBR(tag.installedAt)}`
          : 'Data de instalação não registrada'}
      </div>
    </div>
  );
}
