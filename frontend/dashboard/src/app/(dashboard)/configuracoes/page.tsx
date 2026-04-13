'use client';

import { useEffect, useState } from 'react';
import {
  Settings, Server, Radio, Copy, Check, Wifi, WifiOff, Globe, Shield,
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
    <div className="flex flex-col h-full p-4 md:p-8 gap-6 overflow-auto max-w-6xl mx-auto w-full">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-brand-orange-500/10 border border-brand-orange-500/20">
          <Settings className="h-5 w-5 text-brand-orange-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Configurações</h1>
          <p className="text-sm text-muted-foreground">Servidor de rastreamento e referências técnicas</p>
        </div>
      </div>

      {/* Servidores (Hostnames DNS + IPs) */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Server className="h-4 w-4 text-brand-orange-500" />
            Servidores GPS
          </CardTitle>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
            <Globe className="h-3 w-3" />
            2 servidores ativos com failover automático no rastreador
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {serverInfo ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ServerAddressCard
                  label="Servidor Primário"
                  description="SERVER,1 nos rastreadores"
                  hostname={serverInfo.hostname}
                  ip={serverInfo.primaryIp}
                  icon={<Server className="h-4 w-4 text-brand-orange-500" />}
                />
                <ServerAddressCard
                  label="Servidor Backup"
                  description="SERVER,2 — failover automático"
                  hostname={serverInfo.backupHostname}
                  ip={serverInfo.secondaryIp}
                  icon={<Shield className="h-4 w-4 text-brand-blue-400" />}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <InfoCard
                  label="Status Traccar"
                  value={serverInfo.traccar.status === 'online' ? 'Online' : 'Offline'}
                  icon={serverInfo.traccar.status === 'online' ? (
                    <Wifi className="h-4 w-4 text-brand-green-500" />
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
                  icon={<Globe className="h-4 w-4 text-brand-blue-400" />}
                />
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Não foi possível obter informações do servidor</p>
          )}
        </CardContent>
      </Card>

      {/* Ports by Protocol */}
      {serverInfo && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Radio className="h-4 w-4 text-brand-orange-500" />
              Portas por Protocolo
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Portas TCP abertas para recepção de dados dos rastreadores
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border border-border/40">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/20">
                    <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Protocolo</th>
                    <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Porta</th>
                    <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Modelos Compatíveis</th>
                    <th className="text-right px-4 py-2.5 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {serverInfo.ports.map((port) => (
                    <tr key={port.port} className="border-b border-border/20 last:border-b-0 hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-3 font-semibold">{port.protocol}</td>
                      <td className="px-4 py-3">
                        <CopyableText value={String(port.port)} mono />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {port.models.join(', ')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Badge className="bg-brand-green-500/15 text-brand-green-500 hover:bg-brand-green-500/15 text-[10px] font-semibold">
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
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Globe className="h-4 w-4 text-brand-orange-500" />
            APNs por Operadora
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Configuração de APN para chips M2M (clique para copiar)
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border border-border/40">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/20">
                  <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Operadora</th>
                  <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-muted-foreground font-semibold">APN</th>
                  <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Usuário</th>
                  <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Senha</th>
                  <th className="px-4 py-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {operators.flatMap((op) =>
                  op.apns.map((apn, i) => (
                    <tr key={`${op.operator}-${i}`} className="border-b border-border/20 last:border-b-0 hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-3 font-semibold">
                        {i === 0 ? op.operator : ''}
                      </td>
                      <td className="px-4 py-3">
                        <CopyableText value={apn.apn} mono />
                      </td>
                      <td className="px-4 py-3">
                        <CopyableText value={apn.user} mono />
                      </td>
                      <td className="px-4 py-3">
                        <CopyableText value={apn.pass} mono />
                      </td>
                      <td className="px-4 py-3 text-right">
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
    <div className="rounded-lg border border-border/40 bg-muted/10 p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">{label}</p>
      <div className="flex items-center gap-2">
        {icon}
        {copyable ? (
          <CopyableText value={value} mono={mono} large />
        ) : (
          <span className={cn('text-base font-semibold text-foreground', mono && 'font-mono')}>{value}</span>
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
        'group inline-flex items-center gap-1.5 hover:text-brand-orange-500 transition-colors',
        mono && 'font-mono',
        large ? 'text-base font-semibold' : 'text-sm',
      )}
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <Check className="h-3 w-3 shrink-0 text-brand-green-500" />
      ) : (
        <Copy className="h-3 w-3 shrink-0 opacity-30 group-hover:opacity-70 transition-opacity" />
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
      {copied ? <Check className="h-3 w-3 text-brand-green-500" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

function ServerAddressCard({
  label, description, hostname, ip, icon,
}: {
  label: string; description: string; hostname: string; ip: string; icon: React.ReactNode;
}) {
  const hasHostname = !!hostname;
  const hasIp = ip && ip !== '0.0.0.0';
  const isConfigured = hasHostname || hasIp;

  return (
    <div className="rounded-xl border border-border/40 bg-muted/10 p-5 hover:border-brand-orange-500/30 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <div className="shrink-0 mt-0.5">{icon}</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground leading-snug">{label}</p>
            <p className="text-[11px] text-muted-foreground leading-snug mt-1">{description}</p>
          </div>
        </div>
        <Badge className={cn(
          'shrink-0 text-[10px] font-semibold',
          isConfigured
            ? hasHostname
              ? 'bg-brand-green-500/15 text-brand-green-500 hover:bg-brand-green-500/15'
              : 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/20'
            : 'bg-slate-500/20 text-slate-400 hover:bg-slate-500/20',
        )}>
          {isConfigured ? (hasHostname ? 'DNS' : 'Só IP') : 'Não configurado'}
        </Badge>
      </div>
      <div className="space-y-2.5">
        {hasHostname && (
          <div className="rounded-lg bg-background/50 px-4 py-3 border border-border/30 overflow-hidden">
            <CopyableText value={hostname} mono large />
          </div>
        )}
        {hasIp && (
          <div className="flex items-center gap-2 px-1 overflow-hidden">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">IP</span>
            <CopyableText value={ip} mono />
          </div>
        )}
      </div>
    </div>
  );
}
