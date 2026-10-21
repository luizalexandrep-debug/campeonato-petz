"""Botão "Perguntar": responde perguntas sobre o campeonato com o Gemini.

O modelo não tem os dados na cabeça: ele chama as FERRAMENTAS abaixo, que leem
os dados do próprio app (calendário, estrutura, classificação, vendas por dia),
e responde só com o que elas devolvem. A chave fica na variável GEMINI_API_KEY
da Vercel; o modelo, em GEMINI_MODEL (padrão gemini-3.8-flash).
"""
import os
import time

import requests

REGIONAL_DESTAQUE = "R2 - Luiz"
MODELO_PADRAO = "gemini-3.8-flash"
URL = "https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent"
MAX_VOLTAS = 6              # idas e vindas com as ferramentas, por pergunta
PRAZO_S = 50                # a função da Vercel aceita até 60 s (vercel.json)
MAX_LINHAS = 80             # linhas por ferramenta, para não estourar o contexto

INSTRUCOES = f"""Você é o assistente do "Campeonato Petz 2026" (Petz, lojas em grupos A1 a D14).
Quem pergunta é o gestor da regional "{REGIONAL_DESTAQUE}". Quando ele disser "minhas lojas",
"minha regional" ou "meus distritos", é a regional "{REGIONAL_DESTAQUE}".

Regras do campeonato: 19 rodadas, cada grupo tem 20 lojas jogando todos contra todos.
Cada jogo vale 6 gols (indicadores); vitória = 3 pontos, empate = 1, derrota = 0.
A UF de uma loja é o sufixo da sigla (ABNO-RJ = Rio de Janeiro). O mesmo vale para o adversário.

Como responder:
- Use SEMPRE as ferramentas para buscar números e listas; nunca invente lojas, placares ou valores.
- Se a pergunta não disser a rodada, use a rodada atual (a ferramenta devolve quando você não informa).
- Responda em português do Brasil, direto, em poucas linhas. Use listas ou tabelas quando ajudar.
- Se os dados não bastarem para responder, diga o que falta em vez de chutar.
- Cite a sigla das lojas exatamente como vieram das ferramentas.
- Formatação: use **negrito** e listas com '-'. Não use asteriscos simples nem outros símbolos de markdown.
- Rodada atual: {{RODADA_ATUAL}}. "Próxima semana"/"semana que vem" é a rodada {{RODADA_PROXIMA}}; "semana passada" é a {{RODADA_ANTERIOR}}. Informe 'rodada' na ferramenta quando for outra que não a atual."""

FERRAMENTAS = [{"functionDeclarations": [
    {
        "name": "consultar_jogos",
        "description": (
            "Lista jogos do calendário (TODOS OS JOGOS) com os dados dos dois lados. Cada item é visto do ponto de "
            "vista de uma loja ('loja'), com o adversário e o contexto de ambos. Use os filtros para cruzar, por "
            "exemplo: minhas lojas (regional='R2 - Luiz') contra lojas do Rio (adv_uf='RJ'). Sem 'rodada', usa a atual."),
        "parameters": {"type": "OBJECT", "properties": {
            "rodada": {"type": "INTEGER", "description": "Número da rodada (1 a 19)."},
            "loja": {"type": "STRING", "description": "Sigla da loja, ex.: ABNO-RJ."},
            "regional": {"type": "STRING", "description": "Regional da loja, ex.: 'R2 - Luiz'."},
            "distrito": {"type": "STRING", "description": "Distrito da loja."},
            "uf": {"type": "STRING", "description": "UF da loja (sufixo da sigla), ex.: SP."},
            "adv_regional": {"type": "STRING", "description": "Regional do adversário."},
            "adv_distrito": {"type": "STRING", "description": "Distrito do adversário."},
            "adv_uf": {"type": "STRING", "description": "UF do adversário, ex.: RJ."},
        }},
    },
    {
        "name": "consultar_classificacao",
        "description": (
            "Classificação oficial (última rodada encerrada) por grupo, com regional/distrito de cada loja, "
            "pontos que ainda podem ser ganhos e máximo possível. Filtre por grupo, loja, regional, distrito ou UF."),
        "parameters": {"type": "OBJECT", "properties": {
            "grupo": {"type": "STRING", "description": "Ex.: 'Série C - Grupo 9' ou só '9'."},
            "loja": {"type": "STRING"}, "regional": {"type": "STRING"},
            "distrito": {"type": "STRING"}, "uf": {"type": "STRING"},
            "ate_posicao": {"type": "INTEGER", "description": "Só as N primeiras de cada grupo."},
        }},
    },
    {
        "name": "info_loja",
        "description": "Dados de uma loja: regional, distrito, UF, grupo, posição, pontos e se está eliminada.",
        "parameters": {"type": "OBJECT", "properties": {"loja": {"type": "STRING"}}, "required": ["loja"]},
    },
    {
        "name": "vendas_por_dia",
        "description": (
            "Valores diários de um indicador (padrão: Vendas) da semana atual e da anterior, por loja. "
            "Serve para ver dias sem venda (feriado, loja fechada) e comparar com a semana passada. "
            "Filtre por loja, regional, distrito ou UF."),
        "parameters": {"type": "OBJECT", "properties": {
            "indicador": {"type": "STRING", "description": "Parte do nome do indicador (ex.: VENDAS, ANTIPULGAS)."},
            "loja": {"type": "STRING"}, "regional": {"type": "STRING"},
            "distrito": {"type": "STRING"}, "uf": {"type": "STRING"},
        }},
    },
]}]


