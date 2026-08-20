'use client';

import Image from 'next/image';
import {
  User,
  RadioTower,
  MapPin,
  Wrench,
  ThumbsUp,
  ThumbsDown,
  Lock,
  Unlock,
  Clock,
  HelpCircle,
} from 'lucide-react';
import { cn, formatCpfCnpj, maskCPF } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { canSeeInstallLocation } from '@/lib/manageable-routes';
import type { ClientAsset, CommsState } from '@/types/assets';
import { AssetActionsMenu } from './asset-actions-menu';

/**
 * Um ativo na lista. A informação é a mesma que o operador precisa quando o
 * telefone toca: de quem é, o que é, se está comunicando, quem instalou, se
 * está em dia e se o cliente enxerga no app.
 */
export function AssetCard({
  asset,
  onMapa,
  onHistorico,
  onAlterarTecnico,
  onAlterarFinanceiro,
  onAlterarAcesso,
  onRedefinirSenha,
  onRetirar,
  redefinindoSenha,
}: {
  asset: ClientAsset;
  onMapa: () => void;
  onHistorico: () => void;
  onAlterarTecnico: () => void;
  onAlterarFinanceiro: () => void;
  onAlterarAcesso: () => void;
  onRedefinirSenha: () => void;
  onRetirar: () => void;
  redefinindoSenha: boolean;
}) {
  const { user } = useAuth();
  // Mesma régua do esconderijo do rastreador: documento inteiro é dado de
  // atendimento, não de vitrine.
  const podeVerDocumento = canSeeInstallLocation(user?.role);
  const tecnico =
    asset.device?.technician?.name ?? asset.device?.installedByName ?? null;
  const modelo = [asset.brand, asset.model].filter(Boolean).join(' ');

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Identificação: o que é e qual o aparelho */}
      <div className="flex items-start justify-between gap-3 bg-muted/30 px-4 py-3">
        <div className="flex items-start gap-3 min-w-0">
          <Image
            src={
              asset.vehicleType === 'MOTORCYCLE'
                ? '/markers/moto-top.png'
                : '/markers/car-top.png'
            }
            alt={asset.vehicleType === 'MOTORCYCLE' ? 'Moto' : 'Carro'}
            width={32}
            height={32}
            className="mt-0.5 h-8 w-8 shrink-0 object-contain"
          />
          <div className="min-w-0">
            <h3 className="font-semibold leading-tight flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate">{modelo || 'Modelo não informado'}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-muted-foreground">
                {asset.plate}
              </span>
            </h3>
            {/* O IMEI sem rótulo passava por número solto. É o que o
                atendimento usa pra achar o equipamento e abrir chamado. */}
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {asset.device?.imei ? (
                <>
                  <span className="font-sans">IMEI</span> {asset.device.imei}
                </>
              ) : (
                'sem rastreador'
              )}
            </p>
          </div>
        </div>
        <AssetActionsMenu
          asset={asset}
          onMapa={onMapa}
          onHistorico={onHistorico}
          onAlterarTecnico={onAlterarTecnico}
          onAlterarFinanceiro={onAlterarFinanceiro}
          onAlterarAcesso={onAlterarAcesso}
          onRedefinirSenha={onRedefinirSenha}
          onRetirar={onRetirar}
          redefinindoSenha={redefinindoSenha}
        />
      </div>

      {/* Situação */}
      <div className="space-y-1.5 px-4 py-3 text-sm">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
          <span className="flex items-center gap-1.5 min-w-0">
            <User className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {asset.associate?.name ?? 'Sem cliente vinculado'}
            </span>
          </span>
          {/* Documento junto do nome: é o que confere com quem está no
              telefone. O rótulo existe porque, solto, o número se perde entre
              o IMEI e as datas do card. Inteiro só pro time interno (mesma
              régua do esconderijo do rastreador); os demais perfis veem
              mascarado. */}
          {asset.associate?.cpf && (
            <span className="font-mono text-xs">
              <span className="font-sans">
                {asset.associate.cpf.replace(/\D/g, '').length === 14
                  ? 'CNPJ'
                  : 'CPF'}
              </span>{' '}
              {podeVerDocumento
                ? formatCpfCnpj(asset.associate.cpf)
                : maskCPF(asset.associate.cpf)}
            </span>
          )}
        </p>

        <Comunicacao asset={asset} />

        {tecnico && (
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <Wrench className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{tecnico}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Financeiro asset={asset} />
          <Acesso bloqueado={asset.appAccessBlocked} />
        </div>
      </div>

      {/* Rodapé: frescor do dado + situação no SGA */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {textoUltimaAtualizacao(asset)}
        </span>
        {asset.sga.code && (
          <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-medium text-sky-300">
            SGA: {asset.sga.code}
            {asset.sga.statusLabel ? ` · ${asset.sga.statusLabel}` : ''}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * GPRS e GPS lado a lado. As cores existem porque as duas datas contam coisas
 * diferentes: o chip pode estar vivo com o GPS morto, e é justamente esse o
 * caso que não pode passar despercebido.
 */
function Comunicacao({ asset }: { asset: ClientAsset }) {
  const { state } = asset.comms;
  const gpsAlerta = state === 'GPS_CONGELADO';
  const mudo = state === 'MUDO' || state === 'NUNCA';

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span
        className={cn(
          'flex items-center gap-1.5',
          mudo ? 'font-medium text-red-400' : 'text-muted-foreground',
        )}
        title="Última vez que o rastreador falou com o servidor. Não prova onde o veículo está."
      >
        <RadioTower className="h-3.5 w-3.5 shrink-0" />
        GPRS: {formatarData(asset.device?.lastConnection)}
      </span>
      <span
        className={cn(
          'flex items-center gap-1.5',
          mudo
            ? 'font-medium text-red-400'
            : gpsAlerta
              ? 'font-medium text-amber-400'
              : 'text-muted-foreground',
        )}
        title={
          gpsAlerta
            ? 'O rastreador comunica, mas não obtém posição há horas. Pode ser bloqueador de sinal ou antena solta.'
            : 'Última posição confirmada por satélite.'
        }
      >
        <MapPin className="h-3.5 w-3.5 shrink-0" />
        GPS: {formatarData(asset.lastFixTime)}
      </span>
      {gpsAlerta && (
        <span className="text-xs font-medium text-amber-400">
          sem posição nova
        </span>
      )}
    </div>
  );
}

function Financeiro({ asset }: { asset: ClientAsset }) {
  if (asset.financialStatus === 'ADIMPLENTE') {
    return (
      <span className="flex items-center gap-1.5 text-emerald-400">
        <ThumbsUp className="h-3.5 w-3.5" /> Em dia
      </span>
    );
  }
  if (asset.financialStatus === 'INADIMPLENTE') {
    return (
      <span className="flex items-center gap-1.5 font-medium text-red-400">
        <ThumbsDown className="h-3.5 w-3.5" /> Inadimplente
      </span>
    );
  }
  // Sem consulta ainda: dizer isso é melhor que fingir que está em dia.
  return (
    <span
      className="flex items-center gap-1.5 text-muted-foreground"
      title="A situação financeira ainda não foi consultada no SGA para este ativo."
    >
      <HelpCircle className="h-3.5 w-3.5" /> Situação não consultada
    </span>
  );
}

function Acesso({ bloqueado }: { bloqueado: boolean }) {
  return bloqueado ? (
    <span className="flex items-center gap-1.5 font-medium text-red-400">
      <Lock className="h-3.5 w-3.5" /> Acesso bloqueado
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <Unlock className="h-3.5 w-3.5" /> Acesso liberado
    </span>
  );
}

/** "há 3 minutos" a partir do sinal de vida mais recente. */
function textoUltimaAtualizacao(asset: ClientAsset): string {
  const { gprsAgeMinutes, gpsAgeMinutes } = asset.comms;
  const idades = [gprsAgeMinutes, gpsAgeMinutes].filter(
    (n): n is number => n !== null,
  );
  if (idades.length === 0) return 'Nunca comunicou';

  const minutos = Math.min(...idades);
  if (minutos < 1) return 'Atualizado agora';
  if (minutos < 60) return `Atualizado há ${minutos} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `Atualizado há ${horas}h`;

  const dias = Math.floor(horas / 24);
  return `Atualizado há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

function formatarData(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export type { CommsState };
