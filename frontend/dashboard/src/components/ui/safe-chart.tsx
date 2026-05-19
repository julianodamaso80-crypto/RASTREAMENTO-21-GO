'use client';

import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';

interface SafeChartProps {
  // Recharts chart raíz: LineChart, PieChart, BarChart, AreaChart, etc.
  children: ReactElement<{ width?: number; height?: number }>;
}

// Substitui ResponsiveContainer do Recharts. O ResponsiveContainer
// nativo dispara warning "width(-1) height(-1)" no primeiro tick com
// React 19, porque mede o pai antes do layout. Aqui usamos um
// ResizeObserver próprio e só renderizamos o chart quando o pai já
// tem dimensões válidas — Recharts nunca vê valores negativos.
export function SafeChart({ children }: SafeChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const cr = entry.contentRect;
      if (cr.width > 0 && cr.height > 0) {
        setSize({ w: Math.floor(cr.width), h: Math.floor(cr.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="h-full w-full">
      {size.w > 0 && size.h > 0 && isValidElement(children)
        ? cloneElement(children, { width: size.w, height: size.h })
        : null}
    </div>
  );
}
