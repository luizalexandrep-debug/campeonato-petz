"""
Download anônimo de pastas compartilhadas do SharePoint/OneDrive.

Usa um link de compartilhamento do tipo "Qualquer pessoa com o link" (pasta) e
baixa todos os .xlsx de dentro dela, sem necessidade de login:

  1. Segue o link -> recebe um cookie anônimo (FedAuth tenantanon) e descobre o
     caminho server-relative da pasta (parâmetro ?id=).
  2. Lista os arquivos via REST API (_api/web/GetFolderByServerRelativeUrl).
  3. Baixa cada .xlsx via _api/web/GetFileByServerRelativeUrl('...')/$value.
"""
import re
import time
import uuid
import urllib.parse as urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import requests

# Links de pasta "Qualquer pessoa com o link" (view). Podem ser atualizados aqui.
# São links de PASTA (:f:), não de arquivo.
#
# O caminho pessoal mudou de 'luiz_prado_petz_com_br' para
# 'luiz_prado_petzcobasi_com_br' (mudança de domínio da conta). O host e o
# identificador da pasta continuaram os mesmos — só o segmento do usuário
# mudou. Se acontecer de novo, é esse trecho que precisa ser trocado nos cinco.
PASTAS_SHAREPOINT = {
    "SEMANA ANTERIOR": "https://petcentermarginal1-my.sharepoint.com/:f:/g/personal/luiz_prado_petzcobasi_com_br/IgAraUw_Xz5lQ7wctHpiwl0SAbkW2E_LbgyX5_9MkQb9z_o?e=h5XcMc",
    "SEMANA ATUAL": "https://petcentermarginal1-my.sharepoint.com/:f:/g/personal/luiz_prado_petzcobasi_com_br/IgA5CGHOHMqQSLe5xDfQJDKEAQ_EvUCnYvUUjzlsWuE49eU?e=5TpKZ1",
    "Confrontos": "https://petcentermarginal1-my.sharepoint.com/:f:/g/personal/luiz_prado_petzcobasi_com_br/IgAunV-h79oqTpWyR6vr0BgJAbl2b88L_W15BMnnEgE8Jl0?e=cAqSK4",
    # Ranking acumulado das rodadas já encerradas (export do Power BI).
    # Ver leitura em backend.historico_do_sharepoint().
    "Historico": "https://petcentermarginal1-my.sharepoint.com/:f:/g/personal/luiz_prado_petzcobasi_com_br/IgAJLDGS_b2DSJri9CAzz6dBAWb5DNwKssFacdi6Y9gwm00?e=bcUoZf",
    # Mesmo ranking, por REGIONAL. Acessível pela pasta raiz compartilhada,
    # por isso é baixado via SUBPASTAS_RAIZ (abaixo) e não por link próprio.
    # Pasta raiz — contém estrutura.xlsx (Regional | Distrito | Sigla Loja)
    "Estrutura": "https://petcentermarginal1-my.sharepoint.com/:f:/g/personal/luiz_prado_petzcobasi_com_br/IgBmj_M4lNJVT5A78h_MKThtAaUgbM2id9_uj_Zjjs-8I3g?e=KLPE4E",
}

# Subpastas acessíveis DENTRO do link da pasta raiz (não precisam de link
# próprio): {nome_local: nome_da_subpasta_no_sharepoint}
SUBPASTAS_RAIZ = {
    "HistoricoRegional": "Histórico ranking regionais",
    # Classificação por LOJA dentro de cada grupo (export do Power BI),
    # arquivos "Rodada N.xlsx". Ver backend.classificacao_lojas().
    "ClassificacaoLojas": "Classificação Lojas",
}

# Momento do último 429 do SharePoint. O backend consulta para entrar em
# espera antes de tentar de novo — insistir num throttle só o prolonga.
ULTIMO_THROTTLE = 0.0

# Pastas que falharam no último ciclo de download. O backend usa isso para não
# marcar os dados como "frescos" quando parte deles não chegou — sem isso, uma
# subpasta que falha deixa o arquivo velho valendo por todo o TTL.
ULTIMAS_FALHAS = []


