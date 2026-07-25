"""
Cálculo otimizado dos jogos: carrega cada planilha UMA vez na memória e
calcula todos os confrontos a partir de dicionários — muito mais rápido que
abrir os arquivos repetidamente.

Este módulo é usado tanto pelo gerador de cache local quanto pelo endpoint de
reprocessamento no servidor.
"""
import re
from pathlib import Path
from difflib import SequenceMatcher
import openpyxl

SIMILARIDADE_MIN = 0.6
FILE_ALIASES = {}
DIAS_ORDENADOS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']


def _listar_xlsx(semana_path):
    if not semana_path.exists():
        return []
    return sorted(f for f in semana_path.glob("*.xlsx") if not f.name.startswith("~"))


def _chave(nome_arquivo):
    base = nome_arquivo.rsplit(".", 1)[0].upper()
    return re.sub(r"[^A-Z0-9]", "", base)


def _similaridade(nome_a, nome_b):
    return SequenceMatcher(None, _chave(nome_a), _chave(nome_b)).ratio()


def mapear_indicadores(semana_anterior, semana_atual):
    atual_files = _listar_xlsx(semana_atual)
    anterior_files = _listar_xlsx(semana_anterior)
    indicadores = {}
    for af in atual_files:
        indicadores[af.name] = {"anterior": None, "atual": af}
    restantes = list(anterior_files)
    for canonico, slots in indicadores.items():
        for pf in list(restantes):
            if pf.name == canonico or FILE_ALIASES.get(pf.name) == canonico:
                slots["anterior"] = pf
                restantes.remove(pf)
                break
    for canonico, slots in indicadores.items():
        if slots["anterior"] is not None:
            continue
        melhor, melhor_score = None, 0.0
        for pf in restantes:
            score = _similaridade(canonico, pf.name)
            if score > melhor_score:
                melhor, melhor_score = pf, score
        if melhor and melhor_score >= SIMILARIDADE_MIN:
            slots["anterior"] = melhor
            restantes.remove(melhor)
    for pf in restantes:
        indicadores.setdefault(pf.name, {"anterior": pf, "atual": None})
    return indicadores


def detectar_tipo(file_path):
    """Detecta se o indicador é percentual ('%') ou monetário ('R$') pelo
    formato de número das células do Excel. Fallback: valores todos < 1."""
    if file_path is None:
        return "R$"
    try:
        wb = openpyxl.load_workbook(file_path)  # precisa do formato
        ws = wb.active
        formatos = [str(c.number_format) for row in
                    ws.iter_rows(min_row=2, max_row=6, min_col=3, max_col=6)
                    for c in row if c.number_format]
        wb.close()
        if formatos and any('%' in f for f in formatos):
            return "%"
        wb = openpyxl.load_workbook(file_path, data_only=True, read_only=True)
        ws = wb.active
        vals = [abs(v) for row in ws.iter_rows(min_row=2, max_row=40, min_col=3,
                                               max_col=6, values_only=True)
                for v in row if isinstance(v, (int, float)) and v != 0]
        wb.close()
        if vals and all(v < 1 for v in vals):
            return "%"
    except Exception as e:
        print(f"⚠️ detectar_tipo falhou ({file_path}): {e}")
    return "R$"


def _carregar_arquivo(file_path):
    """Carrega TODAS as lojas de um arquivo de uma vez: {loja: {dia: valor}}."""
    wb = openpyxl.load_workbook(file_path, data_only=True, read_only=True)
    ws = wb.active
    dados = {}
    header = None
    col_dias = []  # lista de (col_idx, dia_nome)
    for row_idx, row in enumerate(ws.iter_rows(values_only=True)):
        if row_idx == 0:
            header = row
            for col_idx in range(2, len(header)):
                if header[col_idx] and "202" in str(header[col_idx]):
                    dia_nome = str(header[col_idx]).split("(")[1].rstrip(")")
                    col_dias.append((col_idx, dia_nome))
            continue
        sigla = row[0]
        if not sigla:
            continue
        dias = {}
        for col_idx, dia_nome in col_dias:
            valor = row[col_idx] if col_idx < len(row) else None
            try:
                if valor == "-" or valor is None:
                    dias[dia_nome] = 0
                else:
                    # 6 casas: preserva percentuais (0,21% = 0.0021).
                    # Arredondar em 2 casas zerava indicadores de share.
                    dias[dia_nome] = round(float(valor), 6)
            except (ValueError, TypeError):
                dias[dia_nome] = 0
        dados[sigla] = dias
    wb.close()
    return dados


