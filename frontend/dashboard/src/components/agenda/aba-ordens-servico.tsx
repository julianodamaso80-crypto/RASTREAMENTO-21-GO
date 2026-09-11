'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Calendar,
  CalendarCheck,
  ClipboardList,
  Copy,
  Download,
  Eraser,
  FileText,
  Lightbulb,
  List,
  Loader2,
  MoreVertical,
  PencilLine,
  Route,
  Search,
  Trash2,
  User,
  UserCog,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { appointmentsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectNative } from '@/components/ui/select-native';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MultiSelect } from '@/components/agenda/multi-select';
import { RotasDialog } from '@/components/agenda/rotas-dialog';
import { emitirOs, relatorioPagamentos } from '@/components/agenda/documentos-os';
import type { Technician } from '@/types/technician';
import {
  SERVICE_TYPE_LABEL,
  STATUS_COM_CONCLUSAO,
  STATUS_EM_ABERTO,
  STATUS_LABEL,
  STATUS_ORDEM,
  type AppointmentStatus,
  type FiltroOrdens,
  type OrdemServico,
  type ServiceType,
} from '@/types/appointment';
import { dataHora, diasEntre, hojeIso, somaDias } from './datas';

interface Props {
  tecnicos: Technician[];
  onAbrirOs: (id: string) => void;
  versao: number;
}

interface Aviso {
  titulo: string;
  texto: string;
  /** Com `ok`, vira pergunta Sim/Não; sem, só um OK. */
  ok?: () => void;
}

