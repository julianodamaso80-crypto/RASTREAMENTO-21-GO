#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Teste de contrato REST do Traccar — 21 GO Rastreamento
=========================================================

Para que serve
---------------
Revalida, endpoint por endpoint, que uma versão do Traccar continua se
comportando do jeito que `backend/src/modules/traccar/traccar.service.ts`
espera. Não testa "o Traccar funciona" em geral — testa exatamente o
contrato que o nosso backend usa: login por sessão, devices, positions,
reports/summary, commands/send, geofences, permissions e users.

Nasceu da Etapa 2 do upgrade 6.5 → 6.14.5 (ver
`.superpowers/sdd/etapa2-traccar-evidencias.md`), mas fica no repositório
como ferramenta permanente: rode de novo antes de qualquer upgrade futuro
do Traccar, antes de mexer em `traccar.xml` de um jeito que possa afetar a
API, ou sempre que quiser ter certeza de que uma instância nova (dev, teste,
produção) responde do jeito que o backend precisa.

Cada recurso criado pelo script (device, geofence, user, vínculo de
permissão) é removido ao final, mesmo que algum passo no meio tenha
falhado, o operador dê Ctrl-C, ou a sessão SSH caia (o script trata
SIGINT/SIGTERM/SIGHUP e roda a limpeza num finally). Exceção: um
`kill -9` (SIGKILL) ou queda de energia não dão chance de rodar nada —
aí o device/geofence/user ficam órfãos na instância testada.

A senha do user de teste é gerada aleatoriamente a cada execução
(módulo `secrets`), nunca fica hardcoded no arquivo.

Como rodar contra um container descartável
--------------------------------------------
    docker run -d --name traccar-contrato-tmp -p 8092:8082 traccar/traccar:6.14.5

    # o primeiro usuário criado sem sessão vira administrador (bootstrap do Traccar)
    curl -X POST http://localhost:8092/api/users -H 'Content-Type: application/json' \\
      -d '{"name":"admin","email":"admin@teste.local","password":"TesteContrato123"}'

    python scripts/traccar-contrato.py \\
      --base-url http://localhost:8092/api \\
      --email admin@teste.local \\
      --password TesteContrato123

    docker rm -f traccar-contrato-tmp

Como rodar contra produção (depois do deploy, para conferir)
---------------------------------------------------------------
    TRACCAR_API_URL=https://traccar.trackgo.site/api \\
    TRACCAR_ADMIN_EMAIL=admin@rastreamento21go.com.br \\
    TRACCAR_ADMIN_PASSWORD='<no 1Password>' \\
    python scripts/traccar-contrato.py

