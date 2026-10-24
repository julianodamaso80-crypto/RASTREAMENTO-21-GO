import { existsSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import type { TipoRelatorio } from './history-report';

export interface LinhaPdf {
  time: string;
  lat: number;
  lng: number;
  speed: number;
  ignition: boolean | null;
  event: string | null;
  address: string | null;
  gprs?: string;
  gps?: string;
  direction?: string;
}

export interface DiaPdf {
  date: string;
  maxSpeed: number;
  lat: number;
  lng: number;
  address: string | null;
}

export interface DadosHistoricoPdf {
  numero: string;
  plate: string;
  veiculo: string | null;
  associado: string | null;
  from: string;
  to: string;
  type: TipoRelatorio;
  totals: { distanceKm: number; ignitionOnMin: number; ignitionOffMin: number };
  rows: LinhaPdf[];
  days: DiaPdf[];
  geradoEm: Date;
}

/** Cores da marca (manual_marca_21go): azul institucional, laranja e verde. */
export const AZUL = '#293c82';
export const AZUL_ESCURO = '#1f2d63';
export const LARANJA = '#f2911d';
export const LARANJA_TEXTO = '#c0700a';
export const VERDE = '#c7d301';
export const CINZA = '#5b6478';
export const TEXTO = '#1f2533';
export const LINHA = '#e3e7ef';
export const ZEBRA = '#f6f7fb';
export const CARTAO = '#f1f4f9';

export const MARGEM = 32;
export const FUSO = 'America/Sao_Paulo';
const TIPO_ROTULO: Record<TipoRelatorio, string> = {
  basico: 'Básico',
  avancado: 'Avançado',
  consolidado: 'Consolidado',
};

export function linkDoMapa(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * Link que abre o Google já com o nome da rua (pedido do dono: coordenada
 * não diz nada para quem lê). Só quando o endereço tem a rua; endereço que é
 * só a cidade levaria ao centro dela, então cai na coordenada exata.
 */
export function linkDoEndereco(lat: number, lng: number, endereco: string | null): string {
  if (!endereco || endereco.split(',').length < 2) return linkDoMapa(lat, lng);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}`;
}

export function dataHora(iso: string | Date): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: FUSO,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    timeZone: FUSO,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** "2026-10-13" no fuso de Brasília. */
export function diaDe(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: FUSO });
}

export function diaPorExtenso(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  const texto = d.toLocaleDateString('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function duracao(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

function km(valor: number): string {
  return `${valor.toFixed(1).replace('.', ',')} km`;
}

export function coordenada(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/**
 * pdfkit quebra linha mesmo com `lineBreak: false` quando o texto não cabe.
 * Corta na medida real da fonte já aplicada.
 */
export function cortar(doc: PDFKit.PDFDocument, texto: string, largura: number): string {
  if (doc.widthOfString(texto) <= largura) return texto;
  let corte = texto;
  while (corte.length > 1 && doc.widthOfString(`${corte}…`) > largura) {
    corte = corte.slice(0, -1);
  }
  return `${corte}…`;
}

export function logo(): string | null {
  const candidatos = [
    join(process.cwd(), 'assets', 'logo-21go.png'),
    join(__dirname, '..', '..', '..', '..', 'assets', 'logo-21go.png'),
  ];
  return candidatos.find((c) => existsSync(c)) ?? null;
}

/**
 * Histórico de localização em PDF, para entregar ao associado (multa, sinistro,
 * comprovação de onde o carro estava). A4 em pé, cabeçalho com a marca, resumo
 * do período e as posições separadas por dia, cada uma com link para o Google
 * Maps. Devolve o arquivo inteiro em memória.
 */
export function gerarHistoricoPdf(dados: DadosHistoricoPdf): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGEM,
    bufferPages: true,
    info: {
      Title: `Histórico de localização ${dados.plate}`,
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
      // O PNG é 512×512 com a marca (texto branco, feito para fundo escuro)
      // ocupando só x 20–492, y 146–354. Desenha a imagem inteira deslocada
      // para que a parte visível fique no lugar e na altura certos.
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
      .text('Relatório de Localização', MARGEM, primeira ? 20 : 12, {
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
          ? 'Histórico de posições do veículo no período'
          : `${dados.plate} · ${dataHora(dados.from)} a ${dataHora(dados.to)}`,
        MARGEM,
        primeira ? 42 : 27,
        { width: largura, align: 'right', lineBreak: false },
      );
    doc.y = altura + 18;
  };

  const resumo = () => {
    const itens: [string, string][] = [
      ['Placa', dados.plate],
      ['Veículo', dados.veiculo || '—'],
      ['Associado', dados.associado || '—'],
      ['Relatório', TIPO_ROTULO[dados.type]],
      ['Início', dataHora(dados.from)],
      ['Fim', dataHora(dados.to)],
      ['Distância percorrida', km(dados.totals.distanceKm)],
      [
        'Ignição ligada / desligada',
        `${duracao(dados.totals.ignitionOnMin)} / ${duracao(dados.totals.ignitionOffMin)}`,
      ],
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
    doc.y = y0 + 2 * h + gap + 14;
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(CINZA)
      .text(
        'Horários de Brasília. "Abrir no mapa" mostra a rua no Google Maps; clique em "Ponto exato" para a posição precisa do GPS.',
        MARGEM,
        doc.y,
        { width: largura },
      );
    doc.y += 8;
  };

  // ---- Tabela de posições (básico/avançado) ------------------------------
  const avancado = dados.type === 'avancado';
  const COL = { hora: 52, endereco: 287, vel: 40, ign: 62, mapa: largura - 52 - 287 - 40 - 62 };
  const ALTURA = 26;

  const tituloDaTabela = () => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(6.8).fillColor(CINZA);
    let x = MARGEM;
    const titulos: [string, number, 'left' | 'center'][] = [
      ['HORA', COL.hora, 'left'],
      ['ENDEREÇO', COL.endereco, 'left'],
      ['KM/H', COL.vel, 'center'],
      ['IGNIÇÃO', COL.ign, 'center'],
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
        width: largura - 140,
        lineBreak: false,
      });
    doc
      .font('Helvetica')
      .fontSize(8)
      .text(`${total} ${total === 1 ? 'registro' : 'registros'}`, MARGEM, y + 6.5, {
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

  const linhaDePosicao = (l: LinhaPdf, i: number) => {
    const y = doc.y;
    const url = linkDoEndereco(l.lat, l.lng, l.address);
    const exato = linkDoMapa(l.lat, l.lng);
    if (i % 2 === 1) doc.rect(MARGEM, y, largura, ALTURA).fillColor(ZEBRA).fill();
    let x = MARGEM;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(TEXTO);
    doc.text(hora(l.time), x + 6, y + 9, { width: COL.hora - 8, lineBreak: false });
    x += COL.hora;

    const detalhe = [
      l.event,
      avancado && l.gps ? `GPS ${hora(l.gps)}` : null,
      avancado && l.gprs ? `GPRS ${hora(l.gprs)}` : null,
      avancado && l.direction ? l.direction : null,
    ]
      .filter(Boolean)
      .join(' · ');
    doc.font('Helvetica').fontSize(7.8).fillColor(TEXTO);
    const endereco = l.address || 'Endereço não identificado';
    doc.text(cortar(doc, endereco, COL.endereco - 12), x + 6, y + 5, {
      width: COL.endereco - 12,
      lineBreak: false,
    });
    // Segunda linha: o ponto exato (prova) e o evento, se houver.
    const ponto = `Ponto exato ${coordenada(l.lat, l.lng)}`;
    doc.font('Helvetica').fontSize(6.6).fillColor(CINZA);
    const larguraPonto = doc.widthOfString(ponto);
    doc.text(ponto, x + 6, y + 15, { width: COL.endereco - 12, lineBreak: false });
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
    doc.text(String(l.speed), x, y + 9, { width: COL.vel, align: 'center', lineBreak: false });
    x += COL.vel;

    const ign = l.ignition === null ? '—' : l.ignition ? 'Ligada' : 'Desligada';
    doc
      .font(l.ignition ? 'Helvetica-Bold' : 'Helvetica')
      .fillColor(l.ignition ? '#0b6b39' : CINZA)
      .text(ign, x, y + 9, { width: COL.ign, align: 'center', lineBreak: false });
    x += COL.ign;

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
      .text('Nenhuma posição registrada no período escolhido.', MARGEM, doc.y + 20, {
        width: largura,
        align: 'center',
      });
  };

  cabecalho(true);
  resumo();

  if (dados.type !== 'consolidado') {
    if (dados.rows.length === 0) semRegistros();
    const porDia = new Map<string, LinhaPdf[]>();
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
        linhaDePosicao(l, i);
      });
      doc.y += 6;
    }
  } else {
    if (dados.days.length === 0) semRegistros();
    const C = { data: 150, vel: 80, endereco: largura - 150 - 80 - 90, mapa: 90 };
    const titulo = () => {
      const y = doc.y + 6;
      doc.roundedRect(MARGEM, y, largura, 20, 4).fillColor(AZUL).fill();
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff');
      let x = MARGEM;
      for (const [t, w] of [
        ['DIA', C.data],
        ['VEL. MÁXIMA', C.vel],
        ['ONDE ESTAVA NA VELOCIDADE MÁXIMA', C.endereco],
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
      doc.font('Helvetica').text(`${d.maxSpeed} km/h`, x + 8, y + 9, { width: C.vel - 12, lineBreak: false });
      x += C.vel;
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

  // Rodapé em todas as páginas, com "Página N de M".
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
