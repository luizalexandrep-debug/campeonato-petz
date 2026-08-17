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

# ------------------------------------------------------------------
# Banco de dados de usuários
# ------------------------------------------------------------------
# Prioriza um Postgres gerenciado (Vercel/Neon), que é PERMANENTE. Sem ele,
# cai para SQLite — que em /tmp no Vercel é efêmero (usuários/senhas se perdem
# a cada reinício da instância).
def _database_uri():
    for var in ('POSTGRES_URL_NON_POOLING', 'POSTGRES_URL', 'DATABASE_URL',
                'POSTGRES_PRISMA_URL'):
        url = os.environ.get(var)
        if url:
            # SQLAlchemy exige o driver explícito
            if url.startswith('postgres://'):
                url = url.replace('postgres://', 'postgresql://', 1)
            if url.startswith('postgresql://'):
                url = url.replace('postgresql://', 'postgresql+psycopg://', 1)
            # o parâmetro do Prisma não é aceito pelo driver
            url = url.replace('?pgbouncer=true', '?').replace('&pgbouncer=true', '')
            print(f"🗄️  Usando Postgres permanente (via {var})")
            return url
    if os.environ.get('VERCEL') or not os.access(str(Path(__file__).parent), os.W_OK):
        print("⚠️  Sem Postgres configurado — usando SQLite em /tmp (efêmero!)")
        return 'sqlite:////tmp/campeonato.db'
    return f"sqlite:///{Path(__file__).parent / 'campeonato.db'}"


app.config['SQLALCHEMY_DATABASE_URI'] = _database_uri()
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {'pool_pre_ping': True}
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'sua-chave-secreta-mude-isso-em-producao')
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SECURE'] = False  # Mude para True em produção (HTTPS)
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

db.init_app(app)
login_manager.init_app(app)
login_manager.login_view = 'login'

# Inicializar banco de dados
init_db(app)


@app.after_request
def _sem_cache_api(resp):
    """Impede navegador/CDN de servir respostas de API em cache (dados mudam)."""
    if request.path.startswith('/api/'):
        resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        resp.headers['Pragma'] = 'no-cache'
    return resp

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
    """Retorna a base de dados ativa: /tmp se já houve download do SharePoint,
    senão a base empacotada no repositório.

    Considera TAMBÉM as subpastas por rodada — com a estrutura nova os arquivos
    ficam em 'SEMANA ATUAL/rodada N' e a raiz fica vazia; sem isso o app cairia
    para a cópia antiga do repositório.
    """
    for pasta in ("SEMANA ATUAL", "SEMANA ANTERIOR"):
        p = TMP_BASE / pasta
        if p.exists() and (any(p.glob("*.xlsx")) or any(p.glob("rodada */*.xlsx"))):
            return TMP_BASE
    return BUNDLED_BASE


def _tem_xlsx(p):
    return p.exists() and any(p.glob("*.xlsx"))


def _rodada_iniciada(base, n):
    """A rodada n já tem base para ser exibida?

    Basta a SEMANA ANTERIOR: no primeiro dia da rodada só existe a base de
    comparação, e é assim que deve aparecer — semana anterior com os valores
    e semana atual zerada, evoluindo conforme os dias entram.
    """
    return (_tem_xlsx(base / "SEMANA ATUAL" / f"rodada {n}")
            or _tem_xlsx(base / "SEMANA ANTERIOR" / f"rodada {n}"))


def rodada_efetiva(semana=None):
    """Qual rodada realmente tem dados para exibir.

    Ordem: a própria rodada -> estrutura antiga (arquivos na raiz) -> a rodada
    anterior mais recente que tenha dados. Retorna (rodada, usou_raiz).
    Isso mantém o app útil quando a rodada já começou (confrontos publicados)
    mas as planilhas de venda dela ainda não subiram.
    """
    base = active_base()
    if semana is None:
        semana = semana_atual()
    if _rodada_iniciada(base, semana):
        return semana, False
    if _tem_xlsx(base / "SEMANA ATUAL"):
        return semana, True          # estrutura antiga (sem subpastas)
    for n in range(semana - 1, 0, -1):
        if _rodada_iniciada(base, n):
            return n, False
    return semana, True


