'use client';

import {
  MoreVertical,
  MapPin,
  Route,
  HardHat,
  ThumbsDown,
  ThumbsUp,
  Lock,
  Unlock,
  KeyRound,
  Loader2,
  ShieldCheck,
  ShieldOff,
  UserRoundCog,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ClientAsset } from '@/types/assets';

export function AssetActionsMenu({
  asset,
  onMapa,
  onHistorico,
  onAlterarTecnico,
  onAlterarFinanceiro,
  onAlterarAcesso,
  onAlterarBloqueador,
  podeLiberarBloqueador,
  onTrocarTitularidade,
  onRedefinirSenha,
  redefinindoSenha,
}: {
  asset: ClientAsset;
  onMapa: () => void;
  onHistorico: () => void;
  onAlterarTecnico: () => void;
  onAlterarFinanceiro: () => void;
  onAlterarAcesso: () => void;
  onAlterarBloqueador: () => void;
  /** Só ADMIN/SUPER_ADMIN; os demais nem veem o item. */
  podeLiberarBloqueador: boolean;
  /** O carro foi vendido: passa para o novo dono do SGA, rastreador fica. */
  onTrocarTitularidade: () => void;
  onRedefinirSenha: () => void;
  redefinindoSenha: boolean;
}) {
  const inadimplente = asset.financialStatus === 'INADIMPLENTE';
  // Veículo só com TAG não existe como veículo nosso nem aparece no app do
  // associado (o app só lista veículo com rastreador). Não há acesso, bloqueio,
  // financeiro ou titularidade para mudar aqui: o clique dava erro.
  const soTag = !!asset.soTag;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 shrink-0 p-0"
            aria-label={`Ações do ativo ${asset.plate}`}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onClick={onMapa}>
          <MapPin className="h-4 w-4" /> Abrir no mapa
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onHistorico}>
          <Route className="h-4 w-4" /> Histórico de viagens
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onAlterarTecnico}
          disabled={!asset.device}
        >
          <HardHat className="h-4 w-4" /> Alterar técnico
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {soTag && (
          <p className="px-2 py-1.5 text-xs leading-snug text-muted-foreground">
            Só TAG: este veículo não aparece no app do cliente, então não há
            acesso para bloquear. As ações abaixo valem quando ele tiver
            rastreador.
          </p>
        )}
        <DropdownMenuItem onClick={onAlterarFinanceiro} disabled={soTag}>
          {inadimplente ? (
            <>
              <ThumbsUp className="h-4 w-4" /> Marcar como Em dia
            </>
          ) : (
            <>
              <ThumbsDown className="h-4 w-4" /> Alterar para Inadimplente
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAlterarAcesso} disabled={soTag}>
          {asset.appAccessBlocked ? (
            <>
              <Unlock className="h-4 w-4" /> Liberar acesso do cliente
            </>
          ) : (
            <>
              <Lock className="h-4 w-4" /> Bloquear acesso do cliente
            </>
          )}
        </DropdownMenuItem>
        {podeLiberarBloqueador && (
          <DropdownMenuItem onClick={onAlterarBloqueador} disabled={soTag}>
            {asset.blockerAccessAllowed ? (
              <>
                <ShieldOff className="h-4 w-4" /> Retirar acesso ao bloqueador
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" /> Liberar acesso ao bloqueador
              </>
            )}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onTrocarTitularidade} disabled={soTag}>
          <UserRoundCog className="h-4 w-4" /> Troca de titularidade
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onRedefinirSenha}
          disabled={soTag || !asset.associate || redefinindoSenha}
        >
          {redefinindoSenha ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <KeyRound className="h-4 w-4" />
          )}
          Redefinir senha do app
        </DropdownMenuItem>

      </DropdownMenuContent>
    </DropdownMenu>
  );
}
