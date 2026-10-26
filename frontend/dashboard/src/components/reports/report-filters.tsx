'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Search, Download, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectNative } from '@/components/ui/select-native';
import { useTracking } from '@/contexts/tracking-context';
import { reportsApi } from '@/lib/api';
import type { VehicleWithTracking } from '@/types/vehicle';
import { AcoesDoPdf } from '@/components/historico/historico-solicitados';
import type { FonteDePdf, HistoricoSolicitado, TipoRelatorio } from '@/lib/historico';

/** O PDF linha a linha vai até 7 dias (regra do gerador); acima disso, um registro por dia. */
const DIAS_PDF_DETALHADO = 7;

interface ReportFiltersProps {
  onGenerate: (vehicle: VehicleWithTracking, from: string, to: string) => void;
  loading: boolean;
  selectedVehicle: VehicleWithTracking | null;
  /** Veículo já escolhido na origem — quem chega de "Histórico de viagens". */
  initialVehicleId?: string;
}

export function ReportFilters({
  onGenerate,
  loading,
  selectedVehicle,
  initialVehicleId,
}: ReportFiltersProps) {
  const { vehicles } = useTracking();
  const [vehicleId, setVehicleId] = useState(initialVehicleId ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [pdfGerado, setPdfGerado] = useState<HistoricoSolicitado | null>(null);

  const filteredVehicles = vehicles.filter(
    (v) =>
      !search ||
      v.plate.toLowerCase().includes(search.toLowerCase()) ||
      v.model?.toLowerCase().includes(search.toLowerCase()),
  );

  function handleGenerate() {
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    if (vehicle && from && to) {
      onGenerate(vehicle, new Date(from).toISOString(), new Date(to).toISOString());
    }
  }

  function handleExport(format: 'xlsx' | 'csv') {
    if (!selectedVehicle?.traccarDeviceId || !from || !to) return;
    const url = reportsApi.getExportUrl(
      'positions',
      selectedVehicle.traccarDeviceId,
      new Date(from).toISOString(),
      new Date(to).toISOString(),
      format,
    );
    const token = localStorage.getItem('token');
    // Abrir download via fetch com auth
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `relatorio.${format}`;
        a.click();
      });
  }

  // O mesmo PDF do histórico do veículo: nome da rua em cada linha, link para o
  // cliente e marca da 21Go. Excel/CSV continuam aqui para quem precisa da planilha.
  async function handlePdf() {
    if (!selectedVehicle?.traccarDeviceId || !from || !to) return;
    const ini = new Date(from).getTime();
    const fim = new Date(to).getTime();
    const tipo: TipoRelatorio =
      fim - ini > DIAS_PDF_DETALHADO * 24 * 3600_000 ? 'consolidado' : 'basico';
    setGerandoPdf(true);
    setPdfGerado(null);
    try {
      const item = await reportsApi.createHistoryRequest(
        selectedVehicle.traccarDeviceId,
        new Date(ini).toISOString(),
        new Date(fim).toISOString(),
        tipo,
      );
      setPdfGerado(item);
      if (tipo === 'consolidado') {
        toast.info('Período maior que 7 dias: o PDF saiu consolidado, um registro por dia.');
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(msg || 'Não foi possível gerar o PDF agora.');
    } finally {
      setGerandoPdf(false);
    }
  }

  const fontePdf: FonteDePdf = {
    gerar: (f, t, tipo) => reportsApi.createHistoryRequest(selectedVehicle?.traccarDeviceId ?? 0, f, t, tipo),
    listar: () => reportsApi.listHistoryRequests(selectedVehicle?.traccarDeviceId ?? 0),
    baixar: (id) => reportsApi.downloadHistoryRequest(id),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        {/* Vehicle selector */}
        <div className="w-64 space-y-1.5">
          <Label htmlFor="rep-vehicle">Veículo</Label>
          <SelectNative
            id="rep-vehicle"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            <option value="">Selecione um veículo</option>
            {filteredVehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate} — {v.brand} {v.model}
              </option>
            ))}
          </SelectNative>
        </div>

        {/* Date range */}
        <div className="space-y-1.5">
          <Label htmlFor="rep-from">Início</Label>
          <Input
            id="rep-from"
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-48"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rep-to">Fim</Label>
          <Input
            id="rep-to"
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-48"
          />
        </div>

        <Button
          onClick={handleGenerate}
          disabled={!vehicleId || !from || !to || loading}
          className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Search className="h-4 w-4 mr-2" />
          {loading ? 'Gerando...' : 'Gerar Relatório'}
        </Button>

        {selectedVehicle && (
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="h-9" onClick={() => handleExport('xlsx')}>
              <Download className="h-3 w-3 mr-1" /> Excel
            </Button>
            <Button variant="outline" size="sm" className="h-9" onClick={() => handleExport('csv')}>
              <Download className="h-3 w-3 mr-1" /> CSV
            </Button>
            <Button size="sm" className="h-9" onClick={handlePdf} disabled={gerandoPdf || !from || !to}>
              {gerandoPdf ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileText className="h-3 w-3 mr-1" />}
              {gerandoPdf ? 'Gerando PDF…' : 'PDF com endereço'}
            </Button>
          </div>
        )}
      </div>

      {pdfGerado && (
        <div className="space-y-2 rounded-lg border border-orange-200 bg-orange-50/60 p-3 dark:border-orange-900 dark:bg-orange-950/20">
          <div className="text-sm">
            <b>PDF pronto</b> · nº {pdfGerado.number} · {pdfGerado.rowCount.toLocaleString('pt-BR')}{' '}
            {pdfGerado.type === 'consolidado' ? 'dias' : 'registros'}, com o nome da rua em cada linha. O link abre
            sem senha até {new Date(pdfGerado.expiresAt).toLocaleDateString('pt-BR')}.
          </div>
          <Input
            readOnly
            value={pdfGerado.url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Link do PDF"
            className="font-mono text-xs"
          />
          <AcoesDoPdf fonte={fontePdf} item={pdfGerado} />
        </div>
      )}
    </div>
  );
}