def _dir_semana(pasta, semana=None):
    """Diretório dos dados de uma semana.

    Estrutura preferida (por rodada):  <base>/SEMANA ATUAL/rodada 8
    Cai para a pasta antiga (<base>/SEMANA ATUAL) ou para a última rodada com
    dados, de modo que a migração dos arquivos possa ser feita aos poucos.
    """
    base = active_base()
    rod, usou_raiz = rodada_efetiva(semana)
    return (base / pasta) if usou_raiz else (base / pasta / f"rodada {rod}")


def dir_anterior(semana=None):
    return _dir_semana("SEMANA ANTERIOR", semana)


def dir_atual(semana=None):
    return _dir_semana("SEMANA ATUAL", semana)


def dir_confrontos():
    """Pasta de confrontos: prefere a baixada do SharePoint (/tmp), senão a
    empacotada no repositório."""
    tmp_conf = TMP_BASE / "Confrontos"
    if tmp_conf.exists() and any(tmp_conf.glob("Semana *.xlsx")):
        return tmp_conf
    return BUNDLED_BASE / "Confrontos"


def semanas_disponiveis():
    """Lista os números de semana com arquivo de confrontos disponível."""
    semanas = set()
    for base in (TMP_BASE / "Confrontos", BUNDLED_BASE / "Confrontos"):
        if not base.exists():
            continue
        for f in base.glob("Semana *.xlsx"):
            if f.name.startswith("~"):
                continue
            m = re.search(r"Semana\s+(\d+)", f.name)
            if m:
                semanas.add(int(m.group(1)))
    return sorted(semanas)


def semana_atual():
    """Semana vigente = maior número de semana com confrontos disponíveis."""
    s = semanas_disponiveis()
    return s[-1] if s else 4


# Mantidos por compatibilidade (usados só como base do Confrontos e afins)
SEMANA_ANTERIOR = BASE_PATH / "SEMANA ANTERIOR"
SEMANA_ATUAL = BASE_PATH / "SEMANA ATUAL"

# ------------------------------------------------------------------
# Frescor dos dados (resolve o /tmp por-instância do Vercel)
# ------------------------------------------------------------------
# Cada instância serverless tem seu próprio /tmp. Sem um controle de validade,
# uma instância que baixou os dados na quarta continua servindo quarta mesmo
# depois de alguém atualizar o SharePoint. Este TTL faz cada instância
# rebaixar os arquivos do SharePoint quando estão "velhos", convergindo todas
# para o dado mais recente em poucos minutos.
import time
import threading

CACHE_TTL_SEGUNDOS = 90          # frescor máximo antes de rebaixar
_fetch_lock = threading.Lock()
_MARKER = TMP_BASE / ".fetched_at"


def garantir_rodada(semana):
    """Garante que os dados da rodada pedida estejam em /tmp.
    Permite reabrir rodadas passadas: se a subpasta 'rodada N' ainda não foi
    baixada nesta instância, busca sob demanda (uma vez)."""
    if not semana:
        return
    alvo = TMP_BASE / "SEMANA ATUAL" / f"rodada {semana}"
    if alvo.exists() and any(alvo.glob("*.xlsx")):
        return
    marcador = TMP_BASE / f".rodada_{semana}_tentada"
    if marcador.exists():
        return   # já tentamos; a rodada provavelmente não usa subpastas
    with _fetch_lock:
        if alvo.exists() and any(alvo.glob("*.xlsx")):
            return
        try:
            import sharepoint
            print(f"⏳ Baixando dados da rodada {semana}...")
            sharepoint.baixar_rodada(semana, str(TMP_BASE), timeout=25)
        except Exception as e:
            print(f"⚠️ garantir_rodada({semana}) falhou: {e}")
        finally:
            try:
                TMP_BASE.mkdir(parents=True, exist_ok=True)
                marcador.write_text(str(time.time()))
            except Exception:
                pass


def _idade_tmp():
    """Idade (segundos) dos dados em /tmp; None se nunca baixado."""
    try:
        if _MARKER.exists():
            return time.time() - float(_MARKER.read_text().strip())
    except Exception:
        pass
    return None


