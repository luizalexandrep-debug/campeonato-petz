"""
Backend Flask - Campeonato Petz 2026
Integração com dados de Semana Anterior e Semana Atual
"""

from flask import Flask, jsonify, request, send_from_directory, session
from flask_cors import CORS
from flask_login import login_user, logout_user, login_required, current_user
import openpyxl
import os
import re
import requests
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from pathlib import Path
from auth import db, login_manager, Usuario, init_db

app = Flask(__name__)
CORS(app)

# Configuração de banco de dados e autenticação
# Em Vercel o filesystem é somente-leitura, exceto /tmp
if os.environ.get('VERCEL') or not os.access(str(Path(__file__).parent), os.W_OK):
    db_path = '/tmp/campeonato.db'
else:
    db_path = str(Path(__file__).parent / 'campeonato.db')
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'
app.config['SECRET_KEY'] = 'sua-chave-secreta-mude-isso-em-producao'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SECURE'] = False  # Mude para True em produção (HTTPS)
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

db.init_app(app)
login_manager.init_app(app)
login_manager.login_view = 'login'

# Inicializar banco de dados
init_db(app)

# Configuração de caminhos
# Em desenvolvimento local: /Users/luizprado/Downloads/Claude/Campeonato Petz
# Em Vercel: use caminhos relativos
try:
    dev_path = Path("/Users/luizprado/Downloads/Claude/Campeonato Petz")
    if dev_path.exists():
        BASE_PATH = dev_path
    else:
        BASE_PATH = Path(__file__).parent / "data"
except:
    BASE_PATH = Path(__file__).parent / "data"

# Base "empacotada" (repositório/dev). Confrontos vêm sempre daqui.
BUNDLED_BASE = BASE_PATH

# Após um reprocessamento, os dados frescos do SharePoint são gravados em /tmp
# (único diretório gravável no Vercel). As leituras passam a preferir /tmp.
TMP_BASE = Path('/tmp/campeonato_data')


def active_base():
    """Retorna a base de dados ativa: /tmp se já houve reprocessamento, senão a
    base empacotada."""
    atual = TMP_BASE / "SEMANA ATUAL"
    if atual.exists() and any(atual.glob("*.xlsx")):
        return TMP_BASE
    return BUNDLED_BASE


def dir_anterior():
    return active_base() / "SEMANA ANTERIOR"


def dir_atual():
    return active_base() / "SEMANA ATUAL"


# Mantidos por compatibilidade (usados só como base do Confrontos e afins)
SEMANA_ANTERIOR = BASE_PATH / "SEMANA ANTERIOR"
SEMANA_ATUAL = BASE_PATH / "SEMANA ATUAL"

# Metadados opcionais (nome amigável/tipo) por arquivo. NÃO define quais
# indicadores existem — os indicadores são descobertos automaticamente a partir
# dos arquivos .xlsx presentes nas pastas. Serve apenas como referência; o
# front-end mostra o nome do arquivo diretamente.
INDICADORES_MAP = {
    "VENDAS.xlsx": {"name": "Vendas", "type": "R$"},
    "PREMIER.xlsx": {"name": "Premier", "type": "R$"},
    "ELANCO.xlsx": {"name": "Antipulgas", "type": "R$"},
    "CAMAS ROUPAS COBERTORES.xlsx": {"name": "Suplementos", "type": "R$"},
    "LIMPEZA PERFUMARIA.xlsx": {"name": "Limpeza e Perfumaria", "type": "R$"},
}

# Pareamento explícito (opcional): força um arquivo da SEMANA ANTERIOR a casar
# com um arquivo da SEMANA ATUAL, caso o pareamento automático por similaridade
# não seja suficiente. Normalmente não é necessário — deixe vazio.
FILE_ALIASES = {}

# Quão parecidos dois nomes de arquivo precisam ser (0 a 1) para serem tratados
# como o MESMO indicador entre as semanas. Tolera prefixos ("MP "), espaços e
# pequenos erros de digitação.
SIMILARIDADE_MIN = 0.6


def _listar_xlsx(semana_path):
    """Lista os arquivos .xlsx de uma pasta (ignora temporários do Excel)."""
    if not semana_path.exists():
        return []
    return sorted(
        f for f in semana_path.glob("*.xlsx") if not f.name.startswith("~")
    )


def _chave(nome_arquivo):
    """Normaliza um nome de arquivo para comparação (maiúsculas, só alfanumérico)."""
    base = nome_arquivo.rsplit(".", 1)[0].upper()
    return re.sub(r"[^A-Z0-9]", "", base)


