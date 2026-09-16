# TAGs rastreáveis — vínculo provado, localização provada, só time interno

**Data:** 16/09/2026 · **Status:** desenho aprovado pelo dono, parte a parte

## 1. Objetivo

Todo associado que tem TAG nossa (K-Tag, rede Find My) fica rastreável **pelo time
interno**, sem invenção: o vínculo TAG → associado é conferido na Rede e no SGA, e
a posição é conferida contra fontes independentes. TAG sem vínculo vai para o
Estoque, livre para vincular.

**Regra que se sobrepõe a tudo:** o associado nunca vê, lista nem infere a TAG —
se souber, o bandido arranca. Vale para web, Android, iOS, role `CLIENT` e `/app/*`.

## 2. Insumos medidos (16/09/2026)

| Arquivo | Conteúdo | Situação |
|---|---|---|
| `21GO! 500 KTAGS - 15_09_2026.xlsx` | 500 chaves (SN, MAC, privateKey, hashedAdvKey), lote 808092, SN `808092604011925`–`808092604223132` | 500/500 com tamanho válido (17 com `=` do Excel). 0 no espelho `rdv_tags` (parado em 27/08) |
| `500 KTAGS - 21 GO! - 30_07_2026.xlsx` | 500 chaves, SN `808092605072173`–`808092605165043` | Já em `tag_keys`. 394 no espelho, 377 com SGA ATIVO |
| `TAGS 21GO (1).xlsx` | 905 SNs (coluna "IMEI" = SN da TAG): 400 de 28/08, 500 de 31/08, 5 de 06/03 | **0 com chave.** O dono confirmou: o fornecedor mandou o arquivo errado. Ficam fora até chegar o certo |

Nenhum SN da lista coincide com os arquivos de chave (testado também por prefixo
de 14 dígitos e sufixos de 6 e 8).

## 3. Pré-requisito: coleta Find My está parada

**Provado:** a última coleta boa foi em 11/09 às 10h17 UTC; o droplet reiniciou às
11h03 (troca de plano); o anisette gerou identidade nova às 11:03:46; desde as
11h17 todo ciclo falha. Um teste com log DEBUG em 16/09 mostrou a sequência:
sessão `LOGGED_IN` → fetch **401** → relogin automático da findmy 0.10.1 →
**GSA 503** no `init`. O motor do MonitoraBem (mesma conta) morreu no mesmo minuto.
Os dois crons foram **pausados** em 16/09 (backup em
`/root/crontab-backup-2026-09-16.txt`).

**Hipótese (não provada):** a Apple rejeita a identidade de máquina nova.

**Passos:**
1. Copiar `/home/Alcoholic/.config/anisette-v3/` para fora e recriar o container
   `anisette` com essa pasta inteira num volume.
2. Um login novo da conta Apple, com 2FA no iPhone do dono (fluxo de 31/08), salvo
   em `/root/findmy-sessao/account.json`. A sessão antiga vai para backup, não é
   apagada. O motor do MonitoraBem recebe a mesma sessão nova.
3. `rodar.sh`: **3 ciclos seguidos com erro** (qualquer exceção que não seja
   `UnauthorizedError`) criam `PARADO` com o motivo, igual à sessão recusada.
4. Religar os dois crons.

**Pronto quando:** um ciclo grava linhas em `tag_positions` com `seen_at` do dia,
conferido por SQL.

**Plano B**, só se o login falhar e com aviso prévio ao dono: identidade antiga do
backup DO de 10/09. Exige subir um clone de produção, que liga crons de boleto,
WhatsApp e SGA. Por isso não é o primeiro caminho.

## 4. Limites da DigitalOcean

Antes de cada etapa pesada (carga da Rede, migration, build), medir disco e memória
(`df`, `free`, API `/v2`). **Qualquer medida ≥ 70% interrompe e aumenta antes de
seguir.** Em 16/09: disco 51% (157/309 GB), 8,6 GB de RAM livres, 1 de 15 droplets.
`tag_positions` tem 512 mil linhas; 1.000 TAGs somam cerca de 7 mil pontos por dia.

## 5. Importação de chaves

Script `backend/scripts/import-tag-keys.ts <arquivo.xlsx> [--dry]`:

- Colunas por cabeçalho (`SN码`, `Key名称…`, `MAC地址`, `privateKey值`, `hashedAdvKey值`), não por posição.
- Remove o `=` inicial **antes** de validar: privateKey = 28 bytes, hashedAdvKey = 32 bytes.
- Round-trip de decifragem por chave (cifra uma coordenada como um iPhone e decifra). Se falhar, a chave não entra.
- SN ou hash já existente no tenant: recusa, nunca sobrescreve.
- Grava `tag_keys` com `batch` = 6 primeiros dígitos. Relatório: aceitas, recusadas com SN e motivo.
- `--dry` não precisa de banco.

## 6. Vínculo TAG → associado (Rede + SGA)

