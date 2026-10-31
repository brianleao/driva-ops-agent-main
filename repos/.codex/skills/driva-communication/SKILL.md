---
name: driva-communication
description: Draft internal feature announcements of Driva product changes for CS and sales teams, in Brazilian Portuguese and without technical jargon, grounded in the ClickUp spec, comments, pull requests, commits and current code of the Driva repositories. Use when asked to write, review or iterate a feature communication ("comunicação de funcionalidade", "/comunicacao") from a ClickUp task. Invoke with $driva-communication.
---

# Driva Communication

Redigir o comunicado interno (release note) de uma funcionalidade entregue, para que o
time entenda o que mudou para o cliente e consiga explicar a mudança.

Ao abrir esta skill, definir `<skill-dir>` como o diretório absoluto que contém este
`SKILL.md` e resolver `references/examples.md` a partir dele. Ler os exemplos antes de
escrever.

## Público e tom

- O time da Driva, principalmente CS e vendas. Escrever em PT-BR como um colega de equipe
  falando com o time: natural, direto, transparente e amigável. Segunda pessoa quando
  fizer sentido ("você filtra", "você baixa").
- Proibido: linguagem imperativa, tom de marketing, palavras difíceis e frases de venda
  ("Revolucione sua operação", "O grande lançamento", "Aproveite agora"). Sem exagero.
- Sem jargão técnico: nada de endpoint, worker, fila, flag, migration, schema, nome de
  tabela, serviço ou repositório. Usar os nomes que aparecem na interface do produto
  (telas, caixinhas, botões, opções), entre aspas quando forem rótulos literais.
- Emojis organizam a leitura, sem poluir.
- Não citar pessoas.

## Estrutura

1. **Título:** um emoji relacionado ao tema seguido do nome direto da funcionalidade.
2. **O que mudou** (`summary`):
   - **P:** uma frase curta e direta dizendo a novidade.
   - **M/G:** 1 a 2 linhas com o contexto (por que fizemos) e a solução.
3. **Na prática** (`in_practice`):
   - **P:** uma frase simples dizendo o que acontece na tela.
   - **M/G:** explicação didática e detalhada de como funciona na tela: regras de
     negócio importantes, onde fica, valor padrão, o que o usuário clica, o que acontece
     ligado e desligado, permissões, exceções, o que continua igual, o efeito em
     configurações já existentes e o que muda no dia a dia. Detalhista na mecânica,
     simples nas palavras. Pode usar linhas começando com `- ` para as regras.
4. **Links** (`links`): só quando o ClickUp trouxer o material. Central de Ajuda
   (`help_center`) e YouTube (`video`) com uma frase tranquila avisando que o material
   está disponível; imagem ou link de referência (`reference`) com o rótulo
   "Imagem/Link de referência".

O tamanho vem de `task.communicationSize` em `clickup.json`. Sem tamanho, escolher pelo
tamanho da entrega e registrar a pendência em `open_questions`.

## Método

1. Ler a spec, as subtasks e os comentários do ClickUp para entender a intenção e os
   termos da interface. A spec é intenção, não prova do que foi entregue.
2. Ler os PRs citados (corpo, arquivos e diff). Sem PR citado, buscar a implementação:

```bash
gh pr list --repo Driva-tecnologia/<repo> --state all --search "<termos>"
gh pr diff <número> --repo Driva-tecnologia/<repo>
git -C <repos-root>/<repo> log --all --grep "<termos>"
```

   Escolher os repositórios pelo mapa de serviços em
   `$CODEX_HOME/skills/driva-debug/references/service-map.md`. Buscar por nome da task,
   ID do ticket, termos da spec e rótulos da interface.
3. Confirmar no código atual de cada repositório o comportamento descrito: padrões,
   condições, permissões e exceções. Um PR fechado sem merge ou revertido não é entrega.
   Um PR aberto é implementação ainda não publicada: o diff dele vale como evidência, porque
   a comunicação costuma ser preparada antes da publicação. Registrar em `open_questions`
   quais PRs ainda não foram integrados.
4. Registrar em `evidence` cada PR, commit ou arquivo que sustenta o texto. O que a spec
   promete mas não foi confirmado no código vai para `open_questions`, nunca para o texto.
5. Devolver `INSUFFICIENT_CONTEXT` só quando nenhuma implementação (PR aberto ou integrado,
   commit ou código atual) sustenta o comportamento a comunicar, explicando o que falta.
   Se só parte da entrega está confirmada, ou se ela ainda não foi publicada, devolver
   `READY` com o que está confirmado e levar a pendência para `open_questions`.

## Iteração

Quando houver versões anteriores e feedback do PM, aplicar o feedback mais recente sobre a
última versão gerada e manter o que não foi pedido para mudar. O feedback de versões que
falharam depois dela ainda não foi aplicado e também precisa entrar. Feedback não dispensa evidência:
se o PM pedir para afirmar algo que o código não confirma, registrar a divergência em
`open_questions`.

## Fora do texto

A linha "Ticket de melhoria aberto por…" e o link do ticket são acrescentados pelo
código. Não escrevê-los.
