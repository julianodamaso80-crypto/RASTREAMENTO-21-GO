import {
  CONDUCTION_LABEL,
  MAINTENANCE_REASON_LABEL,
  SERVICE_TYPE_LABEL,
  SHIFT_LABEL,
  STATUS_LABEL,
  type OrdemServico,
} from '@/types/appointment';
import { dataHora, diaDoIso, diaBr, horaDoIso } from './datas';

/**
 * Documentos que a aba "Ordens de Serviço" gera a partir das OS marcadas:
 * "Emitir OS selecionadas" (uma folha por OS) e "Gerar relatório de
 * pagamentos". Saem numa janela de impressão — "Salvar como PDF" do navegador
 * produz o arquivo.
 */

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ESTILO = `
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 24px; font-size: 12px; }
  h1 { font-size: 18px; margin: 0; color: #293c82; }
  h2 { font-size: 13px; margin: 18px 0 6px; color: #293c82; border-bottom: 2px solid #f2911d; padding-bottom: 3px; }
  .topo { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #293c82; padding-bottom: 8px; }
  .muted { color: #64748b; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; width: 22%; font-weight: 600; }
  thead th { width: auto; background: #293c82; color: #fff; }
  .assinaturas { display: flex; gap: 40px; margin-top: 48px; }
  .assinaturas div { flex: 1; border-top: 1px solid #0f172a; padding-top: 4px; text-align: center; }
  .folha { page-break-after: always; }
  .folha:last-child { page-break-after: auto; }
  .total { text-align: right; font-weight: 700; }
  @media print { body { margin: 12mm; } }
`;

function linha(rotulo: string, valor: unknown) {
  return `<tr><th>${esc(rotulo)}</th><td>${esc(valor || 'Não informado')}</td></tr>`;
}

function folhaOs(o: OrdemServico): string {
  const servico =
    SERVICE_TYPE_LABEL[o.serviceType] +
    (o.maintenanceReason ? ` — ${MAINTENANCE_REASON_LABEL[o.maintenanceReason]}` : '');
  return `
  <section class="folha">
    <div class="topo">
      <div><h1>Ordem de serviço ${esc(o.osNumber)}</h1>
      <span class="muted">21 GO Rastreamento</span></div>
      <div class="muted">Emitida em ${esc(dataHora(new Date().toISOString()))}</div>
    </div>

    <h2>Serviço</h2>
    <table>
      ${linha('Tipo', servico)}
      ${linha('Condução do serviço', CONDUCTION_LABEL[o.conduction])}
      ${linha('Status', STATUS_LABEL[o.status])}
      ${linha('Colaborador', o.technician.name)}
      ${linha('Data do agendamento', diaBr(diaDoIso(o.scheduledStart)))}
      ${linha('Horário', `${horaDoIso(o.scheduledStart)} às ${horaDoIso(o.scheduledEnd)} (${SHIFT_LABEL[o.shift]})`)}
      ${o.completedAt ? linha('Finalizada em', dataHora(o.completedAt)) : ''}
      ${linha('Observação ao técnico', o.technicianNote)}
      ${linha('Descrição', o.description)}
    </table>

    <h2>Cliente</h2>
    <table>
      ${linha('Nome', o.clientName)}
      ${linha('CPF/CNPJ', o.cpfCnpj)}
      ${linha('Contato', o.phone)}
      ${linha('Endereço', [o.address, o.complement].filter(Boolean).join(' — '))}
      ${linha('CEP', o.cep)}
    </table>

    <h2>Veículo</h2>
    <table>
      ${linha('Placa/Chassi', o.plate || o.chassi)}
      ${linha('Marca', o.brand)}
      ${linha('Modelo', o.model)}
      ${linha('IMEI', o.imei)}
    </table>

    <div class="assinaturas"><div>Técnico</div><div>Cliente</div></div>
  </section>`;
}

function abrirImpressao(titulo: string, corpo: string): boolean {
  const janela = window.open('', '_blank');
  if (!janela) return false;
  janela.document.write(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${ESTILO}</style></head><body>${corpo}</body></html>`,
  );
  janela.document.close();
  janela.focus();
  setTimeout(() => janela.print(), 300);
  return true;
}

/** "Emitir OS selecionadas": uma folha por OS. */
export function emitirOs(ordens: OrdemServico[]): boolean {
  const titulo =
    ordens.length === 1 ? `OS ${ordens[0].osNumber}` : `Ordens de serviço (${ordens.length})`;
  return abrirImpressao(titulo, ordens.map(folhaOs).join(''));
}

/**
 * "Gerar relatório de pagamentos": as OS concluídas (e visitas frustradas pelo
 * cliente, que a origem também paga) do técnico, agrupadas por dia, com o
 * custo do serviço e o total.
 */
export function relatorioPagamentos(
  tecnico: string,
  periodo: { from: string; to: string },
  ordens: OrdemServico[],
): boolean {
  const porDia = new Map<string, OrdemServico[]>();
  for (const o of [...ordens].sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))) {
    const d = diaDoIso(o.scheduledStart);
    porDia.set(d, [...(porDia.get(d) ?? []), o]);
  }

  let total = 0;
  const blocos = [...porDia.entries()]
    .map(([d, lista]) => {
      const subtotal = lista.reduce((s, o) => s + Number(o.value || 0), 0);
      total += subtotal;
      return `
      <h2>${esc(diaBr(d))}</h2>
      <table>
        <thead><tr><th>OS</th><th>Horário</th><th>Serviço</th><th>Placa/Chassi</th><th>Status</th><th>Endereço</th><th>Valor</th></tr></thead>
        <tbody>
          ${lista
            .map(
              (o) => `<tr>
                <td>${esc(o.osNumber)}</td>
                <td>${esc(horaDoIso(o.scheduledStart))}</td>
                <td>${esc(SERVICE_TYPE_LABEL[o.serviceType])}</td>
                <td>${esc(o.plate || o.chassi || '-')}</td>
                <td>${esc(STATUS_LABEL[o.status])}</td>
                <td>${esc(o.address || (o.lat == null ? 'Sem localização válida' : '-'))}</td>
                <td>${esc(brl(Number(o.value || 0)))}</td>
              </tr>`,
            )
            .join('')}
          <tr><td colspan="6" class="total">Subtotal do dia</td><td class="total">${esc(brl(subtotal))}</td></tr>
        </tbody>
      </table>`;
    })
    .join('');

  const corpo = `
    <div class="topo">
      <div><h1>Relatório de pagamentos</h1>
      <span class="muted">Colaborador: ${esc(tecnico)} · Período: ${esc(diaBr(periodo.from))} até ${esc(diaBr(periodo.to))}</span></div>
      <div class="muted">${ordens.length} serviço(s)</div>
    </div>
    ${blocos}
    <h2>Total</h2>
    <table><tr><th>Total a pagar</th><td class="total">${esc(brl(total))}</td></tr></table>`;
  return abrirImpressao(`Relatório de pagamentos — ${tecnico}`, corpo);
}
