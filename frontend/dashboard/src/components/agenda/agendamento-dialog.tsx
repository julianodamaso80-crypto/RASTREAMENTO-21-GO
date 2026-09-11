'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search, MapPin, Info } from 'lucide-react';
import { toast } from 'sonner';
import { appointmentsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SelectNative } from '@/components/ui/select-native';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Technician } from '@/types/technician';
import {
  CONDUCTION_LABEL,
  MAINTENANCE_REASON_LABEL,
  SERVICE_TYPE_LABEL,
  SHIFT_HOURS,
  SHIFT_LABEL,
  type AgendaPendencia,
  type Appointment,
  type AppointmentShift,
  type CriarAgendamentoPayload,
  type MaintenanceReason,
  type ServiceConduction,
  type ServiceType,
} from '@/types/appointment';
import { diaDoIso, horaDoIso } from './datas';

interface Props {
  aberto: boolean;
  onFechar: () => void;
  onSalvo: () => void;
  tecnicos: Technician[];
  /** Dia clicado no calendário (YYYY-MM-DD). */
  dia: string;
  /** Técnico já selecionado no filtro, se houver um só. */
  tecnicoPadrao?: string;
  /** Pendência arrastada para o dia — chega com o formulário preenchido. */
  pendencia?: AgendaPendencia | null;
  /** Agendamento existente, quando é edição. */
  existente?: Appointment | null;
}

const VAZIO: CriarAgendamentoPayload = {
  serviceType: 'INSTALLATION',
  date: '',
  shift: 'MORNING',
  technicianId: '',
  conduction: 'MOBILE',
};

