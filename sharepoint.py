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
import urllib.parse as urlparse
from pathlib import Path
import requests

# Links de pasta "Qualquer pessoa com o link" (view). Podem ser atualizados aqui.
# São links de PASTA (:f:), não de arquivo.
PASTAS_SHAREPOINT = {
    "SEMANA ANTERIOR": "https://petcentermarginal1-my.sharepoint.com/:f:/g/personal/luiz_prado_petz_com_br/IgAraUw_Xz5lQ7wctHpiwl0SAbkW2E_LbgyX5_9MkQb9z_o?e=h5XcMc",
    "SEMANA ATUAL": "https://petcentermarginal1-my.sharepoint.com/:f:/g/personal/luiz_prado_petz_com_br/IgA5CGHOHMqQSLe5xDfQJDKEAQ_EvUCnYvUUjzlsWuE49eU?e=5TpKZ1",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
}


def _host_e_userpath(final_url):
    """Extrai o host e o segmento /personal/<user> da URL final."""
    p = urlparse.urlparse(final_url)
    host = f"{p.scheme}://{p.netloc}"
    m = re.search(r"(/personal/[^/]+)/", p.path + "/")
    userpath = m.group(1) if m else None
    return host, userpath


def baixar_pasta(folder_link, dest_dir, timeout=40):
    """Baixa todos os .xlsx de uma pasta compartilhada para dest_dir.
    Retorna a lista de nomes de arquivos baixados. Lança exceção em falha grave."""
    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)

    sess = requests.Session()
    sess.headers.update(HEADERS)

    # 1) Seguir o link -> cookie anônimo + caminho da pasta
    r = sess.get(folder_link, allow_redirects=True, timeout=timeout)
    r.raise_for_status()
    final_url = r.url
    q = urlparse.parse_qs(urlparse.urlparse(final_url).query)
    folder_path = q.get("id", [None])[0]
    if not folder_path:
        raise RuntimeError(f"Não foi possível descobrir o caminho da pasta (URL: {final_url})")

    host, userpath = _host_e_userpath(final_url)
    if not userpath:
        raise RuntimeError(f"Não foi possível extrair /personal/<user> de {final_url}")

    # 2) Listar arquivos
    enc_folder = urlparse.quote(folder_path)
    list_url = (f"{host}{userpath}/_api/web/"
                f"GetFolderByServerRelativeUrl('{enc_folder}')/Files")
    lr = sess.get(list_url, headers={"Accept": "application/json;odata=nometadata"},
                  timeout=timeout)
    lr.raise_for_status()
    files = lr.json().get("value", [])

    baixados = []
    for f in files:
        nome = f.get("Name", "")
        if not nome.lower().endswith(".xlsx") or nome.startswith("~"):
            continue
        srv = f.get("ServerRelativeUrl")
        enc_file = urlparse.quote(srv)
        dl_url = (f"{host}{userpath}/_api/web/"
                  f"GetFileByServerRelativeUrl('{enc_file}')/$value")
        dr = sess.get(dl_url, timeout=timeout)
        dr.raise_for_status()
        (dest / nome).write_bytes(dr.content)
        baixados.append(nome)

    return baixados


def baixar_todas_pastas(base_dest, timeout=40):
    """Baixa SEMANA ANTERIOR e SEMANA ATUAL para base_dest/<nome>.
    Retorna dict {pasta: [arquivos]}."""
    resultado = {}
    for nome_pasta, link in PASTAS_SHAREPOINT.items():
        alvo = Path(base_dest) / nome_pasta
        resultado[nome_pasta] = baixar_pasta(link, alvo, timeout=timeout)
    return resultado


if __name__ == "__main__":
    import sys, time
    dest = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sp_test"
    t0 = time.time()
    res = baixar_todas_pastas(dest)
    for pasta, arqs in res.items():
        print(f"{pasta}: {len(arqs)} arquivos -> {arqs}")
    print(f"Tempo: {time.time()-t0:.1f}s")
