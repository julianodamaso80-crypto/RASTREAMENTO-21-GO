'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CalendarDays, ChevronDown, LineChart } from 'lucide-react';
import { toast } from 'sonner';
import { appointmentsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SafeChart } from '@/components/ui/safe-chart';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MAINTENANCE_REASON_LABEL,
  type AppointmentStatus,
  type GraficoAnalise,
  type ItemGrafico,
  type MaintenanceReason,
  type ResumoAnalise,
} from '@/types/appointment';
import { diasEntre, hojeIso, somaDias } from './datas';

/** Cores das barras por técnico/usuário. A origem sorteia; aqui é fixa por posição. */
const PALETA = [
  '#5fd99b', '#944a3e', '#5ec35b', '#f860e0', '#1bb3d6', '#3a2f7a',
  '#d64f9a', '#57e06e', '#ff4fa5', '#c4a5c9', '#9b37cf', '#c05f4b',
  '#f59a3a', '#2d7f5c', '#b5890c', '#4257a3',
];

/** Paleta fixa que a origem usa nos gráficos de status e de serviço. */
const PALETA_ORIGEM = [
  '#b87333', '#c0c0c0', '#ffd700', '#FF5733', '#e5e4e2',
  '#008080', '#0000ff', '#008000', '#ffff00', '#c3e6f9',
];

const ROTULO_STATUS: Record<string, string> = {
  SCHEDULED: 'agendado',
  CANCELED: 'cancelado',
  COMPLETED: 'concluído',
  POSTPONED: 'prorrogado',
  ANTICIPATED: 'adiantado',
  FRUSTRATED_CLIENT: 'visita frustrada cliente',
  FRUSTRATED_TECHNICIAN: 'visita frustrada técnico',
  CLOSED_BY_SYSTEM: 'concluído pelo sistema',
};

const ROTULO_SERVICO: Record<string, string> = {
  INSTALLATION: 'instalação',
  MAINTENANCE: 'manutenção',
  REMOVAL: 'retirada',
  OTHER: 'outros',
};

/** O select de status do gráfico por técnico, com o texto no plural da origem. */
const FILTRO_STATUS_TECNICO: { value: AppointmentStatus | ''; label: string }[] = [
  { value: '', label: 'Todos os status' },
  { value: 'SCHEDULED', label: 'Agendado(s)' },
  { value: 'CANCELED', label: 'Cancelado(s)' },
  { value: 'COMPLETED', label: 'Concluído(s)' },
  { value: 'POSTPONED', label: 'Prorrogado(s)' },
  { value: 'ANTICIPATED', label: 'Adiantado(s)' },
  { value: 'FRUSTRATED_CLIENT', label: 'Visita(s) frustrada(s) cliente' },
  { value: 'FRUSTRATED_TECHNICIAN', label: 'Visita(s) frustrada(s) técnico' },
  { value: 'CLOSED_BY_SYSTEM', label: 'Concluído pelo sistema' },
];

const TOOLTIP = {
  contentStyle: { borderRadius: 8, fontSize: 12 },
  formatter: (v: unknown) => [String(v ?? 0), 'Quantidade'] as [string, string],
};

type Formato = 'barra-h' | 'barra-v' | 'rosca' | 'pizza';

interface GraficoProps {
  qual: GraficoAnalise;
  formato: Formato;
  legenda: string;
  titulo: (dias: number, filtroTexto: string) => string;
  rotulo?: Record<string, string>;
  paletaFixa?: boolean;
  /** Select extra ao lado das datas (status, motivo de manutenção). */
  filtro?: {
    opcoes: { value: string; label: string }[];
    nome: string;
  };
  altura?: number;
}

/**
 * Um card de gráfico da aba Análise. Cada um tem o próprio período (padrão:
 * últimos 7 dias) e recarrega meio segundo depois da última mudança, como na
 * origem.
 */
