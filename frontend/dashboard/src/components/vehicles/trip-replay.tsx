'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, FastForward } from 'lucide-react';
import { analyticsApi, type ReplayEvent, type ReplayPosition } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface TripReplayProps {
  vehicleId: string;
  from: string;
  to: string;
  onPositionChange?: (pos: ReplayPosition | null) => void;
}

const SPEEDS = [1, 2, 4, 8, 16];
const TICK_MS = 200;

export function TripReplay({ vehicleId, from, to, onPositionChange }: TripReplayProps) {
  const [positions, setPositions] = useState<ReplayPosition[]>([]);
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setIndex(0);
    analyticsApi
      .getReplay(vehicleId, from, to)
      .then((r) => {
        if (cancelled) return;
        setPositions(r.positions);
        setEvents(r.events);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Falha ao carregar replay');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vehicleId, from, to]);

  useEffect(() => {
    onPositionChange?.(positions[index] ?? null);
  }, [index, positions, onPositionChange]);

  useEffect(() => {
    if (!playing) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    timerRef.current = setInterval(() => {
      setIndex((i) => {
        const next = i + speed;
        if (next >= positions.length - 1) {
          setPlaying(false);
          return positions.length - 1;
        }
        return next;
      });
    }, TICK_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, speed, positions.length]);

  const cycleSpeed = useCallback(() => {
    const idx = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
  }, [speed]);

  const currentPos = positions[index];
  const currentTime = currentPos ? new Date(currentPos.deviceTime) : null;
  const eventMarkers = useMemo(() => {
    return events.map((e) => {
      const eventMs = new Date(e.createdAt).getTime();
      if (positions.length < 2) return { ...e, ratio: 0 };
      const startMs = new Date(positions[0].deviceTime).getTime();
      const endMs = new Date(positions[positions.length - 1].deviceTime).getTime();
      const span = endMs - startMs;
      return { ...e, ratio: span > 0 ? (eventMs - startMs) / span : 0 };
    });
  }, [events, positions]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Replay de viagem</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <div className="text-sm text-muted-foreground py-4">Carregando…</div>}
        {error && <div className="text-sm text-destructive py-4">{error}</div>}
        {!loading && !error && positions.length === 0 && (
          <div className="text-sm text-muted-foreground py-4">
            Sem posições registradas no período selecionado.
          </div>
        )}
        {!loading && !error && positions.length > 0 && (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="tabular-nums">
                {currentTime?.toLocaleString('pt-BR') ?? '—'}
              </span>
              <Badge variant="outline" className="tabular-nums">
                {currentPos?.speed.toFixed(0) ?? '0'} km/h
              </Badge>
            </div>
            <div className="relative">
              <Slider
                value={[index]}
                min={0}
                max={positions.length - 1}
                step={1}
                onValueChange={(v) => setIndex(v[0])}
              />
              <div className="absolute inset-x-0 -top-1 pointer-events-none">
                {eventMarkers.map((e, i) => (
                  <div
                    key={i}
                    title={`${e.type}: ${e.message}`}
                    className="absolute h-2 w-2 -translate-x-1/2 rounded-full bg-amber-500"
                    style={{ left: `${e.ratio * 100}%` }}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="icon" variant="outline" onClick={() => setPlaying((p) => !p)}>
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button size="sm" variant="outline" onClick={cycleSpeed} className="gap-1">
                <FastForward className="h-3.5 w-3.5" /> {speed}x
              </Button>
              <span className="text-xs text-muted-foreground ml-auto">
                {index + 1} / {positions.length} · {events.length} eventos
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
