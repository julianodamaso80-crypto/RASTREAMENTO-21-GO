import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { interpretarTermo, orDeCampos } from '../../common/search/termo-busca';

/**
 * Busca única do painel.
 *
 * O atendimento tem UM dado na mão — placa, chassi, CPF, nome, chip ou IMEI —
 * e precisa achar o associado esteja ele onde estiver. Antes, cada tela buscava
 * num conjunto diferente de campos: o Estoque só achava por IMEI/chip, Chips só
 * por ICCID, e quem ainda não tinha rastreador instalado não aparecia em lugar
 * nenhum. Aqui as seis fontes são varridas de uma vez.
 */

export type TipoResultado =
  | 'ATIVO'
  | 'VEICULO'
  | 'PENDENCIA'
  | 'CADASTRO_SGA'
  | 'ESTOQUE'
  | 'CHIP'
  | 'TAG';

export interface ItemResultado {
  tipo: TipoResultado;
  id: string;
  titulo: string;
  subtitulo: string;
  detalhes: string[];
  /** Para onde o clique leva. Null quando não há tela que abra este registro. */
  href: string | null;
  /** Situação do cadastro no SGA, quando conhecida (ATIVO, INADIMPLENTE…). */
  situacao?: string;
}

export interface GrupoResultado {
  tipo: TipoResultado;
  titulo: string;
  itens: ItemResultado[];
}

const TITULO_GRUPO: Record<TipoResultado, string> = {
  ATIVO: 'Ativos (com rastreador)',
  VEICULO: 'Veículos sem rastreador',
  PENDENCIA: 'Pendentes de instalação',
  CADASTRO_SGA: 'Cadastro no SGA',
  ESTOQUE: 'Estoque',
  CHIP: 'Chips',
  TAG: 'TAGs',
};

/** Ordem em que os grupos aparecem: o que resolve atendimento vem primeiro. */
const ORDEM: TipoResultado[] = [
  'ATIVO',
  'VEICULO',
  'PENDENCIA',
  'CADASTRO_SGA',
  'ESTOQUE',
  'CHIP',
  'TAG',
];

/** Teto por fonte no banco. Acima disso o termo é vago demais para servir. */
const TETO_POR_FONTE = 30;
const PADRAO_POR_GRUPO = 8;

function limpo(...partes: (string | number | null | undefined)[]): string[] {
  return partes
    .map((p) => (p === null || p === undefined ? '' : String(p).trim()))
    .filter(Boolean);
}