def garantir_arquivos_frescos(force=False):
    """Garante que /tmp tenha os arquivos do SharePoint razoavelmente frescos.
    Baixa se nunca baixou, se passou do TTL, ou se force=True. Protegido por
    lock para evitar downloads simultâneos na mesma instância."""
    idade = _idade_tmp()
    if not force and idade is not None and idade < CACHE_TTL_SEGUNDOS:
        return  # já está fresco o suficiente
    with _fetch_lock:
        # Re-checar após o lock: outra thread pode ter acabado de baixar
        idade = _idade_tmp()
        if not force and idade is not None and idade < CACHE_TTL_SEGUNDOS:
            return
        try:
            import sharepoint
            print("⏳ Atualizando dados do SharePoint (frescor)...")
            # Em duas fases: a rodada vigente é definida pelos Confrontos, que
            # só ficam corretos DEPOIS do primeiro download. Perguntar antes
            # devolveria a semana da cópia empacotada (desatualizada) e as
            # subpastas certas nunca seriam baixadas.
            sharepoint.baixar_todas_pastas(str(TMP_BASE), timeout=40)
            try:
                sem = semana_atual()
            except Exception:
                sem = None
            if sem:
                for s in (sem, sem - 1):
                    if s > 0:
                        sharepoint.baixar_rodada(s, str(TMP_BASE), timeout=30)
            _MARKER.write_text(str(time.time()))
            print("✅ Dados do SharePoint atualizados em /tmp.")
        except Exception as e:
            print(f"⚠️ garantir_arquivos_frescos falhou: {e}")

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


def mapear_indicadores(semana=None):
    """Descobre os indicadores e pareia cada arquivo da SEMANA ATUAL com o
    arquivo correspondente da SEMANA ANTERIOR, mesmo que os nomes tenham
    pequenas diferenças. Retorna dict:
        { nome_arquivo_atual: {"anterior": Path|None, "atual": Path|None} }
    Quando um novo .xlsx é adicionado, ele entra automaticamente."""
    atual_files = _listar_xlsx(dir_atual(semana))
    anterior_files = _listar_xlsx(dir_anterior(semana))

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


_TIPO_CACHE = {}


def detectar_tipo(file_path):
    """Detecta se o indicador é percentual ('%') ou monetário ('R$').

    Regra (nesta ordem):
      1. Se TODAS as células de dados têm formato de porcentagem -> '%'
         (ex.: SHARE MOL, SHARE DE CLUBZ).
      2. Senão, quem decide são os VALORES: fração (|v| < 1) -> '%',
         caso contrário -> 'R$'. Isso evita classificar errado planilhas com
         formatação mista/resquício de '%' (caso do MP AREIAS, cujos valores
         são centenas/milhares).
      3. Sem valores, cai no formato.
    """
    if file_path is None:
        return "R$"
    chave = str(file_path)
    if chave in _TIPO_CACHE:
        return _TIPO_CACHE[chave]
    tipo = "R$"
    try:
        wb = openpyxl.load_workbook(file_path)  # sem data_only: preserva formato
        ws = wb.active
        formatos = []
        for row in ws.iter_rows(min_row=2, max_row=30, min_col=3, max_col=9):
            for c in row:
                if c.number_format:
                    formatos.append(str(c.number_format))
        wb.close()
        com_pct = sum(1 for f in formatos if '%' in f)
        so_pct = bool(formatos) and com_pct == len(formatos)

        wb = openpyxl.load_workbook(file_path, data_only=True, read_only=True)
        ws = wb.active
        vals = [abs(v) for row in ws.iter_rows(min_row=2, min_col=3, max_col=9,
                                               values_only=True) if row
                for v in row if isinstance(v, (int, float)) and v != 0]
        wb.close()

        if so_pct:
            tipo = "%"
        elif vals:
            tipo = "%" if all(v < 1 for v in vals) else "R$"
        else:
            tipo = "%" if com_pct else "R$"
    except Exception as e:
        print(f"⚠️ detectar_tipo falhou para {file_path}: {e}")
    _TIPO_CACHE[chave] = tipo
    return tipo


