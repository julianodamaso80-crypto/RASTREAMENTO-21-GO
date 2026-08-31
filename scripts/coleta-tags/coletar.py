"""
Coleta as posições das TAGs na rede Find My e grava num CSV.

Roda dentro do container `r21go-ktag-worker`, que tem a lib findmy 0.10.1.
Quem chama é o `rodar.sh`, que cuida do banco antes e depois.

Três coisas aqui existem para proteger a conta Apple, e nenhuma é enfeite:

  1. **Uma passada por execução.** O script não tem laço interno: entra,
     consulta, sai. Quem decide a frequência é o cron — assim não existe
     processo esquecido consultando sem parar.

  2. **Sessão recusada encerra a execução na hora.** Se a Apple devolver
     `UnauthorizedError`, insistir é o caminho mais rápido para a conta ser
     bloqueada de vez. O script sai com código 3, o `rodar.sh` para de agendar
     e o log diz o que fazer.

  3. **Lotes de 256.** É o teto que a Apple aceita por requisição. Mandar mais
     não devolve erro claro, devolve resposta incompleta.
"""
import csv
import json
import sys
from datetime import timezone

from findmy import KeyPair
from findmy.reports import AppleAccount, RemoteAnisetteProvider
from findmy.errors import UnauthorizedError

TAMANHO_DO_LOTE = 256
SESSAO = '/sessao/account.json'
ENTRADA = '/sessao/todas.csv'
SAIDA = '/sessao/posicoes.csv'
ANISETTE = 'http://localhost:6969'

SAI_OK = 0
SAI_ERRO = 1
SAI_SESSAO_MORTA = 3


def carregar_chaves():
    """CSV do banco: numero|chave_privada|placa"""
    itens = []
    with open(ENTRADA, encoding='utf-8') as f:
        for linha in f:
            p = linha.rstrip('\n').split('|')
            if len(p) >= 2 and p[1].strip():
                itens.append({
                    'sn': p[0].strip(),
                    'priv': p[1].strip(),
                    'placa': p[2].strip() if len(p) > 2 else '',
                })
    return itens


def main() -> int:
    itens = carregar_chaves()
    print(f'chaves carregadas: {len(itens)}', flush=True)
    if not itens:
        print('nenhuma chave — nada a consultar', flush=True)
        return SAI_OK

    try:
        estado = json.loads(open(SESSAO, encoding='utf-8').read())
    except (OSError, ValueError) as erro:
        print(f'ERRO: sessao da Apple ausente ou ilegivel ({erro})', flush=True)
        print('Refazer o login manual uma vez — o codigo chega no iPhone.', flush=True)
        return SAI_SESSAO_MORTA

    conta = AppleAccount(RemoteAnisetteProvider(ANISETTE), state_info=estado)
    if 'LOGGED_IN' not in str(conta.login_state):
        print(f'ERRO: sessao invalida ({conta.login_state})', flush=True)
        return SAI_SESSAO_MORTA
    print(f'sessao ok: {conta.account_name}', flush=True)

    # O relatório volta identificado pelo hash da chave, não pelo número da
    # TAG. Este mapa é o que devolve o número (e a placa) a cada avistamento.
    por_hash = {}
    chaves = []
    for item in itens:
        par = KeyPair.from_b64(item['priv'])
        chaves.append(par)
        por_hash[par.hashed_adv_key_b64] = item

    total = 0
    with open(SAIDA, 'w', newline='', encoding='utf-8') as arquivo:
        escritor = csv.writer(arquivo)
        for inicio in range(0, len(chaves), TAMANHO_DO_LOTE):
            pedaco = chaves[inicio:inicio + TAMANHO_DO_LOTE]
            numero = inicio // TAMANHO_DO_LOTE + 1
            print(f'lote {numero}: {len(pedaco)} chaves', flush=True)

            try:
                historico = conta.fetch_location_history(pedaco)
            except UnauthorizedError:
                print('ERRO: a Apple RECUSOU a sessao.', flush=True)
                print('Parando agora — insistir e o que derruba a conta de vez.', flush=True)
                print('Refazer o login manual uma vez.', flush=True)
                return SAI_SESSAO_MORTA
            except Exception as erro:
                print(f'ERRO no lote {numero}: {erro}', flush=True)
                # Um lote que falha não pode levar os outros junto: o que já
                # foi escrito no CSV vale, e o proximo ciclo tenta de novo.
                continue

            for relatorios in historico.values():
                for r in relatorios:
                    item = por_hash.get(r.hashed_adv_key_b64)
                    if not item:
                        continue
                    quando = r.timestamp
                    if quando.tzinfo is None:
                        quando = quando.replace(tzinfo=timezone.utc)

                    precisao = getattr(r, 'horizontal_accuracy', None)
                    try:
                        # O backend valida 0..50000; fora disso é melhor perder
                        # a precisão do que perder a posição inteira.
                        precisao = int(precisao) if precisao is not None else ''
                        if not 0 <= precisao <= 50000:
                            precisao = ''
                    except (TypeError, ValueError, OverflowError):
                        precisao = ''

                    escritor.writerow([
                        item['sn'], item['placa'],
                        r.latitude, r.longitude, precisao,
                        quando.isoformat(),
                    ])
                    total += 1

    print(f'AVISTAMENTOS: {total}', flush=True)
    return SAI_OK


if __name__ == '__main__':
    sys.exit(main())