function formatarDocumento(doc?: string | null): string | null {
  const d = (doc ?? '').replace(/\D/g, '');
  if (d.length === 11) return `CPF ${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14)
    return `CNPJ ${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d ? `Doc. ${d}` : null;
}

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async buscar(tenantId: string, q?: string, porGrupo = PADRAO_POR_GRUPO) {
    const termo = interpretarTermo(q);
    if (!termo) return { termo: '', total: 0, grupos: [] as GrupoResultado[] };

    const or = (campos: Parameters<typeof orDeCampos>[1]) =>
      orDeCampos(termo, campos);

    // Cada fonte só é consultada quando existe campo que possa casar com o
    // termo — buscar um nome na tabela de chips (que só tem número) seria uma
    // consulta garantidamente vazia.
    const [veiculos, pendencias, sga, estoque, chips, tags] = await Promise.all([
      this.buscarEm('vehicle', tenantId, or({
        texto: ['brand', 'model', 'color', 'associate.name'],
        alfanumerico: ['plate', 'chassi', 'renavam'],
        documento: ['associate.cpf'],
        identificador: [
          'device.imei',
          'uniqueId',
          'associate.phone',
          'device.chip.iccid',
          'device.chip.phoneNumber',
        ],
      }), {
        deletedAt: null,
        include: {
          associate: true,
          device: { include: { chip: true } },
        },
      }),
      this.buscarEm('installationPending', tenantId, or({
        texto: ['associateName', 'brandModel', 'city', 'neighborhood'],
        alfanumerico: ['plate', 'chassi'],
        documento: ['cpf'],
        identificador: ['phone'],
      })),
      this.buscarEm('sgaVehicle', tenantId, or({
        texto: ['associateName', 'brandModel'],
        alfanumerico: ['plate', 'chassi'],
        documento: ['cpf'],
        identificador: ['phone'],
      })),
      this.buscarEm('stockItem', tenantId, or({
        texto: ['operator'],
        identificador: ['imei', 'iccid', 'line'],
      }), { deletedAt: null }),
      this.buscarEm('chip', tenantId, or({
        identificador: ['iccid', 'phoneNumber'],
      }), { deletedAt: null }),
      this.buscarEm('rdvTag', tenantId, or({
        alfanumerico: ['plate', 'chassi'],
        identificador: ['tagIdentifier'],
      })),
    ]);

    const ativos: ItemResultado[] = [];
    const semRastreador: ItemResultado[] = [];
    for (const v of veiculos) {
      (v.device ? ativos : semRastreador).push(this.itemVeiculo(v));
    }

    // A placa que já apareceu como ativo não se repete nas fontes de cadastro:
    // o operador leria a mesma placa três vezes e acharia que são registros
    // diferentes.
    const jaMostradas = new Set(
      [...ativos, ...semRastreador].map((i) => i.titulo.toUpperCase()),
    );

    const grupos: GrupoResultado[] = [
      { tipo: 'ATIVO', itens: ativos },
      { tipo: 'VEICULO', itens: semRastreador },
      {
        tipo: 'PENDENCIA',
        itens: pendencias
          .filter((p) => !jaMostradas.has(String(p.plate).toUpperCase()))
          .map((p) => this.itemPendencia(p)),
      },
      {
        tipo: 'CADASTRO_SGA',
        itens: sga
          .filter((s) => !jaMostradas.has(String(s.plate).toUpperCase()))
          .map((s) => this.itemSga(s)),
      },
      { tipo: 'ESTOQUE', itens: estoque.map((e) => this.itemEstoque(e)) },
      { tipo: 'CHIP', itens: chips.map((c) => this.itemChip(c)) },
      { tipo: 'TAG', itens: tags.map((t) => this.itemTag(t)) },
    ]
      .filter((g) => g.itens.length > 0)
      .map((g) => ({
        tipo: g.tipo as TipoResultado,
        titulo: TITULO_GRUPO[g.tipo as TipoResultado],
        itens: g.itens.slice(0, porGrupo),
      }))
      .sort((a, b) => ORDEM.indexOf(a.tipo) - ORDEM.indexOf(b.tipo));

    return {
      termo: termo.texto,
      total: grupos.reduce((soma, g) => soma + g.itens.length, 0),
      grupos,
    };
  }

  /** Consulta uma fonte. OR vazio = nenhum campo pode casar: nem vai ao banco. */
  private async buscarEm(
    tabela: string,
    tenantId: string,
    or: Record<string, unknown>[],
    extra: Record<string, unknown> = {},
  ): Promise<any[]> {
    if (or.length === 0) return [];
    const { include, ...where } = extra as any;
    return (this.prisma as any)[tabela].findMany({
      where: { tenantId, ...where, OR: or },
      take: TETO_POR_FONTE,
      ...(include ? { include } : {}),
    });
  }

  private itemVeiculo(v: any): ItemResultado {
    const doc = formatarDocumento(v.associate?.cpf);
    return {
      tipo: v.device ? 'ATIVO' : 'VEICULO',
      id: v.id,
      titulo: v.plate,
      subtitulo: v.associate?.name ?? 'Sem associado vinculado',
      detalhes: limpo(
        [v.brand, v.model].filter(Boolean).join(' ') || null,
        doc,
        v.associate?.phone,
        v.device?.imei ? `IMEI ${v.device.imei}` : null,
        v.device?.chip?.line ?? v.device?.chip?.phoneNumber
          ? `Chip ${v.device.chip.phoneNumber ?? ''}`.trim()
          : null,
        v.chassi ? `Chassi ${v.chassi}` : null,
      ),
      // Ativo abre no mapa focado (é o que o operador quer ver quando o cliente
      // liga); sem rastreador não há o que mostrar no mapa, vai pra ficha.
      href: v.device
        ? `/mapa?placa=${encodeURIComponent(v.plate)}`
        : `/veiculos/${v.id}`,
      situacao: v.sgaStatusLabel ?? undefined,
    };
  }

  private itemPendencia(p: any): ItemResultado {
    return {
      tipo: 'PENDENCIA',
      id: p.id,
      titulo: p.plate || p.chassi,
      subtitulo: p.associateName,
      detalhes: limpo(
        p.pendingType === 'TAG' ? 'Aguardando TAG' : 'Aguardando rastreador',
        p.brandModel,
        formatarDocumento(p.cpf),
        p.phone,
        [p.neighborhood, p.city].filter(Boolean).join(' · ') || null,
      ),
      href: `/pendencias?busca=${encodeURIComponent(p.plate || p.chassi || '')}`,
    };
  }

  private itemSga(s: any): ItemResultado {
    return {
      tipo: 'CADASTRO_SGA',
      id: s.id,
      titulo: s.plate || s.chassi,
      subtitulo: s.associateName,
      detalhes: limpo(
        s.brandModel,
        formatarDocumento(s.cpf),
        s.phone,
        s.email,
        s.chassi ? `Chassi ${s.chassi}` : null,
      ),
      // Cadastro do SGA não é registro nosso: não há tela que o abra. Os dados
      // que o atendimento precisa já estão no próprio resultado.
      href: null,
      situacao: s.situationLabel ?? undefined,
    };
  }

  private itemEstoque(e: any): ItemResultado {
    return {
      tipo: 'ESTOQUE',
      id: e.id,
      titulo: e.imei,
      subtitulo: e.associatedAt ? 'Vinculado' : 'Disponível no estoque',
      detalhes: limpo(
        e.operator,
        e.line ? `Linha ${e.line}` : null,
        e.iccid ? `ICCID ${e.iccid}` : null,
        e.status,
      ),
      href: `/estoque?busca=${encodeURIComponent(e.imei)}`,
    };
  }

  private itemChip(c: any): ItemResultado {
    return {
      tipo: 'CHIP',
      id: c.id,
      titulo: c.phoneNumber || c.iccid,
      subtitulo: c.operator,
      detalhes: limpo(`ICCID ${c.iccid}`, c.status),
      href: `/chips?busca=${encodeURIComponent(c.iccid)}`,
    };
  }

  private itemTag(t: any): ItemResultado {
    return {
      tipo: 'TAG',
      id: t.id,
      titulo: t.plate || t.chassi,
      subtitulo: t.tagModel ?? 'TAG',
      detalhes: limpo(
        t.tagIdentifier ? `Série ${t.tagIdentifier}` : null,
        t.chassi ? `Chassi ${t.chassi}` : null,
      ),
      href: `/tags-ativas?busca=${encodeURIComponent(t.plate || '')}`,
    };
  }
}
