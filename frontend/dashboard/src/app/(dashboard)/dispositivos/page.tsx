'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, Search, Radio, Copy, Check, Wifi, WifiOff, Cpu, Settings2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { devicesApi, chipsApi, vehiclesApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectNative } from '@/components/ui/select-native';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { Device, Chip, DeviceModel, DeviceStatus } from '@/types/device';
import type { Vehicle } from '@/types/vehicle';
import {
  DEVICE_MODEL_LABELS, DEVICE_STATUS_LABELS, DEVICE_STATUS_COLORS,
  OPERATOR_LABELS,
} from '@/types/device';

const DEVICE_MODELS: DeviceModel[] = [
  'GT06N', 'GT06', 'CONCOX_GT06N', 'J16', 'J16_PRO',
  'CRX3', 'CRX3_NANO', 'CRX_PRO_4G',
  'ST310U', 'ST340', 'ST350',
  'TK103', 'TK303', 'COBAN_GPS103',
  'FMB920', 'FMB120',
  'SINOTRACK_ST901', 'SINOTRACK_ST905', 'OTHER',
];

export default function DispositivosPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  // Create form
  const [formImei, setFormImei] = useState('');
  const [formModel, setFormModel] = useState<DeviceModel>('GT06N');
  const [formBrand, setFormBrand] = useState('');
  const [formSerial, setFormSerial] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formVehicleId, setFormVehicleId] = useState('');
  const [formChipId, setFormChipId] = useState('');
  const [creating, setCreating] = useState(false);

  // Available vehicles/chips for linking
  const [availableVehicles, setAvailableVehicles] = useState<Vehicle[]>([]);
  const [availableChips, setAvailableChips] = useState<Chip[]>([]);

  const loadDevices = useCallback(async () => {
    try {
      const params: Record<string, string | number> = {};
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (modelFilter) params.model = modelFilter;
      const res = await devicesApi.getAll(params);
      setDevices(res.data);
    } catch {
      toast.error('Erro ao carregar dispositivos');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, modelFilter]);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  const loadAvailableResources = async () => {
    try {
      const [v, c] = await Promise.all([
        vehiclesApi.getAll({ perPage: 200 }),
        chipsApi.getAll({ perPage: 200 }),
      ]);
      setAvailableVehicles(v.data);
      setAvailableChips(c.data.filter((ch: Chip) => !ch.device));
    } catch { /* ignore */ }
  };

  const handleCreate = async () => {
    if (!formImei || formImei.length !== 15) {
      toast.error('IMEI deve ter 15 dígitos');
      return;
    }
    setCreating(true);
    try {
      await devicesApi.create({
        imei: formImei,
        model: formModel,
        brand: formBrand || undefined,
        serialNumber: formSerial || undefined,
        notes: formNotes || undefined,
        vehicleId: formVehicleId || undefined,
        chipId: formChipId || undefined,
      } as any);
      toast.success('Dispositivo cadastrado com sucesso');
      setShowCreate(false);
      resetForm();
      loadDevices();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro ao cadastrar dispositivo');
    } finally {
      setCreating(false);
    }
  };

  const resetForm = () => {
    setFormImei(''); setFormModel('GT06N'); setFormBrand('');
    setFormSerial(''); setFormNotes(''); setFormVehicleId(''); setFormChipId('');
  };

  const statuses: DeviceStatus[] = [
    'PENDING_INSTALL', 'INSTALLED', 'CONFIGURING', 'ONLINE', 'OFFLINE', 'MAINTENANCE', 'DEACTIVATED',
  ];

  return (
    <div className="flex flex-col h-full p-4 md:p-6 gap-4 overflow-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Radio className="h-5 w-5 text-emerald-400" />
            Dispositivos
          </h1>
          <p className="text-sm text-muted-foreground">Rastreadores e chips M2M</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => router.push('/chips')}>
            <Cpu className="h-4 w-4 mr-1" /> Chips M2M
          </Button>
          <Button size="sm" onClick={() => { setShowCreate(true); loadAvailableResources(); }}>
            <Plus className="h-4 w-4 mr-1" /> Novo Dispositivo
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Buscar por IMEI ou placa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="sm:w-48">
          <SelectNative value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Todos os status</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{DEVICE_STATUS_LABELS[s]}</option>
            ))}
          </SelectNative>
        </div>
        <div className="sm:w-48">
          <SelectNative value={modelFilter} onChange={(e) => setModelFilter(e.target.value)}>
            <option value="">Todos os modelos</option>
            {DEVICE_MODELS.map((m) => (
              <option key={m} value={m}>{DEVICE_MODEL_LABELS[m]}</option>
            ))}
          </SelectNative>
        </div>
      </div>

      {/* Table / Cards */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        </div>
      ) : devices.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Radio className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhum dispositivo encontrado</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {devices.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              onClick={() => router.push(`/dispositivos/${device.id}`)}
            />
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg">Novo Dispositivo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="dev-imei" required>IMEI</Label>
              <Input
                id="dev-imei"
                placeholder="000000000000000"
                value={formImei}
                onChange={(e) => setFormImei(e.target.value.replace(/\D/g, '').slice(0, 15))}
                className="font-mono"
                maxLength={15}
              />
              <p className="text-xs text-muted-foreground">{formImei.length}/15 dígitos</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dev-model" required>Modelo</Label>
              <SelectNative
                id="dev-model"
                value={formModel}
                onChange={(e) => setFormModel(e.target.value as DeviceModel)}
              >
                {DEVICE_MODELS.map((m) => (
                  <option key={m} value={m}>{DEVICE_MODEL_LABELS[m]}</option>
                ))}
              </SelectNative>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="dev-brand">Marca</Label>
                <Input id="dev-brand" value={formBrand} onChange={(e) => setFormBrand(e.target.value)} placeholder="Concox, Suntech..." />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dev-serial">Nº de Série</Label>
                <Input id="dev-serial" value={formSerial} onChange={(e) => setFormSerial(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dev-vehicle">Vincular a Veículo</Label>
              <SelectNative
                id="dev-vehicle"
                value={formVehicleId}
                onChange={(e) => setFormVehicleId(e.target.value)}
              >
                <option value="">Nenhum</option>
                {availableVehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.plate} - {v.brand} {v.model}</option>
                ))}
              </SelectNative>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dev-chip">Vincular Chip</Label>
              <SelectNative
                id="dev-chip"
                value={formChipId}
                onChange={(e) => setFormChipId(e.target.value)}
              >
                <option value="">Nenhum</option>
                {availableChips.map((c) => (
                  <option key={c.id} value={c.id}>{c.iccid} ({OPERATOR_LABELS[c.operator]})</option>
                ))}
              </SelectNative>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dev-notes">Notas</Label>
              <Textarea
                id="dev-notes"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Observações..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating || formImei.length !== 15}>
              {creating ? 'Cadastrando...' : 'Cadastrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeviceRow({ device, onClick }: { device: Device; onClick: () => void }) {
  const [copied, setCopied] = useState(false);

  const copyImei = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(device.imei);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-4 p-3 rounded-lg border bg-card hover:bg-muted/30 cursor-pointer transition-colors"
    >
      <div className="shrink-0">
        {device.status === 'ONLINE' ? (
          <Wifi className="h-5 w-5 text-emerald-400" />
        ) : device.status === 'OFFLINE' ? (
          <WifiOff className="h-5 w-5 text-red-400" />
        ) : (
          <Radio className="h-5 w-5 text-muted-foreground" />
        )}
      </div>

      <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-5 gap-1 sm:gap-4 items-center">
        <div>
          <button onClick={copyImei} className="flex items-center gap-1 font-mono text-sm hover:text-emerald-400 transition-colors">
            {device.imei}
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 opacity-40" />}
          </button>
          <p className="text-xs text-muted-foreground">{DEVICE_MODEL_LABELS[device.model]}{device.brand ? ` • ${device.brand}` : ''}</p>
        </div>

        <div>
          <Badge className={cn('text-xs', DEVICE_STATUS_COLORS[device.status])}>
            {DEVICE_STATUS_LABELS[device.status]}
          </Badge>
        </div>

        <div className="text-sm">
          {device.vehicle ? (
            <span className="text-foreground font-medium">{device.vehicle.plate}</span>
          ) : (
            <span className="text-muted-foreground text-xs">Não vinculado</span>
          )}
        </div>

        <div className="text-sm">
          {device.chip ? (
            <span className="text-foreground">{OPERATOR_LABELS[device.chip.operator]}</span>
          ) : (
            <span className="text-muted-foreground text-xs">Sem chip</span>
          )}
        </div>

        <div className="text-xs text-muted-foreground">
          {device.lastConnection ? formatRelativeTime(device.lastConnection) : 'Nunca conectou'}
        </div>
      </div>

      <Settings2 className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
    </div>
  );
}
