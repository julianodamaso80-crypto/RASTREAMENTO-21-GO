'use client';

import { useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileUp,
  Link2,
  Loader2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { stockApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import type {
  BulkLinkLinha,
  BulkLinkResultado,
  BulkLinkStatus,
} from '@/types/stock';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chamado ao fechar depois de ter vinculado algo, pra recarregar o estoque. */
  onLinked: () => void;
};

// Cada pacote consulta o SGA ao vivo; 10 por vez cabe folgado no tempo do proxy.
const TAMANHO_PACOTE = 10;

const ROTULO: Record<BulkLinkStatus, string> = {
  VINCULADO: 'Vinculado',
  JA_VINCULADO: 'Já estava vinculado',
  ERRO: 'Não vinculou',
};

function mensagemDaApi(err: unknown, padrao: string): string {
  const m = (err as { response?: { data?: { message?: string | string[] } } })
    ?.response?.data?.message;
  return (Array.isArray(m) ? m.join('; ') : m) || padrao;
}

function baixarCsv(nomeBase: string, resultados: BulkLinkResultado[]) {
  const aspas = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const linhas = [
    ['Linha', 'Placa', 'IMEI', 'Resultado', 'Motivo'].join(';'),
    ...resultados.map((r) =>
      [r.linha, aspas(r.placa), aspas(r.imei), ROTULO[r.status], aspas(r.motivo ?? '')].join(';'),
    ),
  ];
  const blob = new Blob(['﻿' + linhas.join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vinculo-em-massa-${nomeBase.replace(/\.[^.]+$/, '')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function BulkLinkDialog({ open, onOpenChange, onLinked }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [lendo, setLendo] = useState(false);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<BulkLinkLinha[] | null>(null);
  const [rodando, setRodando] = useState(false);
  const [feitas, setFeitas] = useState(0);
  const [resultados, setResultados] = useState<BulkLinkResultado[] | null>(null);
  const [soErros, setSoErros] = useState(false);

  const prontas = linhas?.filter((l) => !l.erro) ?? [];
  const invalidas = linhas?.filter((l) => l.erro) ?? [];

  const reset = () => {
    setNomeArquivo('');
    setLendo(false);
    setErroGeral(null);
    setLinhas(null);
    setRodando(false);
    setFeitas(0);
    setResultados(null);
    setSoErros(false);
  };

  const fechar = (o: boolean) => {
    if (rodando) return; // fechar no meio deixaria o operador sem o relatório
    if (!o) {
      if (resultados?.some((r) => r.status === 'VINCULADO')) onLinked();
      reset();
    }
    onOpenChange(o);
  };

  const escolherArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(xlsx|pdf)$/i.test(file.name)) {
      toast.error('Envie uma planilha .xlsx ou um PDF.');
      return;
    }
    setNomeArquivo(file.name);
    setLendo(true);
    setErroGeral(null);
    setLinhas(null);
    setResultados(null);
    try {
      const lida = await stockApi.bulkLinkRead(file);
      if (lida.erroGeral) setErroGeral(lida.erroGeral);
      else setLinhas(lida.linhas);
    } catch (err) {
      setErroGeral(mensagemDaApi(err, 'Não consegui ler o arquivo.'));
    } finally {
      setLendo(false);
    }
  };

  const vincular = async () => {
    if (!linhas) return;
    setRodando(true);
    setFeitas(0);
    // As linhas que já vieram inválidas do arquivo entram no relatório como erro.
    const acumulado: BulkLinkResultado[] = invalidas.map((l) => ({
      linha: l.linha,
      placa: l.placa,
      imei: l.imei,
      status: 'ERRO',
      motivo: l.erro,
    }));
    for (let i = 0; i < prontas.length; i += TAMANHO_PACOTE) {
      const pacote = prontas.slice(i, i + TAMANHO_PACOTE);
      try {
        const res = await stockApi.bulkLink(
          pacote.map(({ linha, placa, imei, tecnico, local }) => ({
            linha,
            placa,
            imei,
            tecnico,
            local,
          })),
        );
        acumulado.push(...res);
      } catch (err) {
        // Pacote inteiro sem resposta: não dá para saber o que gravou. Marca
        // como não confirmado — reenviar é seguro (linha já vinculada volta
        // como "já estava vinculado").
        const motivo = `${mensagemDaApi(err, 'Sem resposta do servidor')}. Não sei se vinculou; envie o arquivo de novo (o que já vinculou aparece como "já estava vinculado").`;
        acumulado.push(
          ...pacote.map<BulkLinkResultado>((l) => ({
            linha: l.linha,
            placa: l.placa,
            imei: l.imei,
            status: 'ERRO',
            motivo,
          })),
        );
      }
      setFeitas(Math.min(i + TAMANHO_PACOTE, prontas.length));
    }
    acumulado.sort((a, b) => a.linha - b.linha);
    setResultados(acumulado);
    setRodando(false);
  };

  const total = (s: BulkLinkStatus) => resultados?.filter((r) => r.status === s).length ?? 0;
  const mostrados = resultados?.filter((r) => !soErros || r.status === 'ERRO') ?? [];

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <Link2 className="h-5 w-5 text-brand-orange-500" />
            Vincular em massa
          </DialogTitle>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.pdf"
          className="hidden"
          onChange={escolherArquivo}
        />

        {!resultados && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Envie uma planilha (.xlsx) ou PDF com as colunas{' '}
              <strong>Placa, IMEI, Técnico e Local de instalação</strong> — todas
              obrigatórias. Cada linha é conferida no SGA e, estando tudo certo, o
              rastreador fica vinculado ao cliente e rastreável.
            </p>

            <Button
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={lendo || rodando}
            >
              {lendo ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <FileUp className="h-4 w-4 mr-1" />
              )}
              {nomeArquivo ? 'Trocar arquivo' : 'Escolher arquivo'}
            </Button>
            {nomeArquivo && <span className="ml-2 text-sm">{nomeArquivo}</span>}

            {erroGeral && (
              <div className="flex gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{erroGeral}</span>
              </div>
            )}

            {linhas && (
              <div className="space-y-2">
                <p className="text-sm">
                  <strong>{prontas.length}</strong> linha(s) pronta(s) para vincular
                  {invalidas.length > 0 && (
                    <>
                      {' '}e <strong className="text-red-400">{invalidas.length}</strong> com
                      problema no arquivo (não vão ao SGA)
                    </>
                  )}
                  .
                </p>
                {invalidas.length > 0 && (
                  <ul className="max-h-40 overflow-auto rounded-md border border-border/60 p-2 text-xs space-y-1">
                    {invalidas.map((l) => (
                      <li key={l.linha}>
                        <span className="text-muted-foreground">Linha {l.linha}:</span>{' '}
                        {l.erro}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {rodando && (
              <div className="space-y-1">
                <div className="h-2 rounded bg-muted overflow-hidden">
                  <div
                    className="h-full bg-brand-orange-500 transition-all"
                    style={{ width: `${(feitas / Math.max(prontas.length, 1)) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Vinculando… {feitas} de {prontas.length}. Não feche esta janela.
                </p>
              </div>
            )}
          </div>
        )}

        {resultados && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-md bg-emerald-500/15 text-emerald-400 px-2 py-1">
                {total('VINCULADO')} vinculado(s)
              </span>
              <span className="rounded-md bg-blue-500/15 text-blue-400 px-2 py-1">
                {total('JA_VINCULADO')} já estava(m) vinculado(s)
              </span>
              <span className="rounded-md bg-red-500/15 text-red-400 px-2 py-1">
                {total('ERRO')} não vinculou
              </span>
            </div>

            {total('ERRO') > 0 && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={soErros}
                  onChange={(e) => setSoErros(e.target.checked)}
                />
                Mostrar só as que não vincularam
              </label>
            )}

            <div className="max-h-80 overflow-auto rounded-md border border-border/60">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card text-left text-muted-foreground">
                  <tr>
                    <th className="p-2">Linha</th>
                    <th className="p-2">Placa</th>
                    <th className="p-2">IMEI</th>
                    <th className="p-2">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {mostrados.map((r) => (
                    <tr key={`${r.linha}-${r.imei}`} className="border-t border-border/40 align-top">
                      <td className="p-2">{r.linha}</td>
                      <td className="p-2 font-mono">{r.placa}</td>
                      <td className="p-2 font-mono">{r.imei}</td>
                      <td className="p-2">
                        <span
                          className={
                            r.status === 'VINCULADO'
                              ? 'text-emerald-400'
                              : r.status === 'JA_VINCULADO'
                                ? 'text-blue-400'
                                : 'text-red-400'
                          }
                        >
                          {r.status === 'VINCULADO' ? (
                            <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />
                          ) : r.status === 'JA_VINCULADO' ? (
                            <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
                          ) : (
                            <XCircle className="inline h-3.5 w-3.5 mr-1" />
                          )}
                          {ROTULO[r.status]}
                        </span>
                        {r.motivo && <div className="text-muted-foreground mt-0.5">{r.motivo}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          {resultados ? (
            <>
              <Button variant="outline" size="sm" onClick={() => baixarCsv(nomeArquivo || 'arquivo', resultados)}>
                <Download className="h-4 w-4 mr-1" />
                Baixar relatório
              </Button>
              <Button size="sm" onClick={() => fechar(false)}>
                Fechar
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => fechar(false)} disabled={rodando}>
                Cancelar
              </Button>
              <Button size="sm" onClick={vincular} disabled={rodando || lendo || !linhas || prontas.length === 0}>
                {rodando ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4 mr-1" />
                )}
                {rodando ? 'Vinculando...' : `Vincular ${prontas.length || ''}`.trim()}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