def indicador_meta(arquivo, file_path=None):
    """Nome/tipo do indicador. O tipo é DETECTADO do arquivo (formato da
    célula); INDICADORES_MAP serve só para o nome amigável."""
    nome = INDICADORES_MAP.get(arquivo, {}).get("name") or arquivo.rsplit(".", 1)[0]
    tipo = detectar_tipo(file_path) if file_path is not None else \
        INDICADORES_MAP.get(arquivo, {}).get("type", "R$")
    return {"name": nome, "type": tipo}


def ler_dias_loja(file_path, sigla):
    """Lê os valores dia a dia de uma loja. Retorna {dia: valor} ou None se a
    loja não estiver no arquivo.

    Usa o leitor de calculo_rapido, que tolera layouts diferentes (cabeçalho
    fora da 1ª linha, datas reais em vez de '10/08/2026 (Seg)', dias em ordem
    invertida e coluna 'Total') — caso do SHARE CLUBZ.
    """
    import calculo_rapido as cr
    try:
        dados = cr._carregar_arquivo(file_path)
    except Exception as e:
        print(f"⚠️ ler_dias_loja falhou ({file_path}): {e}")
        return None
    return dados.get(sigla)


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

        info = indicador_meta(arquivo, file_path)
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

def estrutura_do_sharepoint():
    """Lê estrutura.xlsx (Regional | Distrito | Sigla Loja) da pasta raiz do
    SharePoint. Retorna {regional: {distrito: [lojas]}} ou None."""
    pasta = TMP_BASE / "Estrutura"
    arq = pasta / "estrutura.xlsx"
    if not arq.exists():
        cands = list(pasta.glob("*.xlsx")) if pasta.exists() else []
        if not cands:
            return None
        arq = cands[0]
    try:
        wb = openpyxl.load_workbook(arq, data_only=True, read_only=True)
        ws = wb.active
        linhas = list(ws.iter_rows(values_only=True))
        wb.close()
        est = {}
        for row in linhas[1:]:
            if not row or len(row) < 3:
                continue
            reg, dist, loja = row[0], row[1], row[2]
            if not reg or not dist or not loja:
                continue
            est.setdefault(str(reg).strip(), {}) \
               .setdefault(str(dist).strip(), []).append(str(loja).strip())
        return est or None
    except Exception as e:
        print(f"⚠️ Falha ao ler estrutura do SharePoint: {e}")
        return None


def estrutura_ativa():
    """Estrutura vigente: SharePoint se disponível, senão estrutura.json."""
    est = estrutura_do_sharepoint()
    if est:
        return est
    try:
        import json as _json
        with open(Path(__file__).parent / 'estrutura.json') as f:
            return _json.load(f)
    except Exception:
        return {}


@app.route('/api/estrutura', methods=['GET'])
def get_estrutura():
    """Estrutura Regional > Distrito > Lojas (do SharePoint, com fallback)."""
    try:
        garantir_arquivos_frescos()
    except Exception:
        pass
    est = estrutura_do_sharepoint()
    if est:
        return jsonify(est)
    try:
        import json as _json
        with open(Path(__file__).parent / 'estrutura.json') as f:
            return jsonify(_json.load(f))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _distritos_da_estrutura():
    """Lista de distritos da estrutura vigente (fonte da verdade do app)."""
    try:
        return [d for reg in estrutura_ativa().values() for d in reg]
    except Exception:
        return []


def _parear_com_estrutura(distritos_planilha):
    """Converte os nomes vindos do ranking para os nomes usados no app.
    Retorna (dict_pareado, nomes_da_planilha_sem_par, distritos_do_app_sem_historico).
    """
    import unicodedata

    def norm(s):
        s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()
        return re.sub(r'[^a-z0-9]', '', s)

    def partes(nome):
        p = str(nome).split(' - ', 1)
        return norm(p[0]), (norm(p[1]) if len(p) > 1 else '')

    app_dists = _distritos_da_estrutura()
    if not app_dists:
        return distritos_planilha, [], []

    resultado, usados = {}, set()
    criterios = [
        lambda a, b: a == b,                                   # nome idêntico
        lambda a, b: partes(a)[0] == partes(b)[0],             # mesmo prefixo
        lambda a, b: partes(a)[1] and partes(a)[1] == partes(b)[1],  # mesma pessoa
    ]
    pendentes = list(distritos_planilha.keys())
    for cmp_ in criterios:
        for nome in list(pendentes):
            for alvo in app_dists:
                if alvo in usados:
                    continue
                if cmp_(nome, alvo):
                    resultado[alvo] = distritos_planilha[nome]
                    usados.add(alvo)
                    pendentes.remove(nome)
                    break
    sem_historico = [d for d in app_dists if d not in usados]
    return resultado, pendentes, sem_historico


