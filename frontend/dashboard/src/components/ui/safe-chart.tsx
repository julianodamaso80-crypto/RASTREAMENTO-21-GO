'use client';

import { useEffect, useState, type ReactNode } from 'react';

// Recharts 3.x + React 19: ResponsiveContainer mede o pai via ResizeObserver
// durante a hidratação e às vezes pega width(-1)/height(-1) no primeiro tick,
// gerando warning no console. Esperar um frame antes de renderizar o chart
// evita a corrida — quando o filho monta, o layout já estabilizou.
export function SafeChart({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  if (!ready) return null;
  return <>{children}</>;
}