class ThrottledError(RuntimeError):
    """O SharePoint respondeu 429 (excesso de requisições)."""


def _marcar_throttle():
    global ULTIMO_THROTTLE
    ULTIMO_THROTTLE = time.time()


HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    # Evita que o SharePoint/CDN devolva uma versão em cache (já causou leitura
    # de arquivo antigo, com os valores ainda zerados).
    "Cache-Control": "no-cache, no-store, max-age=0",
    "Pragma": "no-cache",
}


def _host_e_userpath(final_url):
    """Extrai o host e o segmento /personal/<user> da URL final."""
    p = urlparse.urlparse(final_url)
    host = f"{p.scheme}://{p.netloc}"
    m = re.search(r"(/personal/[^/]+)/", p.path + "/")
    userpath = m.group(1) if m else None
    return host, userpath


def baixar_pasta(folder_link, dest_dir, timeout=40, subpasta=None):
    """Baixa todos os .xlsx de uma pasta compartilhada para dest_dir.
    Se `subpasta` for informada, baixa dessa subpasta (o link anônimo da pasta
    raiz também dá acesso às subpastas dela).
    Retorna a lista de nomes de arquivos baixados."""
    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)

    sess = requests.Session()
    sess.headers.update(HEADERS)

    # 1) Seguir o link -> cookie anônimo + caminho da pasta
    r = sess.get(folder_link, allow_redirects=True, timeout=timeout)
    if r.status_code == 429:
        _marcar_throttle()
        raise ThrottledError("SharePoint respondeu 429 (excesso de requisições)")
    r.raise_for_status()
    final_url = r.url
    q = urlparse.parse_qs(urlparse.urlparse(final_url).query)
    folder_path = q.get("id", [None])[0]
    if not folder_path:
        raise RuntimeError(f"Não foi possível descobrir o caminho da pasta (URL: {final_url})")
    if subpasta:
        folder_path = folder_path.rstrip('/') + '/' + subpasta

    host, userpath = _host_e_userpath(final_url)
    if not userpath:
        raise RuntimeError(f"Não foi possível extrair /personal/<user> de {final_url}")

    # 2) Listar arquivos
    enc_folder = urlparse.quote(folder_path)
    list_url = (f"{host}{userpath}/_api/web/"
                f"GetFolderByServerRelativeUrl('{enc_folder}')/Files"
                f"?nocache={uuid.uuid4().hex}")
    lr = sess.get(list_url, headers={"Accept": "application/json;odata=nometadata"},
                  timeout=timeout)
    if lr.status_code == 429:
        _marcar_throttle()
        raise ThrottledError("SharePoint respondeu 429 ao listar a pasta")
    lr.raise_for_status()
    files = lr.json().get("value", [])

    alvos = [f for f in files
             if f.get("Name", "").lower().endswith(".xlsx")
             and not f.get("Name", "").startswith("~")]

    def _baixar_um(f):
        nome = f["Name"]
        enc_file = urlparse.quote(f["ServerRelativeUrl"])
        # cache-buster: garante a versão MAIS RECENTE (sem ele o SharePoint já
        # devolveu arquivo antigo com valores zerados)
        dl_url = (f"{host}{userpath}/_api/web/"
                  f"GetFileByServerRelativeUrl('{enc_file}')/$value"
                  f"?nocache={uuid.uuid4().hex}")
        dr = sess.get(dl_url, timeout=timeout)
        dr.raise_for_status()
        (dest / nome).write_bytes(dr.content)
        return nome

    # Downloads em paralelo: com 5 pastas (~30 arquivos) o sequencial estourava
    # o limite de tempo da função no Vercel.
    baixados = []
    if alvos:
        with ThreadPoolExecutor(max_workers=min(8, len(alvos))) as ex:
            for fut in as_completed([ex.submit(_baixar_um, f) for f in alvos]):
                try:
                    baixados.append(fut.result())
                except Exception as e:
                    print(f"⚠️ Falha ao baixar arquivo: {e}")

    # Remove cópias locais de arquivos que não existem mais na origem — sem
    # isso, um arquivo movido/renomeado no SharePoint continuaria sendo lido.
    esperados = {f["Name"] for f in alvos}
    for antigo in dest.glob("*.xlsx"):
        if antigo.name not in esperados:
            try:
                antigo.unlink()
                print(f"🗑️  removido obsoleto: {antigo.name}")
            except Exception:
                pass
    return baixados


