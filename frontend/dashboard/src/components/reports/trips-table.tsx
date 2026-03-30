'use client';

import type { Trip } from '@/types/report';

interface TripsTableProps {
  trips: Trip[];
}

export function TripsTable({ trips }: TripsTableProps) {
  if (trips.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">Nenhuma viagem encontrada</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/30 text-muted-foreground text-xs">
            <th className="text-left py-2 px-3">Início</th>
            <th className="text-left py-2 px-3">Fim</th>
            <th className="text-right py-2 px-3">Duração</th>
            <th className="text-right py-2 px-3">Distância</th>
            <th className="text-right py-2 px-3">Vel. Média</th>
            <th className="text-right py-2 px-3">Vel. Máx</th>
          </tr>
        </thead>
        <tbody>
          {trips.map((trip, i) => (
            <tr key={i} className="border-b border-border/20 hover:bg-muted/20">
              <td className="py-2 px-3">{new Date(trip.startTime).toLocaleString('pt-BR')}</td>
              <td className="py-2 px-3">{new Date(trip.endTime).toLocaleString('pt-BR')}</td>
              <td className="py-2 px-3 text-right">{trip.duration} min</td>
              <td className="py-2 px-3 text-right">{trip.distance} km</td>
              <td className="py-2 px-3 text-right">{trip.avgSpeed} km/h</td>
              <td className="py-2 px-3 text-right font-medium text-emerald-400">{trip.maxSpeed} km/h</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
