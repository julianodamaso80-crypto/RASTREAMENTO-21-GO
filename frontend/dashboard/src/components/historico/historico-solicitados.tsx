'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { dataHoraLocal, type FonteDePdf, type HistoricoSolicitado } from '@/lib/historico';

const TIPO: Record<string, string> = {
  basico: 'Básico',
  avancado: 'Avançado',
  consolidado: 'Consolidado',
};

export async function baixarPdf(fonte: FonteDePdf, item: HistoricoSolicitado) {
  const blob = await fonte.baixar(item.id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `historico-${item.plate}-${item.number}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function copiarLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Link copiado. Cole no WhatsApp ou no e-mail do cliente.');
  } catch {
    window.prompt('Copie o link:', url);
  }
}

/** Ações de um PDF pronto: baixar, copiar o link e abrir. */
export function AcoesDoPdf({ fonte, item }: { fonte: FonteDePdf; item: HistoricoSolicitado }) {
  const [baixando, setBaixando] = useState(false);
  async function baixar() {
    setBaixando(true);
    try {
      await baixarPdf(fonte, item);
    } catch {
      toast.error('Não foi possível baixar o PDF agora.');
    } finally {
      setBaixando(false);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={baixar} disabled={baixando}>
        {baixando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
        Baixar PDF
      </Button>
      <Button size="sm" variant="outline" onClick={() => copiarLink(item.url)} disabled={item.expired}>
        <Copy className="mr-2 h-4 w-4" /> Copiar link
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => window.open(item.url, '_blank', 'noopener')}
        disabled={item.expired}
      >
        <ExternalLink className="mr-2 h-4 w-4" /> Abrir
      </Button>
    </div>
  );
}

/** Aba "Solicitados": tudo que já foi gerado em PDF para o veículo. */
export function HistoricoSolicitados({
  fonte,
  versao,
  mostrarQuemPediu,
}: {
  fonte: FonteDePdf;
  /** Muda quando um PDF novo é gerado, para recarregar a lista. */
  versao: number;
  mostrarQuemPediu: boolean;
}) {
  const [itens, setItens] = useState<HistoricoSolicitado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  // A página pode recriar `fonte` a cada render; a lista só recarrega quando
  // `versao` muda ou no botão Atualizar.
  const fonteRef = useRef(fonte);
  useEffect(() => {
    fonteRef.current = fonte;
  });

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setItens(await fonteRef.current.listar());
    } catch {
      setErro('Não foi possível carregar os históricos solicitados.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar, versao]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Históricos já gerados em PDF. O link abre sem senha por 90 dias.
        </p>
        <Button size="sm" variant="ghost" onClick={carregar} disabled={carregando}>
          <RefreshCw className={`mr-2 h-4 w-4 ${carregando ? 'animate-spin' : ''}`} /> Atualizar
        </Button>
      </div>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {itens && itens.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhum histórico gerado ainda. Use a aba Consultar e clique em Gerar PDF.
        </p>
      )}
      {itens?.map((item) => (
        <div key={item.id} className="space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">
                {dataHoraLocal(item.from)} → {dataHoraLocal(item.to)}
              </div>
              <div className="text-xs text-muted-foreground">
                {TIPO[item.type] ?? item.type} · {item.rowCount.toLocaleString('pt-BR')}{' '}
                {item.type === 'consolidado' ? 'dias' : 'registros'} · gerado em {dataHoraLocal(item.createdAt)}
                {item.source === 'APP' ? ' · pelo associado (app)' : ''}
                {mostrarQuemPediu && item.source === 'PAINEL' && item.requestedByName
                  ? ` · por ${item.requestedByName}`
                  : ''}{' '}
                · nº {item.number}
              </div>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                item.expired ? 'bg-muted text-muted-foreground' : 'bg-green-100 text-green-700'
              }`}
            >
              {item.expired ? 'Link expirado' : `Link até ${new Date(item.expiresAt).toLocaleDateString('pt-BR')}`}
            </span>
          </div>
          <AcoesDoPdf fonte={fonte} item={item} />
        </div>
      ))}
    </div>
  );
}