def carregar_tudo(semana_anterior, semana_atual):
    """Pré-carrega todos os indicadores em memória.
    Retorna {arquivo: {'anterior': {loja: {dia: val}}, 'atual': {...}}}."""
    mapa = mapear_indicadores(semana_anterior, semana_atual)
    memoria = {}
    for arquivo, slots in mapa.items():
        # Tipo detectado do arquivo (prefere a semana atual)
        tipo = detectar_tipo(slots.get("atual") or slots.get("anterior"))
        memoria[arquivo] = {"anterior": {}, "atual": {}, "tipo": tipo}
        for semana_type in ("anterior", "atual"):
            fp = slots.get(semana_type)
            if fp:
                memoria[arquivo][semana_type] = _carregar_arquivo(fp)
    return memoria


def _media_dias(dias_obj, dias_a_contar):
    """Média dos dias COM dado (ignora zeros = dia sem informação).
    Usado por indicadores percentuais, onde somar não faz sentido."""
    vals = [(dias_obj or {}).get(d, 0) for d in dias_a_contar]
    vals = [v for v in vals if v]
    return sum(vals) / len(vals) if vals else 0


def _placar(memoria, team1, team2, hoje_idx=None):
    """Retorna (score1, score2, gols) onde gols é {arquivo: 1|2|0}:
    1 = team1 venceu o indicador, 2 = team2, 0 = empate."""
    score1 = score2 = 0
    gols = {}
    dias_a_contar = DIAS_ORDENADOS[:hoje_idx + 1] if hoje_idx is not None else DIAS_ORDENADOS
    for arquivo, semanas in memoria.items():
        ant = semanas["anterior"]
        atu = semanas["atual"]
        d1a, d1t = ant.get(team1), atu.get(team1)
        d2a, d2t = ant.get(team2), atu.get(team2)
        # Precisa dos dois times presentes no indicador
        if not (d1a or d1t) or not (d2a or d2t):
            continue
        # Indicador percentual (ex.: SHARE) agrega por MÉDIA dos dias com dado;
        # indicador monetário agrega por SOMA.
        ehPct = semanas.get("tipo") == "%"
        agg = (lambda o: _media_dias(o, dias_a_contar)) if ehPct else \
              (lambda o: sum((o or {}).get(d, 0) for d in dias_a_contar))
        t1_ant, t1_atu = agg(d1a), agg(d1t)
        t2_ant, t2_atu = agg(d2a), agg(d2t)
        # Evolução PERCENTUAL em relação à semana anterior (regra do campeonato).
        # Deve casar exatamente com calcularPlacarLocal() no frontend.
        ev1 = ((t1_atu - t1_ant) / t1_ant * 100) if t1_ant != 0 else 0
        ev2 = ((t2_atu - t2_ant) / t2_ant * 100) if t2_ant != 0 else 0
        if ev1 > ev2:
            score1 += 1
            gols[arquivo] = 1
        elif ev2 > ev1:
            score2 += 1
            gols[arquivo] = 2
        else:
            gols[arquivo] = 0
    return score1, score2, gols


def calcular_todos_jogos(confrontos, memoria, hoje_idx):
    """Calcula projetado + acumulado de todos os confrontos usando memória.
    Inclui 'golsProjetados' e 'golsAcumulados' (quem venceu cada indicador)."""
    jogos = []
    for conf in confrontos:
        t1, t2 = conf["team1"], conf["team2"]
        s1p, s2p, gols_proj = _placar(memoria, t1, t2, None)
        s1a, s2a, gols_acum = _placar(memoria, t1, t2, hoje_idx)
        jogos.append({
            "team1": t1,
            "team2": t2,
            "scoreProjected": f"{s1p} x {s2p}",
            "scoreAccumulated": f"{s1a} x {s2a}",
            "hojeIdx": hoje_idx,
            "golsProjetados": gols_proj,
            "golsAcumulados": gols_acum,
        })
    return jogos


def ler_confrontos(confrontos_path):
    wb = openpyxl.load_workbook(confrontos_path, data_only=True, read_only=True)
    ws = wb.active
    confrontos = []
    for row_idx, row in enumerate(ws.iter_rows(values_only=True)):
        if row_idx <= 1:
            continue
        team1 = row[2]
        team2 = row[4]
        if team1 and team2:
            confrontos.append({"team1": team1, "team2": team2})
    wb.close()
    return confrontos
