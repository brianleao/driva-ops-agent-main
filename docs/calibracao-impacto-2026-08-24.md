# Calibração histórica do Impacto do Incidente — 24/08/2026

## Escopo

A rubrica foi executada sobre 56 tickets históricos de Engajamento. A saída da versão
`1.0.0` foi preservada em `results/impact-v1-prod-2026-08-24/` e a da versão `1.1.0` em
`results/impact-v1.1-prod-2026-08-24/`. As duas execuções concluíram 56 tickets sem falhas.

O objetivo desta rodada foi verificar se alcance representava abrangência entre clientes,
e não apenas a proporção de leads ou operações afetadas dentro de uma sequência ou conta.

> Nota de elegibilidade: esta rodada exploratória foi executada antes da decisão de limitar
> o score a bugs confirmados e, por isso, inclui outras classificações. Na regra atual,
> somente os 33 tickets classificados como `bug` seriam avaliados; os demais seriam
> registrados como ignorados, sem score.

## Problema observado na v1

Na v1, 11 tickets receberam alcance 4 e 38 receberam alcance 1, quase sem valores
intermediários. Em vários casos, o avaliador usou como denominador leads/operações de uma
única sequência. Isso fez incidentes locais parecerem sistêmicos.

Dois exemplos que motivaram a revisão:

- `86ak0k47v`: 549 leads de uma sequência afetadas; score 89 e alcance 4;
- `86ak2kkpv`: 31 de 54 pares lead-sequência em uma conta; score 89 e alcance 4.

## Decisão da v1.1

Alcance passa a medir primariamente contas e usuários clientes afetados. Operações locais
continuam registradas e sustentam a severidade funcional, mas não podem, sozinhas, produzir
alcance 3 ou 4. O snapshot separa contagens de contas, usuários e operações.

A versão também introduz atribuição causal separada da nota. Isso permite registrar alto
impacto causado por lacuna de design, dependência externa ou configuração/uso sem classificar
automaticamente o caso como defeito do produto.

## Resultado comparativo

| Indicador              | v1.0.0 | v1.1.0 |
| ---------------------- | -----: | -----: |
| Tickets avaliados      |     56 |     56 |
| Falhas                 |      0 |      0 |
| Média                  |  54,98 |  51,39 |
| Mediana                |     55 |   49,5 |
| Moderados              |     22 |     27 |
| Altos                  |     24 |     26 |
| Críticos               |      9 |      2 |
| Sem impacto confirmado |      1 |      1 |

### Distribuição de alcance

| Nível | v1.0.0 | v1.1.0 |
| ----: | -----: | -----: |
|     0 |      1 |      2 |
|     1 |     38 |     50 |
|     2 |      1 |      2 |
|     3 |      5 |      1 |
|     4 |     11 |      1 |

A concentração em alcance 1 é coerente com a origem da amostra: tickets abertos por casos
de clientes específicos. Ainda assim, o pequeno número de níveis 2 e 3 indica que uma
próxima rodada deve calibrar exemplos de “poucas contas” e segmentos, evitando que a
rubrica fique excessivamente binária entre uma conta e um evento sistêmico.

### Antigos críticos

| Ticket      | Score v1 | Score v1.1 | Alcance v1 → v1.1 | Atribuição v1.1       |
| ----------- | -------: | ---------: | ----------------- | --------------------- |
| `86ajvve8y` |       83 |         66 | 3 → 1             | `PRODUCT_DEFECT`      |
| `86ajwbx0d` |       89 |         89 | 4 → 4             | `PRODUCT_DEFECT`      |
| `86ajycr91` |       85 |         66 | 4 → 1             | `PRODUCT_DEFECT`      |
| `86ajyd08y` |       78 |         83 | 4 → 3             | `PRODUCT_DEFECT`      |
| `86ajz1xnv` |       89 |         66 | 4 → 1             | `PRODUCT_DEFECT`      |
| `86ak0dk44` |       83 |         59 | 3 → 1             | `MIXED`               |
| `86ak0k47v` |       89 |         70 | 4 → 1             | `PRODUCT_DESIGN_GAP`  |
| `86ak2kkpv` |       89 |         63 | 4 → 1             | `EXTERNAL_DEPENDENCY` |
| `86ak3qjya` |       85 |         66 | 4 → 1             | `MIXED`               |

Os dois críticos preservados têm evidência multicliente:

- `86ajwbx0d`: 98 de 131 workspaces e 155 de 245 usuários elegíveis afetados;
- `86ajyd08y`: 13 de 258 contas elegíveis afetadas, aproximadamente 5,04%.

### Atribuição causal

| Atribuição                      | Tickets | Score médio |
| ------------------------------- | ------: | ----------: |
| `PRODUCT_DEFECT`                |      28 |       52,79 |
| `PRODUCT_DESIGN_GAP`            |       7 |       51,29 |
| `EXTERNAL_DEPENDENCY`           |       4 |       58,00 |
| `CUSTOMER_CONFIGURATION_OR_USE` |       2 |       24,00 |
| `MIXED`                         |       7 |       51,57 |
| `UNCONFIRMED`                   |       8 |       50,00 |

O resultado confirma por que atribuição não deve reduzir o score: dependências externas e
lacunas de design também produziram impacto relevante.

## Qualidade e limitações dos dados

- 46 avaliações obtiveram contagem de contas, 26 de usuários e 41 de operações;
- 10 avaliações tiveram confiança alta, 37 média e 9 baixa;
- 48 avaliações ficaram no estágio observado, 6 inicial e apenas 2 final;
- a amostra é composta por tickets, não por incidentes deduplicados;
- consultas feitas meses depois podem medir uma janela maior que a conhecida na abertura;
- apenas dois casos têm período final suficientemente fechado, então estes scores não devem
  ser usados ainda como série definitiva de “impacto realizado”.

## Recomendação

A v1.1 está adequada para uma fase informativa. Antes de transformá-la em meta:

1. revisar manualmente os dois críticos, os oito `UNCONFIRMED` e uma amostra estratificada
   de dez tickets com alcance 1;
2. fazer dupla avaliação cega nessa amostra e medir divergência por dimensão;
3. introduzir uma chave de incidente para evitar soma duplicada de tickets da mesma causa;
4. recalcular no fechamento do incidente para aumentar a cobertura do estágio `final`;
5. observar por duas a quatro sprints e só então congelar pesos e limites.

Os artefatos para auditoria são `summary.json`, `customer-impact.csv` e os snapshots em
`tickets/<ticket-id>/customer-impact.json` dentro de cada diretório de versão.
