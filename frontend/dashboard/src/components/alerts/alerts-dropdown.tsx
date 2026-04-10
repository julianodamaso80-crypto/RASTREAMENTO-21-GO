'use client';

import { Bell, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTracking } from '@/contexts/tracking-context';
import { ALERT_TYPE_LABELS, ALERT_TYPE_COLORS } from '@/types/alert';
import { formatRelativeTime } from '@/lib/utils';

export function AlertsDropdown() {
  const { alerts, unreadCount, markAlertRead, markAllAlertsRead } = useTracking();
  const recentAlerts = alerts.filter((a) => !a.read).slice(0, 8);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="relative p-2 rounded-md text-muted-foreground hover:bg-muted/50 transition-colors">
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-[10px] text-white flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm font-semibold">Alertas</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllAlertsRead}
              className="h-7 text-xs text-muted-foreground"
            >
              <CheckCheck className="h-3 w-3 mr-1" />
              Marcar todos
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />

        {recentAlerts.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhum alerta pendente
          </div>
        ) : (
          recentAlerts.map((alert) => (
            <DropdownMenuItem
              key={alert.id}
              onClick={() => markAlertRead(alert.id)}
              className="flex items-start gap-3 px-3 py-2.5 cursor-pointer"
            >
              <div
                className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                style={{ backgroundColor: ALERT_TYPE_COLORS[alert.type] }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{alert.vehicle?.plate}</span>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {formatRelativeTime(alert.createdAt)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {ALERT_TYPE_LABELS[alert.type]}: {alert.message}
                </p>
              </div>
            </DropdownMenuItem>
          ))
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem className="justify-center">
          <Link href="/alertas" className="text-xs text-emerald-400 hover:underline">
            Ver todos os alertas
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
