# Campeonato Petz 2026 - Sistema de Autenticação

## 🔐 Autenticação Implementada

O sistema agora possui autenticação com login/senha. Cada usuário pode fazer login e acessar o dashboard.

### Credenciais Padrão

**Usuário Master (Administrador):**
- **Username:** `master`
- **Senha:** `master123`

⚠️ **IMPORTANTE:** Altere essa senha imediatamente após fazer login!

## 📋 Instalação

### 1. Instalar Dependências

```bash
cd /Users/luizprado/Downloads/campeonato-petz
pip install -r requirements.txt
```

### 2. Iniciar o Servidor

```bash
python backend.py
```

O servidor iniciará em `http://localhost:5000`

## 🚀 Primeiro Acesso

1. Acesse `http://localhost:5000/login.html`
2. Use as credenciais do master
3. Na primeira vez, altere sua senha em: `http://localhost:5000/admin.html` (clique em "Editar")

## 👥 Gerenciando Usuários

### Criar Novo Usuário

1. Faça login como master
2. Acesse `http://localhost:5000/admin.html`
3. Preencha os dados do novo usuário:
   - **Usuário:** username único (ex: `joao_silva`)
   - **Senha:** senha forte
   - **Email:** email do usuário
   - **Nome Completo:** nome completo
4. Clique em "Criar Usuário"

### Editar Usuário

1. Na tabela de usuários, clique em "Editar"
2. Atualize os dados conforme necessário
3. Para resetar a senha de um usuário, preencha o campo "Nova Senha"

### Deletar Usuário

1. Na tabela de usuários, clique em "Deletar"
2. Confirme a exclusão

## 🔒 Funcionalidades de Segurança

- ✅ Senhas com hash (Werkzeug security)
- ✅ Sessões seguras com Flask-Login
- ✅ Banco de dados SQLite para usuários
- ✅ Proteção de rotas (apenas usuários autenticados)
- ✅ Modo Admin para gerenciar usuários

## 📁 Arquivos Criados/Modificados

### Novos Arquivos:
- `auth.py` - Sistema de autenticação e banco de dados
- `login.html` - Página de login
- `admin.html` - Painel de administração
- `requirements.txt` - Dependências Python

### Arquivos Modificados:
- `backend.py` - Adicionadas rotas de autenticação
- `dashboard-v3.html` - Adicionados botões de logout/admin
- `dashboard-v3-styles.css` - Estilos para header
- `dashboard-v3.js` - Verificação de autenticação

## 🚀 Deploy para Produção

Para fazer deploy em uma plataforma, siga os passos:

### Opção 1: Render (Recomendado - Gratuito)

1. Crie uma conta em https://render.com
2. Conecte seu GitHub (ou faça upload dos arquivos)
3. Crie um novo "Web Service"
4. Configure:
   - **Runtime:** Python
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `python backend.py`
5. Configure variáveis de ambiente:
   ```
   FLASK_ENV=production
   SECRET_KEY=sua-chave-secreta-aleatoria
   ```

### Opção 2: Heroku

```bash
# Instale o Heroku CLI
# Faça login
heroku login

# Crie a aplicação
heroku create seu-app-name

# Deploy
git push heroku main
```

### Opção 3: Railway.app

1. Acesse https://railway.app
2. Conecte seu repositório GitHub
3. Railway detectará automaticamente o Flask app

## ⚙️ Configurações de Segurança para Produção

Antes de fazer deploy, edite `backend.py` e altere:

```python
# ❌ NÃO USE EM PRODUÇÃO:
app.config['SECRET_KEY'] = 'sua-chave-secreta-mude-isso-em-producao'
app.config['SESSION_COOKIE_SECURE'] = False

# ✅ USE EM PRODUÇÃO:
app.config['SECRET_KEY'] = 'gere-uma-chave-aleatoria-segura'  # Use secrets.token_hex(32)
app.config['SESSION_COOKIE_SECURE'] = True  # Requer HTTPS
```

## 📞 Suporte

Se tiver dúvidas sobre o sistema de autenticação, verifique:

1. Se o banco de dados `campeonato.db` foi criado
2. Se as dependências foram instaladas corretamente
3. Se o servidor está rodando na porta 5000

## 🔄 Próximos Passos

1. ✅ Sistema de autenticação configurado
2. ⏭️ Fazer deploy para produção
3. ⏭️ Criar usuários para os demais usuários
4. ⏭️ Compartilhar link de acesso