def _similaridade(nome_a, nome_b):
    return SequenceMatcher(None, _chave(nome_a), _chave(nome_b)).ratio()


def mapear_indicadores():
    """Descobre os indicadores e pareia cada arquivo da SEMANA ATUAL com o
    arquivo correspondente da SEMANA ANTERIOR, mesmo que os nomes tenham
    pequenas diferenças. Retorna dict:
        { nome_arquivo_atual: {"anterior": Path|None, "atual": Path|None} }
    Quando um novo .xlsx é adicionado, ele entra automaticamente."""
    atual_files = _listar_xlsx(dir_atual())
    anterior_files = _listar_xlsx(dir_anterior())

    indicadores = {}
    for af in atual_files:
        indicadores[af.name] = {"anterior": None, "atual": af}

    restantes = list(anterior_files)

    # 1) Pareamento exato ou por alias explícito
    for canonico, slots in indicadores.items():
        for pf in list(restantes):
            if pf.name == canonico or FILE_ALIASES.get(pf.name) == canonico:
                slots["anterior"] = pf
                restantes.remove(pf)
                break

    # 2) Pareamento aproximado (tolera pequenas diferenças de nome)
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

    # 3) Arquivos da semana anterior sem par viram indicadores próprios
    for pf in restantes:
        indicadores.setdefault(pf.name, {"anterior": pf, "atual": None})

    return indicadores


def indicador_meta(arquivo):
    """Nome/tipo do indicador. Usa INDICADORES_MAP se disponível, senão deriva
    do nome do arquivo."""
    if arquivo in INDICADORES_MAP:
        return INDICADORES_MAP[arquivo]
    nome = arquivo.rsplit(".", 1)[0]  # Remove extensão
    return {"name": nome, "type": "R$"}


def ler_dias_loja(file_path, sigla):
    """Lê os valores dia a dia de uma loja em um arquivo. Retorna dict
    {dia: valor} ou None se a loja não estiver no arquivo."""
    wb = openpyxl.load_workbook(file_path, data_only=True)
    ws = wb.active
    header = list(ws.iter_rows(max_row=1, values_only=True))[0]

    for row_idx, row in enumerate(ws.iter_rows(values_only=True)):
        if row_idx == 0:
            continue
        if row[0] == sigla:
            dias = {}
            for col_idx in range(2, len(header)):
                if header[col_idx] and "202" in str(header[col_idx]):
                    dia_nome = str(header[col_idx]).split("(")[1].rstrip(")")
                    valor = row[col_idx]
                    try:
                        if valor == "-" or valor is None:
                            dias[dia_nome] = 0
                        else:
                            dias[dia_nome] = round(float(valor), 2)
                    except (ValueError, TypeError):
                        dias[dia_nome] = 0
            return dias
    return None


def calcular_placar(team1, team2, semana):
    """Calcula o placar entre dois times somando a evolução dos indicadores.
    Retorna (score_team1, score_team2) onde cada ponto representa um indicador.

    Lógica:
    - Para cada indicador, compara a evolução total (semana atual vs anterior)
    - Time com maior evolução = 1 ponto naquele indicador
    - Soma dos 5 indicadores = placar final
    """
    placar_team1 = 0
    placar_team2 = 0

    try:
        # Obter dados de ambas as semanas para os dois times
        dados_team1 = {}
        dados_team2 = {}

        mapa = mapear_indicadores()
        for arquivo, slots in mapa.items():
            dados_team1[arquivo] = {}
            dados_team2[arquivo] = {}

            for semana_type in ("anterior", "atual"):
                file_path = slots.get(semana_type)
                if not file_path:
                    continue

                dias1 = ler_dias_loja(file_path, team1)
                dias2 = ler_dias_loja(file_path, team2)

                if dias1:
                    dados_team1[arquivo][semana_type] = dias1
                if dias2:
                    dados_team2[arquivo][semana_type] = dias2

        # Comparar evolução para cada indicador
        for arquivo in dados_team1.keys():
            if arquivo not in dados_team2:
                continue

            anterior1 = dados_team1[arquivo].get("anterior", {})
            atual1 = dados_team1[arquivo].get("atual", {})
            anterior2 = dados_team2[arquivo].get("anterior", {})
            atual2 = dados_team2[arquivo].get("atual", {})

            total_anterior1 = sum(anterior1.values()) if anterior1 else 0
            total_atual1 = sum(atual1.values()) if atual1 else 0
            evolucao1 = total_atual1 - total_anterior1

            total_anterior2 = sum(anterior2.values()) if anterior2 else 0
            total_atual2 = sum(atual2.values()) if atual2 else 0
            evolucao2 = total_atual2 - total_anterior2

            # Time com maior evolução ganha este indicador
            if evolucao1 > evolucao2:
                placar_team1 += 1
            elif evolucao2 > evolucao1:
                placar_team2 += 1
            # Se forem iguais, ninguém ganha ponto neste indicador

        return placar_team1, placar_team2

    except Exception as e:
        print(f"Erro ao calcular placar {team1} vs {team2}: {e}")
        return 0, 0