function GraficoCard({
  qual,
  formato,
  legenda,
  titulo,
  rotulo,
  paletaFixa,
  filtro,
  altura,
}: GraficoProps) {
  const [inicio, setInicio] = useState(() => somaDias(hojeIso(), -6));
  const [fim, setFim] = useState(() => hojeIso());
  const [valorFiltro, setValorFiltro] = useState('');
  const [itens, setItens] = useState<ItemGrafico[] | null>(null);
  const [dias, setDias] = useState(7);
  const [invalido, setInvalido] = useState(false);
  const espera = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!inicio || !fim) return;
    clearTimeout(espera.current);
    espera.current = setTimeout(async () => {
      const d = diasEntre(inicio, fim);
      if (d > 90 || d < 1) {
        setInvalido(true);
        toast.warning(
          d < 1
            ? 'A data de início não pode ser posterior à data fim.'
            : 'Selecione um período inferior a 90 dias.',
        );
        return;
      }
      setInvalido(false);
      try {
        const r = await appointmentsApi.grafico(qual, {
          from: inicio,
          to: fim,
          status: qual === 'tecnicos' ? (valorFiltro as AppointmentStatus | '') : undefined,
          maintenanceReason:
            qual === 'motivos-manutencao' ? (valorFiltro as MaintenanceReason | '') : undefined,
        });
        setItens(r.itens);
        setDias(r.dias);
      } catch {
        toast.error('Não foi possível carregar o gráfico.');
      }
    }, 500);
    return () => clearTimeout(espera.current);
  }, [qual, inicio, fim, valorFiltro]);

  const textoFiltro = filtro?.opcoes.find((o) => o.value === valorFiltro)?.label ?? '';
  const dados = (itens ?? []).map((i, idx) => ({
    ...i,
    nome: rotulo?.[i.chave] ?? i.nome,
    cor: (paletaFixa ? PALETA_ORIGEM : PALETA)[idx % (paletaFixa ? PALETA_ORIGEM.length : PALETA.length)],
  }));
  const vazio = itens !== null && dados.every((d) => d.qtd === 0);
  const alturaFinal =
    altura ?? (formato === 'barra-h' ? Math.max(260, dados.length * 48 + 70) : 360);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <span className="mb-2 text-sm font-semibold">
          {!invalido && titulo(dias, textoFiltro)}
        </span>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold">
            <span className="ml-1">Data início</span>
            <Input
              type="date"
              className="h-8 w-[150px] border-0 bg-muted/60 text-sm"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
            />
          </label>
          <label className="text-xs font-semibold">
            <span className="ml-1">Data fim</span>
            <Input
              type="date"
              className="h-8 w-[150px] border-0 bg-muted/60 text-sm"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
            />
          </label>
          {filtro && (
            <select
              aria-label={filtro.nome}
              className="h-8 w-[190px] rounded-md border border-input bg-background px-2 text-sm"
              value={valorFiltro}
              onChange={(e) => setValorFiltro(e.target.value)}
            >
              {filtro.opcoes.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div style={{ height: alturaFinal }}>
        {itens === null ? (
          <Skeleton className="h-full w-full" />
        ) : vazio ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Nenhum agendamento no período.
          </div>
        ) : (
          <SafeChart>{desenhar(formato, dados)}</SafeChart>
        )}
      </div>
      <p className="mt-1 text-center text-xs text-muted-foreground">{legenda}</p>
    </div>
  );
}

function desenhar(
  formato: Formato,
  dados: (ItemGrafico & { cor: string })[],
): React.ReactElement<{ width?: number; height?: number }> {
  if (formato === 'barra-h') {
    return (
      <BarChart data={dados} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="0" stroke="var(--border)" />
        <XAxis type="number" allowDecimals={false} fontSize={11} stroke="#64748b" />
        <YAxis
          type="category"
          dataKey="nome"
          width={230}
          fontSize={11}
          stroke="#64748b"
          tickLine={false}
          interval={0}
        />
        <Tooltip {...TOOLTIP} />
        <Bar dataKey="qtd" barSize={20} minPointSize={2}>
          {dados.map((d) => (
            <Cell key={d.chave} fill={d.cor} />
          ))}
        </Bar>
      </BarChart>
    );
  }
  if (formato === 'barra-v') {
    return (
      <BarChart data={dados} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="0" stroke="var(--border)" />
        <XAxis dataKey="nome" fontSize={11} stroke="#64748b" interval={0} tickLine={false} />
        <YAxis allowDecimals={false} fontSize={11} stroke="#64748b" />
        <Tooltip {...TOOLTIP} />
        <Bar dataKey="qtd" barSize={20} minPointSize={2}>
          {dados.map((d) => (
            <Cell key={d.chave} fill={d.cor} />
          ))}
        </Bar>
      </BarChart>
    );
  }
  return (
    <PieChart>
      <Tooltip {...TOOLTIP} />
      <Legend verticalAlign="top" iconType="rect" wrapperStyle={{ fontSize: 12 }} />
      <Pie
        data={dados.filter((d) => d.qtd > 0)}
        dataKey="qtd"
        nameKey="nome"
        innerRadius={formato === 'rosca' ? '50%' : 0}
        outerRadius="85%"
        stroke="#fff"
        strokeWidth={2}
      >
        {dados
          .filter((d) => d.qtd > 0)
          .map((d) => (
            <Cell key={d.chave} fill={d.cor} />
          ))}
      </Pie>
    </PieChart>
  );
}

