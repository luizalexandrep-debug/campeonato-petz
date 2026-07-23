# ⚽ Campeonato Petz 2026 - Dashboard de Vendas

Sistema completo de acompanhamento de campeonato de vendas com **autenticação, login/senha e painel administrativo**.

## 🎯 Funcionalidades

- **Entrada de Dados**: Insira os dados de vendas da semana anterior e atual
- **Cálculo Automático**: Calcula gols, pontos e resultado de cada jogo
- **Histórico de Resultados**: Visualize todos os resultados registrados
- **Classificação**: Acompanhe a posição de cada time por grupo
- **Persistência**: Dados são salvos localmente no navegador

## 🚀 Como Usar

### 1. Abrir a Aplicação
Abra o arquivo `index.html` no seu navegador.

### 2. Entrada de Dados

#### Opção A: Carregar do SharePoint
1. Selecione a **Rodada** (1-19)
2. Selecione o **Grupo** (1-14)
3. Clique em "Carregar Dados do SharePoint"
4. Os indicadores serão preenchidos automaticamente

#### Opção B: Inserir Manualmente
1. Selecione a **Rodada** e **Grupo**
2. Clique em "Ou Inserir Manualmente"
3. Preencha os 6 indicadores:
   - Vendas
   - Antipulgas
   - Suplementos
   - Úmidos Cães e Gatos
   - Fornecedor Petix
   - Share Marca Própria

4. Para cada indicador, preencha:
   - Semana Anterior - Time A
   - Semana Atual - Time A
   - Semana Anterior - Time B
   - Semana Atual - Time B

5. Clique em "Calcular Resultado"
6. Confirme e clique em "Salvar Resultado"

### 3. Visualizar Resultados
Acesse a aba **Resultados** para ver:
- Todos os jogos registrados
- Filtrar por rodada e grupo
- Placar final de cada jogo

### 4. Acompanhar Classificação
Acesse a aba **Classificação** para ver:
- Ranking de cada grupo
- Pontos, vitórias, empates, derrotas
- Saldo de gols

## 📊 Como Funciona o Cálculo

### Gols (Indicadores)
Cada rodada tem 6 indicadores que funcionam como "gols":
- O time com **maior evolução** em cada indicador marca 1 gol
- Evolução = Semana Atual - Semana Anterior

### Pontuação
- **Vitória** (mais gols): 3 pontos
- **Empate** (mesmo número de gols): 1 ponto
- **Derrota** (menos gols): 0 pontos

### Exemplo
```
Time A:
- Vendas: 100 → 150 (evolução: +50)
- Antipulgas: 200 → 220 (evolução: +20)
- Suplementos: 50 → 60 (evolução: +10)
- Úmidos Cães e Gatos: 300 → 400 (evolução: +100)
- Fornecedor Petix: 80 → 85 (evolução: +5)
- Share Marca Própria: 30% → 35% (evolução: +5%)
Total de gols: 6

Time B:
- Vendas: 100 → 140 (evolução: +40)
- Antipulgas: 200 → 240 (evolução: +40)
- Suplementos: 50 → 65 (evolução: +15)
- Úmidos Cães e Gatos: 300 → 350 (evolução: +50)
- Fornecedor Petix: 80 → 90 (evolução: +10)
- Share Marca Própria: 30% → 32% (evolução: +2%)
Total de gols: 0

Resultado: Time A vence 6 x 0
Pontos: Time A ganha 3, Time B ganha 0
```

## 💾 Dados Persistidos

Os dados são salvos no **localStorage** do navegador:
- Funciona offline
- Dados persistem entre sessões
- Limpar cache do navegador apaga os dados

## 🔗 Integração com SharePoint

O app está preparado para integração com o SharePoint:
```javascript
const SHAREPOINT_URL = 'https://petcentermarginal1-my.sharepoint.com/...'
```

Dados esperados:
- Arquivo: `Semana_Anterior.xlsx` e `Semana_Atual.xlsx`
- Colunas: Código Loja, Vendas, Antipulgas, Suplementos, Úmidos, Fornecedor Petix, Share MP
- Uma linha por loja

## 🛠️ Funcionalidades Futuras

- [ ] Exportar resultados para Excel
- [ ] Gráficos de evolução
- [ ] Rankings de melhor desempenho por indicador
- [ ] Sincronização em tempo real com SharePoint
- [ ] Suporte a múltiplos usuários com autenticação
- [ ] Notificações de atualizações
- [ ] Modo escuro

## 📋 Requisitos

- Navegador moderno (Chrome, Firefox, Safari, Edge)
- Conexão com internet (para carregar dados do SharePoint)
- JavaScript habilitado

## 📝 Notas Importantes

- Os dados são calculados em tempo real conforme inseridos
- A evolução é sempre: `Valor Atual - Valor Anterior`
- Indicadores com percentual precisam estar em formato decimal (ex: 0.35 para 35%)
- Confirme os valores antes de salvar
- Você pode editar dados deletando e reinserindo

## 🆘 Suporte

Para questões sobre as regras do campeonato, consulte:
`Petz_Regras do Campeonato_2026.pdf`

---

**Desenvolvido para o Campeonato Petz 2026** ⚽🐕
