'use client';

import { useState } from 'react';
import { HistoricoDoDia } from '@/components/historico/historico-do-dia';
import { HistoricoConsultar } from '@/components/historico/historico-consultar';
import type { JornadaDoDia, RelatorioHistorico, TipoRelatorio } from '@/lib/historico';

interface Props {
  carregarDia: (dia: string) => Promise<JornadaDoDia>;
  carregarRelatorio: (from: string, to: string, tipo: TipoRelatorio) => Promise<RelatorioHistorico>;
  diasViagens: number;
  diasConsulta: number;
  resolverEndereco?: (lat: number, lng: number) => Promise<string | null>;
  nomeArquivo: string;
}

/**
 * "Viagens e históricos" da Rede: aba Viagens (um dia, viagens e trajeto) e
 * aba Consultar (período livre, básico/avançado/consolidado).
 */
export function HistoricoDoVeiculo({
  carregarDia,
  carregarRelatorio,
  diasViagens,
  diasConsulta,
  resolverEndereco,
  nomeArquivo,
}: Props) {
  const [aba, setAba] = useState<'viagens' | 'consultar'>('viagens');
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
        <HistoricoConsultar carregar={carregarRelatorio} diasMax={diasConsulta} nomeArquivo={nomeArquivo} />
      )}
    </div>
  );
}