export function AgendamentoDialog({
  aberto,
  onFechar,
  onSalvo,
  tecnicos,
  dia,
  tecnicoPadrao,
  pendencia,
  existente,
}: Props) {
  const [form, setForm] = useState<CriarAgendamentoPayload>(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [origem, setOrigem] = useState<string | null>(null);
  const [situacaoSga, setSituacaoSga] = useState<string | null>(null);

  const editando = Boolean(existente);

  const set = useCallback(
    <K extends keyof CriarAgendamentoPayload>(
      campo: K,
      valor: CriarAgendamentoPayload[K],
    ) => setForm((f) => ({ ...f, [campo]: valor })),
    [],
  );

  useEffect(() => {
    if (!aberto) return;
    setOrigem(null);
    setSituacaoSga(null);

    if (existente) {
      setForm({
        serviceType: existente.serviceType,
        maintenanceReason: existente.maintenanceReason,
        conduction: existente.conduction,
        date: diaDoIso(existente.scheduledStart),
        shift: existente.shift,
        startTime: horaDoIso(existente.scheduledStart),
        endTime: horaDoIso(existente.scheduledEnd),
        technicianId: existente.technicianId,
        vehicleId: existente.vehicleId,
        plate: existente.plate,
        chassi: existente.chassi,
        imei: existente.imei,
        brand: existente.brand,
        model: existente.model,
        installLocation: existente.installLocation,
        clientName: existente.clientName,
        cpfCnpj: existente.cpfCnpj,
        phone: existente.phone,
        email: existente.email,
        cep: existente.cep,
        address: existente.address,
        complement: existente.complement,
        value: existente.value,
        description: existente.description,
        technicianNote: existente.technicianNote,
      });
      return;
    }

    if (pendencia) {
      // Veio arrastada da fila do SGA: o cadastro já está preenchido, o
      // operador só escolhe técnico e horário.
      setOrigem('PENDENCIA_SGA');
      setForm({
        ...VAZIO,
        date: dia,
        technicianId: tecnicoPadrao ?? '',
        serviceType: 'INSTALLATION',
        plate: pendencia.plate,
        chassi: pendencia.chassi,
        brand: pendencia.brandModel,
        clientName: pendencia.clientName,
        cpfCnpj: pendencia.cpfCnpj,
        phone: pendencia.phone,
        email: pendencia.email,
        cep: pendencia.cep,
        address:
          [pendencia.address, pendencia.neighborhood, pendencia.city]
            .filter(Boolean)
            .join(', ') || null,
        lat: pendencia.lat,
        lng: pendencia.lng,
        installationPendingId: pendencia.id,
      });
      return;
    }

    setForm({ ...VAZIO, date: dia, technicianId: tecnicoPadrao ?? '' });
  }, [aberto, dia, existente, pendencia, tecnicoPadrao]);

  const horas = useMemo(() => {
    if (form.shift === 'CUSTOM') {
      return { inicio: form.startTime ?? '', fim: form.endTime ?? '' };
    }
    const [i, f] = SHIFT_HOURS[form.shift];
    return { inicio: i, fim: f };
  }, [form.shift, form.startTime, form.endTime]);

  /** Preenche o resto a partir da placa ou do chassi. */
  const buscarVeiculo = useCallback(async () => {
    const termo = (form.plate || form.chassi || '').trim();
    if (termo.length < 4) {
      toast.error('Informe ao menos 4 caracteres da placa ou do chassi.');
      return;
    }
    setBuscando(true);
    try {
      const r = await appointmentsApi.lookup(termo);
      if (!r) {
        setOrigem(null);
        setSituacaoSga(null);
        toast.warning('Placa não encontrada em ativos, pendências nem no SGA.');
        return;
      }
      setOrigem(r.origem);
      setSituacaoSga(r.sgaSituation ?? null);
      setForm((f) => ({
        ...f,
        vehicleId: r.vehicleId ?? null,
        plate: r.plate ?? f.plate,
        chassi: r.chassi ?? f.chassi,
        imei: r.imei ?? f.imei,
        brand: r.brand ?? f.brand,
        model: r.model ?? f.model,
        installLocation: r.installLocation ?? f.installLocation,
        clientName: r.clientName ?? f.clientName,
        cpfCnpj: r.cpfCnpj ?? f.cpfCnpj,
        phone: r.phone ?? f.phone,
        email: r.email ?? f.email,
        cep: r.cep ?? f.cep,
        address: r.address ?? f.address,
        lat: r.lat ?? f.lat,
        lng: r.lng ?? f.lng,
        installationPendingId: r.installationPendingId ?? f.installationPendingId,
      }));
      toast.success('Dados do veículo preenchidos.');
    } catch {
      toast.error('Não foi possível consultar a placa.');
    } finally {
      setBuscando(false);
    }
  }, [form.plate, form.chassi]);

  const salvar = useCallback(async () => {
    if (!form.technicianId) {
      toast.error('Escolha o técnico.');
      return;
    }
    if (form.serviceType === 'MAINTENANCE' && !form.maintenanceReason) {
      toast.error('Manutenção exige o motivo.');
      return;
    }
    if (form.shift === 'CUSTOM' && (!form.startTime || !form.endTime)) {
      toast.error('Turno customizável exige hora de início e de fim.');
      return;
    }

    setSalvando(true);
    try {
      const payload: CriarAgendamentoPayload = {
        ...form,
        startTime: form.shift === 'CUSTOM' ? form.startTime : null,
        endTime: form.shift === 'CUSTOM' ? form.endTime : null,
        maintenanceReason:
          form.serviceType === 'MAINTENANCE' ? form.maintenanceReason : null,
      };
      if (existente) {
        await appointmentsApi.editar(existente.id, payload);
        toast.success('Agendamento atualizado.');
      } else {
        const criado = await appointmentsApi.criar(payload);
        toast.success(`OS ${criado.osNumber} aberta.`);
      }
      onSalvo();
      onFechar();
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Não foi possível salvar o agendamento.';
      toast.error(msg);
    } finally {
      setSalvando(false);
    }
  }, [form, existente, onSalvo, onFechar]);

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editando
              ? `Ordem de serviço ${existente?.osNumber}`
              : 'Novo agendamento'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* ---------------------------------------------------- serviço */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">
              Serviço
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Tipo de serviço</Label>
                <SelectNative
                  value={form.serviceType}
                  onChange={(e) =>
                    set('serviceType', e.target.value as ServiceType)
                  }
                >
                  {(Object.keys(SERVICE_TYPE_LABEL) as ServiceType[]).map((t) => (
                    <option key={t} value={t}>
                      {SERVICE_TYPE_LABEL[t]}
                    </option>
                  ))}
                </SelectNative>
              </div>

              {form.serviceType === 'MAINTENANCE' && (
                <div>
                  <Label>Motivo da manutenção</Label>
                  <SelectNative
                    value={form.maintenanceReason ?? ''}
                    onChange={(e) =>
                      set(
                        'maintenanceReason',
                        (e.target.value || null) as MaintenanceReason | null,
                      )
                    }
                  >
                    <option value="">Selecione</option>
                    {(
                      Object.keys(MAINTENANCE_REASON_LABEL) as MaintenanceReason[]
                    ).map((m) => (
                      <option key={m} value={m}>
                        {MAINTENANCE_REASON_LABEL[m]}
                      </option>
                    ))}
                  </SelectNative>
                </div>
              )}

              <div>
                <Label>Condução</Label>
                <SelectNative
                  value={form.conduction ?? 'MOBILE'}
                  onChange={(e) =>
                    set('conduction', e.target.value as ServiceConduction)
                  }
                >
                  {(
                    Object.keys(CONDUCTION_LABEL) as ServiceConduction[]
                  ).map((c) => (
                    <option key={c} value={c}>
                      {CONDUCTION_LABEL[c]}
                    </option>
                  ))}
                </SelectNative>
              </div>
            </div>
          </section>

          {/* ------------------------------------------------------ quando */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">
              Data e turno
            </h3>
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <Label>Data</Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => set('date', e.target.value)}
                />
              </div>
              <div>
                <Label>Turno</Label>
                <SelectNative
                  value={form.shift}
                  onChange={(e) =>
                    set('shift', e.target.value as AppointmentShift)
                  }
                >
                  {(Object.keys(SHIFT_LABEL) as AppointmentShift[]).map((s) => (
                    <option key={s} value={s}>
                      {SHIFT_LABEL[s]}
                    </option>
                  ))}
                </SelectNative>
              </div>
              <div>
                <Label>Início</Label>
                <Input
                  type="time"
                  value={horas.inicio}
                  disabled={form.shift !== 'CUSTOM'}
                  onChange={(e) => set('startTime', e.target.value)}
                />
              </div>
              <div>
                <Label>Fim</Label>
                <Input
                  type="time"
                  value={horas.fim}
                  disabled={form.shift !== 'CUSTOM'}
                  onChange={(e) => set('endTime', e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Técnico</Label>
              <SelectNative
                value={form.technicianId}
                onChange={(e) => set('technicianId', e.target.value)}
              >
                <option value="">Selecione um técnico</option>
                {tecnicos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </SelectNative>
            </div>
          </section>

          {/* ----------------------------------------------------- veículo */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Veículo e cliente
              </h3>
              {origem && (
                <Badge variant="secondary" className="text-[11px]">
                  {origem === 'ATIVO'
                    ? 'Ativo nosso'
                    : origem === 'PENDENCIA_SGA'
                      ? 'Pendência do SGA'
                      : 'Cadastro do SGA'}
                </Badge>
              )}
              {situacaoSga && (
                <Badge
                  variant={situacaoSga === 'ATIVO' ? 'default' : 'destructive'}
                  className="text-[11px]"
                >
                  {situacaoSga}
                </Badge>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Label>Placa ou chassi</Label>
                <div className="flex gap-2">
                  <Input
                    value={form.plate ?? ''}
                    placeholder="Placa ou chassi"
                    onChange={(e) => set('plate', e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void buscarVeiculo();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={buscarVeiculo}
                    disabled={buscando}
                  >
                    {buscando ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <div>
                <Label>IMEI</Label>
                <Input
                  value={form.imei ?? ''}
                  onChange={(e) => set('imei', e.target.value)}
                />
              </div>
              <div>
                <Label>Marca</Label>
                <Input
                  value={form.brand ?? ''}
                  onChange={(e) => set('brand', e.target.value)}
                />
              </div>
              <div>
                <Label>Modelo</Label>
                <Input
                  value={form.model ?? ''}
                  onChange={(e) => set('model', e.target.value)}
                />
              </div>
              <div>
                <Label>Local de instalação no veículo</Label>
                <Input
                  value={form.installLocation ?? ''}
                  onChange={(e) => set('installLocation', e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Cliente</Label>
                <Input
                  value={form.clientName ?? ''}
                  onChange={(e) => set('clientName', e.target.value)}
                />
              </div>
              <div>
                <Label>CPF / CNPJ</Label>
                <Input
                  value={form.cpfCnpj ?? ''}
                  onChange={(e) => set('cpfCnpj', e.target.value)}
                />
              </div>
              <div>
                <Label>Contato</Label>
                <Input
                  value={form.phone ?? ''}
                  onChange={(e) => set('phone', e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <Label>E-mail</Label>
                <Input
                  type="email"
                  value={form.email ?? ''}
                  onChange={(e) => set('email', e.target.value)}
                />
              </div>
            </div>
          </section>

          {/* ------------------------------------------------------- local */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">
              Local do serviço
            </h3>
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <Label>CEP</Label>
                <Input
                  value={form.cep ?? ''}
                  onChange={(e) => set('cep', e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Endereço</Label>
                <Input
                  value={form.address ?? ''}
                  onChange={(e) => set('address', e.target.value)}
                />
              </div>
              <div>
                <Label>Complemento</Label>
                <Input
                  value={form.complement ?? ''}
                  onChange={(e) => set('complement', e.target.value)}
                />
              </div>
            </div>
            {form.lat != null && form.lng != null && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {form.lat.toFixed(5)}, {form.lng.toFixed(5)}
              </p>
            )}
          </section>

          {/* -------------------------------------------------------- resto */}
          <section className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Valor do serviço</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.value ?? 0}
                  onChange={(e) => set('value', Number(e.target.value))}
                />
              </div>
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea
                rows={2}
                value={form.description ?? ''}
                onChange={(e) => set('description', e.target.value)}
              />
            </div>
            <div>
              <Label className="flex items-center gap-1">
                Observação para o técnico
                <Info className="h-3 w-3 text-muted-foreground" />
              </Label>
              <Textarea
                rows={2}
                placeholder="Só o técnico vê este texto"
                value={form.technicianNote ?? ''}
                onChange={(e) => set('technicianNote', e.target.value)}
              />
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editando ? 'Salvar' : 'Agendar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
