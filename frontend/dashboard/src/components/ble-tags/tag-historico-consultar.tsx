'use client';

import { useState } from 'react';
import { Download, FileText, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AcoesDoPdf } from '@/components/historico/historico-solicitados';
import {
  dataHoraLocal,
  horaLocal,
  paraCampoLocal,
  type FonteDePdf,
  type HistoricoSolicitado,
  type TipoRelatorio,
} from '@/lib/historico';
import { relatorioTagParaCsv, type RelatorioDaTag } from '@/lib/historico-tag';
import { tagHistoryApi } from '@/lib/api';

interface Props {
  serial: string;
  placa: string;
  /** Gerar, listar e baixar os PDFs (a aba Solicitados usa a mesma fonte). */
  pdf: FonteDePdf;
  /** Avisado a cada PDF novo (a aba Solicitados recarrega). */
  aoGerarPdf: (item: HistoricoSolicitado) => void;
}

const PREDEFINIDOS = [
  { rotulo: '24 horas', min: 1440 },
  { rotulo: '48 horas', min: 2880 },
  { rotulo: '72 horas', min: 4320 },
  { rotulo: '7 dias', min: 10080 },
  { rotulo: '30 dias', min: 43200 },
];

const TIPOS: { id: TipoRelatorio; rotulo: string; dica: string }[] = [
  { id: 'basico', rotulo: 'Básico', dica: 'Onde e quando a TAG foi vista, com a precisão (até 30 dias)' },
  { id: 'avancado', rotulo: 'Avançado', dica: 'Básico mais o atraso da informação e a fonte (até 30 dias)' },
  { id: 'consolidado', rotulo: 'Consolidado', dica: 'Um registro por dia, com o último lugar em que foi vista' },
];

const LINHAS_NA_TELA = 1000;

function mensagemDoErro(e: unknown, padrao: string): string {
  const msg = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
  return (Array.isArray(msg) ? msg.join(' ') : msg) || padrao;
}

function resumoDoLugar(count: number, ate: string, de: string): string {
  if (count <= 1) return 'vista uma vez';
  return `${count} avistamentos, até ${horaLocal(ate)} (de ${horaLocal(de)})`;
}

