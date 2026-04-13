'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import type { CreateGeofencePayload, GeofenceType } from '@/types/geofence';

interface GeofenceFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: CreateGeofencePayload) => Promise<void>;
}

export function GeofenceForm({ open, onClose, onSubmit }: GeofenceFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<GeofenceType>('CIRCLE');
  const [latitude, setLatitude] = useState('-16.6799');
  const [longitude, setLongitude] = useState('-49.2550');
  const [radius, setRadius] = useState('1000');
  const [color, setColor] = useState('#3b82f6');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const coordinates =
        type === 'CIRCLE'
          ? { latitude: parseFloat(latitude), longitude: parseFloat(longitude), radius: parseInt(radius) }
          : []; // Polígono: seria preenchido pela ferramenta de desenho

      await onSubmit({ name, description: description || undefined, type, coordinates, color });
      setName('');
      setDescription('');
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova Cerca Geográfica</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Nome</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ex: Centro Goiânia" />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Descrição (opcional)</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição da cerca" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Tipo</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as GeofenceType)}
                className="w-full h-9 px-3 rounded-md border border-border bg-slate-900 text-slate-100 text-sm focus:outline-none focus:border-brand-orange-500 [&>option]:bg-slate-900 [&>option]:text-slate-100"
              >
                <option value="CIRCLE">Círculo</option>
                <option value="POLYGON">Polígono</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Cor</label>
              <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 p-1" />
            </div>
          </div>

          {type === 'CIRCLE' && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Latitude</label>
                <Input type="number" step="any" value={latitude} onChange={(e) => setLatitude(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Longitude</label>
                <Input type="number" step="any" value={longitude} onChange={(e) => setLongitude(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Raio (m)</label>
                <Input type="number" value={radius} onChange={(e) => setRadius(e.target.value)} required />
              </div>
            </div>
          )}

          {type === 'POLYGON' && (
            <p className="text-xs text-muted-foreground">
              Para polígonos, use a ferramenta de desenho no mapa (em breve).
              Por enquanto, use o tipo Círculo.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={loading} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {loading ? 'Criando...' : 'Criar Cerca'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
