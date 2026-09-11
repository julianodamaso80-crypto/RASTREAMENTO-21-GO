'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';
import ptBr from '@fullcalendar/core/locales/pt-br';
import type { DatesSetArg, EventClickArg, EventDropArg } from '@fullcalendar/core';
import type { DateClickArg, EventReceiveArg } from '@fullcalendar/interaction';
import { Calendar, Search } from 'lucide-react';
import { toast } from 'sonner';
import { appointmentsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectNative } from '@/components/ui/select-native';
import { MultiSelect } from '@/components/agenda/multi-select';
import type { Technician } from '@/types/technician';
import {
  SERVICE_TYPE_LABEL,
  STATUS_LABEL,
  STATUS_ORDEM,
  type AgendaPendencia,
  type AppointmentEvent,
  type AppointmentStatus,
} from '@/types/appointment';
import {
  COR_SERVICO,
  LEGENDA_ICONE,
  LEGENDA_SERVICO,
  opacidadeDoEvento,
  prefixoDoEvento,
} from '@/app/(dashboard)/agenda/agenda-visual';
import { isoLocal, somaDias } from './datas';

interface Props {
  tecnicos: Technician[];
  /** Pede à página para abrir uma OS (clique no bloco). */
  onAbrirOs: (id: string) => void;
  /** Pede à página o formulário de OS nova no dia (e com a pendência, se veio da fila). */
  onNova: (dia: string, pendencia: AgendaPendencia | null, tecnicoPadrao?: string) => void;
  /** Muda quando alguma OS foi salva: recarrega calendário e fila. */
  versao: number;
}

/** Primeiro e último dia visíveis na grade (o `end` do FullCalendar é exclusivo). */
function periodoVisivel(a: DatesSetArg) {
  return { from: isoLocal(a.start), to: somaDias(isoLocal(a.end), -1) };
}

/**
 * Aba "Agendamentos": o calendário, com os mesmos filtros e a mesma barra da
 * origem (técnico, status, período da grade, "Lista de pendências" e
 * "Atualizar Calendário").
 */
