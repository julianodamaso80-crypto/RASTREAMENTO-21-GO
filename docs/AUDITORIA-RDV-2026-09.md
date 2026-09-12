# Auditoria contra a RedeVeiculos — 12/09/2026

Varredura dos **24 módulos** do menu deles com `scripts/clonagem/varredura-rdv.mjs`
(só leitura, nenhum clique além de fechar o aviso de contrato). Atualiza a
auditoria de 20/04/2026, que estava com cinco meses de atraso.

O número entre parênteses é **o que a conta da 21 GO tem lá dentro hoje** — é ele
que separa "módulo que eles vendem" de "módulo que a operação usa".

## O tamanho da operação deles (medido na tela)

| | |
|---|---|
| Ativos cadastrados | **35.115** (13.577 em pré-cadastro) |
| Ativos desconectados | **14.254** — 41% da frota |
| Clientes com ativo | 20.067 (11 inadimplentes) |
| Chips | 25.746 (21.763 vinculados, 3.981 livres) |
| Equipamentos em estoque | 3.864 (2.578 livres, 1.263 com técnico, 21 perdidos) |
| Instalações no mês | 417 |

## Placar por módulo

### Eles usam pesado e nós NÃO temos — é aqui que a fila começa

| Módulo | Uso real deles | O que é |
|---|---|---|
| **Tratativa de Alertas** | **5.177 abertas**, 0 em tratamento | Fila de alerta com dono, status e fechamento. Nosso alerta nasce e morre na tela |
| **Guardião** | **3.175 a tratar** | Motor de silêncio: ativo que parou de comunicar entra numa fila de tratativa (abas A tratar / Tratados / Desabilitados) |
| **Antifraude** | Lista com duplicados reais | Mesmo CPF/placa/chassi repetido na base |
| **Registro de Atividades** | Trilha de auditoria (Análise + Lista) | Quem fez o quê. Nosso `audit_logs` existe no banco, mas sem tela |
| **Config. de agendamentos** | Tipos de serviço + **checklist** + contrato | É o que falta para fechar a nossa agenda (checklist ANTES/DEPOIS e contrato) |

### Eles têm, nós temos — e o nosso está igual ou melhor

| Módulo | Situação |
|---|---|
| Conectividade / Dashboard | ✓ |
| Mapa | ✓ (o nosso tem endereço carimbado na coordenada e satélite Google) |
| Alertas | ✓ na geração (falta a tratativa, acima) |
| Estoque | ✓ **melhor**: abrir marcados no mapa, coluna Conexão, bloqueio de teste |
| Chips | ✓ |
| Clientes / Ativos | ✓ por ativo, com situação do SGA espelhada |
| Agendamentos | ✓ 3 das 5 abas (Análise, Agendamentos, Ordens de Serviço) |
| Usuários e perfis | ✓ com permissão por rota |
| SMS Comandos | ◐ backend pronto, sem a tela de envio em lote |
| Técnicos | ◐ falta avaliação do cliente e ranking de instalações |
| Configurações | ◐ eles têm 8 seções (sub-empresas, seguradoras, tarifação, integrações) |

### Eles têm e NÃO usam — não copiar

Acionamentos (0), Carteira Virtual (0 transações), Consultores (nenhum
cadastrado), Grupos (nenhum), Áreas de risco ("nada por aqui"), Prestadores de
Serviços (1), Vídeos (treinamento da plataforma deles).

São 7 módulos que a auditoria de abril contava como gap nosso. **Não são.**

### Nós temos e eles não têm

TAGs Ativas · Pendentes de Instalação (espelho do SGA, 9.116 linhas) · Rota
Inteligente · Manutenção preditiva · Score de condutor · Assistente IA ·
Relatórios com export · App do associado nas duas lojas.

## Como fica o placar

De 24 módulos deles: **11 já temos**, **3 parciais**, **5 faltam de verdade** e
**7 não valem a pena** (eles mesmos não usam). Em abril o placar era 27%
implementado; hoje, contando só o que a operação usa, estamos em **~70%**.

## Fila sugerida (por uso real, não por lista de features)

1. **Tratativa de Alertas** — 5.177 alertas abertos lá dentro é a maior pilha viva.
2. **Guardião** — 3.175 ativos silenciosos esperando alguém olhar.
3. **Config. de agendamentos + checklist** — fecha o módulo que já subiu.
4. **Antifraude** — barato, roda em cima da base que já temos.
5. **Registro de Atividades** — o dado já é gravado; falta a tela.

## Como refazer

```bash
MSYS_NO_PATHCONV=1 RDV_USER=... RDV_PASS=... \
  node scripts/clonagem/varredura-rdv.mjs --saida docs/clonagem/varredura
```

~4 minutos, custo zero. As capturas e inventários ficam fora do git.
