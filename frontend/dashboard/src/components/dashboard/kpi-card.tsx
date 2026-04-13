'use client';

import type { LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info';

const toneClasses: Record<Tone, { icon: string; accent: string; border: string }> = {
  default: { icon: 'text-foreground', accent: 'text-foreground', border: 'ring-foreground/10' },
  success: { icon: 'text-emerald-400', accent: 'text-emerald-400', border: 'ring-emerald-500/20' },
  warning: { icon: 'text-amber-400', accent: 'text-amber-400', border: 'ring-amber-500/20' },
  danger: { icon: 'text-red-400', accent: 'text-red-400', border: 'ring-red-500/20' },
  info: { icon: 'text-blue-400', accent: 'text-blue-400', border: 'ring-blue-500/20' },
};

interface KpiCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: Tone;
  suffix?: string;
  hint?: string;
  tooltipContent?: React.ReactNode;
  href?: string;
  loading?: boolean;
  emptyLabel?: string;
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  tone = 'default',
  suffix,
  hint,
  tooltipContent,
  href,
  loading,
  emptyLabel,
}: KpiCardProps) {
  const router = useRouter();
  const t = toneClasses[tone];
  const isEmpty = !loading && (value === 0 || value === '0');

  if (loading) {
    return (
      <Card className={cn('ring-1', t.border)}>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-24" />
        </CardContent>
      </Card>
    );
  }

  const content = (
    <Card
      className={cn(
        'ring-1 transition-all duration-200',
        t.border,
        href && 'cursor-pointer hover:ring-2 hover:scale-[1.01]',
      )}
      onClick={href ? () => router.push(href) : undefined}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
            {label}
          </p>
          <Icon className={cn('h-4 w-4 shrink-0', t.icon)} />
        </div>
        <div className="mt-2 flex items-baseline gap-1">
          <span className={cn('text-3xl font-bold tabular-nums', t.accent)}>
            {isEmpty && emptyLabel ? '—' : value}
          </span>
          {!isEmpty && suffix && (
            <span className="text-xs text-muted-foreground">{suffix}</span>
          )}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground min-h-[14px]">
          {isEmpty && emptyLabel ? emptyLabel : hint}
        </p>
      </CardContent>
    </Card>
  );

  if (tooltipContent) {
    return (
      <Tooltip>
        <TooltipTrigger render={<div />}>{content}</TooltipTrigger>
        <TooltipContent side="top">{tooltipContent}</TooltipContent>
      </Tooltip>
    );
  }
  return content;
}
