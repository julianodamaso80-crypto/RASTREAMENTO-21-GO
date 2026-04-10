'use client';

import { useEffect, useState } from 'react';
import {
  Settings, Server, Radio, Copy, Check, Wifi, WifiOff, Globe, Shield, Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { serverApi, chipsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { ServerInfo, OperatorApn } from '@/types/device';

export default function ConfiguracoesPage() {
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [operators, setOperators] = useState<OperatorApn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      serverApi.getInfo().catch(() => null),
      chipsApi.getOperators().catch(() => []),
    ]).then(([info, ops]) => {
      setServerInfo(info);
      setOperators(ops);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-4 md:p-6 gap-4 overflow-auto">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Settings className="h-5 w-5 text-emerald-400" />
          Configurações
        </h1>
        <p className="text-sm text-muted-foreground">Servidor de rastreamento e referências</p>
      </div>

      {/* Servidores (3 IPs) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Server className="h-4 w-4 text-emerald-400" />
            Servidores
          </CardTitle>
        </CardHeader>
        <CardContent>
          {serverInfo ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <ServerIpCard
                  label="IP Primário"
                  description="Servidor principal do Traccar"
                  ip={serverInfo.primaryIp}
                  icon={<Server className="h-4 w-4 text-emerald-400" />}
                />
                <ServerIpCard
                  label="IP Secundário"
                  description="Backup / failover"
                  ip={serverInfo.secondaryIp}
                  icon={<Shield className="h-4 w-4 text-blue-400" />}
                />
                <ServerIpCard
                  label="IP Manutenção"
                  description="Acesso técnico remoto"
                  ip={serverInfo.maintenanceIp}
                  icon={<Wrench className="h-4 w-4 text-orange-400" />}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <InfoCard
                  label="Status Traccar"
                  value={serverInfo.traccar.status === 'online' ? 'Online' : 'Offline'}
                  icon={serverInfo.traccar.status === 'online' ? (
                    <Wifi className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <WifiOff className="h-4 w-4 text-red-400" />
                  )}
                />
                <InfoCard
                  label="Versão Traccar"
                  value={serverInfo.traccar.version}
                />
                <InfoCard
                  label="Protocolos Ativos"
                  value={`${serverInfo.ports.length} protocolos`}
                  icon={<Globe className="h-4 w-4 text-blue-400" />}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Não foi possível obter informações do servidor</p>
          )}
        </CardContent>
      </Card>

      {/* Ports by Protocol */}
      {serverInfo && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Radio className="h-4 w-4 text-emerald-400" />
              Portas por Protocolo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-2 text-muted-foreground font-medium">Protocolo</th>
                    <th className="text-left py-2 text-muted-foreground font-medium">Porta</th>
                    <th className="text-left py-2 text-muted-foreground font-medium">Modelos Compatíveis</th>
                    <th className="text-left py-2 text-muted-foreground font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {serverInfo.ports.map((port) => (
                    <tr key={port.port} className="border-b border-border/30">
                      <td className="py-2.5 font-medium">{port.protocol}</td>
                      <td className="py-2.5">
                        <CopyableText value={String(port.port)} mono />
                      </td>
                      <td className="py-2.5 text-muted-foreground">
                        {port.models.join(', ')}
                      </td>
                      <td className="py-2.5">
                        <Badge className="bg-emerald-500/20 text-emerald-400 text-xs">
                          Ativo
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* APN Reference */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Globe className="h-4 w-4 text-emerald-400" />
            APNs por Operadora
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 text-muted-foreground font-medium">Operadora</th>
                  <th className="text-left py-2 text-muted-foreground font-medium">APN</th>
                  <th className="text-left py-2 text-muted-foreground font-medium">Usuário</th>
                  <th className="text-left py-2 text-muted-foreground font-medium">Senha</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {operators.flatMap((op) =>
                  op.apns.map((apn, i) => (
                    <tr key={`${op.operator}-${i}`} className="border-b border-border/30">
                      <td className="py-2.5 font-medium">
                        {i === 0 ? op.operator : ''}
                      </td>
                      <td className="py-2.5">
                        <CopyableText value={apn.apn} mono />
                      </td>
                      <td className="py-2.5">
                        <CopyableText value={apn.user} mono />
                      </td>
                      <td className="py-2.5">
                        <CopyableText value={apn.pass} mono />
                      </td>
                      <td className="py-2.5">
                        <CopyButton
                          text={`APN: ${apn.apn}\nUser: ${apn.user}\nPass: ${apn.pass}`}
                        />
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InfoCard({
  label, value, mono, copyable, icon,
}: {
  label: string; value: string; mono?: boolean; copyable?: boolean; icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="flex items-center gap-2">
        {icon}
        {copyable ? (
          <CopyableText value={value} mono={mono} large />
        ) : (
          <span className={cn('text-lg font-semibold', mono && 'font-mono')}>{value}</span>
        )}
      </div>
    </div>
  );
}

function CopyableText({ value, mono, large }: { value: string; mono?: boolean; large?: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success('Copiado!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copy}
      className={cn(
        'flex items-center gap-1 hover:text-emerald-400 transition-colors',
        mono && 'font-mono',
        large ? 'text-lg font-semibold' : 'text-sm',
      )}
    >
      {value}
      {copied ? (
        <Check className="h-3 w-3 text-emerald-400" />
      ) : (
        <Copy className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copiado!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="ghost" size="icon-xs" onClick={copy}>
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

function ServerIpCard({
  label, description, ip, icon,
}: {
  label: string; description: string; ip: string; icon: React.ReactNode;
}) {
  const isConfigured = ip && ip !== '0.0.0.0';

  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-1">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-xs font-medium">{label}</p>
        <Badge className={cn(
          'ml-auto text-[10px]',
          isConfigured
            ? 'bg-emerald-500/20 text-emerald-400'
            : 'bg-slate-500/20 text-slate-400',
        )}>
          {isConfigured ? 'Configurado' : 'Não configurado'}
        </Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">{description}</p>
      <CopyableText value={ip} mono large />
    </div>
  );
}