Uso
----
    python scripts/traccar-contrato.py [--base-url URL] [--email EMAIL] [--password SENHA]

    Prioridade de configuração: argumento de linha de comando > variáveis de
    ambiente do PROJETO (TRACCAR_API_URL/TRACCAR_ADMIN_EMAIL/
    TRACCAR_ADMIN_PASSWORD, as mesmas de backend/src/config/configuration.ts)
    > variáveis antigas do próprio script (TRACCAR_BASE_URL/TRACCAR_EMAIL/
    TRACCAR_PASSWORD, aceitas por compatibilidade) > default. Nenhuma
    credencial fica hardcoded no script. O alvo é sempre impresso antes de
    rodar qualquer passo — confira a URL antes de confirmar que é a certa.

    --base-url   ou TRACCAR_API_URL / TRACCAR_BASE_URL   (default: http://localhost:8082/api)
    --email      ou TRACCAR_ADMIN_EMAIL / TRACCAR_EMAIL      (obrigatório)
    --password   ou TRACCAR_ADMIN_PASSWORD / TRACCAR_PASSWORD   (obrigatório)

Saída
------
Uma tabela pass/fail por endpoint testado, uma linha final "N/M OK" e
código de saída não-zero se qualquer passo falhar.
"""

import argparse
import json
import os
import re
import secrets
import signal
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_BASE_URL = "http://localhost:8082/api"


class ContratoError(Exception):
    """Erro controlado de um passo do contrato — carrega o texto pra tabela final."""


class TraccarClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.cookie = None

    def _request(self, method, path, data=None, headers=None, form=False):
        url = self.base_url + path
        body = None
        req_headers = dict(headers or {})
        if data is not None:
            if form:
                body = urllib.parse.urlencode(data).encode("utf-8")
                req_headers.setdefault(
                    "Content-Type", "application/x-www-form-urlencoded"
                )
            else:
                body = json.dumps(data).encode("utf-8")
                req_headers.setdefault("Content-Type", "application/json")
        if self.cookie:
            req_headers["Cookie"] = self.cookie

        req = urllib.request.Request(url, data=body, headers=req_headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                status = resp.status
                raw = resp.read()
                set_cookie = resp.headers.get("Set-Cookie")
                if set_cookie:
                    self.cookie = set_cookie.split(";")[0]
                return status, raw
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            return exc.code, raw

    def get(self, path, params=None, headers=None):
        if params:
            query = urllib.parse.urlencode(params)
            path = f"{path}?{query}"
        return self._request("GET", path, headers=headers)

    def post(self, path, data=None, form=False, headers=None):
        return self._request("POST", path, data=data, form=form, headers=headers)

    def put(self, path, data=None, headers=None):
        return self._request("PUT", path, data=data, headers=headers)

    def delete(self, path, data=None, headers=None):
        return self._request("DELETE", path, data=data, headers=headers)


class Contrato:
    """Roda os passos do contrato e mantém a lista de resultados + recursos a limpar."""

    def __init__(self, client: TraccarClient):
        self.client = client
        self.resultados = []  # (nome, ok, detalhe)
        self.criados = {
            "device_id": None,
            "device_unique_id": None,
            "geofence_id": None,
            "user_id": None,
        }
        self.permissao_vinculada = False

    def passo(self, nome, fn):
        try:
            detalhe = fn()
            self.resultados.append((nome, True, detalhe or "OK"))
            return True
        except ContratoError as exc:
            self.resultados.append((nome, False, str(exc)))
            return False
        except Exception as exc:  # segurança: qualquer exceção não prevista também conta como falha
            self.resultados.append((nome, False, f"erro inesperado: {exc}"))
            return False

    def esperar_status(self, status, esperados, contexto):
        if status not in esperados:
            raise ContratoError(f"esperava {esperados}, veio {status} ({contexto})")

    def _capturar_id_defensivo(self, chave, raw):
        """Guarda o id do recurso assim que possível — o POST já criou o
        recurso no servidor (status conferido antes de chamar isto). Se o
        parse completo do JSON falhar logo em seguida, limpar() ainda precisa
        do id pra não deixar um `contrato-teste-*` esquecido em produção."""
        match = re.search(rb'"id"\s*:\s*(\d+)', raw)
        if match:
            self.criados[chave] = int(match.group(1))

    # --- passos individuais ---

    def login(self):
        def run():
            status, raw = self.client.post(
                "/session",
                data={
                    "email": self.email,
                    "password": self.password,
                },
                form=True,
            )
            self.esperar_status(status, {200}, "POST /session")
            if not self.client.cookie:
                raise ContratoError("login OK mas nenhum cookie de sessão recebido")
            return f"{status}"

        return self.passo("POST /session (login)", run)

    def server(self):
        def run():
            status, raw = self.client.get("/server")
            self.esperar_status(status, {200}, "GET /server")
            try:
                body = json.loads(raw)
            except json.JSONDecodeError:
                raise ContratoError("GET /server não devolveu JSON válido")
            versao = body.get("version", "?")
            return f"{status} (versão {versao})"

        return self.passo("GET /server", run)

    def devices_listar(self):
        def run():
            status, _ = self.client.get("/devices")
            self.esperar_status(status, {200}, "GET /devices")
            return f"{status}"

        return self.passo("GET /devices (listar)", run)

    def devices_criar(self):
        def run():
            unique_id = f"CONTRATO{int(time.time())}"
            status, raw = self.client.post(
                "/devices",
                data={"name": "contrato-teste-device", "uniqueId": unique_id},
            )
            self.esperar_status(status, {200}, "POST /devices")
            self._capturar_id_defensivo("device_id", raw)
            body = json.loads(raw)
            self.criados["device_id"] = body["id"]
            self.criados["device_unique_id"] = unique_id
            return f"{status} (id={body['id']})"

        return self.passo("POST /devices (criar)", run)

    def devices_buscar_por_id(self):
        def run():
            device_id = self.criados["device_id"]
            if device_id is None:
                raise ContratoError("pulado: device não foi criado no passo anterior")
            status, raw = self.client.get("/devices", params={"id": device_id})
            self.esperar_status(status, {200}, "GET /devices?id=")
            body = json.loads(raw)
            if not body or body[0]["id"] != device_id:
                raise ContratoError("device retornado não bate com o id pedido")
            return f"{status}"

        return self.passo("GET /devices?id={id}", run)

    def devices_buscar_por_unique_id(self):
        def run():
            unique_id = self.criados["device_unique_id"]
            if unique_id is None:
                raise ContratoError("pulado: device não foi criado no passo anterior")
            # mesmo filtro que backend/src/modules/traccar/traccar.service.ts
            # (getDeviceByUniqueId) usa no fluxo de instalação — versão-dependente,
            # cai num 400 se a API não suportar mais o filtro server-side.
            status, raw = self.client.get("/devices", params={"uniqueId": unique_id})
            self.esperar_status(status, {200}, "GET /devices?uniqueId=")
            body = json.loads(raw)
            if not body or not any(d.get("uniqueId") == unique_id for d in body):
                raise ContratoError(
                    "200 mas a resposta não contém o device pedido — regressão "
                    "silenciosa: getDeviceByUniqueId cairia no fallback de escanear "
                    "a frota inteira a cada 'conferir GPS' do técnico"
                )
            return f"{status}"

        return self.passo(
            "GET /devices?uniqueId={imei} (getDeviceByUniqueId)", run
        )

    def devices_atualizar(self):
        def run():
            device_id = self.criados["device_id"]
            if device_id is None:
                raise ContratoError("pulado: device não foi criado")
            status, _ = self.client.put(
                f"/devices/{device_id}",
                data={
                    "id": device_id,
                    "name": "contrato-teste-device-editado",
                    "uniqueId": f"CONTRATO{int(time.time())}-upd",
                },
            )
            self.esperar_status(status, {200}, "PUT /devices/{id}")
            return f"{status}"

        return self.passo("PUT /devices/{id} (atualizar)", run)

    def positions(self):
        def run():
            device_id = self.criados["device_id"]
            params = {"deviceId": device_id} if device_id else {}
            status, _ = self.client.get("/positions", params=params)
            self.esperar_status(status, {200}, "GET /positions")
            return f"{status}"

        return self.passo("GET /positions", run)

    def reports_summary(self):
        def run():
            device_id = self.criados["device_id"]
            if device_id is None:
                raise ContratoError("pulado: device não foi criado")
            # mesmos parâmetros de backend/src/modules/traccar/traccar.service.ts (getReportSummary)
            status, _ = self.client.get(
                "/reports/summary",
                params={
                    "deviceId": device_id,
                    "from": "2026-01-01T00:00:00Z",
                    "to": "2026-12-31T23:59:59Z",
                    "daily": "false",
                },
                headers={"Accept": "application/json"},
            )
            self.esperar_status(status, {200}, "GET /reports/summary")
            return f"{status}"

        return self.passo(
            "GET /reports/summary (não estava na lista da evidência — coberto aqui)",
            run,
        )

    def commands_send(self):
        def run():
            device_id = self.criados["device_id"]
            if device_id is None:
                raise ContratoError("pulado: device não foi criado")
            status, _ = self.client.post(
                "/commands/send",
                data={"deviceId": device_id, "type": "custom", "attributes": {"data": ""}},
            )
            # 202 = enfileirado (device offline), não é falha — é o comportamento normal.
            self.esperar_status(status, {200, 202}, "POST /commands/send")
            return f"{status}"

        return self.passo("POST /commands/send (type=custom)", run)

    def geofences_criar(self):
        def run():
            status, raw = self.client.post(
                "/geofences",
                data={
                    "name": "contrato-teste-geofence",
                    "area": "CIRCLE (-22.9 -43.2, 100)",
                },
            )
            self.esperar_status(status, {200}, "POST /geofences")
            self._capturar_id_defensivo("geofence_id", raw)
            body = json.loads(raw)
            self.criados["geofence_id"] = body["id"]
            return f"{status} (id={body['id']})"

        return self.passo("POST /geofences (criar)", run)

    def geofences_atualizar(self):
        def run():
            geofence_id = self.criados["geofence_id"]
            if geofence_id is None:
                raise ContratoError("pulado: geofence não foi criada")
            status, _ = self.client.put(
                f"/geofences/{geofence_id}",
                data={
                    "id": geofence_id,
                    "name": "contrato-teste-geofence-editada",
                    "area": "CIRCLE (-22.9 -43.2, 150)",
                },
            )
            self.esperar_status(status, {200}, "PUT /geofences/{id}")
            return f"{status}"

        return self.passo("PUT /geofences/{id} (atualizar)", run)

    def permissions_vincular(self):
        def run():
            device_id = self.criados["device_id"]
            geofence_id = self.criados["geofence_id"]
            if device_id is None or geofence_id is None:
                raise ContratoError("pulado: device ou geofence não foram criados")
            status, _ = self.client.post(
                "/permissions",
                data={"deviceId": device_id, "geofenceId": geofence_id},
            )
            self.esperar_status(status, {204}, "POST /permissions")
            self.permissao_vinculada = True
            return f"{status}"

        return self.passo("POST /permissions (vincular)", run)

    def permissions_desvincular(self):
        def run():
            if not self.permissao_vinculada:
                raise ContratoError("pulado: vínculo não foi criado")
            device_id = self.criados["device_id"]
            geofence_id = self.criados["geofence_id"]
            status, _ = self.client.delete(
                "/permissions",
                data={"deviceId": device_id, "geofenceId": geofence_id},
            )
            self.esperar_status(status, {204}, "DELETE /permissions")
            self.permissao_vinculada = False
            return f"{status}"

        return self.passo("DELETE /permissions (desvincular)", run)

    def users_criar(self):
        def run():
            email = f"contrato-teste-{int(time.time())}@teste.local"
            # Gerada a cada execução — nunca fica hardcoded no repositório.
            senha = secrets.token_urlsafe(24)
            status, raw = self.client.post(
                "/users",
                data={
                    "name": "contrato-teste-user",
                    "email": email,
                    "password": senha,
                },
            )
            self.esperar_status(status, {200}, "POST /users")
            self._capturar_id_defensivo("user_id", raw)
            body = json.loads(raw)
            self.criados["user_id"] = body["id"]
            return f"{status} (id={body['id']})"

        return self.passo("POST /users (criar)", run)

    # --- limpeza: roda sempre, mesmo se passos anteriores falharam ---

    def limpar(self):
        if self.permissao_vinculada:
            self.passo("DELETE /permissions (limpeza)", self._fn_desvincular_limpeza)

        if self.criados["geofence_id"] is not None:
            self.passo("DELETE /geofences/{id} (limpeza)", self._fn_apagar_geofence)

        if self.criados["device_id"] is not None:
            self.passo("DELETE /devices/{id} (apagar)", self._fn_apagar_device)

        if self.criados["user_id"] is not None:
            self.passo("DELETE /users/{id} (apagar)", self._fn_apagar_user)

    def _fn_desvincular_limpeza(self):
        device_id = self.criados["device_id"]
        geofence_id = self.criados["geofence_id"]
        status, _ = self.client.delete(
            "/permissions", data={"deviceId": device_id, "geofenceId": geofence_id}
        )
        self.esperar_status(status, {204}, "DELETE /permissions (limpeza)")
        self.permissao_vinculada = False
        return f"{status}"

    def _fn_apagar_geofence(self):
        geofence_id = self.criados["geofence_id"]
        status, _ = self.client.delete(f"/geofences/{geofence_id}")
        self.esperar_status(status, {204}, "DELETE /geofences/{id}")
        return f"{status}"

    def _fn_apagar_device(self):
        device_id = self.criados["device_id"]
        status, _ = self.client.delete(f"/devices/{device_id}")
        self.esperar_status(status, {204}, "DELETE /devices/{id}")
        return f"{status}"

    def _fn_apagar_user(self):
        user_id = self.criados["user_id"]
        status, _ = self.client.delete(f"/users/{user_id}")
        self.esperar_status(status, {204}, "DELETE /users/{id}")
        return f"{status}"


def resolver_config(args):
    # Nomes do projeto (backend/src/config/configuration.ts) têm prioridade
    # sobre os nomes antigos do próprio script — um TRACCAR_API_URL de
    # produção esquecido no ambiente não pode ser ofuscado por um
    # TRACCAR_BASE_URL de teste local, ou o operador acha que testou
    # produção e só testou o localhost.
    base_url = (
        args.base_url
        or os.environ.get("TRACCAR_API_URL")
        or os.environ.get("TRACCAR_BASE_URL")
        or DEFAULT_BASE_URL
    )
    email = (
        args.email
        or os.environ.get("TRACCAR_ADMIN_EMAIL")
        or os.environ.get("TRACCAR_EMAIL")
    )
    password = (
        args.password
        or os.environ.get("TRACCAR_ADMIN_PASSWORD")
        or os.environ.get("TRACCAR_PASSWORD")
    )
    if not email or not password:
        print(
            "Erro: informe email e senha via --email/--password ou "
            "TRACCAR_ADMIN_EMAIL/TRACCAR_ADMIN_PASSWORD (ou os antigos "
            "TRACCAR_EMAIL/TRACCAR_PASSWORD).",
            file=sys.stderr,
        )
        sys.exit(2)
    return base_url, email, password


class InterrupcaoControlada(Exception):
    """Ctrl-C local ou sinal recebido (SIGTERM/SIGHUP de uma sessão SSH que
    caiu) — capturado só pra garantir que a limpeza no `finally` de `main()`
    ainda roda antes do processo terminar."""


def _instalar_handlers_de_interrupcao():
    def _handler(signum, _frame):
        raise InterrupcaoControlada(f"sinal {signal.Signals(signum).name} recebido")

    signal.signal(signal.SIGTERM, _handler)
    if hasattr(signal, "SIGHUP"):  # não existe no Windows
        signal.signal(signal.SIGHUP, _handler)


def main():
    # Console do Windows costuma abrir em cp1252; força UTF-8 pra não estropiar o "—".
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    _instalar_handlers_de_interrupcao()

    parser = argparse.ArgumentParser(
        description="Testa o contrato REST do Traccar usado pelo backend do 21 GO."
    )
    parser.add_argument("--base-url", help="Base da API do Traccar (ex.: http://localhost:8082/api)")
    parser.add_argument("--email", help="E-mail de administrador do Traccar")
    parser.add_argument("--password", help="Senha do administrador do Traccar")
    args = parser.parse_args()

    base_url, email, password = resolver_config(args)

    client = TraccarClient(base_url)
    contrato = Contrato(client)
    contrato.email = email
    contrato.password = password

    print(f"Testando contrato Traccar em {base_url}\n")

    # try/finally garante que a limpeza roda mesmo se um Ctrl-C ou um
    # SIGTERM/SIGHUP (sessão SSH caída) interromper um passo no meio — antes,
    # só passos que levantavam Exception (não KeyboardInterrupt/sinal) eram
    # cobertos, e um device/geofence/user de teste podia ficar pra trás com a
    # senha do user publicada neste arquivo.
    try:
        # Login primeiro: se falhar, não adianta tentar o resto — mas ainda
        # rodamos a limpeza (que não fará nada, pois nada foi criado).
        if contrato.login():
            contrato.server()
            contrato.devices_listar()
            contrato.devices_criar()
            contrato.devices_buscar_por_id()
            contrato.devices_buscar_por_unique_id()
            contrato.devices_atualizar()
            contrato.positions()
            contrato.reports_summary()
            contrato.commands_send()
            contrato.geofences_criar()
            contrato.geofences_atualizar()
            contrato.permissions_vincular()
            contrato.permissions_desvincular()
            contrato.users_criar()
    except (KeyboardInterrupt, InterrupcaoControlada) as exc:
        print(f"\nInterrompido ({exc}) — limpando recursos criados antes de sair...", file=sys.stderr)
    finally:
        contrato.limpar()

    if not contrato.resultados:
        print("Nenhum passo chegou a rodar.")
        sys.exit(1)

    largura_nome = max(len(nome) for nome, _, _ in contrato.resultados) + 2
    print(f"{'ENDPOINT'.ljust(largura_nome)}RESULTADO")
    print("-" * (largura_nome + 30))
    ok_count = 0
    for nome, ok, detalhe in contrato.resultados:
        status_txt = "OK" if ok else "FALHOU"
        if ok:
            ok_count += 1
        print(f"{nome.ljust(largura_nome)}{status_txt} — {detalhe}")

    total = len(contrato.resultados)
    print(f"\n{ok_count}/{total} OK")

    sys.exit(0 if ok_count == total else 1)


if __name__ == "__main__":
    main()