def _parear_regionais(regionais_planilha):
    """Converte os nomes de regional do ranking para os nomes da estrutura.
    Casa por nome exato, prefixo (R1/R2/R3) ou nome da pessoa."""
    import unicodedata

    def norm(s):
        s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()
        return re.sub(r'[^a-z0-9]', '', s)

    def partes(nome):
        p = str(nome).split(' - ', 1)
        return norm(p[0]), (norm(p[1]) if len(p) > 1 else '')

    alvos = list(estrutura_ativa().keys())
    if not alvos:
        return regionais_planilha, [], []
    resultado, usados = {}, set()
    criterios = [
        lambda a, b: a == b,
        lambda a, b: partes(a)[0] == partes(b)[0],
        lambda a, b: partes(a)[1] and partes(a)[1] == partes(b)[1],
    ]
    pendentes = list(regionais_planilha.keys())
    for cmp_ in criterios:
        for nome in list(pendentes):
            for alvo in alvos:
                if alvo in usados:
                    continue
                if cmp_(nome, alvo):
                    resultado[alvo] = regionais_planilha[nome]
                    usados.add(alvo)
                    pendentes.remove(nome)
                    break
    return resultado, pendentes, [a for a in alvos if a not in usados]


def historico_do_sharepoint(nome_pasta="Historico", chave="distrito"):
    """Lê o ranking acumulado das rodadas encerradas, do SharePoint.

    nome_pasta: 'Historico' (distritais) ou 'HistoricoRegional' (regionais).
    chave: 'distrito' ou 'regional' — define a coluna de identificação.

    Formato esperado (cabeçalho em qualquer uma das primeiras linhas):
        Rank | Distrital/Regional | Pontuação Média | Vit. Média
    O nº de rodadas vem do nome do arquivo ('rodada 6.xlsx'). Cada arquivo é o
    ranking ACUMULADO até aquela rodada. Retorna None se não houver planilha.
    """
    pasta = TMP_BASE / nome_pasta
    if not pasta.exists():
        return None
    # Só arquivos "rodada N" — a pasta pode conter outros itens por engano
    # (ex.: um 'Semana 8.xlsx' de confrontos salvo no lugar errado).
    def num_rodada(f):
        m = re.match(r"\s*rodada\s*(\d+)", f.stem, re.IGNORECASE)
        return int(m.group(1)) if m else -1

    arquivos = [f for f in pasta.glob("*.xlsx")
                if not f.name.startswith("~") and num_rodada(f) >= 0]
    if not arquivos:
        return None

    # A base é a rodada ANTERIOR à vigente (a atual ainda está em disputa e é
    # somada ao vivo). Se não existir, usa a maior rodada disponível.
    base_desejada = max(semana_atual() - 1, 1)
    candidatos = [f for f in arquivos if num_rodada(f) <= base_desejada]
    arq = max(candidatos or arquivos, key=num_rodada)

    def norm(s):
        # precisa remover ACENTOS, senão 'Pontuação Média' não é reconhecida
        import unicodedata
        s = unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode()
        return re.sub(r"[^a-z]", "", s.lower())

    try:
        wb = openpyxl.load_workbook(arq, data_only=True, read_only=True)
        ws = wb.active
        linhas = list(ws.iter_rows(values_only=True))
        wb.close()
        if not linhas:
            return None

        # Prefixos da coluna de identificação, conforme o tipo de ranking
        pref = (("regional",) if chave == "regional"
                else ("distrital", "distrito"))

        # Descobrir a linha de cabeçalho (a que tem a coluna de identificação)
        idx_head = None
        for i, row in enumerate(linhas[:10]):
            if any(norm(c).startswith(pref) for c in row):
                idx_head = i
                break
        if idx_head is None:
            return None
        head = linhas[idx_head]

        col_dist = col_pts = col_vit = col_rod = None
        for j, c in enumerate(head):
            n = norm(c)
            if col_dist is None and n.startswith(pref):
                col_dist = j
            elif col_pts is None and "pontuacaomedia" in n:
                col_pts = j
            elif col_vit is None and ("vitmedia" in n or "vitoriamedia" in n):
                col_vit = j
            elif col_rod is None and n.startswith("rodada"):
                col_rod = j
        if col_dist is None or col_pts is None:
            return None

        distritos = {}
        rodadas_col = None
        for row in linhas[idx_head + 1:]:
            if not row or col_dist >= len(row):
                continue
            nome = row[col_dist]
            if not nome or not str(nome).strip():
                continue
            try:
                pts = float(row[col_pts])
            except (TypeError, ValueError):
                continue
            vit = 0.0
            if col_vit is not None and col_vit < len(row):
                try:
                    vit = float(row[col_vit])
                except (TypeError, ValueError):
                    vit = 0.0
            if col_rod is not None and col_rod < len(row) and rodadas_col is None:
                try:
                    rodadas_col = int(float(row[col_rod]))
                except (TypeError, ValueError):
                    pass
            distritos[str(nome).strip()] = {
                "pontuacaoMedia": pts, "vitoriaMedia": vit
            }

        if not distritos:
            return None

        # Os nomes no ranking podem diferir dos da estrutura do app
        # (ex.: 'CO-1 - Ana B.' x 'CO-1 - Ana'). Pareia por: nome exato →
        # mesmo prefixo (CO-1, SP5...) → mesma pessoa (Jessica C.).
        if chave == "regional":
            distritos, nao_pareados, sem_historico = _parear_regionais(distritos)
        else:
            distritos, nao_pareados, sem_historico = _parear_com_estrutura(distritos)

        # Nº de rodadas: coluna > nome do arquivo > (semana vigente - 1)
        rodadas = rodadas_col
        if not rodadas:
            m = re.search(r"(\d+)", arq.stem)
            if m:
                rodadas = int(m.group(1))
        if not rodadas:
            rodadas = max(semana_atual() - 1, 1)

        return {
            "rodadasAnteriores": rodadas,
            "atualizadoEm": f"{arq.name} (SharePoint)",
            "distritos": distritos,
            "regionalDestaque": "R2 - Luiz",
            "origem": "sharepoint",
            "naoPareados": nao_pareados,      # nomes do ranking sem par no app
            "semHistorico": sem_historico,    # distritos do app sem histórico
        }
    except Exception as e:
        print(f"⚠️ Falha ao ler histórico do SharePoint: {e}")
        return None


