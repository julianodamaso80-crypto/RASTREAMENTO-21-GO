'use client';

import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HistoricoSolicitados } from '@/components/historico/historico-solicitados';
import { TagHistoricoConsultar } from '@/components/ble-tags/tag-historico-consultar';
import { tagHistoryApi } from '@/lib/api';
import type { FonteDePdf } from '@/lib/historico';

/**
 * Histórico da TAG com PDF: a mesma tela "Consultar / Solicitados" do histórico
 * do rastreador, alimentada pelos avistamentos da TAG.
 */
export function TagHistoricoDialog({
  serial,
  placa,
  open,
  onOpenChange,
}: {
  serial: string;
  placa: string;
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
}) {
  const [aba, setAba] = useState<'consultar' | 'solicitados'>('consultar');
  const [versao, setVersao] = useState(0);

  const pdf: FonteDePdf = useMemo(
    () => ({
      gerar: (from, to, tipo) => tagHistoryApi.gerarPdf(serial, from, to, tipo),
      listar: () => tagHistoryApi.listar(serial),
      baixar: (id) => tagHistoryApi.baixar(id),
    }),
    [serial],
  );

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <History className="h-5 w-5 text-brand-orange-500" />
            Histórico da TAG · {placa}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex border-b">
            {botao('consultar', 'Consultar')}
            {botao('solicitados', 'Solicitados')}
          </div>
          <div className={aba === 'consultar' ? '' : 'hidden'}>
            <TagHistoricoConsultar
              serial={serial}
              placa={placa}
              pdf={pdf}
              aoGerarPdf={() => setVersao((v) => v + 1)}
            />
          </div>
          {aba === 'solicitados' && <HistoricoSolicitados fonte={pdf} versao={versao} mostrarQuemPediu />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