def baixar_rodada(semana, base_dest, timeout=25):
    """Baixa as subpastas 'rodada N' de SEMANA ATUAL e SEMANA ANTERIOR.
    Cada rodada guarda seus próprios dados (atual) e a base de comparação
    (anterior), o que permite reabrir qualquer rodada passada.
    Retorna {pasta: [arquivos]} — lista vazia se a subpasta não existir."""
    sub = f"rodada {semana}"
    out = {}
    del ULTIMAS_FALHAS[:]

    def _uma(nome):
        link = PASTAS_SHAREPOINT.get(nome)
        if not link:
            return nome, []
        dest = Path(base_dest) / nome / sub
        try:
            return nome, baixar_pasta(link, dest, timeout=timeout, subpasta=sub)
        except Exception as e:
            print(f"⚠️ '{nome}/{sub}' indisponível: {e}")
            ULTIMAS_FALHAS.append(f"{nome}/{sub}")
            return nome, []

    alvos = ["SEMANA ATUAL", "SEMANA ANTERIOR"]
    with ThreadPoolExecutor(max_workers=2) as ex:
        for fut in as_completed([ex.submit(_uma, n) for n in alvos]):
            nome, arqs = fut.result()
            out[nome] = arqs
    return out


def baixar_todas_pastas(base_dest, timeout=40, semanas=None):
    """Baixa SEMANA ANTERIOR e SEMANA ATUAL para base_dest/<nome>.
    Retorna dict {pasta: [arquivos]}."""
    raiz = PASTAS_SHAREPOINT.get("Estrutura", "")
    # (nome_local, link, subpasta_no_sharepoint, destino_relativo)
    pastas = [(n, l, None, n) for n, l in PASTAS_SHAREPOINT.items() if l]
    # subpastas alcançadas pelo link da raiz (ex.: histórico das regionais)
    if raiz:
        pastas += [(n, raiz, sub, n) for n, sub in SUBPASTAS_RAIZ.items()]
    # subpastas por rodada (ex.: SEMANA ATUAL/rodada 8)
    for s in (semanas or []):
        for p in ("SEMANA ATUAL", "SEMANA ANTERIOR"):
            if PASTAS_SHAREPOINT.get(p):
                pastas.append((f"{p}/rodada {s}", PASTAS_SHAREPOINT[p],
                               f"rodada {s}", f"{p}/rodada {s}"))
    resultado = {}
    del ULTIMAS_FALHAS[:]

    def _uma(item):
        nome_pasta, link, sub, destino = item
        try:
            return nome_pasta, baixar_pasta(link, Path(base_dest) / destino,
                                            timeout=timeout, subpasta=sub)
        except Exception as e:
            # Uma pasta com problema não pode derrubar as demais
            print(f"⚠️ Falha ao baixar '{nome_pasta}': {e}")
            ULTIMAS_FALHAS.append(nome_pasta)
            return nome_pasta, []

    # Pastas em paralelo (todas as 5 juntas cabem no limite de tempo do Vercel)
    with ThreadPoolExecutor(max_workers=len(pastas) or 1) as ex:
        for fut in as_completed([ex.submit(_uma, p) for p in pastas]):
            nome, arqs = fut.result()
            resultado[nome] = arqs
    return resultado


if __name__ == "__main__":
    import sys, time
    dest = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sp_test"
    t0 = time.time()
    res = baixar_todas_pastas(dest)
    for pasta, arqs in res.items():
        print(f"{pasta}: {len(arqs)} arquivos -> {arqs}")
    print(f"Tempo: {time.time()-t0:.1f}s")
