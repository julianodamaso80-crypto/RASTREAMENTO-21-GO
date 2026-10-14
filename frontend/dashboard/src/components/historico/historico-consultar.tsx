'use client';

import { useMemo, useRef, useState } from 'react';
import { Download, FileText, Loader2, MapPinned, Printer, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TrajetoNoMapa } from '@/components/historico/historico-do-dia';
import { AcoesDoPdf } from '@/components/historico/historico-solicitados';
import {
  dataHoraLocal,
  distanciaDaLinha,
  duracaoLegivel,
  paraCampoLocal,
  relatorioParaCsv,
  type FonteDePdf,
  type HistoricoSolicitado,
  type RelatorioHistorico,
  type TipoRelatorio,
} from '@/lib/historico';

interface Props {
  carregar: (from: string, to: string, tipo: TipoRelatorio) => Promise<RelatorioHistorico>;
  /** Quantos dias para trás o período pode começar. */
  diasMax: number;
  nomeArquivo: string;
  /** Sem isso o botão "Gerar PDF" não aparece. */
  pdf?: FonteDePdf;
  /** Avisado a cada PDF novo (a aba Solicitados recarrega). */
  aoGerarPdf?: (item: HistoricoSolicitado) => void;
}

const PREDEFINIDOS = [
  { rotulo: '1 hora', min: 60 },
  { rotulo: '24 horas', min: 1440 },
  { rotulo: '48 horas', min: 2880 },
  { rotulo: '72 horas', min: 4320 },
  { rotulo: '7 dias', min: 10080 },
];

const TIPOS: { id: TipoRelatorio; rotulo: string; dica: string }[] = [
  { id: 'basico', rotulo: 'Básico', dica: 'Posição, endereço, velocidade e ignição (até 7 dias)' },
  { id: 'avancado', rotulo: 'Avançado', dica: 'Básico mais GPRS, GPS e direção (até 7 dias)' },
  { id: 'consolidado', rotulo: 'Consolidado', dica: 'Um registro por dia com a velocidade máxima' },
];

const LINHAS_NA_TELA = 2000;

