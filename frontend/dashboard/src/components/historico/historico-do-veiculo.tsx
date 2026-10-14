'use client';

import { useState } from 'react';
import { HistoricoDoDia } from '@/components/historico/historico-do-dia';
import { HistoricoConsultar } from '@/components/historico/historico-consultar';
import { HistoricoSolicitados } from '@/components/historico/historico-solicitados';
import type { FonteDePdf, JornadaDoDia, RelatorioHistorico, TipoRelatorio } from '@/lib/historico';

interface Props {
  carregarDia: (dia: string, comEnderecos?: boolean) => Promise<JornadaDoDia>;
  carregarRelatorio: (from: string, to: string, tipo: TipoRelatorio) => Promise<RelatorioHistorico>;
  diasViagens: number;
  diasConsulta: number;
  resolverEndereco?: (lat: number, lng: number) => Promise<string | null>;
  nomeArquivo: string;
  /** PDF com link (aba Solicitados). Sem isso, só Viagens e Consultar. */
  pdf?: FonteDePdf;
  /** Painel mostra quem do time gerou; o associado não vê nome interno. */
  mostrarQuemPediu?: boolean;
}

/**
 * "Viagens e históricos" da Rede: aba Viagens (um dia, viagens e trajeto),
 * aba Consultar (período livre, básico/avançado/consolidado) e aba
 * Solicitados (PDFs já gerados, com link para mandar ao cliente).
 */
export function HistoricoDoVeiculo({
  carregarDia,
  carregarRelatorio,
  diasViagens,
  diasConsulta,
  resolverEndereco,
  nomeArquivo,
  pdf,
  mostrarQuemPediu = false,
}: Props) {
  const [aba, setAba] = useState<'viagens' | 'consultar' | 'solicitados'>('viagens');
  const [versao, setVersao] = useState(0);
  const botao = (id: typeof aba, rotulo: string) => (
    <button
      key={id}
      onClick={() => setAba(id)}
      className={`border-b-2 px-3 py-2 text-sm font-medium ${
        aba === id ? 'border-orange-500 text-foreground' : 'border-transparent text-muted-foreground'
      }`}
    >
      {rotulo}
    </button>
  );
  return (
    <div className="space-y-3">
      <div className="flex border-b">
        {botao('viagens', 'Viagens')}
        {botao('consultar', 'Consultar')}
        {pdf && botao('solicitados', 'Solicitados')}
      </div>
      <div className={aba === 'viagens' ? '' : 'hidden'}>
        <HistoricoDoDia
          carregar={carregarDia}
          diasMax={diasViagens}
          resolverEndereco={resolverEndereco}
          nomeArquivo={nomeArquivo}
        />
      </div>
      {aba === 'consultar' && (
        <HistoricoConsultar
          carregar={carregarRelatorio}
          diasMax={diasConsulta}
          nomeArquivo={nomeArquivo}
          pdf={pdf}
          aoGerarPdf={() => setVersao((v) => v + 1)}
        />
      )}
      {pdf && aba === 'solicitados' && (
        <HistoricoSolicitados fonte={pdf} versao={versao} mostrarQuemPediu={mostrarQuemPediu} />
      )}
    </div>
  );
}