export function AbaAgendamentos({ tecnicos, onAbrirOs, onNova, versao }: Props) {
  const calendarRef = useRef<FullCalendar>(null);
  const filaRef = useRef<HTMLDivElement>(null);

  const [eventos, setEventos] = useState<AppointmentEvent[]>([]);
  const [pendencias, setPendencias] = useState<AgendaPendencia[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [tecnicoFiltro, setTecnicoFiltro] = useState('');
  const [statusFiltro, setStatusFiltro] = useState<string[]>(STATUS_ORDEM);
  const [periodo, setPeriodo] = useState<{ from: string; to: string } | null>(null);
  const [mostrarFila, setMostrarFila] = useState(false);

  const carregarEventos = useCallback(async () => {
    if (!periodo) return;
    setCarregando(true);
    try {
      const todos = statusFiltro.length === STATUS_ORDEM.length;
      const dados = await appointmentsApi.agenda({
        from: periodo.from,
        to: periodo.to,
        technicianIds: tecnicoFiltro ? [tecnicoFiltro] : undefined,
        // Nenhum status marcado = nada a mostrar; todos marcados = sem filtro.
        status: todos ? undefined : (statusFiltro as AppointmentStatus[]),
      });
      setEventos(statusFiltro.length === 0 ? [] : dados);
    } catch {
      toast.error('Não foi possível carregar a agenda.');
    } finally {
      setCarregando(false);
    }
    // O filtro só vale ao clicar em pesquisar ou trocar de mês, como na origem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo]);

  const carregarPendencias = useCallback(async () => {
    try {
      setPendencias(await appointmentsApi.pendencias());
    } catch {
      // A fila é auxiliar: se falhar, o calendário continua utilizável.
    }
  }, []);

  useEffect(() => {
    void carregarPendencias();
  }, [carregarPendencias, versao]);

  useEffect(() => {
    void carregarEventos();
  }, [carregarEventos, versao]);

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

  const aoMudarGrade = useCallback((a: DatesSetArg) => {
    const p = periodoVisivel(a);
    setPeriodo((atual) => (atual?.from === p.from && atual?.to === p.to ? atual : p));
  }, []);

  const aoClicarDia = useCallback(
    (info: DateClickArg) => onNova(info.dateStr.slice(0, 10), null, tecnicoFiltro || undefined),
    [onNova, tecnicoFiltro],
  );

  const aoClicarEvento = useCallback(
    (info: EventClickArg) => {
      const dados = info.event.extendedProps.dados as AppointmentEvent;
      onAbrirOs(dados.id);
    },
    [onAbrirOs],
  );

  /** Arrastou o bloco para outro dia: só a data muda. */
  const aoArrastar = useCallback(
    async (info: EventDropArg) => {
      const inicio = info.event.start;
      const fim = info.event.end ?? inicio;
      if (!inicio || !fim) return;
      try {
        await appointmentsApi.remarcar(info.event.id, inicio.toISOString(), fim.toISOString());
        toast.success('Agendamento remarcado.');
        void carregarEventos();
      } catch {
        info.revert();
        toast.error('Não foi possível remarcar.');
      }
    },
    [carregarEventos],
  );

  const abrirComPendencia = useCallback(
    (p: AgendaPendencia, dia: string) => onNova(dia, p, tecnicoFiltro || undefined),
    [onNova, tecnicoFiltro],
  );

  /** Soltou uma pendência da fila num dia: abre o formulário preenchido. */
  const aoReceberDaFila = useCallback(
    (info: EventReceiveArg) => {
      const id = info.event.extendedProps.pendenciaId as string | undefined;
      const dia = info.event.start ? isoLocal(info.event.start) : isoLocal(new Date());
      // O evento provisório sai: quem cria de verdade é o formulário.
      info.event.remove();
      const p = pendencias.find((x) => x.id === id);
      if (p) abrirComPendencia(p, dia);
    },
    [pendencias, abrirComPendencia],
  );

  return (
    <div>
      <h2 className="flex items-center gap-2 pb-2 text-lg font-semibold">
        <Calendar className="h-5 w-5" /> Agendamentos
      </h2>
      <h3 className="text-base font-semibold text-muted-foreground">Realize seus agendamentos</h3>

      {/* ------------------------------------------------------- filtros */}
      <div className="mt-3 grid items-end gap-3 md:grid-cols-12">
        <div className="md:col-span-4">
          <Label className="mb-1 block">Selecione um técnico</Label>
          <SelectNative value={tecnicoFiltro} onChange={(e) => setTecnicoFiltro(e.target.value)}>
            <option value="">Todos os técnicos</option>
            {tecnicos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectNative>
        </div>
        <div className="md:col-span-3">
          <Label className="mb-1 block">Status</Label>
          <MultiSelect
            opcoes={STATUS_ORDEM.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            valor={statusFiltro}
            onChange={setStatusFiltro}
          />
        </div>
        <div className="md:col-span-2">
          <Label className="mb-1 block">Data início</Label>
          <Input type="date" disabled value={periodo?.from ?? ''} readOnly />
        </div>
        <div className="md:col-span-2">
          <Label className="mb-1 block">Data fim</Label>
          <Input type="date" disabled value={periodo?.to ?? ''} readOnly />
        </div>
        <div className="flex md:col-span-1 md:justify-end">
          <Button
            className="bg-slate-800 text-white hover:bg-slate-700"
            title="Pesquisar"
            onClick={() => void carregarEventos()}
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ------------------------------------------------ lista de pendências */}
      <div className="mt-3">
        <Button
          variant="outline"
          size="sm"
          className="border-sky-500 text-sky-600 hover:bg-sky-50"
          onClick={() => setMostrarFila((v) => !v)}
        >
          Lista de pendências{pendencias.length > 0 ? ` (${pendencias.length})` : ''}
        </Button>
        {mostrarFila && (
          <div className="mt-3 h-[150px] overflow-y-auto rounded-lg border bg-card p-3 shadow-sm">
            <p className="mb-2 text-sm font-semibold">Clique ou arraste a pendência para o calendário</p>
            <div ref={filaRef} className="flex flex-wrap gap-2">
              {pendencias.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhuma pendência aguardando.</p>
              )}
              {pendencias.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className="fc-fila-item cursor-grab rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-left text-xs active:cursor-grabbing"
                  data-id={p.id}
                  data-titulo={`Instalação · ${p.plate}`}
                  title={[p.clientName, p.brandModel, p.neighborhood, p.city].filter(Boolean).join(' · ')}
                  onClick={() => abrirComPendencia(p, isoLocal(new Date()))}
                >
                  <span className="font-semibold">{p.plate}</span>{' '}
                  <span className="text-muted-foreground">{p.clientName}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------ calendário */}
      <div className="relative mt-3 rounded-lg border bg-card p-3">
        {carregando && (
          <div className="absolute right-4 top-4 z-10 text-xs text-muted-foreground">
            Carregando…
          </div>
        )}
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale={ptBr}
          height={780}
          customButtons={{
            atualizar: {
              text: '♻ Atualizar Calendário',
              click: () => void carregarEventos(),
            },
          }}
          headerToolbar={{
            left: 'prev,next today atualizar',
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
          datesSet={aoMudarGrade}
          eventDidMount={(info) => {
            const e = info.event.extendedProps.dados as AppointmentEvent;
            if (e) {
              info.el.style.opacity = String(opacidadeDoEvento(e.status));
              info.el.title = [`OS ${e.osNumber}`, e.clientName, e.technicianName, e.address]
                .filter(Boolean)
                .join(' · ');
            }
          }}
          dateClick={aoClicarDia}
          eventClick={aoClicarEvento}
          eventDrop={aoArrastar}
          eventReceive={aoReceberDaFila}
        />
      </div>

      {/* ------------------------------------------------------- legenda */}
      <div className="mt-2 space-y-1 px-2 text-xs text-muted-foreground">
        <div>
          {LEGENDA_ICONE.map((l, i) => (
            <span key={l.texto}>
              {l.icone}- {l.texto}
              {i < LEGENDA_ICONE.length - 1 ? ' | ' : ''}
            </span>
          ))}
        </div>
        <div>
          {LEGENDA_SERVICO.map((l, i) => (
            <span key={l.texto}>
              <span
                className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle"
                style={{ backgroundColor: l.cor }}
              />
              {l.texto}
              {i < LEGENDA_SERVICO.length - 1 ? ' | ' : ''}
            </span>
          ))}
        </div>
      </div>

    </div>
  );
}
