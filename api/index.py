"""
Entrypoint para Vercel - Backend Campeonato Petz 2026
"""
import sys
import os
from pathlib import Path

# Adicionar o diretório pai ao path para importar backend.py
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend import app

# Exportar app para Vercel
# Vercel procura por 'app' ou 'handler'
