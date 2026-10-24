import PDFDocument from 'pdfkit';
import {
  AZUL,
  AZUL_ESCURO,
  CARTAO,
  CINZA,
  LARANJA,
  LARANJA_TEXTO,
  LINHA,
  MARGEM,
  TEXTO,
  VERDE,
  ZEBRA,
  coordenada,
  cortar,
  dataHora,
  diaDe,
  diaPorExtenso,
  hora,
  linkDoEndereco,
  linkDoMapa,
  logo,
} from '../reports/history-report.pdf';
import type { DiaTag, LinhaTag, RelatorioDaTag, TipoRelatorioTag } from './tag-history-report';

export type LinhaTagPdf = LinhaTag & { address: string | null };
export type DiaTagPdf = DiaTag & { address: string | null };

export interface DadosHistoricoTagPdf {
  numero: string;
  plate: string;
  serial: string;
  veiculo: string | null;
  associado: string | null;
  from: string;
  to: string;
  type: TipoRelatorioTag;
  totals: RelatorioDaTag['totals'];
  rows: LinhaTagPdf[];
  days: DiaTagPdf[];
  geradoEm: Date;
}

const TIPO_ROTULO: Record<TipoRelatorioTag, string> = {
  basico: 'Básico',
  avancado: 'Avançado',
  consolidado: 'Consolidado',
};

/** O aviso que acompanha todo PDF de TAG: o que o documento prova e o que não prova. */
export const AVISO_TAG =
  'A TAG não tem GPS próprio: ela é vista quando um aparelho com Find My passa por perto. ' +
  'Cada linha mostra onde e quando a TAG foi vista, e não o trajeto percorrido. ' +
  'O horário é o do avistamento; a rede entrega a informação com atraso.';