@app.route('/api/historico', methods=['GET'])
def get_historico():
    """Histórico das rodadas encerradas. Prefere a planilha do SharePoint;
    se não houver, usa o historico.json empacotado."""
    try:
        garantir_arquivos_frescos()
    except Exception:
        pass
    # Ranking oficial das REGIONAIS (quando disponível, é a fonte preferida
    # para os totais por regional — evita derivar a partir dos distritos).
    hr = historico_do_sharepoint("HistoricoRegional", chave="regional")

    h = historico_do_sharepoint()
    if h:
        if hr:
            h["regionais"] = hr.get("distritos")
            h["rodadasRegionais"] = hr.get("rodadasAnteriores")
        return jsonify(h)
    try:
        import json as _json
        with open(Path(__file__).parent / 'historico.json') as f:
            d = _json.load(f)
        d["origem"] = "arquivo"
        if hr:
            d["regionais"] = hr.get("distritos")
            d["rodadasRegionais"] = hr.get("rodadasAnteriores")
        return jsonify(d)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/semana', methods=['GET'])
def get_semana():
    """Semana vigente, detectada pelos arquivos de confronto disponíveis.
    Assim, ao subir 'Semana 6.xlsx' o site passa a usar a semana 6 sozinho."""
    try:
        garantir_arquivos_frescos()
    except Exception:
        pass
    return jsonify({
        "semana": semana_atual(),
        "disponiveis": semanas_disponiveis(),
        "origem": str(dir_confrontos()),
    })