export function TagHistoricoConsultar({ serial, placa, pdf, aoGerarPdf }: Props) {
  const [inicio, setInicio] = useState(() => paraCampoLocal(Date.now() - 24 * 3600_000));
  const [fim, setFim] = useState(() => paraCampoLocal(Date.now()));
  const [tipo, setTipo] = useState<TipoRelatorio>('basico');
  const [relatorio, setRelatorio] = useState<RelatorioDaTag | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gerado, setGerado] = useState<HistoricoSolicitado | null>(null);

  function predefinido(min: number) {
    const agora = Date.now();
    setInicio(paraCampoLocal(agora - min * 60_000));
    setFim(paraCampoLocal(agora));
  }

  async function buscar() {
    setCarregando(true);
    setErro(null);
    try {
      setRelatorio(
        await tagHistoryApi.relatorio(serial, new Date(inicio).toISOString(), new Date(fim).toISOString(), tipo),
      );
    } catch (e: unknown) {
      setRelatorio(null);
      setErro(mensagemDoErro(e, 'Não foi possível gerar o relatório agora.'));
    } finally {
      setCarregando(false);
    }
  }

  async function gerarPdf(periodo?: { from: string; to: string; tipo: TipoRelatorio }) {
    setGerando(true);
    setErro(null);
    setGerado(null);
    try {
      const item = periodo
        ? await pdf.gerar(periodo.from, periodo.to, periodo.tipo)
        : await pdf.gerar(new Date(inicio).toISOString(), new Date(fim).toISOString(), tipo);
      setGerado(item);
      aoGerarPdf(item);
    } catch (e: unknown) {
      setErro(mensagemDoErro(e, 'Não foi possível gerar o PDF agora.'));
    } finally {
      setGerando(false);
    }
  }

  function exportar() {
    if (!relatorio) return;
    const blob = new Blob([relatorioTagParaCsv(relatorio)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `historico-tag-${placa}-${relatorio.type}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const avancado = relatorio?.type === 'avancado';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {PREDEFINIDOS.map((p) => (
          <Button key={p.min} variant="outline" size="sm" onClick={() => predefinido(p.min)}>
            {p.rotulo}
          </Button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor="tag-consulta-inicio" className="mb-1 block text-xs text-muted-foreground">
            Inicial
          </label>
          <Input id="tag-consulta-inicio" type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </div>
        <div>
          <label htmlFor="tag-consulta-fim" className="mb-1 block text-xs text-muted-foreground">
            Final
          </label>
          <Input id="tag-consulta-fim" type="datetime-local" value={fim} onChange={(e) => setFim(e.target.value)} />
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs font-medium">Tipo de relatório</div>
        <div className="space-y-1">
          {TIPOS.map((t) => (
            <label key={t.id} className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="tag-tipo-relatorio"
                checked={tipo === t.id}
                onChange={() => setTipo(t.id)}
                className="mt-1"
              />
              <span>
                {t.rotulo} <span className="text-xs text-muted-foreground">· {t.dica}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={buscar} disabled={carregando || !inicio || !fim}>
          {carregando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
          Buscar
        </Button>
        <Button size="sm" variant="outline" onClick={() => gerarPdf()} disabled={gerando || !inicio || !fim}>
          {gerando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
          {gerando ? 'Gerando PDF…' : 'Gerar PDF'}
        </Button>
        <span className="text-xs text-muted-foreground">Período de até 90 dias para trás.</span>
      </div>

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      {gerado && (
        <div className="space-y-2 rounded-lg border border-orange-200 bg-orange-50/60 p-3 dark:border-orange-900 dark:bg-orange-950/20">
          <div className="text-sm">
            <b>PDF pronto</b> · nº {gerado.number} · {gerado.rowCount.toLocaleString('pt-BR')}{' '}
            {gerado.type === 'consolidado' ? 'dias' : 'lugares'}. O link abre sem senha até{' '}
            {new Date(gerado.expiresAt).toLocaleDateString('pt-BR')}.
          </div>
          <Input
            readOnly
            value={gerado.url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Link do PDF"
            className="font-mono text-xs"
          />
          <AcoesDoPdf fonte={pdf} item={gerado} />
        </div>
      )}

      {relatorio && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={exportar}>
              <Download className="mr-2 h-4 w-4" /> Excel
            </Button>
            <Button
              size="sm"
              onClick={() => gerarPdf({ from: relatorio.from, to: relatorio.to, tipo: relatorio.type })}
              disabled={gerando}
            >
              {gerando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
              {gerando ? 'Gerando PDF…' : 'PDF com link'}
            </Button>
          </div>

          <div className="text-sm">
            <div>
              <b>TAG:</b> {relatorio.plate} · nº {relatorio.serial}
            </div>
            <div>
              <b>Período:</b> {dataHoraLocal(relatorio.from)} a {dataHoraLocal(relatorio.to)}
            </div>
            <div className="flex flex-wrap gap-x-4">
              <span>
                <b>Avistamentos:</b> {relatorio.totals.sightings.toLocaleString('pt-BR')}
              </span>
              <span>
                <b>Lugares:</b> {relatorio.totals.places.toLocaleString('pt-BR')}
              </span>
              <span>
                <b>Dias com avistamento:</b> {relatorio.totals.days.toLocaleString('pt-BR')}
              </span>
            </div>
          </div>

          {relatorio.type === 'consolidado' ? (
            relatorio.days.length === 0 ? (
              <p className="py-3 text-center text-sm text-muted-foreground">Nenhum avistamento no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="p-1">Data</th>
                      <th className="p-1">Avistamentos</th>
                      <th className="p-1">Primeira / última</th>
                      <th className="p-1">Última vez vista em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {relatorio.days.map((d) => (
                      <tr key={d.date} className="border-b">
                        <td className="p-1">{d.date.split('-').reverse().join('/')}</td>
                        <td className="p-1">{d.count}</td>
                        <td className="whitespace-nowrap p-1">
                          {horaLocal(d.firstSeen)} / {horaLocal(d.lastSeen)}
                        </td>
                        <td className="p-1">{d.address ?? `${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-1">Vista em</th>
                    <th className="p-1">Latitude</th>
                    <th className="p-1">Longitude</th>
                    <th className="p-1">Endereço</th>
                    <th className="p-1">Precisão</th>
                    <th className="p-1">Avistamentos</th>
                    {avancado && <th className="p-1">Atraso da informação</th>}
                    {avancado && <th className="p-1">Fonte</th>}
                  </tr>
                </thead>
                <tbody>
                  {relatorio.rows.slice(0, LINHAS_NA_TELA).map((l, i) => (
                    <tr key={`${l.time}-${i}`} className="border-b">
                      <td className="whitespace-nowrap p-1">{dataHoraLocal(l.time)}</td>
                      <td className="p-1">{l.lat.toFixed(6)}</td>
                      <td className="p-1">{l.lng.toFixed(6)}</td>
                      <td className="p-1">{l.address ?? '—'}</td>
                      <td className="whitespace-nowrap p-1">{l.accuracyM ? `${Math.round(l.accuracyM)} m` : '—'}</td>
                      <td className="p-1">{resumoDoLugar(l.count, l.untilTime, l.time)}</td>
                      {avancado && <td className="whitespace-nowrap p-1">{l.delayMin ?? '—'} min</td>}
                      {avancado && <td className="p-1">{l.source === 'APPLE_FINDMY' ? 'Find My' : (l.source ?? '—')}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {relatorio.rows.length === 0 && (
                <p className="py-3 text-center text-sm text-muted-foreground">Nenhum avistamento no período.</p>
              )}
              {relatorio.rows.length > LINHAS_NA_TELA && (
                <p className="py-2 text-xs text-muted-foreground">
                  Mostrando {LINHAS_NA_TELA.toLocaleString('pt-BR')} de{' '}
                  {relatorio.rows.length.toLocaleString('pt-BR')} lugares. O Excel e o PDF levam todos.
                </p>
              )}
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            A TAG não tem GPS próprio: ela é vista quando um aparelho com Find My passa por perto. Cada linha mostra
            onde e quando ela foi vista, e não o trajeto percorrido. A rede entrega a informação com atraso.
          </p>
        </div>
      )}
    </div>
  );
}