export function HistoricoConsultar({ carregar, diasMax, nomeArquivo, pdf, aoGerarPdf }: Props) {
  const [inicio, setInicio] = useState(() => paraCampoLocal(Date.now() - 24 * 3600_000));
  const [fim, setFim] = useState(() => paraCampoLocal(Date.now()));
  const [tipo, setTipo] = useState<TipoRelatorio>('basico');
  const [relatorio, setRelatorio] = useState<RelatorioHistorico | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mapa, setMapa] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [gerado, setGerado] = useState<HistoricoSolicitado | null>(null);
  const area = useRef<HTMLDivElement>(null);

  function predefinido(min: number) {
    const agora = Date.now();
    setInicio(paraCampoLocal(agora - min * 60_000));
    setFim(paraCampoLocal(agora));
  }

  async function buscar() {
    setCarregando(true);
    setErro(null);
    setMapa(false);
    try {
      setRelatorio(await carregar(new Date(inicio).toISOString(), new Date(fim).toISOString(), tipo));
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      setRelatorio(null);
      setErro(msg || 'Não foi possível gerar o relatório agora.');
    } finally {
      setCarregando(false);
    }
  }

  /** Sem argumento usa os campos; o botão ao lado do resultado passa o período exibido. */
  async function gerarPdf(periodo?: { from: string; to: string; tipo: TipoRelatorio }) {
    if (!pdf) return;
    setGerando(true);
    setErro(null);
    setGerado(null);
    try {
      const item = periodo
        ? await pdf.gerar(periodo.from, periodo.to, periodo.tipo)
        : await pdf.gerar(new Date(inicio).toISOString(), new Date(fim).toISOString(), tipo);
      setGerado(item);
      aoGerarPdf?.(item);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      setErro(msg || 'Não foi possível gerar o PDF agora.');
    } finally {
      setGerando(false);
    }
  }

  function exportar() {
    if (!relatorio) return;
    const blob = new Blob([relatorioParaCsv(relatorio)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nomeArquivo}-${relatorio.type}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function imprimir() {
    if (!area.current) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(
      `<html><head><title>Histórico ${relatorio?.plate ?? ''}</title><style>body{font-family:sans-serif;font-size:11px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:3px 5px;text-align:left}</style></head><body>${area.current.innerHTML}</body></html>`,
    );
    w.document.close();
    w.print();
  }

  const caminho = useMemo(
    () =>
      (relatorio?.rows ?? []).map((l) => ({
        time: l.time,
        lat: l.lat,
        lng: l.lng,
        speed: l.speed,
        ignition: l.ignition,
      })),
    [relatorio],
  );

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
          <label htmlFor="consulta-inicio" className="mb-1 block text-xs text-muted-foreground">
            Inicial
          </label>
          <Input id="consulta-inicio" type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </div>
        <div>
          <label htmlFor="consulta-fim" className="mb-1 block text-xs text-muted-foreground">
            Final
          </label>
          <Input id="consulta-fim" type="datetime-local" value={fim} onChange={(e) => setFim(e.target.value)} />
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs font-medium">Tipo de relatório</div>
        <div className="space-y-1">
          {TIPOS.map((t) => (
            <label key={t.id} className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="tipo-relatorio"
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

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={buscar} disabled={carregando || !inicio || !fim}>
          {carregando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
          Buscar
        </Button>
        {pdf && (
          <Button size="sm" variant="outline" onClick={() => gerarPdf()} disabled={gerando || !inicio || !fim}>
            {gerando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
            {gerando ? 'Gerando PDF…' : 'Gerar PDF'}
          </Button>
        )}
        <span className="text-xs text-muted-foreground">Período de até {diasMax} dias para trás.</span>
      </div>

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      {pdf && gerado && (
        <div className="space-y-2 rounded-lg border border-orange-200 bg-orange-50/60 p-3 dark:border-orange-900 dark:bg-orange-950/20">
          <div className="text-sm">
            <b>PDF pronto</b> · nº {gerado.number} · {gerado.rowCount.toLocaleString('pt-BR')}{' '}
            {gerado.type === 'consolidado' ? 'dias' : 'registros'}. O link abre sem senha até{' '}
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
            {pdf ? (
              <Button
                size="sm"
                onClick={() => gerarPdf({ from: relatorio.from, to: relatorio.to, tipo: relatorio.type })}
                disabled={gerando}
              >
                {gerando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                {gerando ? 'Gerando PDF…' : 'PDF com link'}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={imprimir}>
                <Printer className="mr-2 h-4 w-4" /> Imprimir / PDF
              </Button>
            )}
            {relatorio.type !== 'consolidado' && caminho.length > 1 && (
              <Button variant="outline" size="sm" onClick={() => setMapa((m) => !m)}>
                <MapPinned className="mr-2 h-4 w-4" /> {mapa ? 'Ocultar mapa' : 'Traçar no mapa'}
              </Button>
            )}
          </div>

          {mapa && <TrajetoNoMapa viagem={{ path: caminho }} />}

          <div ref={area} className="space-y-2">
            <div className="text-sm">
              <div>
                <b>Ativo:</b> {relatorio.plate}
              </div>
              <div>
                <b>Período:</b> {dataHoraLocal(relatorio.from)} a {dataHoraLocal(relatorio.to)}
              </div>
              <div className="flex flex-wrap gap-x-4">
                <span>
                  <b>Ignição ligada total:</b> {duracaoLegivel(relatorio.totals.ignitionOnMin)}
                </span>
                <span>
                  <b>Ignição desligada total:</b> {duracaoLegivel(relatorio.totals.ignitionOffMin)}
                </span>
                <span>
                  <b>Distância percorrida total:</b>{' '}
                  {relatorio.totals.distanceKm.toFixed(2).replace('.', ',')} km
                </span>
              </div>
            </div>

            {relatorio.type === 'consolidado' ? (
              <TabelaConsolidada relatorio={relatorio} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="p-1">Data/Hora</th>
                      {avancado && <th className="p-1">GPRS</th>}
                      {avancado && <th className="p-1">GPS</th>}
                      <th className="p-1">Latitude</th>
                      <th className="p-1">Longitude</th>
                      <th className="p-1">Endereço</th>
                      <th className="p-1">Km/h</th>
                      <th className="p-1">Ignição</th>
                      <th className="p-1">Evento</th>
                      <th className="p-1">Distância</th>
                      {avancado && <th className="p-1">Direção</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {relatorio.rows.slice(0, LINHAS_NA_TELA).map((l, i) => (
                      <tr key={`${l.time}-${i}`} className="border-b">
                        <td className="whitespace-nowrap p-1">{dataHoraLocal(l.time)}</td>
                        {avancado && <td className="whitespace-nowrap p-1">{l.gprs ? dataHoraLocal(l.gprs) : ''}</td>}
                        {avancado && <td className="whitespace-nowrap p-1">{l.gps ? dataHoraLocal(l.gps) : ''}</td>}
                        <td className="p-1">{l.lat.toFixed(6)}</td>
                        <td className="p-1">{l.lng.toFixed(6)}</td>
                        <td className="p-1">{l.address ?? '—'}</td>
                        <td className="p-1">{l.speed}</td>
                        <td className="p-1">{l.ignition === null ? '—' : l.ignition ? 'Ligado' : 'Desligado'}</td>
                        <td className="p-1">{l.event ?? ''}</td>
                        <td className="whitespace-nowrap p-1">{distanciaDaLinha(l.distanceM, l.speed)}</td>
                        {avancado && <td className="p-1">{l.direction}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {relatorio.rows.length === 0 && (
                  <p className="py-3 text-center text-sm text-muted-foreground">Nenhum registro foi encontrado!</p>
                )}
                {relatorio.rows.length > LINHAS_NA_TELA && (
                  <p className="py-2 text-xs text-muted-foreground">
                    Mostrando {LINHAS_NA_TELA.toLocaleString('pt-BR')} de{' '}
                    {relatorio.rows.length.toLocaleString('pt-BR')} registros. O Excel leva todos.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TabelaConsolidada({ relatorio }: { relatorio: RelatorioHistorico }) {
  if (relatorio.days.length === 0) {
    return <p className="py-3 text-center text-sm text-muted-foreground">Nenhum registro foi encontrado!</p>;
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b text-left">
          <th className="p-1">Data</th>
          <th className="p-1">Velocidade máxima</th>
          <th className="p-1">Endereço</th>
        </tr>
      </thead>
      <tbody>
        {relatorio.days.map((d) => (
          <tr key={d.date} className="border-b">
            <td className="p-1">{d.date.split('-').reverse().join('/')}</td>
            <td className="p-1">{d.maxSpeed} km/h</td>
            <td className="p-1">{d.address ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
