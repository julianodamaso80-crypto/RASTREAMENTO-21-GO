'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Search, Cpu, CardSim, Copy, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { chipsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { Chip, ChipOperator, OperatorApn } from '@/types/device';
import {
  CHIP_STATUS_LABELS, CHIP_STATUS_COLORS, OPERATOR_LABELS,
} from '@/types/device';

const OPERATORS: ChipOperator[] = ['VIVO', 'CLARO', 'TIM', 'OI', 'MULTI_OPERATOR'];
const PROVIDERS = ['Voxter', 'Datatem', 'Allcom', 'TrackPlus', 'Sigmais', 'Arqia', 'LinkField', 'Outro'];

export default function ChipsPage() {
  const [chips, setChips] = useState<Chip[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [operatorFilter, setOperatorFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [operatorApns, setOperatorApns] = useState<OperatorApn[]>([]);

  // Form
  const [formIccid, setFormIccid] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formOperator, setFormOperator] = useState<ChipOperator>('VIVO');
  const [formApn, setFormApn] = useState('smart.m2m.vivo.com.br');
  const [formApnUser, setFormApnUser] = useState('vivo');
  const [formApnPass, setFormApnPass] = useState('vivo');
  const [formApnType, setFormApnType] = useState('PRIVATE');
  const [formDataPlan, setFormDataPlan] = useState(50);
  const [formProvider, setFormProvider] = useState('');
  const [formActivatedAt, setFormActivatedAt] = useState('');
  const [formExpiresAt, setFormExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);

  const loadChips = useCallback(async () => {
    try {
      const params: Record<string, string | number> = {};
      if (search) params.search = search;
      if (operatorFilter) params.operator = operatorFilter;
      if (statusFilter) params.status = statusFilter;
      const res = await chipsApi.getAll(params);
      setChips(res.data);
    } catch {
      toast.error('Erro ao carregar chips');
    } finally {
      setLoading(false);
    }
  }, [search, operatorFilter, statusFilter]);

  useEffect(() => { loadChips(); }, [loadChips]);

  useEffect(() => {
    chipsApi.getOperators().then(setOperatorApns).catch(() => {});
  }, []);

  // Auto-fill APN baseado na operadora
  const handleOperatorChange = (op: ChipOperator) => {
    setFormOperator(op);
    const opData = operatorApns.find((o) => o.operator === op);
    if (opData && opData.apns.length > 0) {
      setFormApn(opData.apns[0].apn);
      setFormApnUser(opData.apns[0].user);
      setFormApnPass(opData.apns[0].pass);
    }
  };

  const handleCreate = async () => {
    if (!formIccid || formIccid.length < 19) {
      toast.error('ICCID deve ter 19 ou 20 dígitos');
      return;
    }
    setCreating(true);
    try {
      await chipsApi.create({
        iccid: formIccid,
        phoneNumber: formPhone || undefined,
        operator: formOperator,
        apn: formApn,
        apnUser: formApnUser || undefined,
        apnPassword: formApnPass || undefined,
        apnType: formApnType as any,
        dataPlanMb: formDataPlan,
        provider: formProvider || undefined,
        activatedAt: formActivatedAt || undefined,
        expiresAt: formExpiresAt || undefined,
      } as any);
      toast.success('Chip cadastrado com sucesso');
      setShowCreate(false);
      loadChips();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro ao cadastrar chip');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col h-full p-4 md:p-6 gap-4 overflow-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Cpu className="h-5 w-5 text-emerald-400" />
            Chips M2M
          </h1>
          <p className="text-sm text-muted-foreground">Gestão de chips e linhas de dados</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" /> Novo Chip
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por ICCID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8"
          />
        </div>
        <select
          value={operatorFilter}
          onChange={(e) => setOperatorFilter(e.target.value)}
          className="h-8 rounded-lg border bg-transparent px-3 text-sm"
        >
          <option value="">Todas operadoras</option>
          {OPERATORS.map((op) => (
            <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-8 rounded-lg border bg-transparent px-3 text-sm"
        >
          <option value="">Todos status</option>
          <option value="ACTIVE">Ativo</option>
          <option value="SUSPENDED">Suspenso</option>
          <option value="EXPIRED">Expirado</option>
          <option value="BLOCKED">Bloqueado</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        </div>
      ) : chips.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Cpu className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhum chip encontrado</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {chips.map((chip) => (
            <ChipRow key={chip.id} chip={chip} />
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo Chip M2M</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">ICCID *</label>
              <Input
                placeholder="89550110000000000012"
                value={formIccid}
                onChange={(e) => setFormIccid(e.target.value.replace(/\D/g, '').slice(0, 20))}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1">{formIccid.length}/20 dígitos</p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Telefone</label>
              <Input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} placeholder="11999887766" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Operadora *</label>
              <select
                value={formOperator}
                onChange={(e) => handleOperatorChange(e.target.value as ChipOperator)}
                className="w-full h-8 rounded-lg border bg-transparent px-3 text-sm"
              >
                {OPERATORS.map((op) => (
                  <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">APN *</label>
              <Input value={formApn} onChange={(e) => setFormApn(e.target.value)} className="font-mono text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Usuário APN</label>
                <Input value={formApnUser} onChange={(e) => setFormApnUser(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Senha APN</label>
                <Input value={formApnPass} onChange={(e) => setFormApnPass(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="apnType" value="PRIVATE" checked={formApnType === 'PRIVATE'} onChange={() => setFormApnType('PRIVATE')} />
                APN Privada
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="apnType" value="PUBLIC" checked={formApnType === 'PUBLIC'} onChange={() => setFormApnType('PUBLIC')} />
                APN Pública
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Plano de Dados (MB)</label>
                <Input type="number" value={formDataPlan} onChange={(e) => setFormDataPlan(Number(e.target.value))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Fornecedor</label>
                <select
                  value={formProvider}
                  onChange={(e) => setFormProvider(e.target.value)}
                  className="w-full h-8 rounded-lg border bg-transparent px-3 text-sm"
                >
                  <option value="">Selecionar...</option>
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Data Ativação</label>
                <Input type="date" value={formActivatedAt} onChange={(e) => setFormActivatedAt(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Data Vencimento</label>
                <Input type="date" value={formExpiresAt} onChange={(e) => setFormExpiresAt(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating || formIccid.length < 19}>
              {creating ? 'Cadastrando...' : 'Cadastrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChipRow({ chip }: { chip: Chip }) {
  const [copied, setCopied] = useState(false);

  const copyIccid = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(chip.iccid);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-4 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
      <CardSim className="h-5 w-5 text-blue-400 shrink-0" />

      <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-5 gap-1 sm:gap-4 items-center">
        <div>
          <button onClick={copyIccid} className="flex items-center gap-1 font-mono text-xs hover:text-emerald-400 transition-colors">
            {chip.iccid}
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 opacity-40" />}
          </button>
          {chip.phoneNumber && <p className="text-xs text-muted-foreground">{chip.phoneNumber}</p>}
        </div>

        <div className="text-sm font-medium">{OPERATOR_LABELS[chip.operator]}</div>

        <div>
          <span className="font-mono text-xs text-muted-foreground">{chip.apn}</span>
          <span className="text-xs ml-1">({chip.dataPlanMb} MB)</span>
        </div>

        <div className="text-sm">
          {chip.device ? (
            <span className="text-foreground">{chip.device.imei.slice(0, 8)}...</span>
          ) : (
            <span className="text-muted-foreground text-xs">Sem dispositivo</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Badge className={cn('text-xs', CHIP_STATUS_COLORS[chip.status])}>
            {CHIP_STATUS_LABELS[chip.status]}
          </Badge>
          {chip.expiresAt && (
            <span className="text-xs text-muted-foreground">
              {new Date(chip.expiresAt) < new Date() ? 'Vencido' :
                `Vence ${new Date(chip.expiresAt).toLocaleDateString('pt-BR')}`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
