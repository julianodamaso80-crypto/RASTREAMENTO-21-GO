'use client';

import { ChevronRight, Crosshair, Loader2, MapPin, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LinhaSelecionada {
  id: string;
  /** Placa no mapa de veículos, IMEI no estoque. */
  titulo: string;
  /** Estado em uma linha: "Ligado · 42 km/h", "Sem sinal há 2h". */
  estado: string;
  /** Cor do estado — a mesma do pino, pra linha e pino se reconhecerem. */
  cor: string;
  /** Endereço já resolvido, ou null enquanto não se sabe. */
  endereco: string | null;
  /** true enquanto a busca do endereço DESTA coordenada não voltou. */
  enderecoCarregando: boolean;
  /** false quando o item nunca reportou posição — não entra no mapa. */
  temPosicao: boolean;
}

interface Props {
  linhas: LinhaSelecionada[];
  /** Voa até o item. */
  onFocar: (id: string) => void;
  /** Abre o painel de detalhe completo daquele item. */
  onDetalhe: (id: string) => void;
  /** Tira o item da seleção. */
  onRemover: (id: string) => void;
  /** Reenquadra todos os marcados. */
  onEnquadrar: () => void;
  /** Limpa a seleção inteira. */
  onLimpar: () => void;
}

/**
 * A localização escrita dos vários marcados, um bloco por item.
 *
 * Substitui o painel de detalhe quando há 2+ marcados. O detalhe mostra tudo
 * de UM; aqui a pergunta é outra — "onde estão estes?" — e a resposta precisa
 * caber junta na tela: número, identificação, estado e endereço, nada além.
 *
 * O NÚMERO é o que amarra as duas metades da tela. O mesmo número aparece na
 * etiqueta do pino: o operador vê "o 3 está longe dos outros" no mapa e acha o
 * 3 na lista sem precisar decorar placa.
 *
 * Compartilhado entre o mapa de veículos e o mapa do estoque de propósito: a
 * leitura é idêntica nas duas telas, só muda o que vai em `titulo`/`estado`,
 * que quem chama já entrega formatado.
 */
export function SelectionListPanel({
  linhas,
  onFocar,
  onDetalhe,
  onRemover,
  onEnquadrar,
  onLimpar,
}: Props) {
  return (
    <div className="flex h-full w-full flex-col glass-light border-l border-border/40 shadow-xl">
      <div className="flex items-center gap-2 border-b border-border/40 p-3">
        <h2 className="flex-1 text-sm font-bold">
          {linhas.length} marcados
        </h2>
        <button
          type="button"
          onClick={onEnquadrar}
          title="Enquadrar todos os marcados"
          className="flex items-center gap-1.5 rounded-md border border-border/50 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <Crosshair className="h-3.5 w-3.5" />
          Enquadrar
        </button>
        <button
          type="button"
          onClick={onLimpar}
          title="Desmarcar todos"
          aria-label="Desmarcar todos"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {linhas.map((linha, i) => (
          <div
            key={linha.id}
            className="group border-b border-border/25 px-3 py-2.5 transition-colors hover:bg-muted/20"
          >
            <div className="flex items-center gap-2">
              {/* O número que casa com a etiqueta do pino no mapa. */}
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-slate-950"
                style={{ backgroundColor: linha.cor }}
              >
                {i + 1}
              </span>
              <button
                type="button"
                onClick={() => onFocar(linha.id)}
                className="flex-1 truncate text-left text-sm font-semibold tracking-wide hover:underline"
                title="Centralizar no mapa"
              >
                {linha.titulo}
              </button>
              <button
                type="button"
                onClick={() => onRemover(linha.id)}
                title="Tirar da seleção"
                aria-label={`Tirar ${linha.titulo} da seleção`}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted/50 hover:text-foreground group-hover:opacity-100 focus:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div
              className="mt-0.5 ml-7 text-xs font-medium"
              style={{ color: linha.cor }}
            >
              {linha.estado}
            </div>

            {/* A localização escrita. Enquanto a busca desta coordenada não
                volta, diz que está buscando — nunca mostra o endereço de
                onde o veículo estava antes. */}
            <div className="mt-1 ml-7 flex items-start gap-1.5 text-xs text-muted-foreground">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
              <span className={cn(!linha.endereco && 'italic')}>
                {!linha.temPosicao
                  ? 'Nunca reportou posição'
                  : linha.endereco
                    ? linha.endereco
                    : linha.enderecoCarregando
                      ? 'Buscando endereço…'
                      : 'Endereço indisponível'}
              </span>
              {linha.enderecoCarregando && linha.temPosicao && (
                <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" />
              )}
            </div>

            <button
              type="button"
              onClick={() => onDetalhe(linha.id)}
              className="mt-1.5 ml-7 flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              detalhes
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
