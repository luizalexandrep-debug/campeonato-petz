# ✅ CHECKLIST - Deploy Vercel

Use este checklist para acompanhar seu progresso!

## 📋 Pré-requisitos

- [ ] Tenho conexão com internet
- [ ] Tenho navegador atualizado (Chrome, Firefox, Safari, Edge)
- [ ] Tenho Terminal/PowerShell aberto
- [ ] Tenho Git instalado (`git --version` deve mostrar versão)

## 🔧 Passo 1: Preparar Git Localmente

- [ ] Abri Terminal na pasta `/Users/luizprado/Downloads/campeonato-petz`
- [ ] Executei `git init`
- [ ] Executei `git add .`
- [ ] Executei `git commit -m "Campeonato Petz 2026 - Deploy Vercel"`

## 📱 Passo 2: Criar Conta GitHub

- [ ] Acessei https://github.com/signup
- [ ] Criei minha conta com email/senha
- [ ] Confirmei meu email
- [ ] Fiz login no GitHub

## 📦 Passo 3: Criar Repositório GitHub

- [ ] Acessei https://github.com/new
- [ ] Nomeei como `campeonato-petz`
- [ ] Deixei como **Public**
- [ ] Cliquei em "Create repository"
- [ ] **Copiei a URL** que apareceu

## 🔗 Passo 4: Conectar Repositório Local ao GitHub

- [ ] Executei `git remote add origin https://github.com/MEU-USUARIO/campeonato-petz.git`
  - (Substitui MEU-USUARIO pelo meu usuário GitHub)
- [ ] Executei `git branch -M main`
- [ ] Executei `git push -u origin main`
- [ ] Se pediu senha:
  - [ ] Gerei Personal Access Token no GitHub
  - [ ] Usei o token como senha
- [ ] Verifiquei que os arquivos aparecem em GitHub

## ☁️ Passo 5: Fazer Deploy no Vercel

- [ ] Acessei https://vercel.com/signup
- [ ] Cliquei em "Continue with GitHub"
- [ ] Autorizei Vercel a acessar meu GitHub
- [ ] Cliquei em "Import Project"
- [ ] Selecionei `campeonato-petz`
- [ ] Deixei as configurações padrão:
  - [ ] Framework: Other
  - [ ] Build Command: pip install -r requirements.txt
- [ ] Cliquei em "Deploy"
- [ ] Aguardei 2-3 minutos ⏳

## 📝 Passo 6: Configurar Variáveis de Ambiente (Opcional)

Se quiser customizar:
- [ ] Acessei Settings → Environment Variables no Vercel
- [ ] Adicionei:
  - [ ] FLASK_ENV = production
  - [ ] PYTHONUNBUFFERED = 1

## ✅ Passo 7: Testar o Deploy

- [ ] Recebi o link do Vercel (ex: https://seu-app.vercel.app)
- [ ] Acessei `https://seu-app.vercel.app/login.html`
- [ ] Fiz login com:
  - [ ] Username: `master`
  - [ ] Senha: `master123`
- [ ] Entrei no dashboard com sucesso

## 🔐 Passo 8: Alterar Senha do Master

- [ ] Cliquei em "⚙️ Admin" no dashboard
- [ ] Cliquei em "Editar" no usuário master
- [ ] Preenchi uma nova senha forte
- [ ] Cliquei em "Salvar"
- [ ] Testei fazer login com a nova senha

## 👥 Passo 9: Criar Usuários para Outras Pessoas

Para cada pessoa que vai usar:
- [ ] Voltei ao Admin
- [ ] Preenchi "Criar Novo Usuário":
  - [ ] Usuário: (nome único)
  - [ ] Email: (opcional)
  - [ ] Nome Completo: (nome da pessoa)
  - [ ] Senha: (senha temporária)
- [ ] Cliquei em "Criar Usuário"
- [ ] Compartilhei o username e senha com a pessoa

## 📤 Passo 10: Compartilhar Acesso

- [ ] Copiei o link do Vercel
- [ ] Compartilhei com as pessoas que vão usar:
  ```
  Link: https://seu-app.vercel.app
  Username: (do usuário que criei)
  Senha: (a senha que defini)
  ```

## 🔄 Passo 11: Fazer Alterações Depois (Quando Necessário)

Para cada mudança no código:
- [ ] Editei os arquivos
- [ ] Executei `git add .`
- [ ] Executei `git commit -m "Descrição da mudança"`
- [ ] Executei `git push`
- [ ] Vercel fez deploy automático (2-3 minutos)

## 🎉 PARABÉNS!

Você completou todo o setup! ✨

Seu app está online em:
```
https://seu-app.vercel.app
```

## 📞 Próximas Ações

- [ ] Compartilhei o link com a equipe
- [ ] Criei usuários para todos
- [ ] Testei o login de cada pessoa
- [ ] Documentei as instruções de uso

## 🆘 Se Algo Deu Errado

1. **Deploy falhou no Vercel**
   - Veja os logs em Vercel → Deployments → Logs
   - Verifique se `requirements.txt` está correto
   - Tente fazer push novamente

2. **Login não funciona**
   - Limpe cache: Ctrl+Shift+Delete
   - Tente em janela incógnita
   - Verifique se o banco de dados foi criado

3. **Não consigo fazer push para GitHub**
   - Verifique sua conexão
   - Use Personal Access Token em vez de senha
   - Tente clonar o repositório novamente

## ✨ Conclusão

Tudo pronto! Seu Campeonato Petz 2026 está online com:
- ✅ Login seguro
- ✅ Gerenciamento de usuários
- ✅ Dashboard interativo
- ✅ Atualizações automáticas

**Data de conclusão:** _______________

Divirta-se! 🚀⚽
