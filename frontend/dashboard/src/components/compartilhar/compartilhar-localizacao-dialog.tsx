'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, MessageCircle, Share2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DURACOES_HORAS, type LinkLocalizacao } from '@/lib/compartilhar-localizacao';

function dataHora(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

function mensagem(placa: string, link: LinkLocalizacao) {
  return `Acompanhe a localização do veículo ${placa} em tempo real até ${dataHora(link.expiresAt)}: ${link.url}`;
}

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success('Link copiado.');
  } catch {
    window.prompt('Copie o link:', texto);
  }
}

/**
 * "Compartilhar localização": gera um link sem login que mostra o veículo ao
 * vivo pelo prazo escolhido. Mesmo diálogo no painel e na área do associado —
 * só mudam as chamadas.
 */
export function CompartilharLocalizacaoDialog({
  aberto,
  onFechar,
  placa,
  gerar,
  listar,
  cancelar,
  mostrarQuemGerou = false,
}: {
  aberto: boolean;
  onFechar: () => void;
  placa: string;
  gerar: (horas: number) => Promise<LinkLocalizacao>;
  listar: () => Promise<LinkLocalizacao[]>;
  cancelar: (id: string) => Promise<LinkLocalizacao>;
  mostrarQuemGerou?: boolean;
}) {
  const [horas, setHoras] = useState<number>(8);
  const [gerando, setGerando] = useState(false);
  const [novo, setNovo] = useState<LinkLocalizacao | null>(null);
  const [lista, setLista] = useState<LinkLocalizacao[] | null>(null);
  const [cancelando, setCancelando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setLista(await listar());
    } catch {
      setLista([]);
    }
  }, [listar]);

  useEffect(() => {
    if (!aberto) return;
    setNovo(null);
    setLista(null);
    void carregar();
    // Recarrega só ao abrir; `listar` muda de identidade a cada render do pai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  async function gerarLink() {
    setGerando(true);
    try {
      const l = await gerar(horas);
      setNovo(l);
      await carregar();
    } catch (err: unknown) {
      const m = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(m || 'Não foi possível gerar o link agora.');
    } finally {
      setGerando(false);
    }
  }

  async function cancelarLink(id: string) {
    setCancelando(id);
    try {
      await cancelar(id);
      if (novo?.id === id) setNovo(null);
      toast.success('Link cancelado. Quem tiver ele não vê mais a localização.');
      await carregar();
    } catch {
      toast.error('Não foi possível cancelar agora.');
    } finally {
      setCancelando(null);
    }
  }

  async function compartilhar(l: LinkLocalizacao) {
    const texto = mensagem(placa, l);
    if (navigator.share) {
      try {
        await navigator.share({ title: `Localização ${placa}`, text: texto });
        return;
      } catch {
        // Cancelado pela pessoa: nada a fazer.
        return;
      }
    }
    await copiar(texto);
  }

  const ativos = (lista ?? []).filter((l) => l.active);

  return (
    <Dialog open={aberto} onOpenChange={(a) => !a && onFechar()}>
      <DialogContent className="max-h-[92dvh] w-[96vw] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Compartilhar localização · {placa}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Quem receber o link vê o veículo no mapa em tempo real, sem precisar de login, até o
          prazo acabar.
        </p>

        <div>
          <div className="mb-2 text-sm font-medium">Por quanto tempo?</div>
          <div className="grid grid-cols-4 gap-2">
            {DURACOES_HORAS.map((h) => (
              <Button
                key={h}
                type="button"
                variant={horas === h ? 'default' : 'outline'}
                onClick={() => setHoras(h)}
              >
                {h}h
              </Button>
            ))}
          </div>
        </div>

        <Button onClick={gerarLink} disabled={gerando} className="w-full">
          {gerando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Share2 className="mr-2 h-4 w-4" />}
          Gerar link de {horas} {horas === 1 ? 'hora' : 'horas'}
        </Button>

        {novo && (
          <div className="space-y-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
            <div className="text-sm font-medium">Link pronto · vale até {dataHora(novo.expiresAt)}</div>
            <div className="break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">{novo.url}</div>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" size="sm" onClick={() => copiar(novo.url)}>
                <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar
              </Button>
              <a
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                href={`https://wa.me/?text=${encodeURIComponent(mensagem(placa, novo))}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="mr-1.5 h-3.5 w-3.5" /> WhatsApp
              </a>
              <Button variant="outline" size="sm" onClick={() => compartilhar(novo)}>
                <Share2 className="mr-1.5 h-3.5 w-3.5" /> Enviar
              </Button>
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 text-sm font-medium">Links ativos</div>
          {lista === null ? (
            <div className="text-xs text-muted-foreground">Carregando…</div>
          ) : ativos.length === 0 ? (
            <div className="text-xs text-muted-foreground">Nenhum link ativo para este veículo.</div>
          ) : (
            <ul className="space-y-2">
              {ativos.map((l) => (
                <li key={l.id} className="flex items-center gap-2 rounded border px-2 py-1.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <div>
                      {l.hours}h · vale até {dataHora(l.expiresAt)}
                    </div>
                    <div className="text-muted-foreground">
                      Gerado em {dataHora(l.createdAt)}
                      {mostrarQuemGerou
                        ? ` · ${l.source === 'APP' ? 'pelo associado' : l.requestedByName || 'painel'}`
                        : ''}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Copiar" onClick={() => copiar(l.url)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    title="Cancelar link"
                    disabled={cancelando === l.id}
                    onClick={() => cancelarLink(l.id)}
                  >
                    {cancelando === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
