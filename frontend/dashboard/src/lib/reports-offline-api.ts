import api from '@/lib/api';

export interface OfflineEquipmentRow {
  placa: string;
  modeloVeiculo: string | null;
  cliente: string | null;
  imei: string;
  iccid: string | null;
  numeroChip: string | null;
  operadora: string | null;
  ultimaComunicacao: string | null;
  situacao: 'OFFLINE' | 'SEM_RESPOSTA' | 'NUNCA_REPORTOU';
  instaladoEm: string | null;
}

export interface OfflineEquipmentResult {
  data: OfflineEquipmentRow[];
  meta: { total: number; geradoEm: string };
}

export const reportsOfflineApi = {
  list: async (): Promise<OfflineEquipmentResult> => {
    const res = await api.get('/reports/offline-equipment');
    const body = res.data;
    // Tolera o envelope { data: { data, meta } } caso um interceptor global embrulhe.
    return Array.isArray(body?.data) ? body : body.data;
  },
  exportXlsx: async (): Promise<Blob> => {
    const res = await api.get('/reports/offline-equipment', {
      params: { format: 'xlsx' },
      responseType: 'blob',
    });
    return res.data as Blob;
  },
};