**Calibração obrigatória:** busca por SN no painel da Rede (só leitura, sessão do
dono) em 20 TAGs com placa conhecida em `rdv_tags`. O método só é usado nas demais
se acertar 20/20.

Para cada SN com chave, a resposta vira um destes estados:

| Estado | Condição |
|---|---|
| `VINCULADA` | A Rede mostra a TAG em um veículo; a placa (ou o chassi, no 0km) existe em `sga_vehicles` com `situation_code = '1'` |
| `VINCULADA_INATIVO` | A Rede mostra o vínculo e a situação no SGA ≠ 1 |
| `LIVRE` | Resposta válida da Rede (sessão ok, busca concluída), sem veículo |
| `SEM_RESPOSTA` | Erro, sessão caída ou formato não reconhecido. Não decide nada |

"Não achei" **nunca** vira `LIVRE`. A adesão do SGA (8/9) é registrada, mas não bloqueia.

## 7. Portão de localização

Funções puras em `backend/src/modules/ble-tags/tag-vinculo/`. Entrada: avistamentos
próprios (`tag_positions`), último ponto da TAG na Rede e posições do rastreador do
mesmo veículo (Rede ou nosso Traccar).

| Prova | Bate quando |
|---|---|
| **P1** mesmo avistamento (KTAG, ponto T da Rede) | \|Δt\| ≤ 2 min e distância ≤ 50 m |
| **P2** rastreador do mesmo carro | \|Δt\| ≤ 10 min e distância ≤ `accuracy_m` + 300 m |
| **P3** TAG livre parada | Avistamentos de 7 dias todos a ≤ 1 km entre si |
| **Contradição** | \|Δt\| ≤ 10 min e distância > 2 km |

| Veredito | Regra | Destino |
|---|---|---|
| `CONFIRMADA` | `VINCULADA` + (P1 ou P2) + nenhuma contradição | Clientes Ativos (interno) |
| `DIVERGENTE` | Qualquer contradição | Revisão, com destaque |
| `AGUARDANDO_PROVA` | `VINCULADA` sem par comparável | Revisão; reavaliada a cada coleta |
| `ESTOQUE` | `LIVRE` + P3 (ou sem avistamento) | Estoque de TAG |
| `LIVRE_EM_MOVIMENTO` | `LIVRE` e P3 falha | Revisão, nunca estoque |
| `INATIVO` / `SEM_RESPOSTA` | Estados da seção 6 | Revisão |

Distância por haversine. Limites são constantes nomeadas com teste nos valores de
borda (50 m, 300 m, 1 km, 2 km, 2 min, 10 min).

## 8. Persistência

Migration aditiva (`CREATE TABLE IF NOT EXISTS`) `tag_links`:

`id`, `tenant_id`, `serial_number`, `plate`, `chassi`, `associate_code`,
`link_state` (seção 6), `verdict` (seção 7), `origin` (`REDE` | `ESTOQUE`),
`evidence` jsonb (fonte, Δt, distância, pontos comparados), `checked_at`,
`created_at`, `updated_at`, `deleted_at`.
Único em (`tenant_id`, `serial_number`) entre linhas não apagadas.

`Device` não é tocado. O rastreador do veículo nunca é desvinculado.

## 9. Onde aparece (só SUPER_ADMIN, ADMIN, OPERATOR)

- **Clientes Ativos:** a linha de quem tem TAG `CONFIRMADA` ganha o selo "TAG" com a última posição e a idade do ponto. Veículo só com TAG `CONFIRMADA` passa a aparecer, marcado "TAG".
- **Estoque:** TAG `ESTOQUE` entra com tipo "TAG" e filtro próprio, sem device no Traccar. "Vincular" reaproveita `sga-lookup/:placaOuChassi` e grava `tag_links` com `origin = ESTOQUE`. Depois passa pelo portão da seção 7.
- **Revisão:** lista dos vereditos não confirmados, com motivo e provas.
- Role `CLIENT` e `/app/*`: nenhum campo de TAG, em nenhuma resposta nem evento.

## 10. Testes

- Importador: `=`, tamanho, duplicado, round-trip, cabeçalho por nome.
- Classificador de vínculo: os 4 estados; "não achei" ≠ `LIVRE`.
- Portão: cada prova nos limites exatos; contradição vence confirmação.
- Contrato envenenado: TAG plantada no banco não aparece para `CLIENT` nem em `/app/*`.
- Clientes Ativos: cliente só com TAG confirmada aparece; com TAG aguardando, não aparece.
- `app-boot.spec.ts` verde antes do deploy.

## 11. Deploy

Migration antes da imagem · boot validado em container efêmero · builds em
sequência · avisar as sessões paralelas e montar sobre a imagem em serviço ·
medir DO antes e depois · conferir `/api/v1/health` e as telas com JWT interno.

## 12. Entrega

Relatório ao dono com os números reais por veredito, mais as 900 TAGs à espera do
arquivo correto do fornecedor.

## Fora do escopo

Importar as 900 sem chave · retirar `Device.vehicleId @unique` · sincronização
diária pela API v2 da Rede.