const erroDaApi = (e: unknown, padrao: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? padrao;

/** Período padrão da origem: 3 dias para trás, 7 para frente. */
const filtroInicial = (): FiltroOrdens => ({
  from: somaDias(hojeIso(), -3),
  to: somaDias(hojeIso(), 7),
  tipoData: 'AGENDAMENTO',
  technicianIds: [],
  createdByIds: [],
  status: ['SCHEDULED'],
  serviceType: '',
  search: '',
});

/**
 * Aba "Ordens de Serviço", copiada da origem: filtros recolhíveis, busca,
 * "Selecionar todos" + "Mais ações" e um card por OS com o menu ⋮.
 */
export function AbaOrdensServico({ tecnicos, onAbrirOs, versao }: Props) {
  const [filtro, setFiltro] = useState<FiltroOrdens>(filtroInicial);
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const [usuarios, setUsuarios] = useState<{ id: string; name: string }[]>([]);

  const [ordens, setOrdens] = useState<OrdemServico[] | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [exportando, setExportando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [rotas, setRotas] = useState<OrdemServico[] | null>(null);

  // Técnico: começa com todos marcados, como o "[Selecionar todos]" da origem.
  useEffect(() => {
    setFiltro((f) =>
      f.technicianIds?.length ? f : { ...f, technicianIds: tecnicos.map((t) => t.id) },
    );
  }, [tecnicos]);

  useEffect(() => {
    appointmentsApi.usuarios().then(setUsuarios).catch(() => undefined);
  }, []);

  const filtroEfetivo = useMemo<FiltroOrdens>(() => {
    const todosTecnicos = tecnicos.length > 0 && filtro.technicianIds?.length === tecnicos.length;
    return {
      ...filtro,
      // Todos marcados = sem filtro (inclui OS de técnico já desativado).
      technicianIds: todosTecnicos ? [] : filtro.technicianIds,
      search: buscaAplicada,
    };
  }, [filtro, buscaAplicada, tecnicos.length]);

  const validar = useCallback((f: FiltroOrdens) => {
    const dias = diasEntre(f.from, f.to);
    if (dias < 1) {
      toast.warning('A data de início não pode ser anterior a data fim.');
      return false;
    }
    if (dias > 90) {
      toast.warning('As datas selecionadas não podem ultrapassar 90 dias.');
      return false;
    }
    return true;
  }, []);

  const carregar = useCallback(async () => {
    if (!filtroEfetivo.from || !filtroEfetivo.to || !validar(filtroEfetivo)) return;
    // Técnico ou status sem nada marcado não filtra — a origem simplesmente
    // não envia o parâmetro e lista tudo.
    setOrdens(null);
    try {
      const dados = await appointmentsApi.lista(filtroEfetivo);
      setOrdens(dados);
      setMarcadas(new Set());
    } catch (e) {
      setOrdens([]);
      toast.error(erroDaApi(e, 'Não foi possível carregar as ordens de serviço.'));
    }
  }, [filtroEfetivo, validar]);

  useEffect(() => {
    const t = setTimeout(() => void carregar(), 300);
    return () => clearTimeout(t);
  }, [carregar, versao]);

  const set = <K extends keyof FiltroOrdens>(k: K, v: FiltroOrdens[K]) =>
    setFiltro((f) => ({ ...f, [k]: v }));

  const trocarTipoData = (tipo: FiltroOrdens['tipoData']) => {
    setFiltro((f) => ({
      ...f,
      tipoData: tipo,
      // Na conclusão, a origem desmarca e trava os status que não concluem.
      status:
        tipo === 'CONCLUSAO'
          ? (f.status ?? []).filter((s) => STATUS_COM_CONCLUSAO.includes(s))
          : f.status,
    }));
  };

  const pesquisar = () => setBuscaAplicada(busca.trim());

  const limparPesquisa = () => {
    setBusca('');
    setBuscaAplicada('');
    setFiltro({ ...filtroInicial(), technicianIds: tecnicos.map((t) => t.id) });
  };

  const exportar = async () => {
    setExportando(true);
    try {
      const blob = await appointmentsApi.exportar(filtroEfetivo);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Relatório Agendamento.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(erroDaApi(e, 'Falha ao exportar.'));
    } finally {
      setExportando(false);
    }
  };

  const lista = ordens ?? [];
  const selecionadas = lista.filter((o) => marcadas.has(o.id));
  const todasMarcadas = lista.length > 0 && selecionadas.length === lista.length;

  const alternar = (id: string) =>
    setMarcadas((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // ------------------------------------------------------ "Mais ações"

  const umTecnico = filtro.technicianIds?.length === 1 ? filtro.technicianIds[0] : null;
  const nomeTecnico = tecnicos.find((t) => t.id === umTecnico)?.name ?? '';

  const listarRotas = () => {
    if (!selecionadas.length || !umTecnico || filtro.from !== filtro.to) {
      return setAviso({
        titulo: 'ATENÇÃO',
        texto:
          'Selecione um técnico, uma ou mais ordem(s) de serviço(s) com as datas de início e fim para o mesmo dia',
      });
    }
    if (selecionadas.length > 10) {
      return setAviso({ titulo: 'ATENÇÃO', texto: 'Limite máximo é de 10 serviços!' });
    }
    setRotas(selecionadas);
  };

  const emitir = () => {
    if (!selecionadas.length) {
      return setAviso({ titulo: 'Atenção!', texto: 'Selecione pelo menos uma ordem de serviço' });
    }
    if (selecionadas.length > 20) {
      return setAviso({ titulo: 'Atenção!', texto: 'Selecione no máximo 20 ordens de serviços' });
    }
    if (!emitirOs(selecionadas)) toast.error('Libere as janelas pop-up do navegador para emitir a OS.');
  };

  const gerarPagamentos = () => {
    // A origem só paga concluída e visita frustrada pelo cliente.
    const pagaveis = selecionadas.filter(
      (o) => o.status === 'COMPLETED' || o.status === 'FRUSTRATED_CLIENT',
    );
    if (!pagaveis.length || !umTecnico || diasEntre(filtro.from, filtro.to) > 31) {
      return setAviso({
        titulo: 'ATENÇÃO',
        texto:
          'Selecione um técnico, uma ou mais ordem(s) de serviço(s) concluídas em um período máximo de 30 dias',
      });
    }
    if (!relatorioPagamentos(nomeTecnico, { from: filtro.from, to: filtro.to }, pagaveis)) {
      toast.error('Libere as janelas pop-up do navegador para gerar o relatório.');
    }
  };

  // ------------------------------------------------------ ações do card

  const duplicar = (o: OrdemServico) =>
    setAviso({
      titulo: 'ATENÇÃO',
      texto: 'Deseja duplicar este agendamento?',
      ok: async () => {
        try {
          const nova = await appointmentsApi.duplicar(o.id);
          toast.success(`Agendamento duplicado: OS ${nova.osNumber}.`);
          void carregar();
        } catch (e) {
          toast.warning(
            erroDaApi(e, 'Não foi possível duplicar a OS no momento, tente novamente mais tarde.'),
          );
        }
      },
    });

  const excluir = (o: OrdemServico) => {
    if (!STATUS_EM_ABERTO.includes(o.status)) {
      return toast.warning(
        'A exclusão só é permitida para agendamentos com os status agendado, prorrogado ou adiantado.',
      );
    }
    setAviso({
      titulo: 'Atenção!',
      texto: 'Deseja realmente excluir esse agendamento?',
      ok: async () => {
        try {
          await appointmentsApi.remover(o.id);
          toast.success('Agendamento excluído.');
          void carregar();
        } catch (e) {
          toast.error(erroDaApi(e, 'Não foi possível efetuar o processo, tente novamente mais tarde.'));
        }
      },
    });
  };

  const statusDesabilitados = filtro.tipoData === 'CONCLUSAO';

  return (
    <div>
      <h2 className="flex items-center gap-2 pb-2 text-lg font-semibold">
        <List className="h-5 w-5" /> Ordens de serviço
      </h2>

      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="text-sm text-indigo-500 hover:underline"
          onClick={() => setMostrarFiltros((v) => !v)}
        >
          Mostrar Filtros
        </button>
        {lista.length > 0 && (
          <Button size="sm" className="bg-indigo-500 text-white hover:bg-indigo-600" onClick={exportar} disabled={exportando}>
            {exportando ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Carregando dados
              </>
            ) : (
              <>
                <Download className="mr-1 h-4 w-4" /> Exportar
              </>
            )}
          </Button>
        )}
      </div>

      {/* ------------------------------------------------------- filtros */}
      {mostrarFiltros && (
        <div className="mb-2 rounded-lg border bg-card p-3">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <Label className="mb-1 block">Tipo serviço</Label>
              <SelectNative
                value={filtro.serviceType ?? ''}
                onChange={(e) => set('serviceType', e.target.value as ServiceType | '')}
              >
                <option value="">Todos</option>
                {(Object.keys(SERVICE_TYPE_LABEL) as ServiceType[]).map((s) => (
                  <option key={s} value={s}>
                    {SERVICE_TYPE_LABEL[s]}
                  </option>
                ))}
              </SelectNative>
            </div>
            <div>
              <Label className="mb-1 block">Selecione um técnico</Label>
              <MultiSelect
                opcoes={tecnicos.map((t) => ({ value: t.id, label: t.name }))}
                valor={filtro.technicianIds ?? []}
                onChange={(v) => set('technicianIds', v)}
                placeholder="Selecione uma ou mais opções"
              />
            </div>
            <div>
              <Label className="mb-1 block">Selecione um usuário</Label>
              <MultiSelect
                opcoes={usuarios.map((u) => ({ value: u.id, label: u.name }))}
                valor={filtro.createdByIds ?? []}
                onChange={(v) => set('createdByIds', v)}
                placeholder="Selecione um ou mais usuários"
              />
            </div>
            <div>
              <Label className="mb-1 block">Status</Label>
              <MultiSelect
                opcoes={STATUS_ORDEM.map((s) => ({
                  value: s,
                  label: STATUS_LABEL[s],
                  disabled: statusDesabilitados && !STATUS_COM_CONCLUSAO.includes(s),
                }))}
                valor={filtro.status ?? []}
                onChange={(v) => set('status', v as AppointmentStatus[])}
              />
            </div>
          </div>
          <hr className="my-3" />
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Label className="mb-1 block">Data início</Label>
              <Input type="date" value={filtro.from} onChange={(e) => set('from', e.target.value)} />
            </div>
            <div>
              <Label className="mb-1 block">Data fim</Label>
              <Input type="date" value={filtro.to} onChange={(e) => set('to', e.target.value)} />
            </div>
            <div>
              <Label className="mb-1 block">Tipo de Data</Label>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                {(['AGENDAMENTO', 'CONCLUSAO'] as const).map((t) => (
                  <label key={t} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="tipoData"
                      checked={filtro.tipoData === t}
                      onChange={() => trocarTipoData(t)}
                      className="h-4 w-4 accent-[var(--primary)]"
                    />
                    {t === 'AGENDAMENTO' ? 'Agendamento' : 'Conclusão'}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- busca */}
      <div className="flex">
        <Input
          className="rounded-r-none"
          placeholder="Pesquisar por nome, cpf, placa, chassi, imei ou identificador"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && pesquisar()}
        />
        <Button
          className="rounded-l-none bg-slate-800 text-white hover:bg-slate-700"
          title="Pesquisar"
          onClick={pesquisar}
        >
          <Search className="h-4 w-4" />
        </Button>
        {buscaAplicada && (
          <Button
            variant="destructive"
            className="ml-1"
            title="Limpar pesquisa"
            onClick={limparPesquisa}
          >
            <Eraser className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* --------------------------------------------------------- lista */}
      <div className="pt-3">
        {ordens === null ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Pesquisando...
          </div>
        ) : lista.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <ClipboardList className="h-10 w-10 opacity-40" />
            <span className="text-base font-semibold">Nada por aqui</span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 pb-2">
              <label className="flex cursor-pointer items-center gap-2">
                <Chave
                  ligada={todasMarcadas}
                  onChange={() =>
                    setMarcadas(todasMarcadas ? new Set() : new Set(lista.map((o) => o.id)))
                  }
                />
                <strong>Selecionar todos</strong>
              </label>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button size="sm" className="bg-slate-800 text-white hover:bg-slate-700">
                      Mais ações ▾
                    </Button>
                  }
                />
                <DropdownMenuContent align="start" className="w-72">
                  <DropdownMenuItem onClick={gerarPagamentos} title="Informações de rotas concluídas por técnico">
                    <Route className="h-4 w-4 text-muted-foreground" /> Gerar relatório de pagamentos
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!selecionadas.length}
                    onClick={listarRotas}
                    title="Listar ordens de serviço selecionadas"
                  >
                    <Route className="h-4 w-4 text-muted-foreground" /> Listar rotas selecionadas
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!selecionadas.length}
                    onClick={emitir}
                    title="Emitir ordens de serviço selecionadas"
                  >
                    <FileText className="h-4 w-4 text-muted-foreground" /> Emitir OS selecionadas
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <small className="ml-auto flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                <CalendarCheck className="h-3 w-3" /> Data de finalização do agendamento |
                <Calendar className="h-3 w-3" /> Data de agendamento do serviço |
                <UserCog className="h-3 w-3" /> Colaborador |
                <User className="h-3 w-3" /> Cliente |
                <Wrench className="h-3 w-3" /> Tipo de serviço
              </small>
            </div>

            <div className="space-y-3">
              {lista.map((o) => (
                <CardOs
                  key={o.id}
                  o={o}
                  marcada={marcadas.has(o.id)}
                  onMarcar={() => alternar(o.id)}
                  onVer={() => onAbrirOs(o.id)}
                  onDuplicar={() => duplicar(o)}
                  onExcluir={() => excluir(o)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <Dialog open={aviso !== null} onOpenChange={(v) => !v && setAviso(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{aviso?.titulo}</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{aviso?.texto}</p>
          <DialogFooter>
            {aviso?.ok ? (
              <>
                <Button variant="outline" onClick={() => setAviso(null)}>
                  Não
                </Button>
                <Button
                  onClick={() => {
                    const acao = aviso.ok;
                    setAviso(null);
                    void acao?.();
                  }}
                >
                  Sim
                </Button>
              </>
            ) : (
              <Button onClick={() => setAviso(null)}>OK</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {rotas && (
        <RotasDialog
          key={rotas.map((o) => o.id).join()}
          aberto
          onFechar={() => setRotas(null)}
          colaborador={nomeTecnico}
          dia={filtro.from}
          ordens={rotas}
          onVer={onAbrirOs}
        />
      )}
    </div>
  );
}

/** A chavinha liga/desliga da origem (custom-switch). */
function Chave({ ligada, onChange }: { ligada: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligada}
      onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
        ligada ? 'border-primary bg-primary' : 'border-border bg-muted'
      }`}
    >
      <span
        className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all ${
          ligada ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

function CardOs({
  o,
  marcada,
  onMarcar,
  onVer,
  onDuplicar,
  onExcluir,
}: {
  o: OrdemServico;
  marcada: boolean;
  onMarcar: () => void;
  onVer: () => void;
  onDuplicar: () => void;
  onExcluir: () => void;
}) {
  const aberta = STATUS_EM_ABERTO.includes(o.status);
  const semLocalizacao = o.lat == null || o.lng == null;

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Chave ligada={marcada} onChange={onMarcar} />
          <ClipboardList className="h-5 w-5" />
          <button
            type="button"
            onClick={onVer}
            className="max-w-[350px] truncate text-lg font-semibold hover:underline"
          >
            {o.osNumber || 'Não Informado'}
          </button>
          <PencilLine className="h-3.5 w-3.5 cursor-pointer text-muted-foreground" onClick={onVer} />
          {(o.plate || o.chassi) && (
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {o.plate || o.chassi}
            </span>
          )}
          <span className="rounded-md bg-muted px-2 py-0.5 text-sm">{STATUS_LABEL[o.status]}</span>
          {semLocalizacao && (
            <button
              type="button"
              onClick={onVer}
              title="Ordem de serviço sem localização válida"
              className="flex items-center gap-1 rounded-md bg-red-500 px-2 py-0.5 text-xs font-semibold text-white"
            >
              <AlertTriangle className="h-3 w-3" /> Sem localização válida
            </button>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Ações">
                <MoreVertical className="h-4 w-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={onVer}>
              <Calendar className="h-4 w-4 text-muted-foreground" /> Ver Agendamento
            </DropdownMenuItem>
            {aberta && (
              <DropdownMenuItem onClick={onDuplicar}>
                <Copy className="h-4 w-4 text-muted-foreground" /> Duplicar agendamento
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onExcluir}>
              {aberta ? <Trash2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />} Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-col gap-1.5 px-4 py-3 text-sm text-muted-foreground">
        {o.clientName && (
          <span className="flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" /> {o.clientName}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <UserCog className="h-3.5 w-3.5" /> {o.technician?.name || 'Não Informado'}
        </span>
        <span className="flex items-center gap-1.5">
          <Wrench className="h-3.5 w-3.5" /> {SERVICE_TYPE_LABEL[o.serviceType]}
        </span>
        {o.autoScheduled && (
          <span className="flex items-center gap-1.5">
            <Lightbulb className="h-3.5 w-3.5 text-amber-500" /> Auto Agendado
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5" /> {dataHora(o.scheduledStart)}
        </span>
        {o.completedAt && (
          <span className="flex items-center gap-1.5">
            <CalendarCheck className="h-3.5 w-3.5" /> {dataHora(o.completedAt)}
          </span>
        )}
      </div>
    </div>
  );
}
