'use client';

import { useCallback, useEffect, useState } from 'react';
import { Calendar, LineChart, List } from 'lucide-react';
import { toast } from 'sonner';
import { appointmentsApi, techniciansApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AgendamentoDialog } from '@/components/agenda/agendamento-dialog';
import { AbaAnalise } from '@/components/agenda/aba-analise';
import { AbaAgendamentos } from '@/components/agenda/aba-agendamentos';
import { AbaOrdensServico } from '@/components/agenda/aba-ordens-servico';
import { diaDoIso, hojeIso } from '@/components/agenda/datas';
import type { Technician } from '@/types/technician';
import type { AgendaPendencia, Appointment } from '@/types/appointment';
import './agenda.css';

type Aba = 'analise' | 'agendamentos' | 'ordens';

const ABAS: { id: Aba; texto: string; icone: typeof LineChart }[] = [
  { id: 'analise', texto: 'Análise', icone: LineChart },
  { id: 'agendamentos', texto: 'Agendamentos', icone: Calendar },
  { id: 'ordens', texto: 'Ordens de Serviço', icone: List },
];

/**
 * Agenda de ordens de serviço — as três abas do `/agendamentos/` da origem:
 * Análise, Agendamentos (calendário) e Ordens de Serviço (lista). O formulário
 * da OS é um só, aberto por qualquer aba.
 */
export default function AgendaPage() {
  // A aba fica na URL (?aba=) para o F5 e o link voltarem ao mesmo lugar. Lida
  // do location em vez de useSearchParams pra não exigir Suspense na rota.
  const [aba, setAba] = useState<Aba>(() => {
    if (typeof window === 'undefined') return 'analise';
    const p = new URLSearchParams(window.location.search).get('aba');
    return p === 'agendamentos' || p === 'ordens' ? p : 'analise';
  });
  const [tecnicos, setTecnicos] = useState<Technician[]>([]);
  const [versao, setVersao] = useState(0);

  const [dialogAberto, setDialogAberto] = useState(false);
  const [dia, setDia] = useState(hojeIso());
  const [pendencia, setPendencia] = useState<AgendaPendencia | null>(null);
  const [tecnicoPadrao, setTecnicoPadrao] = useState<string | undefined>();
  const [existente, setExistente] = useState<Appointment | null>(null);

  const trocarAba = (a: Aba) => {
    setAba(a);
    const url = new URL(window.location.href);
    url.searchParams.set('aba', a);
    window.history.replaceState(null, '', url.toString());
  };

  useEffect(() => {
    techniciansApi
      .getAll()
      .then((t) => setTecnicos(t.filter((x) => x.active)))
      .catch(() => toast.error('Não foi possível carregar os técnicos.'));
  }, []);

  const abrirOs = useCallback(async (id: string) => {
    try {
      const ficha = await appointmentsApi.porId(id);
      setExistente(ficha);
      setPendencia(null);
      setDia(diaDoIso(ficha.scheduledStart));
      setDialogAberto(true);
    } catch {
      toast.error('Não foi possível abrir a ordem de serviço.');
    }
  }, []);

  const novaOs = useCallback(
    (d: string, p: AgendaPendencia | null, tecnico?: string) => {
      setExistente(null);
      setPendencia(p);
      setDia(d);
      setTecnicoPadrao(tecnico);
      setDialogAberto(true);
    },
    [],
  );

  return (
    <div className="min-h-full">
      <nav className="flex overflow-x-auto bg-[#1f2d63] px-2 text-white md:px-4">
        {ABAS.map(({ id, texto, icone: Icone }) => (
          <button
            key={id}
            type="button"
            onClick={() => trocarAba(id)}
            className={cn(
              'flex shrink-0 items-center gap-2 border-b-[3px] px-4 py-3 text-sm font-semibold transition-colors',
              aba === id
                ? 'border-[#f2911d] text-white'
                : 'border-transparent text-white/75 hover:text-white',
            )}
          >
            <Icone className="h-4 w-4" /> {texto}
          </button>
        ))}
      </nav>

      <div className="p-4 md:p-6">
        {aba === 'analise' && <AbaAnalise />}
        {aba === 'agendamentos' && (
          <AbaAgendamentos
            tecnicos={tecnicos}
            onAbrirOs={abrirOs}
            onNova={novaOs}
            versao={versao}
          />
        )}
        {aba === 'ordens' && (
          <AbaOrdensServico tecnicos={tecnicos} onAbrirOs={abrirOs} versao={versao} />
        )}
      </div>

      <AgendamentoDialog
        aberto={dialogAberto}
        onFechar={() => setDialogAberto(false)}
        onSalvo={() => setVersao((v) => v + 1)}
        tecnicos={tecnicos}
        dia={dia}
        tecnicoPadrao={tecnicoPadrao}
        pendencia={pendencia}
        existente={existente}
      />
    </div>
  );
}