# ---------------------------------------------------------------- dados

def _b():
    import backend
    return backend


def _uf(sigla):
    return str(sigla).rsplit("-", 1)[-1].upper() if "-" in str(sigla) else ""


def _mapa_lojas():
    """{sigla: {regional, distrito, uf}} da estrutura vigente."""
    b = _b()
    m = {}
    for reg, dists in (b.estrutura_ativa() or {}).items():
        for dist, lojas in (dists or {}).items():
            for l in lojas:
                m[str(l).upper()] = {"regional": reg, "distrito": dist, "uf": _uf(l)}
    return m


def _grupo_de_loja():
    _rod, grupos = _b().classificacao_lojas()
    g = {}
    for nome, linhas in grupos.items():
        for r in linhas:
            g[r["time"].upper()] = nome
    return g


def _igual(a, b):
    return str(a or "").strip().lower() == str(b or "").strip().lower()


def _casa(info, regional=None, distrito=None, uf=None):
    if regional and not _igual(info.get("regional"), regional):
        return False
    if distrito and not _igual(info.get("distrito"), distrito):
        return False
    if uf and not _igual(info.get("uf"), uf):
        return False
    return True


def _cortar(linhas):
    if len(linhas) > MAX_LINHAS:
        return {"total": len(linhas), "mostrando": MAX_LINHAS, "itens": linhas[:MAX_LINHAS],
                "aviso": "Lista cortada; refine os filtros se precisar do resto."}
    return {"total": len(linhas), "itens": linhas}


def consultar_jogos(rodada=None, loja=None, regional=None, distrito=None, uf=None,
                    adv_regional=None, adv_distrito=None, adv_uf=None):
    b = _b()
    rodada = int(rodada) if rodada else b.semana_atual()
    lojas = _mapa_lojas()
    grupo = _grupo_de_loja()
    import calculo_rapido as cr
    elim = cr.lojas_eliminadas()
    saida = []
    for j in b.ler_todos_os_jogos():
        if j["rodada"] != rodada:
            continue
        for eu, adv, gols_eu, gols_adv in ((j["mandante"], j["visitante"], j["golsMandante"], j["golsVisitante"]),
                                             (j["visitante"], j["mandante"], j["golsVisitante"], j["golsMandante"])):
            ie, ia = lojas.get(eu.upper(), {}), lojas.get(adv.upper(), {})
            ie = {**{"uf": _uf(eu)}, **ie}
            ia = {**{"uf": _uf(adv)}, **ia}
            if loja and not _igual(eu, loja):
                continue
            if not _casa(ie, regional, distrito, uf) or not _casa(ia, adv_regional, adv_distrito, adv_uf):
                continue
            item = {
                "rodada": rodada, "loja": eu, "regional": ie.get("regional"), "distrito": ie.get("distrito"),
                "uf": ie.get("uf"), "grupo": grupo.get(eu.upper()),
                "adversario": adv, "adv_regional": ia.get("regional"), "adv_distrito": ia.get("distrito"),
                "adv_uf": ia.get("uf"),
                "loja_eliminada": eu.upper() in elim, "adv_eliminada": adv.upper() in elim,
            }
            if j.get("realizado") and gols_eu is not None:
                item["placar_oficial"] = f"{int(gols_eu)} x {int(gols_adv)}"
            saida.append(item)
    res = _cortar(saida)
    res["rodada_consultada"] = rodada
    res["rodada_atual"] = b.semana_atual()
    return res


