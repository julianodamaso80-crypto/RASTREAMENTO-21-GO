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
  onRedefinirSenha,
  redefinindoSenha,
}: {
  asset: ClientAsset;
  onMapa: () => void;
  onHistorico: () => void;
  onAlterarTecnico: () => void;
  onAlterarFinanceiro: () => void;
  onAlterarAcesso: () => void;
  onRedefinirSenha: () => void;
  redefinindoSenha: boolean;
}) {
  const inadimplente = asset.financialStatus === 'INADIMPLENTE';

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

        <DropdownMenuItem onClick={onAlterarFinanceiro}>
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
        <DropdownMenuItem onClick={onAlterarAcesso}>
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
        <DropdownMenuItem
          onClick={onRedefinirSenha}
          disabled={!asset.associate || redefinindoSenha}
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