# ============================================================
# Utilitários para leitura de Excel
# ============================================================

def ler_arquivo_excel(file_path):
    """Lê arquivo Excel e retorna dict com dados por loja"""
    try:
        wb = openpyxl.load_workbook(file_path, data_only=True)
        ws = wb.active

        dados = {}

        # Detectar quantas colunas de dados existem (a partir da coluna 3)
        header = list(ws.iter_rows(max_row=1, values_only=True))[0]
        num_cols = 2  # Começar da coluna C (índice 2)
        for col_idx in range(2, len(header)):
            if header[col_idx] and "202" in str(header[col_idx]):  # Procura por datas
                num_cols += 1
            else:
                break

        for row_idx, row in enumerate(ws.iter_rows(values_only=True)):
            if row_idx == 0:  # Header
                continue

            loja = row[0]  # Primeira coluna
            if not loja:
                continue

            # Somar valores (colunas a partir de C até o último dia)
            valores_semana = []
            for col_idx in range(2, num_cols):
                val = row[col_idx]
                if val is not None:
                    try:
                        valores_semana.append(float(val))
                    except:
                        pass

            if valores_semana:
                total = sum(valores_semana)
                dados[loja] = total

        return dados

    except Exception as e:
        print(f"Erro ao ler {file_path}: {e}")
        return {}

def get_dados_indicadores(slot):
    """Lê todos os indicadores de uma semana (descobertos automaticamente).
    slot: "anterior" ou "atual"."""
    dados_semana = {}

    for arquivo, slots in mapear_indicadores().items():
        file_path = slots.get(slot)
        if not file_path:
            continue

        info = indicador_meta(arquivo)
        dados = ler_arquivo_excel(file_path)
        dados_semana[arquivo] = {
            "name": info["name"],
            "type": info["type"],
            "data": dados
        }

    return dados_semana

# ============================================================
# Endpoints da API
# ============================================================

@app.route('/api/health', methods=['GET'])
def health():
    """Verifica se a API está funcionando"""
    return jsonify({
        "status": "ok",
        "message": "API Campeonato Petz funcionando"
    })

@app.route('/api/indicadores', methods=['GET'])
def get_indicadores():
    """Retorna lista de indicadores disponíveis"""
    return jsonify({
        "indicadores": [
            {"id": "VENDAS.xlsx", "name": "Vendas", "type": "R$"},
            {"id": "PREMIER.xlsx", "name": "Premier", "type": "R$"},
            {"id": "ELANCO.xlsx", "name": "Antipulgas", "type": "R$"},
            {"id": "CAMAS ROUPAS COBERTORES.xlsx", "name": "Suplementos", "type": "R$"},
            {"id": "MP LIMPEZA PERFUMARIA.xlsx", "name": "Share Marca Própria", "type": "%"},
            {"id": "LIMPEZA PERFUMARIA.xlsx", "name": "Úmidos Cães e Gatos", "type": "R$"},
        ]
    })