def consultar_classificacao(grupo=None, loja=None, regional=None, distrito=None, uf=None, ate_posicao=None):
    b = _b()
    rodada, grupos = b.classificacao_lojas()
    lojas = _mapa_lojas()
    import calculo_rapido as cr
    elim = cr.lojas_eliminadas()
    saida = []
    for nome, linhas in grupos.items():
        if grupo and str(grupo).strip().lower() not in nome.lower() and not nome.lower().endswith(f"grupo {str(grupo).strip()}"):
            continue
        # máximo possível dos rivais, para saber quem ainda pode alcançar
        for r in linhas:
            if ate_posicao and r["rank"] > int(ate_posicao):
                continue
            info = {**{"uf": _uf(r["time"])}, **lojas.get(r["time"].upper(), {})}
            if loja and not _igual(r["time"], loja):
                continue
            if not _casa(info, regional, distrito, uf):
                continue
            restam = max(0, 19 - r["jogos"]) * 3
            saida.append({
                "grupo": nome, "posicao": r["rank"], "loja": r["time"], "regional": info.get("regional"),
                "distrito": info.get("distrito"), "uf": info.get("uf"), "pontos": r["pts"], "jogos": r["jogos"],
                "vitorias": r["vit"], "empates": r["emp"], "derrotas": r["der"], "saldo_gols": r["sg"],
                "pontos_restantes": restam, "pontos_maximos": r["pts"] + restam,
                "eliminada": r["time"].upper() in elim,
            })
    res = _cortar(saida)
    res["rodada_da_classificacao"] = rodada
    return res


def info_loja(loja):
    lojas = _mapa_lojas()
    sigla = str(loja).strip().upper()
    info = lojas.get(sigla)
    if not info:
        return {"erro": f"Loja {loja} não encontrada na estrutura."}
    cl = consultar_classificacao(loja=sigla)["itens"]
    return {"loja": sigla, **info, "classificacao": cl[0] if cl else None}


def vendas_por_dia(indicador="VENDAS", loja=None, regional=None, distrito=None, uf=None):
    b = _b()
    import calculo_rapido as cr
    semana = b.semana_atual()
    b.garantir_rodada(semana)
    memoria = cr.carregar_tudo(b.dir_anterior(semana), b.dir_atual(semana))
    chave = next((k for k in memoria if str(indicador or "VENDAS").upper() in k.upper()), None)
    if not chave:
        return {"erro": f"Indicador '{indicador}' não encontrado.", "indicadores": sorted(memoria)}
    lojas = _mapa_lojas()
    saida = []
    for sigla, dias in (memoria[chave].get("atual") or {}).items():
        info = {**{"uf": _uf(sigla)}, **lojas.get(sigla.upper(), {})}
        if loja and not _igual(sigla, loja):
            continue
        if not _casa(info, regional, distrito, uf):
            continue
        ant = (memoria[chave].get("anterior") or {}).get(sigla, {})
        saida.append({
            "loja": sigla, "regional": info.get("regional"), "distrito": info.get("distrito"), "uf": info.get("uf"),
            "semana_atual_por_dia": {d: round(v, 2) for d, v in dias.items() if d != cr.CHAVE_TOTAL},
            "semana_anterior_por_dia": {d: round(v, 2) for d, v in ant.items() if d != cr.CHAVE_TOTAL},
        })
    res = _cortar(saida)
    res.update({"indicador": chave, "semana": semana})
    return res


IMPLEMENTACOES = {
    "consultar_jogos": consultar_jogos,
    "consultar_classificacao": consultar_classificacao,
    "info_loja": info_loja,
    "vendas_por_dia": vendas_por_dia,
}


# ---------------------------------------------------------------- Gemini

class ErroPergunta(Exception):
    pass


