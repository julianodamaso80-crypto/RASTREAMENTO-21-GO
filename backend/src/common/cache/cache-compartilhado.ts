export interface OpcoesCacheCompartilhado {
  maxEntradas: number;
  timeoutMs: number;
}

interface Entrada<T> {
  valor: T;
  expiraEm: number;
}

interface Montagem<T> {
  promessa: Promise<T>;
}

/**
 * Cache em processo com single-flight: quem pede a mesma chave enquanto ela
 * está sendo montada espera a mesma montagem, em vez de abrir outra.
 *
 * A "versão" de uma chave é a montagem registrada para ela: `invalidar` tira
 * o registro, e uma montagem que termina sem estar mais registrada entrega o
 * valor a quem já esperava, mas não grava. Falha e timeout não ficam guardados.
 *
 * Nem `invalidar` nem o timeout cancelam a montagem em voo: ela termina sozinha
 * e o resultado é descartado. Aceito porque quem monta já tem limite próprio
 * (o axios do Traccar corta em 30 s).
 */
export class CacheCompartilhado<T> {
  private readonly entradas = new Map<string, Entrada<T>>();
  private readonly emVoo = new Map<string, Montagem<T>>();

  constructor(private readonly opcoes: OpcoesCacheCompartilhado) {}

  /** ttlMs pode depender do valor montado (ex.: resultado degradado dura menos). */
  obter(
    chave: string,
    ttlMs: number | ((valor: T) => number),
    montar: () => Promise<T>,
  ): Promise<T> {
    const entrada = this.entradas.get(chave);
    if (entrada) {
      this.entradas.delete(chave);
      if (Date.now() < entrada.expiraEm) {
        this.entradas.set(chave, entrada);
        return Promise.resolve(entrada.valor);
      }
    }

    const voando = this.emVoo.get(chave);
    if (voando) return voando.promessa;

    const montagem = {} as Montagem<T>;
    montagem.promessa = this.comTimeout(montar).then(
      (valor) => {
        if (this.emVoo.get(chave) === montagem) {
          this.emVoo.delete(chave);
          const ttl = typeof ttlMs === 'function' ? ttlMs(valor) : ttlMs;
          this.gravar(chave, { valor, expiraEm: Date.now() + ttl });
        }
        return valor;
      },
      (erro: unknown) => {
        if (this.emVoo.get(chave) === montagem) this.emVoo.delete(chave);
        throw erro;
      },
    );
    this.emVoo.set(chave, montagem);
    return montagem.promessa;
  }

  /** Sobe a versão da chave: a entrada vigente deixa de ser fresca e uma montagem em voo iniciada antes NÃO é gravada ao terminar (mas ainda é entregue a quem já esperava por ela). */
  invalidar(chave: string): void {
    this.entradas.delete(chave);
    this.emVoo.delete(chave);
  }

  /** Esquece tudo (entradas e montagens em voo seguem até terminar, mas não são reaproveitadas). */
  limpar(): void {
    this.entradas.clear();
    this.emVoo.clear();
  }

  tamanho(): number {
    return this.entradas.size;
  }

  private gravar(chave: string, entrada: Entrada<T>): void {
    this.entradas.delete(chave);
    this.entradas.set(chave, entrada);
    while (this.entradas.size > this.opcoes.maxEntradas) {
      const maisAntiga = this.entradas.keys().next().value as string;
      this.entradas.delete(maisAntiga);
    }
  }

  private comTimeout(montar: () => Promise<T>): Promise<T> {
    const { timeoutMs } = this.opcoes;
    const trabalho = new Promise<T>((resolve) => resolve(montar()));
    let timer: NodeJS.Timeout | undefined;
    const estouro = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`cache: montagem excedeu ${timeoutMs} ms`)),
        timeoutMs,
      );
    });
    // Depois do estouro a montagem segue rodando; o erro tardio dela não pode
    // virar unhandled rejection.
    trabalho.catch(() => undefined);
    return Promise.race([trabalho, estouro]).finally(() => clearTimeout(timer));
  }
}