@app.route('/api/dados-semanas', methods=['GET'])
def get_dados_semanas():
    """Retorna todos os dados de semana anterior e atual"""
    try:
        dados_anterior = get_dados_indicadores("anterior")
        dados_atual = get_dados_indicadores("atual")

        return jsonify({
            "semana_anterior": dados_anterior,
            "semana_atual": dados_atual,
            "timestamp": "2026-07-22"
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/comparacao-lojas', methods=['POST'])
def comparacao_lojas():
    """
    Compara duas lojas e calcula evolução de indicadores
    Body: {"team1": "ABVT-SP", "team2": "ACST-SP"}
    """
    try:
        data = request.json
        team1 = data.get("team1")
        team2 = data.get("team2")

        if not team1 or not team2:
            return jsonify({"error": "Lojas inválidas"}), 400

        # Carregar dados
        dados_anterior = get_dados_indicadores("anterior")
        dados_atual = get_dados_indicadores("atual")

        resultado = {
            "team1": team1,
            "team2": team2,
            "indicadores": {},
            "gols": {"team1": 0, "team2": 0}
        }

        # Comparar cada indicador
        for arquivo, info in dados_anterior.items():
            data_anterior = info["data"]
            data_atual_info = dados_atual.get(arquivo, {})
            data_atual = data_atual_info.get("data", {})

            # Valores para team1
            val_ant_1 = data_anterior.get(team1, 0)
            val_atu_1 = data_atual.get(team1, 0)
            evolucao_1 = val_atu_1 - val_ant_1

            # Valores para team2
            val_ant_2 = data_anterior.get(team2, 0)
            val_atu_2 = data_atual.get(team2, 0)
            evolucao_2 = val_atu_2 - val_ant_2

            # Determinar vencedor do indicador
            vencedor = None
            if evolucao_1 > evolucao_2:
                vencedor = "team1"
                resultado["gols"]["team1"] += 1
            elif evolucao_2 > evolucao_1:
                vencedor = "team2"
                resultado["gols"]["team2"] += 1

            resultado["indicadores"][arquivo] = {
                "name": info["name"],
                "type": info["type"],
                "team1": {
                    "anterior": round(val_ant_1, 2),
                    "atual": round(val_atu_1, 2),
                    "evolucao": round(evolucao_1, 2)
                },
                "team2": {
                    "anterior": round(val_ant_2, 2),
                    "atual": round(val_atu_2, 2),
                    "evolucao": round(evolucao_2, 2)
                },
                "vencedor": vencedor
            }

        # Determinar resultado
        gols_1 = resultado["gols"]["team1"]
        gols_2 = resultado["gols"]["team2"]

        if gols_1 > gols_2:
            resultado["resultado"] = f"{team1} venceu {gols_1} x {gols_2}"
            resultado["pontos"] = {"team1": 3, "team2": 0}
        elif gols_2 > gols_1:
            resultado["resultado"] = f"{team2} venceu {gols_2} x {gols_1}"
            resultado["pontos"] = {"team1": 0, "team2": 3}
        else:
            resultado["resultado"] = f"Empate {gols_1} x {gols_2}"
            resultado["pontos"] = {"team1": 1, "team2": 1}

        return jsonify(resultado)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/loja/<sigla>', methods=['GET'])
def get_loja(sigla):
    """Retorna dados de uma loja específica"""
    try:
        dados_anterior = get_dados_indicadores("anterior")
        dados_atual = get_dados_indicadores("atual")

        loja_data = {
            "sigla": sigla,
            "indicadores": {}
        }

        for arquivo, info in dados_anterior.items():
            loja_data["indicadores"][arquivo] = {
                "name": info["name"],
                "anterior": round(info["data"].get(sigla, 0), 2),
                "atual": round(dados_atual[arquivo]["data"].get(sigla, 0), 2)
            }

        return jsonify(loja_data)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/confrontos/<int:semana>', methods=['GET'])
def get_confrontos(semana):
    """Retorna os confrontos de uma semana específica"""
    try:
        confrontos_path = BASE_PATH / "Confrontos" / f"Semana {semana}.xlsx"

        if not confrontos_path.exists():
            return jsonify({"error": f"Confrontos da semana {semana} não encontrados"}), 404

        wb = openpyxl.load_workbook(confrontos_path, data_only=True)
        ws = wb.active

        confrontos = []

        for row_idx, row in enumerate(ws.iter_rows(values_only=True)):
            if row_idx <= 1:  # Skip header e linha vazia
                continue

            # Formato correto:
            # Col 0: DESC_JOGO_ELIMINATORIAS (sempre "Jogo")
            # Col 1: ID_JOGO (número)
            # Col 2: Time_Mandante
            # Col 3: Texto_Resultado_Partida_Card (ex: "1 x 5")
            # Col 4: Time_Visitante

            team1 = row[2]
            # score_str = row[3]  # Ignorar o score pré-determinado, será calculado
            team2 = row[4]

            if team1 and team2:
                confrontos.append({
                    "team1": team1,
                    "team2": team2
                })

        return jsonify({
            "semana": semana,
            "confrontos": confrontos,
            "total": len(confrontos)
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/loja-dias/<sigla>/<int:semana>', methods=['GET'])
def get_loja_dias(sigla, semana):
    """Retorna dados dia a dia de uma loja para uma semana"""
    try:
        dados_dias = {}

        # Indicadores descobertos automaticamente, já pareando o arquivo da
        # semana anterior com o da semana atual (tolerando pequenas diferenças
        # de nome).
        mapa = mapear_indicadores()

        for arquivo, slots in mapa.items():
            info = indicador_meta(arquivo)

            for semana_type in ("anterior", "atual"):
                file_path = slots.get(semana_type)
                if not file_path:
                    continue

                dias = ler_dias_loja(file_path, sigla)
                if dias is None:
                    continue  # Loja não está neste arquivo

                dados_dias.setdefault(arquivo, {})[semana_type] = {
                    "name": info["name"],
                    "type": info["type"],
                    "dias": dias
                }

        # Mapa de dias semana para índices (0=Seg, 6=Dom)
        dias_semana = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
        hoje_idx = datetime.now().weekday()  # 0=Mon, 6=Sun
        # Converter para índice local (0=Seg brasileiro, 6=Dom)
        hoje_idx_br = (hoje_idx + 1) % 7  # Ajustar para semana começar em seg

        return jsonify({
            "sigla": sigla,
            "semana": semana,
            "dados": dados_dias,
            "hoje_dia": dias_semana[hoje_idx_br],
            "hoje_idx": hoje_idx_br
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/placar/<team1>/<team2>/<int:semana>', methods=['GET'])
def get_placar(team1, team2, semana):
    """Calcula o placar entre dois times baseado na evolução dos indicadores.
    Retorna score_team1 e score_team2, onde cada ponto = 1 indicador vencido."""
    try:
        score1, score2 = calcular_placar(team1, team2, semana)
        return jsonify({
            "team1": team1,
            "team2": team2,
            "score": f"{score1} x {score2}",
            "score1": score1,
            "score2": score2
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/lojas-disponiveis', methods=['GET'])
def get_lojas_disponiveis():
    """Retorna lista de todas as lojas disponíveis"""
    try:
        dados_anterior = get_dados_indicadores("anterior")

        # Pegar lojas do primeiro indicador
        primeiro_indicador = list(dados_anterior.values())[0]
        lojas = sorted(list(primeiro_indicador["data"].keys()))

        return jsonify({
            "total": len(lojas),
            "lojas": lojas
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ============================================================
# CALCULAR RESUMO DE TODOS OS JOGOS (PRÉ-CÁLCULO)
# ============================================================

def calcularPlacarBackend(team1, team2, semana, hojeIdx=None):
    """Calcula placar comparando evolução dos indicadores"""
    try:
        mapa = mapear_indicadores()
        score1 = 0
        score2 = 0
        diasOrdenados = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

        for arquivo, slots in mapa.items():
            dados1_ind = {}
            dados2_ind = {}

            for semana_type in ("anterior", "atual"):
                file_path = slots.get(semana_type)
                if not file_path:
                    continue

                dias1 = ler_dias_loja(file_path, team1)
                dias2 = ler_dias_loja(file_path, team2)

                if dias1:
                    dados1_ind[semana_type] = dias1
                if dias2:
                    dados2_ind[semana_type] = dias2

            if not dados1_ind or not dados2_ind:
                continue

            dias1Anterior = dados1_ind.get('anterior', {})
            dias1Atual = dados1_ind.get('atual', {})
            dias2Anterior = dados2_ind.get('anterior', {})
            dias2Atual = dados2_ind.get('atual', {})

            diasAcontar = diasOrdenados[:hojeIdx+1] if hojeIdx is not None else diasOrdenados

            total1Anterior = sum(dias1Anterior.get(dia, 0) for dia in diasAcontar)
            total1Atual = sum(dias1Atual.get(dia, 0) for dia in diasAcontar)
            total2Anterior = sum(dias2Anterior.get(dia, 0) for dia in diasAcontar)
            total2Atual = sum(dias2Atual.get(dia, 0) for dia in diasAcontar)

            evolucao1 = (total1Atual - total1Anterior)
            evolucao2 = (total2Atual - total2Anterior)

            if evolucao1 > evolucao2:
                score1 += 1
            elif evolucao2 > evolucao1:
                score2 += 1

        return score1, score2
    except Exception as e:
        print(f"Erro ao calcular placar {team1} vs {team2}: {e}")
        return 0, 0

@app.route('/api/precalculate/<int:semana>', methods=['POST'])
def precalculate_games(semana):
    """Pré-calcula todos os jogos e salva em arquivo JSON para cache"""
    try:
        import json

        print(f"\n⏳ Iniciando pré-cálculo para semana {semana}...")

        # Carregar confrontos
        confrontos_path = BASE_PATH / "Confrontos" / f"Semana {semana}.xlsx"
        if not confrontos_path.exists():
            return jsonify({"error": f"Confrontos da semana {semana} não encontrados"}), 404

        wb = openpyxl.load_workbook(confrontos_path, data_only=True)
        ws = wb.active
        confrontos = []

        for row_idx, row in enumerate(ws.iter_rows(values_only=True)):
            if row_idx <= 1:
                continue
            team1 = row[2]
            team2 = row[4]
            if team1 and team2:
                confrontos.append({"team1": team1, "team2": team2})

        games_summary = []
        print(f"⏳ Calculando {len(confrontos)} jogos...")

        # Pegar hoje_idx
        hoje_idx = 6
        try:
            hoje_idx_br = (datetime.now().weekday() + 1) % 7
            hoje_idx = hoje_idx_br
        except:
            pass

        for idx, conf in enumerate(confrontos):
            team1 = conf['team1']
            team2 = conf['team2']

            if (idx + 1) % 20 == 0:
                print(f"  {idx + 1}/{len(confrontos)} calculados...")

            score1_proj, score2_proj = calcularPlacarBackend(team1, team2, semana)
            score1_acum, score2_acum = calcularPlacarBackend(team1, team2, semana, hoje_idx)

            games_summary.append({
                "team1": team1,
                "team2": team2,
                "scoreProjected": f"{score1_proj} x {score2_proj}",
                "scoreAccumulated": f"{score1_acum} x {score2_acum}",
                "hojeIdx": hoje_idx
            })

        # Tentar salvar em arquivo (pode falhar em Vercel)
        try:
            cache_dir = BASE_PATH / "cache"
            cache_dir.mkdir(exist_ok=True)
            cache_file = str(cache_dir / f'games-summary-w{semana}.json')
            data = {
                "week": semana,
                "lastUpdated": datetime.now().isoformat(),
                "total": len(games_summary),
                "games": games_summary
            }
            with open(cache_file, 'w') as f:
                json.dump(data, f, indent=2)
            print(f"✅ {len(games_summary)} jogos calculados e salvos!")
        except Exception as cache_err:
            print(f"⚠️  Não foi possível salvar cache: {cache_err}")

        return jsonify({
            "message": f"Pré-cálculo concluído para semana {semana}",
            "week": semana,
            "total": len(games_summary),
            "games": games_summary
        }), 200

    except Exception as e:
        print(f"❌ Erro ao iniciar pré-cálculo: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/api/games-summary/<int:semana>', methods=['GET'])
def get_games_summary(semana):
    """Retorna resumo pré-calculado de todos os jogos da semana (from cache)"""
    try:
        import json
        import os

        # 1) Cache em /tmp (reprocessado nesta instância) — mais fresco e rápido
        try:
            tmp_cache = str(TMP_BASE / "cache" / f'games-summary-w{semana}.json')
            if os.path.exists(tmp_cache):
                print(f"📦 Cache /tmp: {tmp_cache}")
                with open(tmp_cache, 'r') as f:
                    return jsonify(json.load(f))
        except Exception:
            pass

        # 2) Sem cache local (ex.: cold start): buscar do SharePoint AO VIVO.
        #    Isso garante que os dados nunca "revertam" para o empacotado antigo.
        try:
            print("🔄 Sem cache local — buscando do SharePoint ao vivo...")
            r = _baixar_e_recalcular(semana)
            return jsonify(r["data"])
        except Exception as e:
            print(f"⚠️ Auto-fetch do SharePoint falhou ({e}). Usando fallback empacotado.")

        # 3) Fallback: cache empacotado no repositório
        try:
            b_cache = str(BUNDLED_BASE / "cache" / f'games-summary-w{semana}.json')
            if os.path.exists(b_cache):
                print(f"📦 Cache empacotado: {b_cache}")
                with open(b_cache, 'r') as f:
                    return jsonify(json.load(f))
        except Exception:
            pass

        # 4) Último recurso: calcular a partir do empacotado (lento)
        print(f"⚠️ Cache não encontrado! Calculando a partir do empacotado...")

        confrontos_path = BASE_PATH / "Confrontos" / f"Semana {semana}.xlsx"
        if not confrontos_path.exists():
            return jsonify({"error": f"Confrontos da semana {semana} não encontrados"}), 404

        wb = openpyxl.load_workbook(confrontos_path, data_only=True)
        ws = wb.active
        confrontos = []

        for row_idx, row in enumerate(ws.iter_rows(values_only=True)):
            if row_idx <= 1:
                continue
            team1 = row[2]
            team2 = row[4]
            if team1 and team2:
                confrontos.append({"team1": team1, "team2": team2})

        games_summary = []
        hoje_idx = 6
        try:
            hoje_idx_br = (datetime.now().weekday() + 1) % 7
            hoje_idx = hoje_idx_br
        except:
            pass

        for idx, conf in enumerate(confrontos):
            team1 = conf['team1']
            team2 = conf['team2']

            if (idx + 1) % 30 == 0:
                print(f"  {idx + 1}/{len(confrontos)} calculados...")

            score1_proj, score2_proj = calcularPlacarBackend(team1, team2, semana)
            score1_acum, score2_acum = calcularPlacarBackend(team1, team2, semana, hoje_idx)

            games_summary.append({
                "team1": team1,
                "team2": team2,
                "scoreProjected": f"{score1_proj} x {score2_proj}",
                "scoreAccumulated": f"{score1_acum} x {score2_acum}",
                "hojeIdx": hoje_idx
            })

        return jsonify({
            "week": semana,
            "lastUpdated": datetime.now().isoformat(),
            "total": len(games_summary),
            "games": games_summary
        })

    except Exception as e:
        print(f"❌ Erro ao retornar resumo: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# ============================================================
# REPROCESSAR (baixa dados do SharePoint e recalcula)
# ============================================================

def _baixar_e_recalcular(semana):
    """Baixa as pastas do SharePoint, recalcula todos os jogos e grava o cache
    em /tmp. Retorna dict com 'data' (resumo), 'baixados' e 'dias_atual'.
    Lança exceção em falha."""
    import json
    import sharepoint
    import calculo_rapido as cr

    # 1) Baixar as pastas do SharePoint para /tmp
    print(f"⏳ Semana {semana}: baixando do SharePoint...")
    baixados = sharepoint.baixar_todas_pastas(str(TMP_BASE), timeout=40)
    total_arqs = sum(len(v) for v in baixados.values())
    if total_arqs == 0:
        raise RuntimeError("Nenhum arquivo baixado do SharePoint. "
                           "Verifique os links de compartilhamento.")
    print(f"✅ Baixados: {baixados}")

    # 2) Confrontos vêm da base empacotada (não mudam no dia a dia)
    confrontos_path = BUNDLED_BASE / "Confrontos" / f"Semana {semana}.xlsx"
    if not confrontos_path.exists():
        raise FileNotFoundError(f"Confrontos da semana {semana} não encontrados")
    confrontos = cr.ler_confrontos(confrontos_path)

    # 3) Cálculo rápido em memória (lê os dados frescos de /tmp)
    memoria = cr.carregar_tudo(TMP_BASE / "SEMANA ANTERIOR", TMP_BASE / "SEMANA ATUAL")
    hoje_idx = (datetime.now().weekday() + 1) % 7
    jogos = cr.calcular_todos_jogos(confrontos, memoria, hoje_idx)

    # 4) Salvar cache em /tmp
    cache_dir = TMP_BASE / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    data = {
        "week": semana,
        "lastUpdated": datetime.now().isoformat(),
        "total": len(jogos),
        "games": jogos,
    }
    with open(cache_dir / f'games-summary-w{semana}.json', 'w') as f:
        json.dump(data, f, ensure_ascii=False)

    # Dias disponíveis na semana atual (para informar o usuário)
    dias_atual = []
    for arq, sem in memoria.items():
        for loja, dias in sem.get("atual", {}).items():
            dias_atual = list(dias.keys())
            break
        if dias_atual:
            break

    print(f"✅ Reprocessamento concluído: {len(jogos)} jogos.")
    return {"data": data, "baixados": baixados, "dias_atual": dias_atual}


@app.route('/api/reprocessar/<int:semana>', methods=['POST'])
@login_required
def reprocessar(semana):
    """Baixa as pastas SEMANA ANTERIOR/ATUAL do SharePoint, recalcula todos os
    jogos e atualiza o cache. Retorna o resumo recalculado."""
    try:
        r = _baixar_e_recalcular(semana)
        return jsonify({
            "message": "Reprocessamento concluído com sucesso",
            "week": semana,
            "total": r["data"]["total"],
            "arquivos_baixados": r["baixados"],
            "dias_semana_atual": r["dias_atual"],
            "lastUpdated": r["data"]["lastUpdated"],
        })
    except Exception as e:
        print(f"❌ Erro no reprocessamento: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Falha ao reprocessar: {e}"}), 500

# ============================================================
# AUTENTICAÇÃO
# ============================================================

@app.route('/api/login', methods=['POST'])
def login():
    """Login de usuário"""
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    if not username or not password:
        return jsonify({"error": "Username e password são obrigatórios"}), 400

    user = Usuario.query.filter_by(username=username).first()

    if user is None or not user.check_password(password):
        return jsonify({"error": "Username ou password inválidos"}), 401

    if not user.ativo:
        return jsonify({"error": "Usuário inativo"}), 403

    login_user(user, remember=True)
    session.permanent = True

    return jsonify({
        "message": "Login realizado com sucesso",
        "user": user.to_dict()
    })

@app.route('/api/logout', methods=['POST'])
@login_required
def logout():
    """Logout de usuário"""
    logout_user()
    return jsonify({"message": "Logout realizado com sucesso"})

@app.route('/api/me', methods=['GET'])
def get_current_user():
    """Retorna informações do usuário logado"""
    if current_user.is_authenticated:
        return jsonify({"user": current_user.to_dict()})
    return jsonify({"user": None})

@app.route('/api/usuarios', methods=['GET'])
@login_required
def list_usuarios():
    """Lista todos os usuários (apenas admin)"""
    if not current_user.é_admin:
        return jsonify({"error": "Acesso negado"}), 403

    usuarios = Usuario.query.all()
    return jsonify({
        "total": len(usuarios),
        "usuarios": [u.to_dict() for u in usuarios]
    })

@app.route('/api/usuarios', methods=['POST'])
@login_required
def create_usuario():
    """Cria novo usuário (apenas admin)"""
    if not current_user.é_admin:
        return jsonify({"error": "Acesso negado"}), 403

    data = request.get_json()
    username = data.get('username')
    email = data.get('email')
    nome_completo = data.get('nome_completo')
    password = data.get('password')

    if not username or not password:
        return jsonify({"error": "Username e password são obrigatórios"}), 400

    if Usuario.query.filter_by(username=username).first():
        return jsonify({"error": "Username já existe"}), 400

    if email and Usuario.query.filter_by(email=email).first():
        return jsonify({"error": "Email já existe"}), 400

    novo_usuario = Usuario(
        username=username,
        email=email,
        nome_completo=nome_completo,
        ativo=True
    )
    novo_usuario.set_password(password)
    db.session.add(novo_usuario)
    db.session.commit()

    return jsonify({
        "message": "Usuário criado com sucesso",
        "user": novo_usuario.to_dict()
    }), 201

@app.route('/api/usuarios/<int:usuario_id>', methods=['PUT'])
@login_required
def update_usuario(usuario_id):
    """Atualiza usuário (admin) ou sua própria senha"""
    usuario = Usuario.query.get(usuario_id)

    if not usuario:
        return jsonify({"error": "Usuário não encontrado"}), 404

    # Usuário comum só pode atualizar sua própria senha
    if not current_user.é_admin and current_user.id != usuario_id:
        return jsonify({"error": "Acesso negado"}), 403

    data = request.get_json()

    # Atualizar senha
    if 'password' in data and data['password']:
        usuario.set_password(data['password'])

    # Apenas admin pode atualizar outros campos
    if current_user.é_admin:
        if 'email' in data:
            usuario.email = data['email']
        if 'nome_completo' in data:
            usuario.nome_completo = data['nome_completo']
        if 'ativo' in data:
            usuario.ativo = data['ativo']

    db.session.commit()

    return jsonify({
        "message": "Usuário atualizado com sucesso",
        "user": usuario.to_dict()
    })

@app.route('/api/usuarios/<int:usuario_id>', methods=['DELETE'])
@login_required
def delete_usuario(usuario_id):
    """Deleta usuário (apenas admin)"""
    if not current_user.é_admin:
        return jsonify({"error": "Acesso negado"}), 403

    usuario = Usuario.query.get(usuario_id)

    if not usuario:
        return jsonify({"error": "Usuário não encontrado"}), 404

    if usuario.id == current_user.id:
        return jsonify({"error": "Não pode deletar a si mesmo"}), 400

    db.session.delete(usuario)
    db.session.commit()

    return jsonify({"message": "Usuário deletado com sucesso"})

# ============================================================
# SERVIR ARQUIVOS ESTÁTICOS
# ============================================================

STATIC_DIR = str(Path(__file__).parent)

@app.route('/')
def index():
    """Serve a página principal do dashboard"""
    return send_from_directory(STATIC_DIR, 'dashboard-v3.html')

@app.route('/<path:filename>')
def serve_static(filename):
    """Serve arquivos estáticos (CSS, JS, etc)"""
    return send_from_directory(STATIC_DIR, filename)

# ============================================================
# Main
# ============================================================

if __name__ == '__main__':
    print("🚀 Iniciando Backend Campeonato Petz...")
    print(f"📁 Lendo dados de: {BASE_PATH}")
    print("🔗 API disponível em: http://localhost:5000")
    print("\nEndpoints:")
    print("  GET  /api/health")
    print("  GET  /api/indicadores")
    print("  GET  /api/dados-semanas")
    print("  GET  /api/lojas-disponiveis")
    print("  GET  /api/loja/<sigla>")
    print("  POST /api/comparacao-lojas")
    print("\n" + "="*60)

    app.run(debug=True, port=5000, host='0.0.0.0', threaded=True)
