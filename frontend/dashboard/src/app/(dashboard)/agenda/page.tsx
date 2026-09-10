'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';
import ptBr from '@fullcalendar/core/locales/pt-br';
import type { EventClickArg, EventDropArg } from '@fullcalendar/core';
import type { DateClickArg, EventReceiveArg } from '@fullcalendar/interaction';
import { CalendarDays, RefreshCw, Search, ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import { appointmentsApi, techniciansApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SelectNative } from '@/components/ui/select-native';
import { Skeleton } from '@/components/ui/skeleton';
import { AgendamentoDialog } from '@/components/agenda/agendamento-dialog';
import type { Technician } from '@/types/technician';
import {
  SERVICE_TYPE_LABEL,
  STATUS_LABEL,
  type AgendaPendencia,
  type Appointment,
  type AppointmentEvent,
  type AppointmentStatus,
} from '@/types/appointment';
import {
  COR_SERVICO,
  LEGENDA_ICONE,
  LEGENDA_SERVICO,
  opacidadeDoEvento,
  prefixoDoEvento,
} from './agenda-visual';
import './agenda.css';

/** Primeiro e último dia do mês de uma data, no formato que a API espera. */
function limitesDoMes(base: Date) {
  const from = new Date(base.getFullYear(), base.getMonth(), 1);
  const to = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return { from: iso(from), to: iso(to) };
}

function iso(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dia}`;
}

export default function AgendaPage() {
  const calendarRef = useRef<FullCalendar>(null);
  const filaRef = useRef<HTMLDivElement>(null);

  const [tecnicos, setTecnicos] = useState<Technician[]>([]);
  const [eventos, setEventos] = useState<AppointmentEvent[]>([]);
  const [pendencias, setPendencias] = useState<AgendaPendencia[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [tecnicoFiltro, setTecnicoFiltro] = useState('');
  const [statusFiltro, setStatusFiltro] = useState<AppointmentStatus | ''>('');
  const [busca, setBusca] = useState('');
  const [periodo, setPeriodo] = useState(() => limitesDoMes(new Date()));
  const [mostrarFila, setMostrarFila] = useState(false);

  const [dialogAberto, setDialogAberto] = useState(false);
  const [diaClicado, setDiaClicado] = useState(iso(new Date()));
  const [pendenciaArrastada, setPendenciaArrastada] =
    useState<AgendaPendencia | null>(null);
  const [emEdicao, setEmEdicao] = useState<Appointment | null>(null);

  const carregarEventos = useCallback(async () => {
    setCarregando(true);
    try {
      const dados = await appointmentsApi.agenda({
        from: periodo.from,
        to: periodo.to,
        technicianIds: tecnicoFiltro ? [tecnicoFiltro] : undefined,
        status: statusFiltro ? [statusFiltro] : undefined,
        search: busca || undefined,
      });
      setEventos(dados);
    } catch {
      toast.error('Não foi possível carregar a agenda.');
    } finally {
      setCarregando(false);
    }
  }, [periodo, tecnicoFiltro, statusFiltro, busca]);

  const carregarPendencias = useCallback(async () => {
    try {
      setPendencias(await appointmentsApi.pendencias());
    } catch {
      // A fila é auxiliar: se falhar, o calendário continua utilizável.
    }
  }, []);

  useEffect(() => {
    techniciansApi
      .getAll()
      .then((t) => setTecnicos(t.filter((x) => x.active)))
      .catch(() => toast.error('Não foi possível carregar os técnicos.'));
    void carregarPendencias();
  }, [carregarPendencias]);

  useEffect(() => {
    void carregarEventos();
  }, [carregarEventos]);

  // A fila só vira arrastável depois de existir no DOM. O Draggable do
  // FullCalendar precisa do contêiner, não de cada item.
  useEffect(() => {
    if (!mostrarFila || !filaRef.current) return;
    const d = new Draggable(filaRef.current, {
      itemSelector: '.fc-fila-item',
      eventData: (el) => ({
        title: el.getAttribute('data-titulo') ?? '',
        extendedProps: { pendenciaId: el.getAttribute('data-id') },
      }),
    });
    return () => d.destroy();
  }, [mostrarFila, pendencias]);

  const eventosDoCalendario = useMemo(
    () =>
      eventos.map((e) => ({
        id: e.id,
        title: `${prefixoDoEvento(e)} ${SERVICE_TYPE_LABEL[e.serviceType]}${
          e.plate ? ` · ${e.plate}` : ''
        }`,
        start: e.start,
        end: e.end,
        backgroundColor: COR_SERVICO[e.serviceType],
        borderColor: COR_SERVICO[e.serviceType],
        textColor: '#fff',
        // `editable` por evento: OS encerrada não se arrasta para outro dia.
        editable: e.status === 'SCHEDULED' || e.status === 'POSTPONED',
        extendedProps: { dados: e },
      })),
    [eventos],
  );

  const aoClicarDia = useCallback((info: DateClickArg) => {
    setEmEdicao(null);
    setPendenciaArrastada(null);
    setDiaClicado(info.dateStr.slice(0, 10));
    setDialogAberto(true);
  }, []);

  const aoClicarEvento = useCallback(async (info: EventClickArg) => {
    const dados = info.event.extendedProps.dados as AppointmentEvent;
    try {
      const ficha = await appointmentsApi.porId(dados.id);
      setEmEdicao(ficha);
      setPendenciaArrastada(null);
      setDiaClicado(ficha.scheduledStart.slice(0, 10));
      setDialogAberto(true);
    } catch {
      toast.error('Não foi possível abrir a ordem de serviço.');
    }
  }, []);

  /** Arrastou o bloco para outro dia: só a data muda. */
  const aoArrastar = useCallback(
    async (info: EventDropArg) => {
      const inicio = info.event.start;
      const fim = info.event.end ?? inicio;
      if (!inicio || !fim) return;
      try {
        await appointmentsApi.remarcar(
          info.event.id,
          inicio.toISOString(),
          fim.toISOString(),
        );
        toast.success('Agendamento remarcado.');
        void carregarEventos();
      } catch {
        info.revert();
        toast.error('Não foi possível remarcar.');
      }
    },
    [carregarEventos],
  );

  /** Soltou uma pendência da fila num dia: abre o formulário preenchido. */
  const aoReceberDaFila = useCallback(
    (info: EventReceiveArg) => {
      const id = info.event.extendedProps.pendenciaId as string | undefined;
      const dia = info.event.start ? iso(info.event.start) : iso(new Date());
      // O evento provisório sai: quem cria de verdade é o formulário.
      info.event.remove();
      const p = pendencias.find((x) => x.id === id);
      if (!p) return;
      setEmEdicao(null);
      setPendenciaArrastada(p);
      setDiaClicado(dia);
      setDialogAberto(true);
    },
    [pendencias],
  );

  const aoSalvar = useCallback(() => {
    void carregarEventos();
    void carregarPendencias();
  }, [carregarEventos, carregarPendencias]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-emerald-500" />
          <div>
            <h1 className="text-xl font-semibold">Agenda</h1>
            <p className="text-sm text-muted-foreground">
              Agendamentos e ordens de serviço dos técnicos
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={mostrarFila ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMostrarFila((v) => !v)}
          >
            <ClipboardList className="mr-2 h-4 w-4" />
            Fila de instalação
            {pendencias.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {pendencias.length}
              </Badge>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void carregarEventos()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Atualizar
          </Button>
        </div>
      </div>

      {/* ------------------------------------------------------- filtros */}
      <div className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label className="text-xs">Técnico</Label>
          <SelectNative
            value={tecnicoFiltro}
            onChange={(e) => setTecnicoFiltro(e.target.value)}
          >
            <option value="">Todos os técnicos</option>
            {tecnicos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectNative>
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <SelectNative
            value={statusFiltro}
            onChange={(e) =>
              setStatusFiltro(e.target.value as AppointmentStatus | '')
            }
          >
            <option value="">Todos os status</option>
            {(Object.keys(STATUS_LABEL) as AppointmentStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </SelectNative>
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs">Buscar</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Nome, CPF, placa, chassi, IMEI ou número da OS"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* --------------------------------------------------- fila do SGA */}
        {mostrarFila && (
          <aside className="w-full shrink-0 lg:w-72">
            <div className="rounded-lg border bg-card p-3">
              <h2 className="mb-1 text-sm font-semibold">
                Aguardando instalação
              </h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Vem do SGA. Arraste para o dia do técnico.
              </p>
              <div ref={filaRef} className="max-h-[640px] space-y-2 overflow-y-auto">
                {pendencias.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma pendência aguardando.
                  </p>
                )}
                {pendencias.map((p) => (
                  <div
                    key={p.id}
                    className="fc-fila-item cursor-grab rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-xs active:cursor-grabbing"
                    data-id={p.id}
                    data-titulo={`Instalação · ${p.plate}`}
                  >
                    <div className="font-semibold">{p.plate}</div>
                    <div className="truncate text-muted-foreground">
                      {p.clientName}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {p.brandModel}
                    </div>
                    {(p.neighborhood || p.city) && (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {[p.neighborhood, p.city].filter(Boolean).join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </aside>
        )}

        {/* ------------------------------------------------------ calendário */}
        <div className="min-w-0 flex-1 rounded-lg border bg-card p-3">
          {carregando && eventos.length === 0 ? (
            <Skeleton className="h-[700px] w-full" />
          ) : (
            <FullCalendar
              ref={calendarRef}
              plugins={[
                dayGridPlugin,
                timeGridPlugin,
                listPlugin,
                interactionPlugin,
              ]}
              initialView="dayGridMonth"
              locale={ptBr}
              height={780}
              headerToolbar={{
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
              }}
              dayMaxEvents={2}
              // Bloco cheio, como na origem: com a bolinha padrão do
              // FullCalendar a cor do serviço vira um ponto e some da grade.
              eventDisplay="block"
              displayEventTime
              droppable
              editable
              events={eventosDoCalendario}
              eventDidMount={(info) => {
                const e = info.event.extendedProps.dados as AppointmentEvent;
                if (e) {
                  info.el.style.opacity = String(opacidadeDoEvento(e.status));
                  info.el.title = [
                    `OS ${e.osNumber}`,
                    e.clientName,
                    e.technicianName,
                    e.address,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                }
              }}
              dateClick={aoClicarDia}
              eventClick={aoClicarEvento}
              eventDrop={aoArrastar}
              eventReceive={aoReceberDaFila}
            />
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- legenda */}
      <div className="space-y-2 rounded-lg border bg-card p-3 text-xs">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {LEGENDA_SERVICO.map((l) => (
            <span key={l.texto} className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: l.cor }}
              />
              {l.texto}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
          {LEGENDA_ICONE.map((l) => (
            <span key={l.texto}>
              {l.icone} {l.texto}
            </span>
          ))}
        </div>
      </div>

      <AgendamentoDialog
        aberto={dialogAberto}
        onFechar={() => setDialogAberto(false)}
        onSalvo={aoSalvar}
        tecnicos={tecnicos}
        dia={diaClicado}
        tecnicoPadrao={tecnicoFiltro || undefined}
        pendencia={pendenciaArrastada}
        existente={emEdicao}
      />
    </div>
  );
}
