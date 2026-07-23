#!/bin/bash

echo "🚀 Iniciando Campeonato Petz 2026..."
echo ""
echo "Verificando dependências..."

# Verificar se pip está instalado
if ! command -v pip &> /dev/null; then
    echo "❌ pip não está instalado. Instale Python primeiro."
    exit 1
fi

# Instalar dependências se necessário
if ! python3 -c "import flask" 2>/dev/null; then
    echo "📦 Instalando dependências..."
    pip install -r requirements.txt
else
    echo "✅ Dependências já instaladas"
fi

echo ""
echo "🔐 Sistema de Autenticação Ativo"
echo "📋 Credenciais padrão:"
echo "   Usuário: master"
echo "   Senha:   master123"
echo ""
echo "🌐 Acessar em: http://localhost:5000/login.html"
echo "⚙️  Admin em:    http://localhost:5000/admin.html"
echo ""
echo "Iniciando servidor Flask..."
echo "────────────────────────────────────────"
echo ""

python3 backend.py