def _chamar_gemini(corpo, restante):
    chave = os.environ.get("GEMINI_API_KEY", "").strip()
    if not chave:
        raise ErroPergunta("A chave GEMINI_API_KEY não está configurada na Vercel.")
    modelo = os.environ.get("GEMINI_MODEL", MODELO_PADRAO).strip() or MODELO_PADRAO
    inicio = time.time()
    r = None
    # O plano gratuito às vezes responde 500/503 (modelo sobrecarregado) e passa
    # em segundos: tenta de novo antes de desistir, dentro do prazo da função.
    for tentativa in range(3):
        sobra = restante - (time.time() - inicio)
        if sobra < 6:
            break
        try:
            r = requests.post(URL.format(modelo=modelo), json=corpo, timeout=max(5, min(40, sobra)),
                              headers={"x-goog-api-key": chave, "Content-Type": "application/json"})
        except requests.Timeout:
            raise ErroPergunta("O Gemini demorou demais para responder. Tente de novo.")
        except requests.RequestException as e:
            raise ErroPergunta(f"Não consegui falar com o Gemini: {e}")
        if r.status_code in (500, 502, 503, 504) and tentativa < 2:
            time.sleep(2 * (tentativa + 1))
            continue
        break
    if r is None:
        raise ErroPergunta("A pergunta estourou o tempo. Tente algo mais específico.")
    if r.status_code == 429:
        raise ErroPergunta("Limite gratuito do Gemini atingido por agora. Tente de novo em alguns minutos.")
    if r.status_code in (500, 502, 503, 504):
        raise ErroPergunta("O Gemini está sobrecarregado neste momento (erro do lado do Google). "
                           "Espere alguns segundos e tente de novo.")
    if r.status_code in (400, 401, 403):
        try:
            msg = r.json().get("error", {}).get("message", "")
        except Exception:
            msg = r.text[:200]
        raise ErroPergunta(f"O Gemini recusou o pedido ({r.status_code}): {msg}")
    if not r.ok:
        raise ErroPergunta(f"Erro do Gemini ({r.status_code}).")
    return r.json()


def responder(pergunta, historico=None):
    """Devolve {'resposta': texto, 'consultas': [nomes das ferramentas usadas]}."""
    inicio = time.time()
    try:
        atual = int(_b().semana_atual())
    except Exception:
        atual = 0
    instrucoes = (INSTRUCOES.replace("{RODADA_ATUAL}", str(atual))
                  .replace("{RODADA_PROXIMA}", str(atual + 1)).replace("{RODADA_ANTERIOR}", str(atual - 1)))
    contents = []
    for h in (historico or [])[-8:]:
        papel = "model" if h.get("papel") == "assistente" else "user"
        texto = str(h.get("texto") or "").strip()
        if texto:
            contents.append({"role": papel, "parts": [{"text": texto[:4000]}]})
    contents.append({"role": "user", "parts": [{"text": str(pergunta).strip()[:2000]}]})
    usadas = []

    for _ in range(MAX_VOLTAS):
        restante = PRAZO_S - (time.time() - inicio)
        if restante < 5:
            raise ErroPergunta("A pergunta ficou complicada demais e estourou o tempo. Tente algo mais específico.")
        dados = _chamar_gemini({
            "systemInstruction": {"parts": [{"text": instrucoes}]},
            "contents": contents,
            "tools": FERRAMENTAS,
            "generationConfig": {"temperature": 0.2},
        }, restante)
        cands = dados.get("candidates") or []
        if not cands or not (cands[0].get("content") or {}).get("parts"):
            motivo = (dados.get("promptFeedback") or {}).get("blockReason") or (cands[0].get("finishReason") if cands else "")
            raise ErroPergunta(f"O Gemini não devolveu resposta{(' (' + motivo + ')') if motivo else ''}.")
        conteudo = cands[0]["content"]
        chamadas = [p["functionCall"] for p in conteudo["parts"] if "functionCall" in p]
        if not chamadas:
            texto = "".join(p.get("text", "") for p in conteudo["parts"] if not p.get("thought")).strip()
            if not texto:
                raise ErroPergunta("O Gemini respondeu vazio. Tente reformular.")
            return {"resposta": texto, "consultas": usadas}

        # devolve o conteúdo do modelo como veio (inclui as assinaturas de raciocínio)
        contents.append(conteudo)
        respostas = []
        for c in chamadas:
            nome, args = c.get("name"), c.get("args") or {}
            usadas.append(nome)
            fn = IMPLEMENTACOES.get(nome)
            try:
                resultado = fn(**args) if fn else {"erro": f"Ferramenta {nome} não existe."}
            except TypeError as e:
                resultado = {"erro": f"Argumentos inválidos: {e}"}
            except Exception as e:
                resultado = {"erro": f"Falha ao consultar os dados: {e}"}
            respostas.append({"functionResponse": {"name": nome, "response": {"resultado": resultado}}})
        contents.append({"role": "user", "parts": respostas})
    raise ErroPergunta("Não consegui fechar a resposta com as consultas disponíveis. Tente algo mais específico.")
