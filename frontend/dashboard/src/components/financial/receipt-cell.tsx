'use client';

import { useRef, useState } from 'react';
import { Eye, Loader2, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { financialApi } from '@/lib/api';
import type { FinancialEntry } from '@/types/financial';

const ACEITOS = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';
const LIMITE_MB = 10;

/**
 * Comprovante do lançamento: anexa imagem ou PDF, abre numa aba e remove.
 * O arquivo exige token, então abrir é baixar o blob e apontar a aba pra ele.
 */
export function ReceiptCell({
  entry,
  onChange,
}: {
  entry: FinancialEntry;
  onChange: (entry: FinancialEntry) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const erro = (err: unknown, padrao: string) => {
    const msg =
      (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
        ?.message || padrao;
    toast.error(Array.isArray(msg) ? msg.join('. ') : msg);
  };

  const anexar = async (file: File) => {
    if (file.size > LIMITE_MB * 1024 * 1024) {
      toast.error(`O arquivo passa de ${LIMITE_MB} MB`);
      return;
    }
    setOcupado(true);
    try {
      onChange(await financialApi.anexarComprovante(entry.id, file));
      toast.success('Comprovante anexado');
    } catch (err) {
      erro(err, 'Erro ao anexar o comprovante');
    } finally {
      setOcupado(false);
    }
  };

  const abrir = async () => {
    setOcupado(true);
    try {
      const blob = await financialApi.baixarComprovante(entry.id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      // Espera a aba ler o blob antes de soltar a memória.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      erro(err, 'Erro ao abrir o comprovante');
    } finally {
      setOcupado(false);
    }
  };

  const remover = async () => {
    if (!confirm(`Remover o comprovante da placa ${entry.plate}?`)) return;
    setOcupado(true);
    try {
      onChange(await financialApi.removerComprovante(entry.id));
      toast.success('Comprovante removido');
    } catch (err) {
      erro(err, 'Erro ao remover o comprovante');
    } finally {
      setOcupado(false);
    }
  };

  const botao =
    'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors disabled:opacity-50';

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="file"
        accept={ACEITOS}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void anexar(file);
        }}
      />
      {entry.receipt ? (
        <>
          <button
            type="button"
            onClick={abrir}
            disabled={ocupado}
            title={entry.receipt.fileName}
            aria-label={`Abrir comprovante da placa ${entry.plate}`}
            className={cn(botao, 'border-brand-green-500/40 bg-brand-green-500/10 text-brand-green-600 hover:bg-brand-green-500/20')}
          >
            {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            Ver
          </button>
          <button
            type="button"
            onClick={remover}
            disabled={ocupado}
            aria-label={`Remover comprovante da placa ${entry.plate}`}
            className="rounded p-1 text-muted-foreground hover:text-red-500"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={ocupado}
          aria-label={`Anexar comprovante da placa ${entry.plate}`}
          className={cn(botao, 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground')}
        >
          {ocupado ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Paperclip className="h-3.5 w-3.5" />
          )}
          Anexar
        </button>
      )}
    </div>
  );
}
