# Divergências entre o placar calculado pelo app e o resultado oficial — rodada 8

**Registrado em 2026-08-24, pendente de análise.**

## Como apareceu

Ao capturar a classificação por lojas da rodada 8 do Power BI ("Campeonato Petz
classificacao todos os jogos", filtro RODADA_DESC = Rodada 8) para gerar
`Classificação Lojas/Rodada 8.xlsx`, comparei o *delta* de cada loja entre a
rodada 7 e a rodada 8 oficiais com o placar que o app calcula para a rodada 8
completa.

Fonte usada na comparação: dados completos dos 7 dias em
`OneDrive/Claude/Campeonato Petz/SEMANA {ANTERIOR,ATUAL}/rodada 8`
(a cópia empacotada em `data/` é um retrato de 21/08, com só 4 dias — não serve
para essa conferência).

## Resultado

| | jogos |
|---|---|
| idênticos | 116 |
| mesmo vencedor, placar difere em 1 gol | 12 |
| **resultado diferente** | **5** |
| total | 133 |

### Os 5 jogos em que o resultado muda

| Jogo | App | Oficial |
|---|---|---|
| IPIR-SP × ITTB-SP | 2x4 | 4x2 |
| BFRX-RJ × NIGC-RJ | 3x3 | 2x4 |
| LAUZ-SP × JUND-SP | 3x3 | 4x2 |
| CXAS-RS × STDU-CE | 3x3 | 2x4 |
| TTUI-SP × SZNO-SP | 4x2 | 3x3 |

### Os 12 em que só o placar difere

| Jogo | App | Oficial |
|---|---|---|
| JGRE-SP × SLPD-RS | 2x4 | 1x5 |
| MRMS-SC × PIRA-SP | 2x4 | 1x5 |
| LHVD-PR × LTPL-SP | 1x5 | 2x4 |
| NSPL-MS × GVLD-MG | 1x5 | 0x6 |
| MRBI-SP × MOGI-SP | 0x6 | 1x5 |
| SHGR-RJ × SCAR-SP | 2x4 | 1x5 |
| GRVT-RS × SADP-SP | 4x2 | 5x1 |
| RAJA-MG × ASTS-SP | 1x5 | 0x6 |
| CGHS-SP × W3NT-DF | 5x1 | 6x0 |
| STCE-SP × ABVT-SP | 5x1 | 4x2 |
| TTVL-SP × CPCO-SC | 0x6 | 1x5 |
| DRDS-MS × ZVJD-SP | 4x2 | 5x1 |

## Por que NÃO é erro da captura

A planilha capturada passa em todos estes testes:

- 266 lojas, 14 grupos, rank sequencial de 1..N em cada grupo;
- `VIT+EMP+DER = Jogos`, `3×VIT+EMP = Pts`, `GM−GS = SG` nas 266 linhas;
- contra o `Rodada 7.xlsx` oficial: mesmas 266 siglas, ninguém trocou de grupo,
  cada loja com **exatamente +1 jogo**, incremento de V/E/D coerente, pontos
  batendo com o resultado e 6 gols distribuídos por jogo.

Um erro de leitura da tela quebraria alguma dessas invariantes.

## Hipóteses já descartadas

**"Zerou na semana atual = 0%" (testada e descartada em 2026-08-24).**
A regra devolvia 0% para a loja sem venda na semana atual, o que no meio da
semana fazia quem não tinha dado passar na frente de quem vendeu. Isso é um
bug real e foi corrigido (agora vale −100%) — mas **não explica as
divergências desta rodada**: com a rodada 8 completa, nenhum dos 133 jogos
muda de placar, e a comparação com o oficial fica idêntica (116 / 12 / 5)
antes e depois da correção. O efeito só aparece em rodada parcial.

## O que a margem por gol revelou (2026-08-31)

Cruzando os 5 jogos com `/api/margens`, o gol de **SHARE CLUBZ** é o pivô:

- em **4 dos 5**, inverter SOMENTE o gol de SHARE CLUBZ deixa o placar do app
  idêntico ao oficial (BFRX×NIGC, LAUZ×JUND, CXAS×STDU, TTUI×SZNO);
- em 4 dos 5, o SHARE CLUBZ é o gol de **menor margem** do jogo — de 0,022 a
  0,688 ponto percentual;
- o quinto (IPIR×ITTB) precisa de dois gols trocados: SHARE CLUBZ (0,465 p.p.)
  e TAPETES MP (R$ 608,41), os dois menores do jogo.

**Mas trocar a agregação não resolve.** Testado na rodada 8 inteira:

| Agregação do indicador % | idênticos | só placar | resultado diferente |
|---|---|---|---|
| coluna `Total` (regra atual) | **117** | 11 | **5** |
| média dos dias com dado | 104 | 19 | 10 |

A média piora bastante — conserta 3 dos 5 e quebra 8 outros. Ou seja, a coluna
`Total` está certa como regra geral; o que difere é algo dentro do próprio
critério do share, não a forma de agregar.

### A definição oficial da meta (do próprio Power BI, tela "Jogos")

> **Share Clubz [Evolução Semanal]** — "Evolução semanal do share das vendas de
> Clubz **no canal físico** em relação ao total de vendas **no canal físico** no
> mesmo período. **(OBS: apenas Clubz novos)**."

Compare com a meta de vendas, na mesma tela:

> **Vendas (físico e digital)** — "Evolução semanal do faturamento bruto total
> vendido pelos canais **físico e digital**."

Ou seja, o share tem **dois recortes** que as outras metas não têm: o
denominador é só o **canal físico** (sem digital) e o numerador conta só
**Clubz novos** (sem renovações). Se a coluna `Total` da planilha exportada for
calculada sobre outra base — por exemplo incluindo o digital, ou todos os
Clubz — o número fica próximo mas não igual, e a diferença só muda o resultado
onde a margem é mínima. É exatamente o que se observa: 4 dos 5 jogos decididos
por 0,022 a 0,688 ponto percentual.

Próximo passo: pegar no Power BI (tela Jogos > filtrar a loja > botão direito >
Drill-through > Detalhe do Jogo) o valor de share da semana anterior e da atual
de UMA loja dos 5 jogos — CXAS-RS é a melhor candidata, margem de 0,022 p.p. —
e comparar com a coluna `Total` da planilha:

| | semana anterior | semana atual |
|---|---|---|
| planilha (coluna Total) | 0,3396% | 0,2143% |
| Power BI | ? | ? |

Se os números diferirem, a causa está confirmada e a correção é pedir a
exportação do share já no recorte certo.

## Hipóteses a investigar

1. **Agregação do SHARE CLUBZ.** (principal suspeita) O app usa a coluna `Total` da planilha quando
   ela existe (`agregar_pct`); se o critério oficial for a média dos dias — ou
   vice-versa — o gol vira em jogos apertados. É o candidato mais provável:
   quase todas as divergências são de **um único gol**.
2. **Desempate em cascata.** Quando as evoluções empatam, o app decide por
   maior valor na semana atual e depois na anterior (`_placar`). O critério
   oficial pode ser outro.
3. **Arredondamento** na evolução percentual, em jogos decididos por diferença
   mínima. O quadro "Por pouco" (`/api/margens`) agora dá a margem exata de
   cada gol — dá para checar se os 17 jogos divergentes são justamente os de
   margem mínima.
4. **Base da semana anterior divergente** — o Power BI pode estar usando um
   corte de dados diferente do que está no SharePoint.

## Situação em 2026-08-31

Com o `Rodada 7.xlsx` também corrigido (a eliminação do W3NT-DF vale
retroativamente e mexia em STCE-SP, ALDT-CE e ASAN-DF), a comparação ficou
limpa: as 266 lojas passam no teste de coerência entre as rodadas 7 e 8
(exatamente +1 jogo, V/E/D e gols batendo), e o placar do app contra o oficial
é **117 idênticos, 11 só no placar, 5 com resultado diferente**.

Os 5 são sempre os mesmos e não têm relação com a eliminação:

| Jogo | App | Oficial |
|---|---|---|
| IPIR-SP × ITTB-SP | 2x4 | 4x2 |
| BFRX-RJ × NIGC-RJ | 3x3 | 2x4 |
| LAUZ-SP × JUND-SP | 3x3 | 4x2 |
| CXAS-RS × STDU-CE | 3x3 | 2x4 |
| TTUI-SP × SZNO-SP | 4x2 | 3x3 |

## Como retomar

Rodar, para cada um dos 17 jogos, `_placar` com detalhe por gol e comparar com
o que o Power BI mostra no detalhe daquele confronto. Se o padrão for sempre o
mesmo gol, a hipótese 1 se confirma e o ajuste é em `agregar_pct`.
