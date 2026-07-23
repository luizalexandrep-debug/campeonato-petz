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
                    dias[dia_nome] = round(float(valor), 2)
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
        memoria[arquivo] = {"anterior": {}, "atual": {}}
        for semana_type in ("anterior", "atual"):
            fp = slots.get(semana_type)
            if fp:
                memoria[arquivo][semana_type] = _carregar_arquivo(fp)
    return memoria


def _placar(memoria, team1, team2, hoje_idx=None):
    score1 = score2 = 0
    dias_a_contar = DIAS_ORDENADOS[:hoje_idx + 1] if hoje_idx is not None else DIAS_ORDENADOS
    for arquivo, semanas in memoria.items():
        ant = semanas["anterior"]
        atu = semanas["atual"]
        d1a, d1t = ant.get(team1), atu.get(team1)
        d2a, d2t = ant.get(team2), atu.get(team2)
        # Precisa dos dois times presentes no indicador
        if not (d1a or d1t) or not (d2a or d2t):
            continue
        t1_ant = sum((d1a or {}).get(d, 0) for d in dias_a_contar)
        t1_atu = sum((d1t or {}).get(d, 0) for d in dias_a_contar)
        t2_ant = sum((d2a or {}).get(d, 0) for d in dias_a_contar)
        t2_atu = sum((d2t or {}).get(d, 0) for d in dias_a_contar)
        ev1 = t1_atu - t1_ant
        ev2 = t2_atu - t2_ant
        if ev1 > ev2:
            score1 += 1
        elif ev2 > ev1:
            score2 += 1
    return score1, score2


def calcular_todos_jogos(confrontos, memoria, hoje_idx):
    """Calcula projetado + acumulado de todos os confrontos usando memória."""
    jogos = []
    for conf in confrontos:
        t1, t2 = conf["team1"], conf["team2"]
        s1p, s2p = _placar(memoria, t1, t2, None)
        s1a, s2a = _placar(memoria, t1, t2, hoje_idx)
        jogos.append({
            "team1": t1,
            "team2": t2,
            "scoreProjected": f"{s1p} x {s2p}",
            "scoreAccumulated": f"{s1a} x {s2a}",
            "hojeIdx": hoje_idx,
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
