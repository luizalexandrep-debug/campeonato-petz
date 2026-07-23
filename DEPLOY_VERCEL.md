# 🚀 Deploy Vercel - Campeonato Petz 2026

## Pré-requisitos

✅ Conta GitHub (gratuita)
✅ Conta Vercel (gratuita)

## 📋 Passo a Passo

### 1️⃣ Criar Conta GitHub (se não tiver)

1. Acesse https://github.com/signup
2. Preencha os dados:
   - **Username:** seu_usuario_git
   - **Email:** seu_email@gmail.com
   - **Password:** senha forte
3. Clique em "Create account"
4. Confirme seu email

### 2️⃣ Criar Repositório no GitHub

1. Acesse https://github.com/new
2. Preencha:
   - **Repository name:** `campeonato-petz`
   - **Description:** Campeonato Petz 2026 - Dashboard de Vendas
   - **Visibility:** Public (para Vercel acessar)
3. Clique em "Create repository"
4. **NÃO inicialize com README** (vamos fazer localmente)

### 3️⃣ Fazer Push do Código para GitHub

Abra o terminal e execute:

```bash
cd /Users/luizprado/Downloads/campeonato-petz

# Inicializar repositório Git
git init

# Adicionar todos os arquivos
git add .

# Fazer commit
git commit -m "Initial commit: Campeonato Petz 2026 com autenticação"

# Adicionar remote (SUBSTITUA seuusuario pelo seu usuário GitHub)
git remote add origin https://github.com/seuusuario/campeonato-petz.git

# Fazer push
git branch -M main
git push -u origin main
```

Se pedir senha, use um **Personal Access Token**:
1. GitHub → Settings → Developer settings → Personal access tokens
2. Clique em "Generate new token"
3. Selecione `repo` (full control of private repositories)
4. Copie o token e use como senha

### 4️⃣ Conectar Vercel ao GitHub

1. Acesse https://vercel.com/signup
2. Clique em "Continue with GitHub"
3. Autorize Vercel a acessar seu GitHub
4. Clique em "Import Project"
5. Selecione `campeonato-petz`
6. Configure:
   - **Framework Preset:** Other
   - **Build Command:** `pip install -r requirements.txt`
   - **Output Directory:** (deixe vazio)
   - **Environment Variables:** (veja abaixo)

### 5️⃣ Configurar Variáveis de Ambiente no Vercel

No painel do Vercel, vá para **Settings → Environment Variables** e adicione:

```
FLASK_ENV = production
SECRET_KEY = (gere uma chave aleatória)
PYTHONUNBUFFERED = 1
```

Para gerar uma chave segura, execute:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

### 6️⃣ Fazer Deploy

1. Clique em "Deploy" no Vercel
2. Aguarde ~2-3 minutos
3. Você receberá um link como: `https://seu-app.vercel.app`

## ✅ Verificar Deploy

1. Acesse `https://seu-app.vercel.app/login.html`
2. Faça login com:
   - **Username:** `master`
   - **Senha:** `master123`

## 🔐 Próximas Etapas

### 1. Alterar Senha do Master

1. Faça login como `master`
2. Acesse `https://seu-app.vercel.app/admin.html`
3. Clique em "Editar" no usuário master
4. Altere a senha
5. Clique em "Salvar"

### 2. Criar Usuários para Outras Pessoas

1. No painel Admin, preencha:
   - **Usuário:** (nome único)
   - **Senha:** (senha temporária)
   - **Email:** (email da pessoa)
   - **Nome Completo:** (nome completo)
2. Clique em "Criar Usuário"
3. Compartilhe o username e senha com a pessoa
4. Ela pode alterar a senha no primeiro acesso

## 🚨 Troubleshooting

### "Deploy falhou"
- Verifique se há arquivo `requirements.txt`
- Verifique se o `backend.py` está correto
- Veja os logs no Vercel: `Deployments → Logs`

### "Banco de dados não inicializa"
- Vercel cria um diretório temporário a cada deploy
- O banco de dados é recriado automaticamente com o usuário master
- Na primeira vez, pode levar alguns segundos

### "Autenticação não funciona"
- Limpe o cache do navegador (Ctrl+Shift+Delete)
- Verifique se as cookies estão habilitadas
- Tente em outro navegador

## 📞 Link Final

Seu app estará disponível em:
```
https://seu-app.vercel.app
```

Compartilhe esse link com acesso ao painel Admin!

## 🔄 Fazer Alterações Depois

Se precisar fazer mudanças no código:

```bash
cd /Users/luizprado/Downloads/campeonato-petz

# Fazer alterações nos arquivos...

# Fazer commit
git add .
git commit -m "Descrição da mudança"

# Fazer push (Vercel faz deploy automático)
git push
```

Vercel detectará o push e fará deploy automático! ✨
