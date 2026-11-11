'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Download, Loader2 } from 'lucide-react';
import {
  reportsOfflineApi,
  type OfflineEquipmentRow,
} from '@/lib/reports-offline-api';
import { formatDateBR } from '@/lib/utils';

const SITUACAO: Record<OfflineEquipmentRow['situacao'], string> = {
  OFFLINE: 'Offline',
  SEM_RESPOSTA: 'Sem resposta',
  NUNCA_REPORTOU: 'Nunca reportou',
};

const vazio = (v: string | null) => v || '—';

export function OfflineEquipmentReport() {
  const [rows, setRows] = useState<OfflineEquipmentRow[]>([]);
  const [geradoEm, setGeradoEm] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [filtro, setFiltro] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await reportsOfflineApi.list();
      setRows(r.data);
      setGeradoEm(r.meta.geradoEm);
    } catch {
      toast.error('Erro ao carregar equipamentos offline');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const filtradas = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.placa, r.imei, r.iccid, r.numeroChip].some((c) =>
        (c ?? '').toLowerCase().includes(q),
      ),
    );
  }, [rows, filtro]);

  const baixar = async () => {
    setDownloading(true);
    try {
      const blob = await reportsOfflineApi.exportXlsx();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'equipamentos-offline.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Erro ao baixar a planilha');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-sm">
          <span className="text-2xl font-bold">{rows.length}</span>{' '}
          <span className="text-muted-foreground">equipamentos sem comunicação</span>
          {geradoEm && (
            <span className="ml-2 text-xs text-muted-foreground">
              gerado em {formatDateBR(geradoEm)}
            </span>
          )}
        </div>
        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Filtrar por placa, IMEI ou chip"
          className="ml-auto h-9 w-72 rounded-md border border-border/30 bg-transparent px-3 text-sm"
        />
        <button
          onClick={baixar}
          disabled={downloading || loading || rows.length === 0}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border/30 px-3 text-sm font-medium hover:bg-muted/20 disabled:opacity-50"
        >
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Baixar XLSX
        </button>
      </div>

      <div className="rounded-lg border border-border/30 p-4">
        {loading ? (
          <div className="flex justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filtradas.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Nenhum equipamento offline encontrado
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30 text-muted-foreground text-xs">
                  <th className="text-left py-2 px-3">Placa</th>
                  <th className="text-left py-2 px-3">Cliente</th>
                  <th className="text-left py-2 px-3">IMEI</th>
                  <th className="text-left py-2 px-3">ICCID</th>
                  <th className="text-left py-2 px-3">Nº do chip</th>
                  <th className="text-left py-2 px-3">Operadora</th>
                  <th className="text-left py-2 px-3">Situação</th>
                  <th className="text-left py-2 px-3">Última comunicação</th>
                  <th className="text-left py-2 px-3">Instalado em</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((r) => (
                  <tr key={r.imei} className="border-b border-border/20 hover:bg-muted/20">
                    <td className="py-2 px-3 font-medium">{r.placa}</td>
                    <td className="py-2 px-3">{vazio(r.cliente)}</td>
                    <td className="py-2 px-3 font-mono text-xs">{r.imei}</td>
                    <td className="py-2 px-3 font-mono text-xs">{vazio(r.iccid)}</td>
                    <td className="py-2 px-3">{vazio(r.numeroChip)}</td>
                    <td className="py-2 px-3">{vazio(r.operadora)}</td>
                    <td className="py-2 px-3 text-yellow-400">{SITUACAO[r.situacao]}</td>
                    <td className="py-2 px-3">
                      {r.ultimaComunicacao ? formatDateBR(r.ultimaComunicacao) : '—'}
                    </td>
                    <td className="py-2 px-3">
                      {r.instaladoEm ? formatDateBR(r.instaladoEm).slice(0, 10) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
