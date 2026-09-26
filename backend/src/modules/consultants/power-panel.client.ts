import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UsuarioPower } from './consultants.mapper';

/**
 * Painel do Power CRM (app.powercrm.com.br). SOMENTE LEITURA.
 *
 * Mesmo fluxo de login que o CRM usa (21 GO - CRM, modules/power/session.ts):
 *   1. POST /j_spring_security_check (form) → cookies de sessão
 *   2. POST /internal/selectCompany  (form, com os cookies) → { access_token } (~10h)
 *
 * Login próprio, sem depender do CRM: provado em 17/09/2026 que um segundo login
 * com a mesma conta NÃO derruba o token que o CRM está usando (200 antes e depois).
 *
 * NUNCA logar token, senha ou cookies.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

/** Renova com folga para o token não vencer no meio de uma coleta. */
const MARGEM_MS = 5 * 60 * 1000;

/** status 0 = ativos E bloqueados. */
const FILTRO = {
  limitToBranches: [],
  status: 0,
  office: 0,
  filterUser: true,
  functions: null,
  groupPermission: [],
  cooperativeIds: [],
  sortBy: null,
  sortDirection: null,
};

export interface PaginaPower {
  content: UsuarioPower[];
  totalElements: number;
  totalPages: number;
}

export class PowerRecusouError extends Error {}

@Injectable()
export class PowerPanelClient {
  private readonly logger = new Logger(PowerPanelClient.name);
  private token: { valor: string; expiraEm: number } | null = null;
  private loginEmAndamento: Promise<string> | null = null;

  constructor(private config: ConfigService) {}

  get configurado(): boolean {
    return Boolean(
      this.config.get<string>('power.username') && this.config.get<string>('power.password'),
    );
  }

  private get base(): string {
    return (this.config.get<string>('power.baseUrl') ?? '').replace(/\/+$/, '');
  }

  async listarUsuarios(page: number, size: number): Promise<PaginaPower> {
    try {
      return await this.chamarLista(await this.obterToken(), page, size);
    } catch (erro) {
      if (!(erro instanceof PowerRecusouError)) throw erro;
      // Uma retentativa só: se o relogin não resolveu, é credencial — insistir
      // só arrisca bloqueio da conta.
      this.token = null;
      return this.chamarLista(await this.obterToken(), page, size);
    }
  }

  private async chamarLista(token: string, page: number, size: number): Promise<PaginaPower> {
    const resp = await fetch(`${this.base}/company/userListFilter?page=${page}&size=${size}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        'user-agent': UA,
      },
      body: JSON.stringify(FILTRO),
      signal: AbortSignal.timeout(60_000),
    });
    if (resp.status === 401 || resp.status === 403) {
      throw new PowerRecusouError(`Power recusou o token (HTTP ${resp.status})`);
    }
    const corpo = await resp.text();
    if (!resp.ok) throw new Error(`Power HTTP ${resp.status} em userListFilter`);
    try {
      return JSON.parse(corpo) as PaginaPower;
    } catch {
      throw new Error('Power respondeu algo que não é JSON em userListFilter');
    }
  }

  private async obterToken(): Promise<string> {
    if (this.token && this.token.expiraEm - MARGEM_MS > Date.now()) return this.token.valor;
    if (!this.loginEmAndamento) {
      this.loginEmAndamento = this.login().finally(() => {
        this.loginEmAndamento = null;
      });
    }
    return this.loginEmAndamento;
  }

  private async login(): Promise<string> {
    const usuario = this.config.get<string>('power.username');
    const senha = this.config.get<string>('power.password');
    const empresa = this.config.get<string>('power.companyId');
    if (!usuario || !senha || !empresa) {
      throw new Error('Credenciais do Power não configuradas (POWER_LOGIN_USERNAME/PASSWORD/COMPANY_ID)');
    }

    const cookies = new Map<string, string>();
    const guardar = (resp: Response) => {
      for (const linha of resp.headers.getSetCookie()) {
        const par = linha.split(';')[0];
        const i = par.indexOf('=');
        if (i > 0) cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
      }
    };

    // `redirect: manual`: o sucesso é um 302, e os cookies vêm nessa resposta.
    const respLogin = await fetch(`${this.base}/j_spring_security_check`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml',
      },
      body: new URLSearchParams({ j_username: usuario, j_password: senha }).toString(),
      signal: AbortSignal.timeout(30_000),
    });
    guardar(respLogin);
    // O Spring manda cookie até quando recusa a senha: quem diz se deu certo é o destino.
    if ((respLogin.headers.get('location') ?? '').includes('/login') || !cookies.size) {
      throw new PowerRecusouError(`Login no Power recusado (HTTP ${respLogin.status})`);
    }

    // Form, não JSON: JSON aqui devolve 400.
    const respToken = await fetch(`${this.base}/internal/selectCompany`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        'user-agent': UA,
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: new URLSearchParams({ i: String(empresa) }).toString(),
      signal: AbortSignal.timeout(30_000),
    });
    const corpo = await respToken.text();
    if (!respToken.ok) throw new Error(`Power selectCompany HTTP ${respToken.status}`);
    let token: string | undefined;
    try {
      token = (JSON.parse(corpo) as { access_token?: string }).access_token;
    } catch {
      throw new Error('Power selectCompany respondeu algo que não é JSON');
    }
    if (!token) throw new PowerRecusouError('Power selectCompany não devolveu token');

    this.token = { valor: token, expiraEm: PowerPanelClient.expiracao(token) };
    this.logger.log('Login no Power OK');
    return token;
  }

  /** Lê o `exp` do JWT sem validar assinatura — só para saber quando renovar. */
  private static expiracao(jwt: string): number {
    try {
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')) as {
        exp?: number;
      };
      if (payload.exp) return payload.exp * 1000;
    } catch {
      // malformado: trata como sessão curta
    }
    return Date.now() + 60 * 60 * 1000;
  }
}
