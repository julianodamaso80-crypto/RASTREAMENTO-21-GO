import { existsSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { FINANCIAL_STATUS_LABEL, MESES } from './financial.constants';

export interface LinhaRelatorio {
  plate: string;
  status: string;
  month: number | null;
  consultantName: string | null;
  consultantContact: string | null;
  receiptId: string | null;
  plateCount: number;
  createdAt: Date;
  receipt: { fileName: string } | null;
}

/** Cores da marca (manual_marca_21go): azul institucional e laranja. */
const AZUL = '#293c82';
const LARANJA = '#f2911d';
const CINZA = '#5b6478';
const LINHA = '#dfe3ec';
const ZEBRA = '#f6f7fb';

const COR_SITUACAO: Record<string, { fundo: string; texto: string }> = {
  MIGRATION: { fundo: '#e8f5cf', texto: '#456b12' },
  PAID_PIX: { fundo: '#d8f3e3', texto: '#0b6b39' },
  NO_RECEIPT: { fundo: '#fde5d3', texto: '#9a3d0a' },
};

const COLUNAS = [
  { chave: 'plate', titulo: 'Placa', largura: 78 },
  { chave: 'status', titulo: 'Situação', largura: 108 },
  { chave: 'month', titulo: 'Mês', largura: 66 },
  { chave: 'consultantName', titulo: 'Consultor', largura: 150 },
  { chave: 'consultantContact', titulo: 'Contato', largura: 88 },
  { chave: 'receiptId', titulo: 'Comprovante', largura: 118 },
  { chave: 'plateCount', titulo: 'Placas', largura: 54 },
] as const;

const MARGEM = 32;
const ALTURA_LINHA = 22;

function dataHora(d: Date): string {
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * pdfkit quebra linha mesmo com `lineBreak: false` quando o texto não cabe, e
 * a linha da tabela vira duas. Corta na medida real da fonte já aplicada.
 */
function cortar(doc: PDFKit.PDFDocument, texto: string, largura: number): string {
  if (doc.widthOfString(texto) <= largura) return texto;
  let corte = texto;
  while (corte.length > 1 && doc.widthOfString(`${corte}…`) > largura) {
    corte = corte.slice(0, -1);
  }
  return `${corte}…`;
}

function logo(): string | null {
  // `dist/src/modules/financial` → raiz da imagem. Em dev, roda de src/.
  const candidatos = [
    join(process.cwd(), 'assets', 'logo-21go.png'),
    join(__dirname, '..', '..', '..', '..', 'assets', 'logo-21go.png'),
  ];
  return candidatos.find((c) => existsSync(c)) ?? null;
}

/**
 * Relatório do Financeiro em PDF. Uma folha A4 deitada por página, cabeçalho
 * com a marca, faixa com o período e o resumo, e a tabela zebrada — a mesma
 * ordem de colunas da tela, para conferir lado a lado.
 */
export function gerarRelatorioPdf(dados: {
  linhas: LinhaRelatorio[];
  periodo: string;
  filtros: string[];
  empresa: string | null;
  geradoPor: string | null;
}): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGEM });
  const largura = doc.page.width - MARGEM * 2;

  const totais = dados.linhas.reduce(
    (acc, l) => {
      acc[l.status] = (acc[l.status] ?? 0) + 1;
      acc.placas += l.plateCount;
      acc.anexos += l.receipt ? 1 : 0;
      return acc;
    },
    { placas: 0, anexos: 0 } as Record<string, number>,
  );

  let paginas = 0;

  const cabecalho = () => {
    paginas += 1;
    const arquivo = logo();
    if (arquivo) {
      try {
        doc.image(arquivo, MARGEM, MARGEM - 6, { height: 34 });
      } catch {
        // Logo ilegível não pode derrubar o relatório.
      }
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(AZUL)
      .text('Relatório do Financeiro', MARGEM + (arquivo ? 120 : 0), MARGEM - 2);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(CINZA)
      .text(
        `${dados.periodo}${dados.empresa ? ` · ${dados.empresa}` : ''}`,
        MARGEM + (arquivo ? 120 : 0),
        MARGEM + 17,
      );
    doc
      .fontSize(8)
      .fillColor(CINZA)
      .text(
        `Gerado em ${dataHora(new Date())}${dados.geradoPor ? ` por ${dados.geradoPor}` : ''}`,
        MARGEM,
        MARGEM + 2,
        { width: largura, align: 'right' },
      );
    doc
      .moveTo(MARGEM, MARGEM + 42)
      .lineTo(MARGEM + largura, MARGEM + 42)
      .lineWidth(2)
      .strokeColor(LARANJA)
      .stroke();
    doc.y = MARGEM + 52;
  };

  const resumo = () => {
    const itens = [
      `Lançamentos: ${dados.linhas.length}`,
      `Placas: ${totais.placas}`,
      ...Object.keys(FINANCIAL_STATUS_LABEL).map(
        (s) => `${FINANCIAL_STATUS_LABEL[s]}: ${totais[s] ?? 0}`,
      ),
      `Com comprovante anexado: ${totais.anexos}`,
    ];
    doc.rect(MARGEM, doc.y, largura, 24).fillColor(ZEBRA).fill();
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(AZUL)
      .text(itens.join('     ·     '), MARGEM + 8, doc.y + 8, { width: largura - 16 });
    doc.y += 16;
    if (dados.filtros.length) {
      doc
        .fontSize(8)
        .fillColor(CINZA)
        .text(`Filtros: ${dados.filtros.join(' · ')}`, MARGEM, doc.y + 4, {
          width: largura,
        });
      doc.y += 6;
    }
    doc.y += 12;
  };

  const tituloDaTabela = () => {
    const y = doc.y;
    doc.rect(MARGEM, y, largura, ALTURA_LINHA).fillColor(AZUL).fill();
    let x = MARGEM;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
    for (const c of COLUNAS) {
      doc.text(cortar(doc, c.titulo.toUpperCase(), c.largura - 12), x + 6, y + 7, {
        width: c.largura - 12,
        align: c.chave === 'plateCount' ? 'center' : 'left',
        lineBreak: false,
      });
      x += c.largura;
    }
    doc.y = y + ALTURA_LINHA;
  };

  const rodape = () => {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(CINZA)
      .text(`Página ${paginas}`, MARGEM, doc.page.height - MARGEM - 10, {
        width: largura,
        align: 'right',
        lineBreak: false,
      });
  };

  const limiteY = () => doc.page.height - MARGEM - 24;

  cabecalho();
  resumo();
  tituloDaTabela();

  if (dados.linhas.length === 0) {
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(CINZA)
      .text('Nenhum lançamento no período escolhido.', MARGEM, doc.y + 16, {
        width: largura,
        align: 'center',
      });
  }

  dados.linhas.forEach((linha, i) => {
    if (doc.y + ALTURA_LINHA > limiteY()) {
      rodape();
      doc.addPage();
      cabecalho();
      tituloDaTabela();
    }
    const y = doc.y;
    if (i % 2 === 1) doc.rect(MARGEM, y, largura, ALTURA_LINHA).fillColor(ZEBRA).fill();

    let x = MARGEM;
    for (const c of COLUNAS) {
      if (c.chave === 'status') {
        const cor = COR_SITUACAO[linha.status] ?? { fundo: ZEBRA, texto: CINZA };
        doc
          .roundedRect(x + 4, y + 4, c.largura - 12, ALTURA_LINHA - 9, 3)
          .fillColor(cor.fundo)
          .fill();
        doc
          .font('Helvetica-Bold')
          .fontSize(7)
          .fillColor(cor.texto)
          .text(cortar(doc, FINANCIAL_STATUS_LABEL[linha.status] ?? linha.status, c.largura - 14), x + 4, y + 8, {
            width: c.largura - 12,
            align: 'center',
            lineBreak: false,
          });
      } else {
        const valor =
          c.chave === 'month'
            ? (linha.month ? MESES[linha.month - 1] : '—')
            : c.chave === 'plateCount'
              ? String(linha.plateCount)
              : c.chave === 'receiptId'
                ? linha.receiptId || (linha.receipt ? 'arquivo anexado' : '—')
                : ((linha[c.chave] as string | null) ?? '—');
        const anexado = c.chave === 'receiptId' && !linha.receiptId && linha.receipt;
        doc
          .font(c.chave === 'plate' ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(c.chave === 'receiptId' ? 7 : 8)
          .fillColor(anexado ? LARANJA : '#1f2533')
          .text(cortar(doc, valor, c.largura - 12), x + 6, y + 7, {
            width: c.largura - 12,
            align: c.chave === 'plateCount' ? 'center' : 'left',
            lineBreak: false,
          });
      }
      x += c.largura;
    }

    doc
      .moveTo(MARGEM, y + ALTURA_LINHA)
      .lineTo(MARGEM + largura, y + ALTURA_LINHA)
      .lineWidth(0.5)
      .strokeColor(LINHA)
      .stroke();
    doc.y = y + ALTURA_LINHA;
  });

  rodape();
  return doc;
}
