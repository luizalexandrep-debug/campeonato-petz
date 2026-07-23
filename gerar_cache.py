"""
Gera o cache de resumo dos jogos (games-summary-wN.json) localmente,
usando o MESMO cálculo do backend (calculo_rapido).

Uso: python gerar_cache.py 4
"""
import sys
import json
from pathlib import Path
from datetime import datetime
import calculo_rapido as cr

# Fonte dos dados (mesma pasta usada localmente pelo backend)
dev_path = Path("/Users/luizprado/Downloads/Claude/Campeonato Petz")
BASE_PATH = dev_path if dev_path.exists() else Path(__file__).parent / "data"


def gerar(semana):
    confrontos_path = BASE_PATH / "Confrontos" / f"Semana {semana}.xlsx"
    if not confrontos_path.exists():
        print(f"❌ Confrontos não encontrados: {confrontos_path}")
        sys.exit(1)

    confrontos = cr.ler_confrontos(confrontos_path)
    print(f"⏳ Calculando {len(confrontos)} jogos da semana {semana}...")

    memoria = cr.carregar_tudo(BASE_PATH / "SEMANA ANTERIOR", BASE_PATH / "SEMANA ATUAL")
    hoje_idx = (datetime.now().weekday() + 1) % 7
    jogos = cr.calcular_todos_jogos(confrontos, memoria, hoje_idx)

    data = {
        "week": semana,
        "lastUpdated": datetime.now().isoformat(),
        "total": len(jogos),
        "games": jogos,
    }
    cache_dir = Path(__file__).parent / "data" / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    out = cache_dir / f"games-summary-w{semana}.json"
    with open(out, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"✅ {len(jogos)} jogos salvos em {out}")


if __name__ == "__main__":
    semana = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    gerar(semana)
