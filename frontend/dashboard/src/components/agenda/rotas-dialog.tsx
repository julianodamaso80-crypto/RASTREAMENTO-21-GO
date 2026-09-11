'use client';

import { useState } from 'react';
import { Eye, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SHIFT_LABEL, type OrdemServico } from '@/types/appointment';
import { diaBr, horaDoIso } from './datas';

interface Props {
  aberto: boolean;
  onFechar: () => void;
  colaborador: string;
  dia: string;
  ordens: OrdemServico[];
  onVer: (id: string) => void;
}

/**
 * "Listar rotas selecionadas": as OS do técnico no dia, em ordem de horário,
 * arrastáveis para reorganizar. "Gerar" abre a rota no Google Maps na ordem
 * da lista — igual à origem.
 */
export function RotasDialog({ aberto, onFechar, colaborador, dia, ordens, onVer }: Props) {
  // Quem abre monta o componente de novo (key), então a ordem inicial nasce aqui.
  const [ordem, setOrdem] = useState<OrdemServico[]>(() =>
    [...ordens].sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart)),
  );
  const [arrastando, setArrastando] = useState<number | null>(null);

  const soltar = (destino: number) => {
    if (arrastando === null || arrastando === destino) return;
    setOrdem((lista) => {
      const nova = [...lista];
      const [item] = nova.splice(arrastando, 1);
      nova.splice(destino, 0, item);
      return nova;
    });
    setArrastando(null);
  };

  const gerar = () => {
    const paradas = ordem
      .map((o) => (o.lat != null && o.lng != null ? `${o.lat},${o.lng}` : o.address))
      .filter((p): p is string => Boolean(p && p.trim()));
    if (!paradas.length) return;
    if (
      !window.confirm('Será criada uma rota na ordem fornecida com os endereços selecionados.')
    ) {
      return;
    }
    const caminho = paradas.map((p) => encodeURIComponent(p)).join('/');
    window.open(`https://www.google.com/maps/dir/${caminho}?travelmode=driving`, '_blank');
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Rotas de serviço</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          <strong>Colaborador:</strong> {colaborador} <span className="mx-1">•</span>
          <strong>Data:</strong> {diaBr(dia)}
        </p>
        <div className="space-y-2">
          {ordem.map((o, i) => (
            <div
              key={o.id}
              draggable
              onDragStart={() => setArrastando(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => soltar(i)}
              title="Arraste para reorganizar"
              className="flex cursor-grab items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex-1">
                <strong>Endereço</strong> <span>{o.address || 'Sem endereço'}</span> -{' '}
                <strong>Turno</strong> <span>{SHIFT_LABEL[o.shift]}</span> -{' '}
                <strong>Horário</strong> <span>{horaDoIso(o.scheduledStart)}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-7 p-0"
                title="Visualizar"
                onClick={() => onVer(o.id)}
              >
                <Eye className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={gerar} title="Gerar rota">
            Gerar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
