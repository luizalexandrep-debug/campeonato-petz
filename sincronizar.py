#!/usr/bin/env python3
"""Sobe as bases do OneDrive local para o app, sem passar pelo SharePoint.

Serve enquanto os links anônimos de pasta estiverem fora do ar: em vez de o
servidor baixar do SharePoint, a gente empacota os arquivos no próprio deploy.

    python3 sincronizar.py             # mostra o que mudaria
    python3 sincronizar.py --aplicar   # copia para data/
    python3 sincronizar.py --publicar  # copia, commita e faz push

O caminho da pasta do campeonato é descoberto sozinho; dá para forçar com
--origem "/caminho/para/Campeonato Petz".
"""
import argparse
import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
DESTINO = AQUI / "data"

# De onde vem cada pasta do SharePoint para dentro de data/. A chave é o nome
# no OneDrive; o valor é o nome que o backend espera (ver pasta_dados()).
PASTAS = {
    "Confrontos": "Confrontos",
    "Classificação Lojas": "ClassificacaoLojas",
    "Histórico ranking distritais": "Historico",
    "Histórico ranking regionais": "HistoricoRegional",
}
SEMANAS = ("SEMANA ATUAL", "SEMANA ANTERIOR")
# Quantas rodadas manter empacotadas (as mais recentes).
RODADAS_MANTIDAS = 3


def achar_origem():
    base = Path.home() / "Library/CloudStorage"
    for p in base.glob("OneDrive-*/Claude/Campeonato Petz"):
        if p.is_dir():
            return p
    return None


def assinatura(f: Path):
    return hashlib.md5(f.read_bytes()).hexdigest()


def copiar(src: Path, dst: Path, mudancas: list, aplicar: bool):
    """Copia um .xlsx e registra se era novo ou diferente."""
    if src.name.startswith("~") or src.suffix.lower() != ".xlsx":
        return
    rotulo = str(dst.relative_to(DESTINO))
    if not dst.exists():
        mudancas.append(("novo", rotulo, src.stat().st_size))
    elif assinatura(src) != assinatura(dst):
        mudancas.append(("mudou", rotulo, src.stat().st_size))
    else:
        return
    if aplicar:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def rodadas_recentes(pasta: Path):
    """As RODADAS_MANTIDAS rodadas mais recentes QUE TÊM ARQUIVOS.

    As pastas 'rodada 10' a 'rodada 19' já existem no OneDrive, vazias,
    esperando as próximas semanas. Ordenar só pelo número pegaria essas e
    deixaria de fora a rodada que está valendo.
    """
    achadas = []
    for p in pasta.glob("rodada *"):
        try:
            n = int(p.name.split()[-1])
        except ValueError:
            continue
        if any(f.name.lower().endswith(".xlsx") and not f.name.startswith("~")
               for f in p.iterdir()):
            achadas.append((n, p))
    return [p for _n, p in sorted(achadas, reverse=True)[:RODADAS_MANTIDAS]]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--aplicar", action="store_true", help="copia os arquivos para data/")
    ap.add_argument("--publicar", action="store_true", help="copia, commita e faz push")
    ap.add_argument("--origem", help="pasta do campeonato no OneDrive")
    args = ap.parse_args()
    aplicar = args.aplicar or args.publicar

    origem = Path(args.origem) if args.origem else achar_origem()
    if not origem or not origem.is_dir():
        print("❌ Não achei a pasta do campeonato no OneDrive. Use --origem.")
        return 1
    print(f"📁 Origem : {origem}")
    print(f"📦 Destino: {DESTINO}")
    print()

    mudancas = []
    for nome_od, nome_data in PASTAS.items():
        pasta = origem / nome_od
        if not pasta.is_dir():
            print(f"   ⚠️  '{nome_od}' não existe na origem — pulando.")
            continue
        for f in sorted(pasta.glob("*.xlsx")):
            copiar(f, DESTINO / nome_data / f.name, mudancas, aplicar)

    for est in sorted(origem.glob("estrutura*.xlsx")):
        copiar(est, DESTINO / "Estrutura" / "estrutura.xlsx", mudancas, aplicar)

    for semana in SEMANAS:
        pasta = origem / semana
        if not pasta.is_dir():
            continue
        for rod in rodadas_recentes(pasta):
            for f in sorted(rod.glob("*.xlsx")):
                copiar(f, DESTINO / semana / rod.name / f.name, mudancas, aplicar)

    if not mudancas:
        print("✅ Nada mudou — o app já está com estes arquivos.")
        return 0

    novos = sum(1 for m in mudancas if m[0] == "novo")
    print(f"{len(mudancas)} arquivo(s): {novos} novo(s), {len(mudancas) - novos} alterado(s)")
    for tipo, rotulo, tam in mudancas:
        print(f"   {'+' if tipo == 'novo' else '~'} {rotulo}  ({tam / 1024:.0f} KB)")

    if not aplicar:
        print("\nNada foi copiado. Rode com --aplicar (ou --publicar) para valer.")
        return 0

    print("\n✅ Copiado para data/.")
    if not args.publicar:
        print("   Falta commitar e fazer push para o app enxergar.")
        return 0

    subprocess.run(["git", "add", "data"], cwd=AQUI, check=True)
    msg = f"Atualiza as bases empacotadas ({len(mudancas)} arquivo(s))"
    subprocess.run(["git", "commit", "-qm", msg], cwd=AQUI, check=True)
    subprocess.run(["git", "push", "-q"], cwd=AQUI, check=True)
    print("🚀 Publicado. O deploy leva ~1 minuto.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