function plural(n: number, um: string, varios: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`;
}

/**
 * Histórico da TAG em PDF, no mesmo padrão visual do histórico do rastreador
 * (marca, resumo, dias separados, link do mapa em cada linha), mas só com o que
 * a TAG sabe dizer: onde e quando foi vista e com que precisão.
 */
export function gerarHistoricoTagPdf(dados: DadosHistoricoTagPdf): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGEM,
    bufferPages: true,
    info: {
      Title: `Histórico de localização da TAG ${dados.plate}`,
      Author: '21Go Proteção Veicular',
    },
  });
  const partes: Buffer[] = [];
  const pronto = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (p: Buffer) => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
  });

  const largura = doc.page.width - MARGEM * 2;
  const limiteY = () => doc.page.height - MARGEM - 30;
  const arquivoLogo = logo();

  const cabecalho = (primeira: boolean) => {
    const altura = primeira ? 74 : 46;
    doc.rect(0, 0, doc.page.width, altura).fillColor(AZUL).fill();
    doc.rect(0, altura, doc.page.width * 0.72, 4).fillColor(LARANJA).fill();
    doc.rect(doc.page.width * 0.72, altura, doc.page.width * 0.28, 4).fillColor(VERDE).fill();
    if (arquivoLogo) {
      const alturaMarca = primeira ? 44 : 26;
      const escala = alturaMarca / 208;
      const yMarca = (altura - alturaMarca) / 2;
      try {
        doc.image(arquivoLogo, MARGEM - 20 * escala, yMarca - 146 * escala, { width: 512 * escala });
      } catch {
        // Logo ilegível não pode derrubar o relatório.
      }
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(primeira ? 16 : 11)
      .fillColor('#ffffff')
      .text('Relatório de Localização da TAG', MARGEM, primeira ? 20 : 12, {
        width: largura,
        align: 'right',
        lineBreak: false,
      });
    doc
      .font('Helvetica')
      .fontSize(primeira ? 9 : 8)
      .fillColor('#d6dcf0')
      .text(
        primeira
          ? 'Onde e quando a TAG do veículo foi vista no período'
          : `${dados.plate} · ${dataHora(dados.from)} a ${dataHora(dados.to)}`,
        MARGEM,
        primeira ? 42 : 27,
        { width: largura, align: 'right', lineBreak: false },
      );
    doc.y = altura + 18;
  };

  const resumo = () => {
    const t = dados.totals;
    const itens: [string, string][] = [
      ['Placa', dados.plate],
      ['Veículo', dados.veiculo || '—'],
      ['Associado', dados.associado || '—'],
      ['Relatório', TIPO_ROTULO[dados.type]],
      ['Início', dataHora(dados.from)],
      ['Fim', dataHora(dados.to)],
      ['Avistamentos', t.sightings.toLocaleString('pt-BR')],
      ['Lugares / dias', `${t.places.toLocaleString('pt-BR')} / ${t.days.toLocaleString('pt-BR')}`],
    ];
    const colunas = 4;
    const gap = 8;
    const w = (largura - gap * (colunas - 1)) / colunas;
    const h = 38;
    const y0 = doc.y;
    itens.forEach(([rotulo, valor], i) => {
      const x = MARGEM + (i % colunas) * (w + gap);
      const y = y0 + Math.floor(i / colunas) * (h + gap);
      doc.roundedRect(x, y, w, h, 5).fillColor(CARTAO).fill();
      doc
        .font('Helvetica')
        .fontSize(6.5)
        .fillColor(CINZA)
        .text(rotulo.toUpperCase(), x + 8, y + 7, { width: w - 16, lineBreak: false, characterSpacing: 0.4 });
      doc.font('Helvetica-Bold').fontSize(i === 0 ? 11 : 9).fillColor(AZUL_ESCURO);
      doc.text(cortar(doc, valor, w - 16), x + 8, y + 19, { width: w - 16, lineBreak: false });
    });
    doc.y = y0 + 2 * h + gap + 12;
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(CINZA)
      .text(
        `Horários de Brasília. TAG nº ${dados.serial}. "Abrir no mapa" mostra a rua no Google Maps; "Ponto exato" leva à coordenada informada pela rede.`,
        MARGEM,
        doc.y,
        { width: largura },
      );
    doc.y += 4;
    const yAviso = doc.y;
    const alturaAviso = 34;
    doc.roundedRect(MARGEM, yAviso, largura, alturaAviso, 4).fillColor('#fff7e8').fill();
    doc.rect(MARGEM, yAviso, 3, alturaAviso).fillColor(LARANJA).fill();
    doc
      .font('Helvetica')
      .fontSize(7.4)
      .fillColor(TEXTO)
      .text(AVISO_TAG, MARGEM + 10, yAviso + 6, { width: largura - 20 });
    doc.y = yAviso + alturaAviso + 8;
  };

  const avancado = dados.type === 'avancado';
  const COL = { hora: 74, endereco: 262, prec: 52, mapa: largura - 74 - 262 - 52 };
  const ALTURA = 26;

  const tituloDaTabela = () => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(6.8).fillColor(CINZA);
    let x = MARGEM;
    const titulos: [string, number, 'left' | 'center'][] = [
      ['VISTA', COL.hora, 'left'],
      ['ONDE', COL.endereco, 'left'],
      ['PRECISÃO', COL.prec, 'center'],
      ['MAPA', COL.mapa, 'center'],
    ];
    for (const [t, w, align] of titulos) {
      doc.text(t, x + 6, y, { width: w - 12, align, lineBreak: false, characterSpacing: 0.4 });
      x += w;
    }
    doc
      .moveTo(MARGEM, y + 11)
      .lineTo(MARGEM + largura, y + 11)
      .lineWidth(0.8)
      .strokeColor(LINHA)
      .stroke();
    doc.y = y + 13;
  };

  const faixaDoDia = (dia: string, total: number, continuacao: boolean) => {
    const y = doc.y + 6;
    doc.roundedRect(MARGEM, y, largura, 20, 4).fillColor(AZUL).fill();
    doc.rect(MARGEM, y, 4, 20).fillColor(LARANJA).fill();
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#ffffff')
      .text(`${diaPorExtenso(dia)}${continuacao ? ' (continuação)' : ''}`, MARGEM + 12, y + 6, {
        width: largura - 160,
        lineBreak: false,
      });
    doc
      .font('Helvetica')
      .fontSize(8)
      .text(plural(total, 'lugar', 'lugares'), MARGEM, y + 6.5, {
        width: largura - 10,
        align: 'right',
        lineBreak: false,
      });
    doc.y = y + 26;
  };

  const novaPagina = () => {
    doc.addPage();
    cabecalho(false);
  };

  const botaoMapa = (x: number, y: number, w: number, url: string) => {
    const bw = Math.min(w - 10, 72);
    const bx = x + (w - bw) / 2;
    doc.roundedRect(bx, y + 6, bw, 14, 7).lineWidth(0.8).strokeColor(LARANJA).stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(LARANJA_TEXTO)
      .text('Abrir no mapa', bx, y + 9.5, { width: bw, align: 'center', lineBreak: false });
    doc.link(bx, y + 6, bw, 14, url);
  };

  const linhaDeLugar = (l: LinhaTagPdf, i: number) => {
    const y = doc.y;
    const url = linkDoEndereco(l.lat, l.lng, l.address);
    const exato = linkDoMapa(l.lat, l.lng);
    if (i % 2 === 1) doc.rect(MARGEM, y, largura, ALTURA).fillColor(ZEBRA).fill();
    let x = MARGEM;

    doc.font('Helvetica-Bold').fontSize(8).fillColor(TEXTO);
    doc.text(hora(l.time).slice(0, 5), x + 6, y + 5, { width: COL.hora - 8, lineBreak: false });
    doc.font('Helvetica').fontSize(6.6).fillColor(CINZA);
    const ate = l.count > 1 ? `até ${hora(l.untilTime).slice(0, 5)}` : 'uma vez';
    doc.text(ate, x + 6, y + 15, { width: COL.hora - 8, lineBreak: false });
    x += COL.hora;

    doc.font('Helvetica').fontSize(7.8).fillColor(TEXTO);
    doc.text(cortar(doc, l.address || 'Endereço não identificado', COL.endereco - 12), x + 6, y + 5, {
      width: COL.endereco - 12,
      lineBreak: false,
    });
    const ponto = `Ponto exato ${coordenada(l.lat, l.lng)}`;
    doc.font('Helvetica').fontSize(6.6).fillColor(CINZA);
    const larguraPonto = doc.widthOfString(ponto);
    doc.text(ponto, x + 6, y + 15, { width: COL.endereco - 12, lineBreak: false });
    const detalhe = [
      l.count > 1 ? `${l.count}x` : null,
      avancado && l.delayMin !== undefined ? `atraso ${l.delayMin} min` : null,
      avancado && l.source ? (l.source === 'APPLE_FINDMY' ? 'Find My' : l.source) : null,
    ]
      .filter(Boolean)
      .join(' · ');
    if (detalhe) {
      const resto = COL.endereco - 12 - larguraPonto - 4;
      doc.fillColor(LARANJA_TEXTO);
      doc.text(cortar(doc, ` · ${detalhe}`, resto), x + 6 + larguraPonto + 2, y + 15, {
        width: resto,
        lineBreak: false,
      });
    }
    doc.link(x, y, COL.endereco, 13, url);
    doc.link(x, y + 13, larguraPonto + 12, ALTURA - 13, exato);
    x += COL.endereco;

    doc.font('Helvetica').fontSize(8).fillColor(TEXTO);
    doc.text(l.accuracyM ? `${Math.round(l.accuracyM)} m` : '—', x, y + 9, {
      width: COL.prec,
      align: 'center',
      lineBreak: false,
    });
    x += COL.prec;

    botaoMapa(x, y, COL.mapa, url);
    doc
      .moveTo(MARGEM, y + ALTURA)
      .lineTo(MARGEM + largura, y + ALTURA)
      .lineWidth(0.4)
      .strokeColor(LINHA)
      .stroke();
    doc.y = y + ALTURA;
  };

  const semRegistros = () => {
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(CINZA)
      .text('Nenhum avistamento da TAG no período escolhido.', MARGEM, doc.y + 20, {
        width: largura,
        align: 'center',
      });
  };

  cabecalho(true);
  resumo();

  if (dados.type !== 'consolidado') {
    if (dados.rows.length === 0) semRegistros();
    const porDia = new Map<string, LinhaTagPdf[]>();
    for (const l of dados.rows) {
      const d = diaDe(l.time);
      const lista = porDia.get(d);
      if (lista) lista.push(l);
      else porDia.set(d, [l]);
    }
    for (const [dia, linhas] of porDia) {
      if (doc.y + 26 + 13 + ALTURA * 2 > limiteY()) novaPagina();
      faixaDoDia(dia, linhas.length, false);
      tituloDaTabela();
      linhas.forEach((l, i) => {
        if (doc.y + ALTURA > limiteY()) {
          novaPagina();
          faixaDoDia(dia, linhas.length, true);
          tituloDaTabela();
        }
        linhaDeLugar(l, i);
      });
      doc.y += 6;
    }
  } else {
    if (dados.days.length === 0) semRegistros();
    const C = { data: 130, qtd: 62, janela: 92, endereco: largura - 130 - 62 - 92 - 80, mapa: 80 };
    const titulo = () => {
      const y = doc.y + 6;
      doc.roundedRect(MARGEM, y, largura, 20, 4).fillColor(AZUL).fill();
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff');
      let x = MARGEM;
      for (const [t, w] of [
        ['DIA', C.data],
        ['AVISTAM.', C.qtd],
        ['PRIMEIRA / ÚLTIMA', C.janela],
        ['ONDE FOI VISTA POR ÚLTIMO', C.endereco],
        ['MAPA', C.mapa],
      ] as [string, number][]) {
        doc.text(t, x + 8, y + 7, { width: w - 12, lineBreak: false });
        x += w;
      }
      doc.y = y + 22;
    };
    titulo();
    dados.days.forEach((d, i) => {
      if (doc.y + ALTURA > limiteY()) {
        novaPagina();
        titulo();
      }
      const y = doc.y;
      const url = linkDoEndereco(d.lat, d.lng, d.address);
      if (i % 2 === 1) doc.rect(MARGEM, y, largura, ALTURA).fillColor(ZEBRA).fill();
      let x = MARGEM;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(TEXTO);
      doc.text(cortar(doc, diaPorExtenso(d.date), C.data - 12), x + 8, y + 9, { width: C.data - 12, lineBreak: false });
      x += C.data;
      doc.font('Helvetica').text(String(d.count), x + 8, y + 9, { width: C.qtd - 12, lineBreak: false });
      x += C.qtd;
      doc.fontSize(7.4).text(`${hora(d.firstSeen).slice(0, 5)} / ${hora(d.lastSeen).slice(0, 5)}`, x + 8, y + 9, {
        width: C.janela - 12,
        lineBreak: false,
      });
      x += C.janela;
      doc.fontSize(7.8);
      doc.text(cortar(doc, d.address || coordenada(d.lat, d.lng), C.endereco - 12), x + 8, y + 9, {
        width: C.endereco - 12,
        lineBreak: false,
      });
      doc.link(x, y, C.endereco, ALTURA, url);
      x += C.endereco;
      botaoMapa(x, y, C.mapa, url);
      doc
        .moveTo(MARGEM, y + ALTURA)
        .lineTo(MARGEM + largura, y + ALTURA)
        .lineWidth(0.4)
        .strokeColor(LINHA)
        .stroke();
      doc.y = y + ALTURA;
    });
  }

  const faixa = doc.bufferedPageRange();
  for (let i = 0; i < faixa.count; i++) {
    doc.switchToPage(faixa.start + i);
    const y = doc.page.height - MARGEM - 14;
    doc
      .moveTo(MARGEM, y - 6)
      .lineTo(MARGEM + largura, y - 6)
      .lineWidth(0.5)
      .strokeColor(LINHA)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(CINZA)
      .text(
        `Documento nº ${dados.numero} · Gerado em ${dataHora(dados.geradoEm)} · 21Go Proteção Veicular`,
        MARGEM,
        y,
        { width: largura - 80, lineBreak: false },
      );
    doc.text(`Página ${i + 1} de ${faixa.count}`, MARGEM, y, {
      width: largura,
      align: 'right',
      lineBreak: false,
    });
  }

  doc.end();
  return pronto;
}
