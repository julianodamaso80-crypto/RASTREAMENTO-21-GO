"""
Cliente do endpoint Macless Haystack.

O endpoint faz uma coisa só: autentica na conta Apple, pede à Apple os
relatórios das chaves informadas e devolve o que veio, ainda cifrado. Quem
abre o envelope é o findmy_crypto, com a chave privada da TAG.

Contrato confirmado no código do endpoint (dchristl/macless-haystack,
endpoint/mh_endpoint.py, do_POST):

    POST /
    {"ids": ["<hashedAdvKey base64>", ...], "days": 7}

    200 {"results": [
      {"id": "<hashedAdvKey>", "payload": "<base64>",
       "datePublished": 1787760795000, "statusCode": 0}, ...
    ]}

O endpoint aceita Basic Auth quando MH_ENDPOINT_USER/PASS estão configurados.
"""
import httpx

TIMEOUT_S = 90


class DecoderIndisponivel(RuntimeError):
    """O endpoint não respondeu ou respondeu o que não deveria."""


def fetch_reports(
    hashed_adv_keys: list[str],
    days: int,
    base_url: str,
    auth: tuple[str, str] | None = None,
) -> list[dict]:
    """
    Relatórios cifrados das chaves pedidas.

    Devolve lista vazia quando não há chave a consultar — sem bater no
    endpoint à toa, porque cada chamada dessas custa uma ida à Apple e é o que
    derruba a conta quando feito com pressa.
    """
    if not hashed_adv_keys:
        return []

    try:
        resposta = httpx.post(
            base_url.rstrip("/") + "/",
            json={"ids": list(hashed_adv_keys), "days": days},
            auth=auth,
            timeout=TIMEOUT_S,
        )
        resposta.raise_for_status()
        corpo = resposta.json()
    except httpx.HTTPError as erro:
        raise DecoderIndisponivel(f"endpoint Find My não respondeu: {erro}") from erro
    except ValueError as erro:
        raise DecoderIndisponivel(f"endpoint Find My devolveu não-JSON: {erro}") from erro

    resultados = corpo.get("results")
    if resultados is None:
        raise DecoderIndisponivel(
            "resposta do endpoint sem a chave 'results' — versão incompatível?"
        )

    # Só o que dá para decifrar: sem id não sabemos de qual TAG é, sem payload
    # não há o que abrir.
    return [r for r in resultados if r.get("id") and r.get("payload")]
