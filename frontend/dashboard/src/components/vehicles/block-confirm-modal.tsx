'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { vehiclesApi } from '@/lib/api';
import { toast } from 'sonner';
import type { VehicleWithTracking } from '@/types/vehicle';

interface BlockConfirmModalProps {
  open: boolean;
  onClose: () => void;
  vehicle: VehicleWithTracking;
  isBlocking: boolean;
}

export function BlockConfirmModal({
  open,
  onClose,
  vehicle,
  isBlocking,
}: BlockConfirmModalProps) {
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      if (isBlocking) {
        await vehiclesApi.block(vehicle.id);
        toast.success(`Veículo ${vehicle.plate} bloqueado`);
      } else {
        await vehiclesApi.unblock(vehicle.id);
        toast.success(`Veículo ${vehicle.plate} desbloqueado`);
      }
      onClose();
    } catch {
      toast.error(`Erro ao ${isBlocking ? 'bloquear' : 'desbloquear'} veículo`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isBlocking ? 'Confirmar Bloqueio' : 'Confirmar Desbloqueio'}
          </DialogTitle>
          <DialogDescription>
            {isBlocking
              ? `Tem certeza que deseja bloquear o veículo ${vehicle.plate}? Esta ação enviará um comando ao rastreador.`
              : `Tem certeza que deseja desbloquear o veículo ${vehicle.plate}?`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant={isBlocking ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={loading}
            className={!isBlocking ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
          >
            {loading ? 'Processando...' : 'Confirmar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
