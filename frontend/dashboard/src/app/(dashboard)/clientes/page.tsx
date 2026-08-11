'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Search,
  BarChart3,
  List,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { clientsApi, devicesApi } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AssetCard } from '@/components/clientes/asset-card';
import { AssetsAnalytics } from '@/components/clientes/assets-analytics';
import {
  AlterarTecnicoDialog,
  RetirarRastreadorDialog,
  SenhaTemporariaDialog,
  type RetiradaAlvo,
  type SenhaTemporaria,
  type TecnicoAlvo,
} from '@/components/clientes/asset-dialogs';
import type { ClientAsset } from '@/types/assets';

const TAMANHOS_PAGINA = [20, 60, 140, 200, 400, 500];

/**
 * O card mostra "atualizado há X". Sem recarregar, esse texto envelhece na tela
 * e passa a mentir — 30s mantém honesto sem martelar a API.
 */
const INTERVALO_ATUALIZACAO_MS = 30_000;

export default function ClientesPage() {
  const router = useRouter();
  const [aba, setAba] = useState<'lista' | 'analises'>('lista');

  const [assets, setAssets] = useState<ClientAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [retirando, setRetirando] = useState<RetiradaAlvo | null>(null);
  const [salvandoRetirada, setSalvandoRetirada] = useState(false);
  const [trocandoTecnico, setTrocandoTecnico] = useState<TecnicoAlvo | null>(null);
  const [salvandoTecnico, setSalvandoTecnico] = useState(false);
  const [resetandoId, setResetandoId] = useState<string | null>(null);
  const [senhaGerada, setSenhaGerada] = useState<SenhaTemporaria | null>(null);

  // Recarregar em background não pode piscar a lista inteira.
  const primeiraCarga = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await clientsApi.getAssets({
        search: search || undefined,
        page,
        perPage,
      });
      setAssets(res.data);
      setTotal(res.meta.total);
    } catch {
      toast.error('Erro ao carregar os ativos');
    } finally {
      primeiraCarga.current = false;
      setLoading(false);
    }
  }, [search, page, perPage]);

  useEffect(() => {
    const t = setTimeout(load, primeiraCarga.current ? 0 : 300);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (aba !== 'lista') return;
    const t = setInterval(load, INTERVALO_ATUALIZACAO_MS);
    return () => clearInterval(t);
  }, [load, aba]);

  const totalPaginas = Math.max(1, Math.ceil(total / perPage));

  /**
   * Cliente ligou dizendo que perdeu a senha do app. Gera uma temporária
   * ditável — aparece uma vez só e obriga o cliente a criar a definitiva no
   * primeiro acesso.
   */
  const resetarSenha = async (asset: ClientAsset) => {
    if (!asset.associate) return;
    setResetandoId(asset.id);
    try {
      const res = await clientsApi.resetAppPassword(asset.associate.id);
      setSenhaGerada({
        nome: res.name || asset.associate.name,
        senha: res.temporaryPassword,
      });
    } catch {
      toast.error('Não consegui redefinir a senha. Tente de novo.');
    } finally {
      setResetandoId(null);
    }
  };

  const alternarAcesso = async (asset: ClientAsset) => {
    const bloquear = !asset.appAccessBlocked;
    try {
      await clientsApi.setAppAccess(asset.id, bloquear);
      toast.success(
        bloquear
          ? `O cliente não enxerga mais ${asset.plate} no app.`
          : `Acesso do cliente a ${asset.plate} liberado.`,
      );
      await load();
    } catch {
      toast.error('Não consegui alterar o acesso. Tente de novo.');
    }
  };

  const alternarFinanceiro = async (asset: ClientAsset) => {
    const novo =
      asset.financialStatus === 'INADIMPLENTE' ? 'ADIMPLENTE' : 'INADIMPLENTE';
    try {
      await clientsApi.setFinancialStatus(asset.id, novo);
      toast.success(
        novo === 'INADIMPLENTE'
          ? `${asset.plate} marcado como inadimplente.`
          : `${asset.plate} marcado como em dia.`,
      );
      await load();
    } catch {
      toast.error('Não consegui alterar a situação. Tente de novo.');
    }
  };

  const confirmarTecnico = async (technicianId: string) => {
    if (!trocandoTecnico) return;
    setSalvandoTecnico(true);
    try {
      await clientsApi.setTechnician(trocandoTecnico.vehicleId, technicianId);
      toast.success('Técnico atualizado.');
      setTrocandoTecnico(null);
      await load();
    } catch {
      toast.error('Não consegui alterar o técnico. Tente de novo.');
    } finally {
      setSalvandoTecnico(false);
    }
  };

  /**
   * Retirada do rastreador: o veículo sai do rastreamento e o aparelho volta
   * pro estoque disponível.
   */
  const confirmarRetirada = async (motivo: string) => {
    if (!retirando) return;
    setSalvandoRetirada(true);
    try {
      await devicesApi.uninstall(retirando.deviceId, motivo || undefined);
      toast.success(
        `Rastreador ${retirando.imei} retirado — voltou pro estoque disponível.`,
      );
      setRetirando(null);
      await load();
    } catch {
      toast.error('Não consegui retirar o rastreador. Tente de novo.');
    } finally {
      setSalvandoRetirada(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4 md:p-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Users className="h-5 w-5 text-brand-orange-500" />
            Clientes Ativos
          </h1>
          <p className="text-sm text-muted-foreground">
            Um card por ativo — veículo com rastreador instalado e cliente
            vinculado ao SGA
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
          <span className="text-xs text-muted-foreground">Ativos</span>
          <span className="text-lg font-bold">{total}</span>
        </div>
      </div>

      <div className="flex gap-1 border-b">
        <AbaBotao
          ativa={aba === 'analises'}
          onClick={() => setAba('analises')}
          icone={<BarChart3 className="h-4 w-4" />}
          rotulo="Análises"
        />
        <AbaBotao
          ativa={aba === 'lista'}
          onClick={() => setAba('lista')}
          icone={<List className="h-4 w-4" />}
          rotulo="Lista"
        />
      </div>

      {aba === 'analises' ? (
        <AssetsAnalytics />
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, CPF, IMEI, placa, chassi, marca ou modelo..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <select
              className="h-8 rounded-md border bg-background px-2 text-xs"
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setPage(1);
              }}
            >
              {TAMANHOS_PAGINA.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="text-xs">
              registros por página · página {page} de {totalPaginas}
            </span>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-44 w-full rounded-lg" />
              ))}
            </div>
          ) : assets.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Users className="mb-3 h-12 w-12 text-muted-foreground/30" />
                <p className="text-muted-foreground">
                  {search
                    ? 'Nenhum ativo encontrado para essa busca'
                    : 'Nenhum ativo ainda'}
                </p>
                {!search && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Associe um rastreador do <strong>Estoque</strong> a uma placa
                    do SGA para ele aparecer aqui.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {assets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  redefinindoSenha={resetandoId === asset.id}
                  onMapa={() =>
                    router.push(`/mapa?placa=${encodeURIComponent(asset.plate)}`)
                  }
                  onHistorico={() =>
                    router.push(
                      `/relatorios?veiculo=${encodeURIComponent(asset.id)}`,
                    )
                  }
                  onAlterarTecnico={() =>
                    setTrocandoTecnico({
                      vehicleId: asset.id,
                      plate: asset.plate,
                      tecnicoAtual:
                        asset.device?.technician?.name ??
                        asset.device?.installedByName ??
                        null,
                    })
                  }
                  onAlterarFinanceiro={() => alternarFinanceiro(asset)}
                  onAlterarAcesso={() => alternarAcesso(asset)}
                  onRedefinirSenha={() => resetarSenha(asset)}
                  onRetirar={() => {
                    if (!asset.device) return;
                    setRetirando({
                      deviceId: asset.device.id,
                      imei: asset.device.imei,
                      plate: asset.plate,
                      cliente: asset.associate?.name ?? 'cliente',
                    });
                  }}
                />
              ))}
            </div>
          )}

          {totalPaginas > 1 && (
            <div className="flex items-center justify-center gap-2 pb-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" /> Anterior
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {totalPaginas}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPaginas, p + 1))}
                disabled={page >= totalPaginas}
              >
                Próxima <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}

      <SenhaTemporariaDialog
        senha={senhaGerada}
        onClose={() => setSenhaGerada(null)}
      />
      <RetirarRastreadorDialog
        alvo={retirando}
        salvando={salvandoRetirada}
        onCancel={() => setRetirando(null)}
        onConfirm={confirmarRetirada}
      />
      <AlterarTecnicoDialog
        alvo={trocandoTecnico}
        salvando={salvandoTecnico}
        onCancel={() => setTrocandoTecnico(null)}
        onConfirm={confirmarTecnico}
      />
    </div>
  );
}

function AbaBotao({
  ativa,
  onClick,
  icone,
  rotulo,
}: {
  ativa: boolean;
  onClick: () => void;
  icone: React.ReactNode;
  rotulo: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
        ativa
          ? 'border-brand-orange-500 text-brand-orange-400'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {icone}
      {rotulo}
    </button>
  );
}
