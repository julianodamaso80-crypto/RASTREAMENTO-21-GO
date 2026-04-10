'use client';

import { CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTracking } from '@/contexts/tracking-context';
import { ALERT_TYPE_LABELS, ALERT_TYPE_COLORS } from '@/types/alert';
import { formatRelativeTime } from '@/lib/utils';

export default function AlertsPage() {
  const { alerts, unreadCount, markAlertRead, markAllAlertsRead } = useTracking();

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Alertas</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {unreadCount} não lido{unreadCount !== 1 ? 's' : ''}
            </p>
          </div>
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={markAllAlertsRead}>
              <CheckCheck className="h-4 w-4 mr-2" />
              Marcar todos como lidos
            </Button>
          )}
        </div>

        {alerts.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <p className="text-lg">Nenhum alerta registrado</p>
            <p className="text-sm mt-1">Alertas serão gerados automaticamente pelo sistema</p>
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`flex items-start gap-4 p-4 rounded-lg border transition-colors ${
                  alert.read
                    ? 'bg-muted/10 border-border/30'
                    : 'bg-muted/20 border-border/50'
                }`}
              >
                <div
                  className="w-3 h-3 rounded-full mt-1 shrink-0"
                  style={{ backgroundColor: ALERT_TYPE_COLORS[alert.type] }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge
                      variant="outline"
                      className="text-[10px]"
                      style={{
                        borderColor: ALERT_TYPE_COLORS[alert.type],
                        color: ALERT_TYPE_COLORS[alert.type],
                      }}
                    >
                      {ALERT_TYPE_LABELS[alert.type]}
                    </Badge>
                    <span className="font-semibold text-sm">{alert.vehicle?.plate}</span>
                    <span className="text-xs text-muted-foreground">
                      {alert.vehicle?.brand} {alert.vehicle?.model}
                    </span>
                  </div>
                  <p className="text-sm">{alert.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatRelativeTime(alert.createdAt)}
                  </p>
                </div>
                {!alert.read && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => markAlertRead(alert.id)}
                    className="text-xs text-muted-foreground shrink-0"
                  >
                    Marcar como lido
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
