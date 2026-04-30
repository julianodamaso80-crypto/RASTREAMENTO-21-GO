'use client';

import type { Stop } from '@/types/report';
import { formatDateBR } from '@/lib/utils';

interface StopsTableProps {
  stops: Stop[];
}

export function StopsTable({ stops }: StopsTableProps) {
  if (stops.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">Nenhuma parada encontrada</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/30 text-muted-foreground text-xs">
            <th className="text-left py-2 px-3">Endereço</th>
            <th className="text-left py-2 px-3">Início</th>
            <th className="text-left py-2 px-3">Fim</th>
            <th className="text-right py-2 px-3">Duração</th>
          </tr>
        </thead>
        <tbody>
          {stops.map((stop, i) => (
            <tr key={i} className="border-b border-border/20 hover:bg-muted/20">
              <td className="py-2 px-3">{stop.address || `${stop.latitude.toFixed(4)}, ${stop.longitude.toFixed(4)}`}</td>
              <td className="py-2 px-3">{formatDateBR(stop.startTime)}</td>
              <td className="py-2 px-3">{formatDateBR(stop.endTime)}</td>
              <td className="py-2 px-3 text-right font-medium text-yellow-400">{stop.duration} min</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