@app.route('/api/diag', methods=['GET'])
def diagnostico():
    """Diagnóstico: mostra qual arquivo está sendo usado por indicador/semana,
    tamanho e quantos valores não-zero foram lidos. Ajuda a detectar arquivo
    desatualizado/corrompido em /tmp."""
    try:
        garantir_arquivos_frescos()
        pastas_tmp = {}
        for nome in ("SEMANA ANTERIOR", "SEMANA ATUAL", "Confrontos", "Historico", "Estrutura"):
            p = TMP_BASE / nome
            pastas_tmp[nome] = sorted(f.name for f in p.glob("*.xlsx")) if p.exists() else "AUSENTE"
        out = {
            "base_ativa": str(active_base()),
            "tmp_existe": (TMP_BASE / "SEMANA ATUAL").exists(),
            "idade_download_s": round(_idade_tmp()) if _idade_tmp() is not None else None,
            "pastas_tmp": pastas_tmp,
            "indicadores": {}
        }
        for arquivo, slots in mapear_indicadores().items():
            info = {}
            for semana in ("anterior", "atual"):
                fp = slots.get(semana)
                if not fp:
                    info[semana] = None
                    continue
                dados = {}
                try:
                    wb = openpyxl.load_workbook(fp, data_only=True, read_only=True)
                    ws = wb.active
                    naozero = 0
                    total = 0
                    lojas = 0
                    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True)):
                        if not row or not row[0]:
                            continue
                        lojas += 1
                        for v in row[2:9]:
                            total += 1
                            if isinstance(v, (int, float)) and v != 0:
                                naozero += 1
                    wb.close()
                    dados = {"lojas": lojas, "celulas": total, "nao_zero": naozero}
                except Exception as e:
                    dados = {"erro": str(e)}
                info[semana] = {
                    "arquivo": fp.name,
                    "bytes": fp.stat().st_size if fp.exists() else None,
                    **dados
                }
            info["tipo"] = detectar_tipo(slots.get("atual") or slots.get("anterior"))
            out["indicadores"][arquivo] = info
        return jsonify(out)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


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
        confrontos_path = dir_confrontos() / f"Semana {semana}.xlsx"

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
        garantir_arquivos_frescos()
        garantir_rodada(semana)
        dados_dias = {}

        # Indicadores descobertos automaticamente, já pareando o arquivo da
        # semana anterior com o da semana atual (tolerando pequenas diferenças
        # de nome).
        mapa = mapear_indicadores(semana)

        for arquivo, slots in mapa.items():
            # Tipo detectado do arquivo (prefere o da semana atual)
            info = indicador_meta(arquivo, slots.get("atual") or slots.get("anterior"))

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

            # Evolução PERCENTUAL (regra do campeonato) — casa com o frontend
            import calculo_rapido as _cr
            evolucao1 = _cr.evolucao_pct(total1Anterior, total1Atual)
            evolucao2 = _cr.evolucao_pct(total2Anterior, total2Atual)

            if evolucao1 > evolucao2:
                score1 += 1
            elif evolucao2 > evolucao1:
                score2 += 1
            # Evoluções iguais: desempate em cascata — maior valor atual,
            # depois maior valor da semana anterior
            elif total1Atual > total2Atual:
                score1 += 1
            elif total2Atual > total1Atual:
                score2 += 1
            elif total1Anterior > total2Anterior:
                score1 += 1
            elif total2Anterior > total1Anterior:
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
        confrontos_path = dir_confrontos() / f"Semana {semana}.xlsx"
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