function CardQuantidade({
  cor,
  titulo,
  valor,
}: {
  cor: string;
  titulo: string;
  valor: number | null;
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg border bg-card p-5 shadow-xs">
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-white"
        style={{ backgroundColor: cor }}
      >
        <CalendarDays className="h-6 w-6" />
      </div>
      <div className="flex-1 text-center">
        <div className="text-sm text-muted-foreground">{titulo}</div>
        <div className="mt-1 text-xl font-semibold">
          {valor === null ? <Skeleton className="mx-auto h-6 w-10" /> : valor}
        </div>
      </div>
    </div>
  );
}

function Subtitulo({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-5 text-base font-semibold text-muted-foreground">{children}</h3>;
}

export function AbaAnalise() {
  const [resumo, setResumo] = useState<ResumoAnalise | null>(null);
  const [extras, setExtras] = useState(false);

  useEffect(() => {
    appointmentsApi
      .analiseResumo()
      .then(setResumo)
      .catch(() => toast.error('Não foi possível carregar a análise.'));
  }, []);

  return (
    <div>
      <h2 className="flex items-center gap-2 pb-2 text-lg font-semibold">
        <LineChart className="h-5 w-5" /> Análise dos agendamentos
      </h2>

      <Subtitulo>Quantidade de agendados</Subtitulo>
      <div className="grid gap-3 md:grid-cols-3">
        <CardQuantidade cor="#6777ef" titulo="Hoje (restante do dia)" valor={resumo?.hoje ?? null} />
        <CardQuantidade cor="#47c363" titulo="Próximos 7 dias" valor={resumo?.semana ?? null} />
        <CardQuantidade cor="#ffa426" titulo="Próximos dias 8 a 30" valor={resumo?.mes ?? null} />
      </div>

      <Subtitulo>Criação de agendamentos por usuário</Subtitulo>
      <GraficoCard
        qual="usuarios"
        formato="barra-h"
        titulo={(d) => `Todos usuários no período de ${d} dia(s)`}
        legenda="Gráfico de quantidade de agendamentos criados por usuário"
      />

      <Subtitulo>Técnico(s)</Subtitulo>
      <GraficoCard
        qual="tecnicos"
        formato="barra-h"
        titulo={(d, f) => `${f || 'Todos os status'} no período de ${d} dia(s)`}
        legenda="Gráfico de quantidade de agendamentos por técnico e status"
        filtro={{ nome: 'Status', opcoes: FILTRO_STATUS_TECNICO }}
      />

      {!extras ? (
        <div className="mt-4 flex justify-center">
          <Button className="bg-slate-800 text-white hover:bg-slate-700" onClick={() => setExtras(true)}>
            Mais análises <ChevronDown className="ml-1 h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <GraficoCard
            qual="motivos-manutencao"
            formato="barra-h"
            titulo={(d, f) =>
              `${!f || f === 'Todos' ? 'Todos os motivos de manutenção' : f} no período de ${d} dia(s)`
            }
            legenda="Gráfico de quantidade de motivo de manutenção por técnico"
            filtro={{
              nome: 'Motivo de manutenção',
              opcoes: [
                { value: '', label: 'Todos' },
                ...(Object.keys(MAINTENANCE_REASON_LABEL) as MaintenanceReason[]).map((m) => ({
                  value: m,
                  label: MAINTENANCE_REASON_LABEL[m],
                })),
              ],
            }}
          />
          <GraficoCard
            qual="status"
            formato="barra-v"
            paletaFixa
            rotulo={ROTULO_STATUS}
            titulo={(d) => `Status no período de ${d} dia(s)`}
            legenda="Gráfico de quantidade de agendamentos por status"
            altura={380}
          />

          <Subtitulo>Serviço e Motivo visita frustrada</Subtitulo>
          <div className="grid gap-4 lg:grid-cols-2">
            <GraficoCard
              qual="servicos"
              formato="rosca"
              paletaFixa
              rotulo={ROTULO_SERVICO}
              titulo={(d) => `Serviço(s) no período de ${d} dia(s)`}
              legenda="Gráfico de quantidade de agendamentos por tipo de serviço"
            />
            <GraficoCard
              qual="visitas-frustradas"
              formato="pizza"
              titulo={(d) => `Motivo(s) visita(s) frustrada(s) ${d} dia(s)`}
              legenda="Gráfico de quantidade de visitas frustradas por técnico"
            />
          </div>
        </div>
      )}
    </div>
  );
}
