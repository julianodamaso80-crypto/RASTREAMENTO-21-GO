import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

/**
 * O backend inteiro precisa MONTAR.
 *
 * Em 26/08/2026 um `imports: [TraccarModule]` sem `forwardRef` derrubou a API
 * em produção: `tsc` passou, os 247 testes passaram, e o container morreu no
 * boot com `UndefinedModuleException` — dependência circular entre módulos.
 * Nada no CI olhava o grafo de dependências.
 *
 * `compile()` monta o grafo sem chamar `onModuleInit`, então não abre conexão
 * com banco, Redis ou Traccar: é barato e pega exatamente essa classe de erro.
 */
jest.setTimeout(60_000);

describe('AppModule', () => {
  it('monta o grafo de dependências inteiro', async () => {
    const ref = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(ref).toBeDefined();
    await ref.close();
  });
});