def _calcular_summary(semana):
    """Calcula o resumo de todos os jogos a partir da base ATIVA (/tmp se
    reprocessado, senão empacotada). Retorna o dict do resumo."""
    import calculo_rapido as cr
    confrontos_path = dir_confrontos() / f"Semana {semana}.xlsx"
    if not confrontos_path.exists():
        raise FileNotFoundError(f"Confrontos da semana {semana} não encontrados")
    confrontos = cr.ler_confrontos(confrontos_path)
    garantir_rodada(semana)          # dados da rodada pedida (subpasta)
    memoria = cr.carregar_tudo(dir_anterior(semana), dir_atual(semana))
    hoje_idx = (datetime.now().weekday() + 1) % 7
    jogos = cr.calcular_todos_jogos(confrontos, memoria, hoje_idx)

    # Alerta: indicador que subiu sem nenhum valor (planilha zerada). Sem base
    # de comparação o gol empata em todos os jogos e o placar não soma 6.
    avisos = []
    for arquivo, sem in memoria.items():
        nome = arquivo.rsplit('.', 1)[0]
        for rotulo, chave in (("semana anterior", "anterior"), ("semana atual", "atual")):
            lojas = sem.get(chave) or {}
            if not lojas:
                continue  # arquivo ausente nessa semana (não é o mesmo problema)
            tem_valor = any(v for dias in lojas.values() for v in dias.values())
            if not tem_valor:
                avisos.append({
                    "indicador": nome,
                    "semana": rotulo,
                    "mensagem": f"{nome} ({rotulo}) está sem dados — a planilha subiu zerada, "
                                f"então esse gol não está sendo disputado."
                })

    rod_dados, _raiz = rodada_efetiva(semana)
    if rod_dados == semana and not _listar_xlsx(dir_atual(semana)):
        # 1º dia da rodada: só existe a base de comparação. Mostramos a rodada
        # mesmo assim (semana anterior preenchida, semana atual zerada).
        avisos.append({
            "indicador": "Dados de venda",
            "semana": f"rodada {semana}",
            "mensagem": f"A rodada {semana} está começando: só há a base da semana "
                        f"anterior. A semana atual ainda está zerada, então os gols "
                        f"estão sendo definidos apenas pelos critérios de desempate."
        })
    if rod_dados != semana:
        avisos.append({
            "indicador": "Dados de venda",
            "semana": f"rodada {semana}",
            "mensagem": f"A rodada {semana} ainda não tem planilhas de venda — "
                        f"os placares estão sendo calculados com os dados da rodada {rod_dados}."
        })
    return {
        "week": semana,
        "rodadaDados": rod_dados,
        "semDadosAtual": cr.semana_atual_vazia(memoria),
        "lastUpdated": datetime.now().isoformat(),
        "total": len(jogos),
        "games": jogos,
        "avisos": avisos,
    }


@app.route('/api/games-summary/<int:semana>', methods=['GET'])
def get_games_summary(semana):
    """Retorna o resumo de todos os jogos, sempre a partir dos dados mais
    frescos disponíveis (SharePoint via /tmp, com TTL)."""
    try:
        import json
        import os

        # 1) Garante que /tmp esteja fresco (rebaixa do SharePoint se preciso)
        garantir_arquivos_frescos()

        # 2) Calcular a partir da base ativa (rápido, ~0.4s)
        try:
            return jsonify(_calcular_summary(semana))
        except Exception as e:
            print(f"⚠️ Cálculo do resumo falhou ({e}). Tentando fallback empacotado.")

        # 3) Fallback: cache empacotado no repositório
        try:
            b_cache = str(BUNDLED_BASE / "cache" / f'games-summary-w{semana}.json')
            if os.path.exists(b_cache):
                with open(b_cache, 'r') as f:
                    return jsonify(json.load(f))
        except Exception:
            pass

        return jsonify({"error": "Não foi possível calcular o resumo"}), 500

    except Exception as e:
        print(f"❌ Erro ao retornar resumo: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# ============================================================
# REPROCESSAR (baixa dados do SharePoint e recalcula)
# ============================================================

def _baixar_e_recalcular(semana):
    """FORÇA o download das pastas do SharePoint e recalcula. Usado pelo botão
    Reprocessar. Retorna dict com 'data' (resumo) e 'dias_atual'."""
    import calculo_rapido as cr

    # Força o refresh imediato (ignora o TTL) nesta instância
    garantir_arquivos_frescos(force=True)

    data = _calcular_summary(semana)

    # Dias disponíveis na semana atual (para informar o usuário)
    memoria = cr.carregar_tudo(dir_anterior(), dir_atual())
    dias_atual = []
    for arq, sem in memoria.items():
        for loja, dias in sem.get("atual", {}).items():
            dias_atual = list(dias.keys())
            break
        if dias_atual:
            break

    print(f"✅ Reprocessamento concluído: {data['total']} jogos.")
    return {"data": data, "dias_atual": dias_atual}


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
