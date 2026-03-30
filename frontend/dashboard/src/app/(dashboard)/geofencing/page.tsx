'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { geofencesApi } from '@/lib/api';
import { GeofenceList } from '@/components/geofencing/geofence-list';
import { GeofenceForm } from '@/components/geofencing/geofence-form';
import { Skeleton } from '@/components/ui/skeleton';
import type { Geofence, CreateGeofencePayload } from '@/types/geofence';

const GeofenceMap = dynamic(
  () => import('@/components/geofencing/geofence-map').then((m) => m.GeofenceMap),
  { ssr: false, loading: () => <div className="w-full h-full bg-muted/20 animate-pulse" /> },
);

export default function GeofencingPage() {
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadGeofences = useCallback(async () => {
    try {
      const res = await geofencesApi.getAll({ perPage: 100 });
      setGeofences(res.data);
    } catch {
      toast.error('Erro ao carregar cercas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGeofences();
  }, [loadGeofences]);

  const handleCreate = useCallback(
    async (data: CreateGeofencePayload) => {
      await geofencesApi.create(data);
      toast.success('Cerca criada com sucesso');
      loadGeofences();
    },
    [loadGeofences],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm('Tem certeza que deseja excluir esta cerca?')) return;
      try {
        await geofencesApi.delete(id);
        toast.success('Cerca excluída');
        if (selectedId === id) setSelectedId(null);
        loadGeofences();
      } catch {
        toast.error('Erro ao excluir cerca');
      }
    },
    [selectedId, loadGeofences],
  );

  return (
    <div className="flex h-full">
      {/* Lista lateral */}
      <div className="w-[320px] shrink-0 border-r border-border/30 flex flex-col glass-light">
        <div className="flex items-center justify-between p-3 border-b border-border/30">
          <h2 className="font-semibold text-sm">Cercas Geográficas</h2>
          <Button
            size="sm"
            className="h-7 bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => setShowForm(true)}
          >
            <Plus className="h-3 w-3 mr-1" /> Nova
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : (
            <GeofenceList
              geofences={geofences}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onDelete={handleDelete}
            />
          )}
        </div>
      </div>

      {/* Mapa */}
      <div className="flex-1">
        <GeofenceMap geofences={geofences} selectedId={selectedId} />
      </div>

      {/* Form dialog */}
      <GeofenceForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onSubmit={handleCreate}
      />
    </div>
  );
}
