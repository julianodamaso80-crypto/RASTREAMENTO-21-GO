'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Copy, Check, Radio, Smartphone, Server,
  Lock, Unlock, MapPin, RotateCcw, FileText, Send, AlertTriangle,
  Shield,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { devicesApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type { Device, GeneratedCommandsResponse, SmsCommand } from '@/types/device';
import {
  DEVICE_MODEL_LABELS, DEVICE_STATUS_LABELS, DEVICE_STATUS_COLORS,
  OPERATOR_LABELS,
} from '@/types/device';

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [device, setDevice] = useState<Device | null>(null);
  const [commands, setCommands] = useState<GeneratedCommandsResponse | null>(null);
  const [history, setHistory] = useState<SmsCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingCmds, setGeneratingCmds] = useState(false);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [sendingCommand, setSendingCommand] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadDevice();
    loadHistory();
  }, [id]);

  const loadDevice = async () => {
    try {
      const d = await devicesApi.getById(id);
      setDevice(d);
    } catch {
      toast.error('Dispositivo não encontrado');
      router.push('/dispositivos');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const res = await devicesApi.getCommands(id);
      setHistory(res.data);
    } catch { /* ignore */ }
  };

  const handleGenerateCommands = async () => {
    setGeneratingCmds(true);
    try {
      const cmds = await devicesApi.generateCommands(id);
      setCommands(cmds);
    } catch {
      toast.error('Erro ao gerar comandos');
    } finally {
      setGeneratingCmds(false);
    }
  };

  const handleSendCommand = async (type: string) => {
    setSendingCommand(true);
    try {
      await devicesApi.sendCommand(id, type);
      toast.success('Comando registrado com sucesso');
      setConfirmAction(null);
      loadHistory();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro ao enviar comando');
    } finally {
      setSendingCommand(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copiado!');
  };

  const copyAllCommands = () => {
    if (!commands) return;
    const all = commands.commands
      .map((c) => `Passo ${c.step}: ${c.label}\n${c.command}`)
      .join('\n\n');
    navigator.clipboard.writeText(all);
    toast.success('Todos os comandos copiados!');
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!device) return null;

  return (
    <div className="flex flex-col h-full p-4 md:p-6 gap-4 overflow-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.push('/dispositivos')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Radio className="h-5 w-5 text-emerald-400" />
            {device.imei}
          </h1>
          <p className="text-sm text-muted-foreground">
            {DEVICE_MODEL_LABELS[device.model]}{device.brand ? ` • ${device.brand}` : ''}
          </p>
        </div>
        <Badge className={cn('ml-auto', DEVICE_STATUS_COLORS[device.status])}>
          {DEVICE_STATUS_LABELS[device.status]}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Info Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Informações do Dispositivo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <InfoRow label="IMEI" value={device.imei} mono copyable onCopy={copyToClipboard} />
            <InfoRow label="Modelo" value={DEVICE_MODEL_LABELS[device.model]} />
            {device.brand && <InfoRow label="Marca" value={device.brand} />}
            {device.serialNumber && <InfoRow label="Nº Série" value={device.serialNumber} />}
            {device.firmwareVersion && <InfoRow label="Firmware" value={device.firmwareVersion} />}
            <InfoRow label="Última Conexão" value={device.lastConnection ? formatRelativeTime(device.lastConnection) : 'Nunca'} />
            {device.installedBy && <InfoRow label="Instalado por" value={device.installedBy} />}
            {device.notes && <InfoRow label="Notas" value={device.notes} />}
          </CardContent>
        </Card>

        {/* Linked Resources */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Chip Vinculado</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {device.chip ? (
                <div className="space-y-2">
                  <InfoRow label="ICCID" value={device.chip.iccid} mono />
                  <InfoRow label="Telefone" value={device.chip.phoneNumber || '—'} />
                  <InfoRow label="Operadora" value={OPERATOR_LABELS[device.chip.operator]} />
                  <InfoRow label="APN" value={device.chip.apn} mono copyable onCopy={copyToClipboard} />
                </div>
              ) : (
                <p className="text-muted-foreground">Nenhum chip vinculado</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Veículo Vinculado</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {device.vehicle ? (
                <div className="space-y-2">
                  <InfoRow label="Placa" value={device.vehicle.plate} />
                  <InfoRow label="Veículo" value={`${device.vehicle.brand || ''} ${device.vehicle.model || ''}`.trim() || '—'} />
                </div>
              ) : (
                <p className="text-muted-foreground">Nenhum veículo vinculado</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Server Info */}
      {commands && (
        <Card className="border-emerald-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Server className="h-4 w-4 text-emerald-400" />
              Informações do Servidor
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {/* Hostname DNS (principal) */}
            {commands.serverHostname && (
              <InfoRow
                label={commands.supportsMultiIp ? 'Hostname Primário' : 'Hostname GPS'}
                value={commands.serverHostname}
                mono copyable onCopy={copyToClipboard}
                icon={<Server className="h-3 w-3 text-emerald-400" />}
              />
            )}
            {commands.supportsMultiIp && commands.backupHostname && (
              <InfoRow
                label="Hostname Backup"
                value={commands.backupHostname}
                mono copyable onCopy={copyToClipboard}
                icon={<Shield className="h-3 w-3 text-blue-400" />}
              />
            )}
            {/* IPs (fallback) */}
            <InfoRow
              label={commands.supportsMultiIp ? 'IP Primário' : 'IP do Servidor'}
              value={commands.serverIp}
              mono copyable onCopy={copyToClipboard}
              icon={<Server className="h-3 w-3 text-muted-foreground" />}
            />
            {commands.supportsMultiIp && (
              <InfoRow
                label="IP Secundário"
                value={commands.secondaryIp}
                mono copyable onCopy={copyToClipboard}
                icon={<Shield className="h-3 w-3 text-muted-foreground" />}
              />
            )}
            <InfoRow label="Porta" value={String(commands.serverPort)} mono copyable onCopy={copyToClipboard} />
            <InfoRow label="Protocolo" value={commands.protocol.toUpperCase()} />
            <p className="text-xs text-muted-foreground mt-2">
              {commands.serverHostname
                ? 'Comandos SMS usam hostname DNS — mudanças de IP não quebram rastreadores no campo'
                : commands.supportsMultiIp
                  ? 'Este rastreador suporta múltiplos servidores (primário + backup)'
                  : 'Configure seu rastreador para enviar dados para este endereço'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* SMS Commands */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-emerald-400" />
              Comandos SMS de Configuração
            </CardTitle>
            <Button size="sm" onClick={handleGenerateCommands} disabled={generatingCmds}>
              {generatingCmds ? 'Gerando...' : 'Gerar Comandos de Configuração'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!commands ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Clique em "Gerar Comandos" para ver os SMS de configuração para este rastreador
            </p>
          ) : commands.commands.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum template disponível para este modelo
            </p>
          ) : (
            <div className="space-y-3">
              {commands.commands.map((cmd, i) => (
                <CommandCard
                  key={i}
                  step={cmd.step}
                  label={cmd.label}
                  command={cmd.command}
                  phoneNumber={cmd.phoneNumber}
                  onCopy={() => copyToClipboard(cmd.command)}
                />
              ))}
              <Button
                variant="outline"
                className="w-full"
                onClick={copyAllCommands}
              >
                <Copy className="h-4 w-4 mr-2" />
                Copiar Todos os Comandos
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Remote Commands */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Send className="h-4 w-4 text-emerald-400" />
            Comandos Remotos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Button variant="destructive" size="sm" onClick={() => setConfirmAction('BLOCK')}>
              <Lock className="h-4 w-4 mr-1" /> Bloquear
            </Button>
            <Button variant="outline" size="sm" className="border-emerald-500/50 text-emerald-400" onClick={() => setConfirmAction('UNBLOCK')}>
              <Unlock className="h-4 w-4 mr-1" /> Desbloquear
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirmAction('GET_LOCATION')}>
              <MapPin className="h-4 w-4 mr-1" /> Localização
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirmAction('GET_PARAMS')}>
              <FileText className="h-4 w-4 mr-1" /> Configuração
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirmAction('RESTART')}>
              <RotateCcw className="h-4 w-4 mr-1" /> Reiniciar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Command History */}
      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Histórico de Comandos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {history.map((cmd) => (
                <div key={cmd.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30 text-sm">
                  <Badge variant="outline" className="text-xs shrink-0">{cmd.type}</Badge>
                  <code className="text-xs font-mono text-muted-foreground truncate flex-1">{cmd.command}</code>
                  <Badge className={cn('text-xs', cmd.status === 'RESPONDED' ? 'bg-emerald-500/20 text-emerald-400' : cmd.status === 'FAILED' ? 'bg-red-500/20 text-red-400' : 'bg-slate-500/20 text-slate-400')}>
                    {cmd.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground shrink-0">{formatRelativeTime(cmd.createdAt)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirm Dialog */}
      <Dialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {(confirmAction === 'BLOCK' || confirmAction === 'FACTORY_RESET') && (
                <AlertTriangle className="h-5 w-5 text-red-400" />
              )}
              Confirmar Comando
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja enviar o comando <strong>{confirmAction}</strong> para o dispositivo <strong>{device.imei}</strong>?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancelar</Button>
            <Button
              variant={confirmAction === 'BLOCK' ? 'destructive' : 'default'}
              onClick={() => confirmAction && handleSendCommand(confirmAction)}
              disabled={sendingCommand}
            >
              {sendingCommand ? 'Enviando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CommandCard({
  step, label, command, phoneNumber, onCopy,
}: {
  step: number; label: string; command: string; phoneNumber: string; onCopy: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border bg-slate-900/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          Passo {step}: {label}
        </span>
      </div>
      {phoneNumber && (
        <p className="text-xs text-muted-foreground">
          📱 Envie para: <span className="text-foreground">{phoneNumber}</span>
        </p>
      )}
      <div className="flex items-center gap-2">
        <code className="flex-1 text-sm font-mono bg-slate-950 rounded px-3 py-2 text-emerald-400 overflow-x-auto">
          {command}
        </code>
        <Button variant="ghost" size="icon-sm" onClick={handleCopy}>
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

function InfoRow({
  label, value, mono, copyable, onCopy, icon,
}: {
  label: string; value: string; mono?: boolean; copyable?: boolean; onCopy?: (v: string) => void; icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className={cn('flex items-center gap-1', mono && 'font-mono text-xs')}>
        {value}
        {copyable && onCopy && (
          <button onClick={() => onCopy(value)} className="text-muted-foreground hover:text-emerald-400 transition-colors">
            <Copy className="h-3 w-3" />
          </button>
        )}
      </span>
    </div>
  );
}
