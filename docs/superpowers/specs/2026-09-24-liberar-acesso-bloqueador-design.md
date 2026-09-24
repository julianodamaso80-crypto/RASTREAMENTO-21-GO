# Liberar acesso ao bloqueador — design

Data: 2026-09-24 · Status: aprovado pelo dono na conversa

## Objetivo

Por padrão nenhum associado bloqueia o próprio veículo. O admin libera, veículo a veículo,
pelo menu de ações de Clientes Ativos. Com a liberação ligada, o app do associado mostra
o botão de bloquear/desbloquear daquele veículo.

## Decisões fechadas com o dono

1. A permissão é **por veículo** (mesmo modelo do "Bloquear acesso do cliente").
2. Nasce **desligada para todos**.
3. Só **ADMIN e SUPER_ADMIN** ligam/desligam. OPERATOR e VIEWER não veem o item.
4. O associado pode **bloquear a qualquer momento**, inclusive em movimento, depois de uma
   confirmação forte.
5. O associado pode **desbloquear sozinho**.

## Banco

- `Vehicle.blockerAccessAllowed Boolean @default(false) @map("blocker_access_allowed")`.
- Migração aditiva: `ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS blocker_access_allowed
  BOOLEAN NOT NULL DEFAULT false`. Não altera nenhuma linha existente.

## Painel (Clientes Ativos → menu ⋮ do ativo)

- `asset-actions-menu.tsx`: item novo logo abaixo de "Bloquear acesso do cliente",
  renderizado só quando o usuário logado é ADMIN ou SUPER_ADMIN.
  - Desligado: ícone de cadeado + "Liberar acesso ao bloqueador".
  - Ligado: "Retirar acesso ao bloqueador".
- `ClientAsset` ganha `blockerAccessAllowed`, devolvido pela listagem de ativos.
- Rota `PATCH /api/v1/clients/assets/:vehicleId/blocker-access` com body `{ allowed: boolean }`,
  `@Roles(SUPER_ADMIN, ADMIN)`, filtro por `tenantId` via `assertVehicle`. Mesmo padrão de
  `setAppAccess`. O `AuditInterceptor` já registra o PATCH (quem, quando, qual veículo).

## API do app do associado (`app-data.controller.ts`, mundo `associate`)

- `GET /app/vehicles` passa a devolver por veículo:
  - `blockerAccessAllowed: boolean`
  - `blocked: boolean` — `vehicle.status === BLOCKED`.
- `POST /app/vehicles/:id/block` e `POST /app/vehicles/:id/unblock`:
  1. O veículo tem que ser do associado do token e do mesmo tenant. Senão, 404.
  2. `blockerAccessAllowed` precisa estar ligado **no momento da chamada**. Senão, 403.
     Retirar o acesso no painel vale na hora, mesmo com o app aberto.
  3. Reusa `VehiclesService.block/unblock` (o mesmo caminho que bloqueou a TUM2F03 em
     24/09). Sem rastreador vinculado, 400. Falha no Traccar, 503 e o status não muda.
  4. Resposta traz `queued: boolean`. O Traccar devolve 202 quando o rastreador está
     offline e o comando vai para a fila. Nesse caso o app avisa: "O veículo será
     bloqueado assim que o rastreador se comunicar."
- A auditoria precisa gravar que a ação veio do **associado** (id do associado na
  metadata), e não de um usuário interno. O `AuditInterceptor` já classifica
  `/vehicles/:id/(un)block` como `COMMAND_SENT`. Conferir que ele pega a rota do app e
  preenche o associado.
- Nenhum controller novo: as rotas entram no `app-data.controller.ts`, que já está em
  `ASSOCIATE_CONTROLLERS` do `auth-worlds.ts`.

## App do associado (`mobile/src/app/vehicle/[id].tsx`)

- Botão só existe quando `blockerAccessAllowed` é true. Sem liberação, nada aparece:
  nem botão desabilitado, nem menção ao recurso.
- Texto alterna entre "Bloquear veículo" e "Desbloquear veículo", conforme `blocked`.
- Confirmação antes de bloquear: "O veículo vai parar de funcionar. Se estiver em
  movimento, pode desligar no meio da via. Confirmar bloqueio?". O desbloqueio pede uma
  confirmação simples.
- Resultado: sucesso, fila (rastreador offline) ou erro, sempre em texto claro.
- Sai na versão 1.5.2 (build + lojas). Painel e API sobem antes, independentes.

## Estado de bloqueio visível ao associado (pedido do dono, 24/09)

Vale para **todo associado**, com ou sem acesso ao bloqueador. Um veículo bloqueado pela
empresa também precisa aparecer como bloqueado.

- Hoje o `GET /app/vehicles` já devolve `status: BLOCKED` (gravado quando o comando é
  aceito), mas o app ignora o campo e mostra "Desligado". O `blocked` que o próprio
  rastreador informa na posição não é repassado.
- API: `toPositionDto` passa a devolver `blocked: a.blocked ?? null`. O que o rastreador
  informa é a fonte da verdade; o `status` do banco só diz que o comando saiu.
- App (tela de veículos e ficha do veículo):
  - `position.blocked === true` → "Bloqueado", em vermelho, no lugar de
    "Desligado/Ligado".
  - `status === BLOCKED` e o rastreador ainda não confirmou → "Bloqueio enviado,
    aguardando o rastreador".
  - Caso contrário, igual a hoje.
- Chega ao associado na mesma versão 1.5.2.

## Ordem de entrega

1. Migração + backend (painel e rotas do app) + painel. Deploy normal, combinado com as
   outras sessões antes de buildar.
2. App 1.5.2 com o botão. Build e envio às lojas.

## Testes

- Backend:
  - OPERATOR chamando `blocker-access` → 403.
  - Associado sem liberação chamando block → 403.
  - Associado tentando bloquear veículo de outro associado → 404.
  - Associado com liberação → comando `engineStop` enviado e status BLOCKED.
  - Traccar 202 → `queued: true`.
  - `auth-worlds.spec` e `app-boot.spec` continuam passando.
- Mobile: o botão some sem liberação e aparece com ela. O texto alterna conforme `blocked`.
- Em produção: liberar na TUM2F03 (já testada hoje), conferir o `GET /app/vehicles` com o
  token da conta de teste, retirar o acesso e conferir o 403.

## Fora de escopo

- Liberação por associado (todos os veículos de uma vez).
- Regra de velocidade para bloquear.
- Notificar o time interno quando o associado bloqueia.
