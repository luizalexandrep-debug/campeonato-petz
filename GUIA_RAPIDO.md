# ⚡ Guia Rápido - Deploy Vercel em 5 Minutos

## 🎯 Objetivo
Colocar o Campeonato Petz 2026 online com login e senha

## 📦 Arquivos Preparados

Tudo que você precisa está pronto:
```
✅ backend.py (servidor Flask)
✅ auth.py (sistema de autenticação)
✅ dashboard-v3.html (interface)
✅ login.html (página de login)
✅ admin.html (painel de admin)
✅ vercel.json (configuração Vercel)
✅ requirements.txt (dependências Python)
✅ .gitignore (arquivos a ignorar)
```

## 🚀 Passo 1: Criar Conta GitHub (1 min)

Se não tiver:
1. Acesse https://github.com/signup
2. Preencha email, username, senha
3. Confirme seu email

## 🔗 Passo 2: Criar Repositório GitHub (1 min)

1. Acesse https://github.com/new
2. Digite o nome: `campeonato-petz`
3. Deixe como **Public**
4. Clique em "Create repository"
5. **Copie a URL** que aparecerá (exemplo: `https://github.com/seu-usuario/campeonato-petz.git`)

## 📤 Passo 3: Fazer Push do Código (2 min)

Abra o Terminal e execute:

```bash
# Navegar para a pasta do projeto
cd /Users/luizprado/Downloads/campeonato-petz

# Inicializar Git
git init

# Adicionar todos os arquivos
git add .

# Fazer commit
git commit -m "Campeonato Petz 2026 - Deploy Vercel"

# Adicionar repositório remoto (SUBSTITUA A URL)
git remote add origin https://github.com/SEU-USUARIO/campeonato-petz.git

# Fazer push
git branch -M main
git push -u origin main
```

**Se pedir senha:**
- Gere um **Personal Access Token** em GitHub:
  - Settings → Developer settings → Personal access tokens → Generate new token
  - Selecione apenas `repo`
  - Use o token como senha

## ☁️ Passo 4: Fazer Deploy no Vercel (1 min)

1. Acesse https://vercel.com/signup
2. Clique em "Continue with GitHub"
3. Autorize Vercel
4. Clique em "Import Project"
5. Selecione `campeonato-petz`
6. Clique em "Deploy"
7. **Aguarde 2-3 minutos** ⏳

## ✅ Passo 5: Verificar Deploy

Quando terminar, você receberá uma URL como:
```
https://seu-app.vercel.app
```

Acesse: `https://seu-app.vercel.app/login.html`

**Login de teste:**
- Username: `master`
- Senha: `master123`

## 🔐 Passo 6: Alterar Senha e Criar Usuários

1. Faça login como `master`
2. Clique em "⚙️ Admin"
3. Altere a senha do master
4. Crie novos usuários para compartilhar acesso

## 🎉 Pronto!

Seu app está online! Compartilhe:
```
https://seu-app.vercel.app
```

Cada pessoa faz login com seu próprio usuário.

## 🆘 Problemas?

**Deploy não funciona:**
- Verifique se fez push para GitHub
- Verifique os logs no Vercel: Deployments → Logs

**Login não funciona:**
- Limpe cache: Ctrl+Shift+Delete
- Tente em janela incógnita

**Esqueceu a senha do master:**
- Acesse Vercel → Storage → usar console para deletar o banco
- Será recriado na próxima requisição

## 💡 Próximas Mudanças

Para atualizar o código depois:

```bash
cd /Users/luizprado/Downloads/campeonato-petz

# Faça as mudanças nos arquivos...

git add .
git commit -m "Descrição da mudança"
git push
```

**Vercel faz deploy automático!** ✨
