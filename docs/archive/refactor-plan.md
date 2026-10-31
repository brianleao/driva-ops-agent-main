# Plano de refatoração

Objetivo: levar o código ao estado descrito no `AGENTS.md` sem mudar o comportamento em produção. Cada etapa cabe em uma sessão, vira uma branch `refactor/<etapa>` e um PR próprio, e deixa `build` + testes verdes. Não comece uma etapa sem a anterior mergeada.

## Regras para toda etapa

- Ler o `AGENTS.md` e **só esta etapa** deste arquivo; não carregar o plano inteiro nem arquivos que a etapa não toca.
- Mudança estrutural não muda comportamento. Bug encontrado no caminho vira anotação na seção "Achados" no fim deste arquivo, não correção na mesma etapa.
- Commitar cedo (o `main` local pode levar `reset --hard` fora da sessão).
- Ao terminar: marcar a etapa como concluída aqui, atualizar "Estado da migração" do `AGENTS.md` e registrar no PR os comandos de validação rodados.
- Etapas marcadas com **deploy** devem ir para produção e ser observadas (um ciclo de cron + um diagnóstico manual) antes da próxima.

## Estratégia para sair do `.mjs`

O runner roda direto de `src/` porque os `.mjs` nunca passam pelo `tsc`. A saída incremental é:

1. Ligar `allowJs` e renomear `*.mjs` → `*.js`. O `tsc` passa a copiar esses arquivos para `dist/`, o Nest spawna `dist/runner.js` e o `Dockerfile` deixa de copiar arquivos um a um. Nada é reescrito.
2. Converter arquivo por arquivo de `.js` para `.ts`. Como os imports já usam o sufixo `.js`, quem importa não muda.
3. Quando não sobrar `.js` em `src/`, desligar `allowJs`.

Os fixtures em `src/incidents/fixtures/` são executáveis que fazem papel do binário do Codex nos testes de integração do `processIncident` (`config.codexBin` aponta para eles; leem o prompt do stdin, gravam `captured-prompt.txt` e devolvem uma saída fixa). **Decisão (etapa 2):** mantidos, renomeados `.mjs` → `.js` (ESM via `"type": "module"`, shebang `node`), fora do build pelo `exclude` de `fixtures/`. Não viram `.sh` (precisam consumir stdin e gravar o prompt) e não exigem exceção no `AGENTS.md`, porque a regra "tudo é `.ts`" vale para o código do build.

---

## Etapa 0 — Limpeza do repositório ✅

- [x] Remover `state/diagnosis.lock/owner.json` do índice (`git rm --cached`) e ignorar `state/diagnosis.lock/`.
- [x] Mover `DEPLOY_HANDOFF.md` e `GOOGLE_CHAT_HANDOFF.md` para `docs/`; corrigir links no README.
- [x] Decidir sobre `systemd/`: removido (Dokku é o único deploy).
- [x] Commitar `AGENTS.md` e este plano.
- [x] Remover `pnpm-lock.yaml` do working tree se não for usado (o lockfile oficial é o `package-lock.json`).

Validação: `npm run build && npm test`.

## Etapa 1 — Vitest como rede de segurança ✅

Motivo de vir primeiro: os testes atuais importam `dist/` e exigem build; a refatoração precisa de testes que leiam o fonte.

- [x] Adicionar `vitest` e `vitest.config.ts` (ambiente node, `include: ['src/**/*.spec.ts']`).
- [x] Converter cada `*.test.mjs` em `*.spec.ts` com a mesma cobertura, trocando `node:test`/`assert` por `describe`/`it`/`expect`. Manter o padrão Arrange/Act/Assert.
- [x] Imports apontam para o fonte (`../runner.mjs`, `./google-chat.service.js`), nunca para `dist/`. Remover o transpile em runtime.
- [x] `npm test` → `vitest run`; adicionar `test:watch`.
- [x] Confirmar que o número de casos de teste é igual ao de antes.

Validação: `npm test` sem `npm run build` antes; `npm run build`.

## Etapa 2 — Build único (`allowJs`) — **deploy** ✅

- [x] `tsconfig.json`: `allowJs: true`, `include` com `src/**/*.js`; `tsconfig.build.json` exclui `*.spec.ts` e `fixtures/`.
- [x] Renomear `src/**/*.mjs` → `.js`, incluindo os fixtures (conforme decisão acima), e corrigir os imports `.mjs` → `.js` e os caminhos dos fixtures em `runner-integration.spec.ts`.
- [x] Mover `prompt.md` e `remediation-prompt.md` para `src/prompts/`; `impact-prompt.md` fica em `src/impact/`. Publicar via `assets` do `nest-cli.json` (com `watchAssets`) e ajustar os caminhos lidos no runner e no impact-runner.
- [x] `DiagnosisExecutionService` e `ImpactExecutionService` spawnam `dist/runner.js` e `dist/impact/impact-runner.js`, resolvidos a partir do próprio arquivo compilado e não de `process.cwd()`/`src`.
- [x] Scripts do `package.json`: `diagnose`, `dry-run`, `impact`, `impact:history` e `check` passam a usar `dist/` (com `build` antes quando fizer sentido); texto de uso do runner atualizado.
- [x] `Dockerfile`: remover os `COPY src/...` do estágio final; manter skills, `config.toml` e `entrypoint`.
- [x] Conferir que `dist/` contém runner, helpers e prompts depois de `npm run build`.

Validação: `npm test`; `npm run build`; `npm run dry-run`; `docker build .`; subir o container localmente e disparar `POST /diagnoses` com `--dry-run` ou um ticket de teste.

## Etapa 3 — ESLint e Prettier ✅

- [x] ESLint flat config (`typescript-eslint` recomendado + `no-floating-promises`, `no-explicit-any`, `no-console` exceto nos entrypoints). Por enquanto, ignorar `src/**/*.js`.
- [x] Prettier alinhado ao engagement-service. **Decisão:** copiar o `.prettierrc` dele (`singleQuote: true`, `trailingComma: all`, `endOfLine: auto`, `tabWidth: 2`, override de `*.yaml` com `singleQuote: false`), sem `printWidth` explícito, ou seja, o padrão de 80.
- [x] Scripts `lint`, `lint:fix`, `format`.
- [x] **Commit só de formatação separado** do commit de configuração, para o `git blame` poder ignorá-lo (`.git-blame-ignore-revs`).
- [x] Corrigir os erros de lint nos `.ts` existentes sem mudar comportamento. `no-floating-promises` deve achar os fire-and-forget sem `.catch`: corrigir com log.

Validação: `npm run lint && npm run build && npm test`.

## Etapa 4 — Tipos de domínio e contrato IPC ✅

- [x] Criar a fonte única das categorias de domínio (`as const` + tipo derivado + validador): decisão da ação de engenharia, `confidence`, modo de remediação, fonte e status da execução. Os `.ts` que repetem string unions passam a importar daí.
- [x] Criar `diagnosis/runner-messages.ts` com os tipos das mensagens IPC runner ↔ Nest.
- [x] Substituir o marcador de stdout `DRIVA_DIAGNOSIS_READY:<id>` por `process.send` com um tipo de mensagem, como já é feito para incidentes. Manter o fallback de stdout só para o modo CLI, se ele for necessário (verificar).
- [x] Testes do handshake de IPC no `DiagnosisExecutionService`.

Validação: `npm run lint && npm run build && npm test`; teste de integração do runner com notificação.

## Etapa 5 — Configuração centralizada ✅

- [x] `src/config/`: carregar e validar as variáveis de ambiente em objetos tipados (um para o app Nest, um para o runner, um para o impacto). Ponto de partida: `configFromEnv` do runner.
- [x] Nest: provider de config injetado; remover `process.env` de services e controllers (inclusive o `@Cron(process.env.DIAGNOSIS_CRON ...)`).
- [x] Runner/impacto: recebem a config tipada da função `main`.
- [x] Criar ou atualizar o `.env.example` com todas as variáveis.
- [x] Config obrigatória inválida derruba o boot com mensagem clara.

Validação: `grep -rn "process.env" src` só encontra `src/config/` e testes; `npm run lint && npm run build && npm test`.

## Etapa 6 — Funções puras para `.ts` ✅

Arquivos: `config/area-values`, `diagnosis/vector-classification`, `remediation/remediation-reorientation`, `incidents/repository-selection`, `impact/customer-impact`, `impact/impact-report`, `impact/impact-persistence`.

- [x] Converter para `.ts` com tipos explícitos de entrada e saída, usando os tipos da etapa 4.
- [x] Extrair o helper de escrita atômica para um lugar compartilhado entre o `StateService` e o runner.
- [x] Nenhuma mudança de lógica: os specs da etapa 1 devem passar sem edição (exceto imports).

Validação: `npm run lint && npm run build && npm test`.

## Etapa 7 — Adapters compartilhados ✅

Unificar o que hoje existe duplicado entre o runner e o Nest. Cada adapter é uma classe/função `.ts` sem dependência de Nest, usada diretamente pelo runner e embrulhada como provider no Nest.

- [x] `github/`: um único wrapper do `gh` (hoje há `runGitHub` no runner e `GithubService`), com timeout, stderr e env explícito.
- [x] `codex/`: execução do Codex com allowlist de env (`codexEnvironment`), sandbox `bwrap` e timeout. Consumidores: runner, `impact-evaluator` e `google-chat.service` (linha ~1341, que hoje repassa o `process.env` inteiro; corrigir isso sem mudar o que o Codex efetivamente recebe além de segredos: verificar e anotar).
- [x] `clickup/`: `clickupRequest`/`fetchTasks`/`normalizeTicket` unificados com o `ClickupService`.
- [x] `git/`: `runGit`, sincronização de repositórios e dependências, worktrees.
- [x] Specs dos adapters com `spawn`/`fetch` mockados.

Validação: `npm run lint && npm run build && npm test`; `npm run dry-run`.

## Etapa 8 — Quebrar o runner e converter para `.ts` — **deploy** ✅

Pode virar duas sessões (8a e 8b) se o contexto apertar.

- [x] 8a: extrair para arquivos próprios, já em `.ts`: validação da ação de engenharia, helpers de issue/PR de incidente (os que hoje são exportados para teste), seleção e normalização de tickets, montagem de prompts, persistência de artefatos em `results/`.
- [x] 8b: `processTicket`, `processIncident`, remediação e reorientação em módulos por responsabilidade; `runner.ts` fica só com parse de args, carga de config, lock e o loop principal.
- [x] Logger do runner no lugar de `console.log` (a saída continua indo para o stdout herdado pelo Nest).
- [x] O `runner-integration.spec.ts` continua passando sem mudança de asserções.

Handoff 8b → 9 (branch `refactor/etapa-8-runner-ts`, PR contra `refactor/etapa-7-adapters`): `runner.js` apagado; `runner.ts` só com args, config, lock e loop. Módulos novos: `runner/runner-{paths,codex,preparation,lock,args}.ts`, `remediation/remediation-run.ts`, `remediation/remediation-reorientation-run.ts`, `diagnosis/ticket-processing.ts` e `incidents/incident-processing.ts`. `runnerDir` continua sendo o diretório de `dist/runner.js` (prompts em `dist/prompts/`); `RUNNER_PATH` do `DiagnosisExecutionService` resolve para `dist/runner.js`. Sobram em `.js` só `impact/impact-evaluator.js` e `impact/impact-runner.js`. O diagnóstico manual com `--remediation=none` não foi rodado nesta sessão (ver pré-requisitos no PR).

Validação: `npm run lint && npm run build && npm test`; `npm run dry-run`; diagnóstico manual de um ticket real com `--remediation=none` em ambiente local ou staging.

## Etapa 9 — Impacto para `.ts` ✅

- [x] `impact-evaluator` e `impact-runner` em `.ts`, usando o adapter do Codex e a config da etapa 5.
- [x] Desligar `allowJs` quando não sobrar `.js` em `src/`; remover o ignore de `*.js` do ESLint.

Validação: `npm run lint && npm run build && npm test`; `npm run impact -- --ticket-id=<id de teste>`.

Handoff 9 → 10 (branch `refactor/etapa-9-impact-ts`, PR contra `refactor/etapa-8-runner-ts`): não sobra `.js` em `src/` além dos fixtures executáveis de `incidents/fixtures/` (fake Codex dos testes de integração, lintados com globals de Node e fora do build). `allowJs` desligado e `tsconfig` com `include: ["src/**/*.ts"]`. Parse de args do impacto em `impact/impact-args.ts` (com spec); o runner usa `loadDotEnv`, `impactCodexConfigFromEnv`, `runCodexExec` via evaluator e `runnerLogger`. `--help`, ticket inseguro e `--concurrency` inválido validados; a execução real com `--ticket-id=86ajk4mpg` chegou ao Codex e falhou no `bwrap` do host local (ver achados), sem alterar os artefatos do ticket.

## Etapa 10 — Módulos Nest, guards e DTOs

- [x] Um módulo por pasta de feature (`state`, `clickup`, `github`, `codex`, `google-chat`, `diagnosis`, `incidents`, `impact`, `health`); `AppModule` só importa. Sem dependência circular (`google-chat` ↔ `diagnosis` é a candidata: resolver extraindo ou com eventos, perguntar se não for óbvio).
- [x] Guards: `DiagnosisApiKeyGuard`, `GrafanaWebhookGuard`, `GoogleChatAuthGuard`, com `timingSafeEqual`. Remover os `authorize()` inline.
- [x] `ValidationPipe` global + DTOs para `POST /diagnoses`, `/impact`, `/incidents/grafana` e o evento do Google Chat. Manter o alias legado `googleChatUser` (conferir se ainda é usado antes de remover).
- [x] Specs dos guards e da validação dos DTOs (payloads válidos e inválidos).

Validação: `npm run lint && npm run build && npm test`; `curl` nos endpoints com e sem token.

Handoff 10 → 11 (branch `refactor/etapa-10-nest-modulos`, PR contra `refactor/etapa-9-impact-ts`): módulos `config` (global, tokens `APP_CONFIG`/`AUTH_CONFIG`/`CLICKUP_CONFIG`/`RUNTIME_CONFIG`/`GOOGLE_CHAT_CONFIG`), `state`, `clickup`, `github`, `google-chat`, `diagnosis`, `incidents`, `impact` e `health`; `AppModule` só importa. O ciclo `google-chat` ↔ `diagnosis` foi resolvido separando o controller do Chat e os services de comando/reorientação em `GoogleChatEventsModule`, que importa `GoogleChatModule` (notificações) e `DiagnosisModule` (que por sua vez importa `GoogleChatModule`). Guards em `diagnosis/diagnosis-api-key.guard.ts`, `incidents/grafana-webhook.guard.ts` e `google-chat/google-chat-auth.guard.ts` (comparação por `common/safe-equal.ts`). `RequestValidationPipe` global (`common/request-validation.pipe.ts`) com DTOs por feature. `curl` antes/depois idêntico em código HTTP e corpo, exceto os `runId` aleatórios; as execuções enfileiradas falharam por `DIAGNOSIS_VECTORS` ausente, sem diagnóstico real.

## Etapa 11 — Quebrar o `google-chat.service.ts` — **deploy**

- [x] Separar por responsabilidade: roteamento de eventos, montagem de cards, threads/espaços, notificação de execuções, conversa com o Codex e ações (assumir, aprovar comentário, reorientar).
- [x] O `google-chat.service.spec.ts` continua passando; quebrá-lo junto com o service.

Validação: `npm run lint && npm run build && npm test`; interação real em um espaço de teste do Chat.

Handoff 11 → 12 (branch `refactor/etapa-11-google-chat`, PR contra `refactor/etapa-10-nest-modulos`): o `google-chat.service.ts` virou `google-chat-event-router.service.ts` (só `handleEvent`), e as responsabilidades foram para `google-chat-cards.ts` (montagem pura, com snapshots JSON dos cards em `__snapshots__/`), `google-chat-add-on.ts` (normalização/resposta do add-on), `google-chat-messenger.service.ts` (API do Chat), `google-chat-threads.service.ts` (threads/espaços), `google-chat-actions.service.ts` (assumir, aprovar comentário), `google-chat-notifications.service.ts` (cards de execução) e `google-chat-conversation.service.ts` (conversa com o Codex). Cada arquivo tem spec ao lado; os casos do spec antigo foram redistribuídos sem perda. `GoogleChatModule` declara messenger, threads, actions, notifications, conversation e router, e exporta notifications (usado pelo `DiagnosisModule`), router, messenger e threads (usados pelo `GoogleChatEventsModule`); sem import de `DiagnosisModule`, sem ciclo. Comando `/processar` e reorientação injetam messenger/threads direto. O Nest usa `ticketResultsDir` para achar `results/<ticket>`. A interação real num espaço de teste do Chat fica como pré-requisito do deploy, descrito no PR.

## Etapa 12 — Fechamento

- [x] Health: mover o `spawn` do `health.controller.ts` para um service.
- [x] README atualizado (comandos, arquitetura, variáveis).
- [x] `AGENTS.md`: remover a seção "Estado da migração" e revisar o que mudou nas decisões tomadas durante as etapas.
- [x] Avaliar `knip` para exports e dependências mortas.
- [x] Apagar este arquivo ou arquivá-lo.

Fechamento (branch `refactor/etapa-12-fechamento`, PR contra `refactor/etapa-11-google-chat`): `HealthService` com spec; README e `AGENTS.md` revisados. O `knip` rodou via `npx`, sem virar dependência: nenhum arquivo ou dependência morta, e só `envValue` foi removido. Os demais exports só têm uso interno e estão listados em `docs/achados.md`. Plano arquivado em `docs/archive/`. Os achados abertos foram para `docs/achados.md`; os resolvidos ficam registrados abaixo.

---

## Achados

Bugs e dúvidas encontrados durante as etapas, para tratar em PRs separados.

- **Specs sem typecheck (etapa 1).** Os `*.spec.ts` foram traduzidos 1:1 dos `.test.mjs` e ainda não passam no `tsc` strict (~180 erros: parâmetros sem tipo, imports de `.mjs` sem declaração, acesso a membros `private` do `GoogleChatService`). O Vitest não faz typecheck e o `tsconfig.build.json` exclui os specs, então build e testes passam. Tipar os specs junto com a conversão dos `.mjs` (etapas 2+) e, depois, incluir `tsc --noEmit` na validação.
- **`DIAGNOSIS_VECTORS` ausente no `.env` local (etapa 2).** O `.env` de desenvolvimento não tem `DIAGNOSIS_VECTORS`, obrigatória desde antes desta etapa, e o `npm run dry-run` falha com `Missing required configuration: DIAGNOSIS_VECTORS`. A validação usou o valor do `.env.example` via variável de ambiente. Atualizar o `.env` local (ou documentar no README) quando a config for centralizada (etapa 5).
- **`POST /diagnoses` sem modo dry-run (etapa 2).** O endpoint não aceita `dryRun`: o smoke test no container só consegue subir o runner, que falha na primeira chamada ao ClickUp com um ticket inexistente (aqui, `401 Team not authorized` para um id fora do workspace). O registro termina em `failed`, como esperado. Avaliar um `dryRun` na API manual junto com os DTOs (etapa de validação de entrada).
- **`state/diagnosis.lock` órfão no clone local.** O lock de 2026-08-01 (pid 368610, morto) ainda existe no `state/` local. Não afeta o dry-run, mas bloquearia um diagnóstico real local. Remover à mão, conforme o procedimento de lock órfão.
- **Prompts e fixtures fora do Prettier (etapa 3).** `src/prompts/`, `src/**/*-prompt.md` e `src/**/fixtures` estão no `.prettierignore`: os prompts vão literais para o Codex e reformatá-los mudaria o diagnóstico em produção. Se um dia forem formatados, tratar como mudança de prompt.
- **`no-floating-promises` sem ocorrências (etapa 3).** Os fire-and-forget dos `.ts` já usavam `void ... .catch`/`.then(ok, err)`. Os de `src/**/*.js` (runner, impacto) só serão verificados quando esses arquivos forem convertidos para `.ts`.
- **`eslint-disable` em `spawnCodex` (etapa 3).** A regex que remove caracteres de controle do stderr do Codex (`google-chat.service.ts`, desde a etapa 11 `google-chat-conversation.service.ts`) é intencional; `no-control-regex` foi desligada só nessa linha.
- **Fallback de stdout desnecessário (etapa 4).** Nada fora do Nest lia `DRIVA_DIAGNOSIS_READY`: no modo CLI (`npm run diagnose`, `dry-run`) o marcador só era impresso. Sem canal IPC, o aviso de ticket agora é no-op (`process.send?.`); o de incidente continua exigindo a fila da aplicação ou `--no-notify`. Com isso, o stdout do runner passou de `pipe` + repasse para `inherit`.
- **`EngineeringAction` do Google Chat segue com `string` (etapa 4).** `decision` e `confidence` em `google-chat.service.ts` (desde a etapa 11 `google-chat.types.ts`) vêm de `engineering-action.json` lido do disco sem validação, então não foram estreitados para `EngineeringDecision`/`ConfidenceLevel`. Estreitar quando a leitura desses artefatos passar por validação (etapa 11).
- **Status "ativos" diferentes para reorientação (etapa 4).** `findActiveByTicket` considera `queued`/`running`, mas o serviço de reorientação do Chat também trata `pending_confirmation` como ativo. Mantido como está; confirmar se a diferença é intencional.
- **Notificação de incidente fora da fila de notificações (etapa 4).** O `close` do runner espera só as notificações de ticket; a de incidente não entra na fila porque o runner já espera o ack antes de seguir. Comportamento preservado.
- **Três defaults para `DRIVA_REPOS_DIR` (etapa 5).** O runner usa um caminho fixo (`DEFAULT_RUNNER_REPOS_DIR`), o impacto usa `<projectDir>/repos` e o Nest usa `<cwd>/repos`. Registrado sem unificar: em produção a variável está definida, mas localmente cada processo pode olhar para um diretório diferente.
- **`CLICKUP_MAX_ATTACHMENT_MB` (etapa 5).** O default no código é 50; o `.env.example` sugere 20. Mantidos os dois.
- **Gate do cron mais estrito que a validação (etapa 5, resolvido).** `DIAGNOSIS_CRON_ENABLED` agora só aceita `true`, `false` ou vazio; qualquer outro valor (inclusive `1`/`yes`) impede o boot.
- **`GOOGLE_CHAT_VECTOR_SPACES_JSON` inválido lança erro (etapa 5, resolvido).** O mapa é validado no boot do Nest por `parseVectorSpaces` (objeto de vetor → array de spaces), o mesmo parser usado ao notificar.
- **`googleChatActionUrl` e `CODEX_BIN` duplicados (etapa 5).** A URL de ação do Chat estava implementada duas vezes (Chat e reorientação) e `CODEX_BIN` era lido em vários pontos; ambos agora vêm de `src/config/` com o mesmo comportamento.
- **Dependência transitiva `cron` (etapa 5, resolvido).** `cron` foi declarado no `package.json` fixo em `4.4.0`, a mesma versão exigida por `@nestjs/schedule`; ao atualizar um, alinhar o outro.
- **Leitura preguiçosa da config nos services (etapa 5).** Os services leem a config por helpers de `src/config/` no momento do uso, não por injeção, porque os specs alteram `process.env` e instanciam os services diretamente. Adiado: trocar por injeção quando os módulos forem divididos (etapa 10).
- **Lista de confiança duplicada em `customer-impact` (etapa 6, resolvido).** O módulo tinha um `Set` próprio com `high`/`medium`/`low`; agora usa `isConfidenceLevel`/`ConfidenceLevel` de `diagnosis/engineering-action.ts`, com os mesmos valores.
- **Escrita atômica em `state/atomic-write.ts` (etapa 6).** `writeFileAtomic`/`writeJsonAtomic` substituem as cópias do `StateService`, do runner (`writeJsonAtomic`, `writeSecretAtomic`) e do `impact-persistence`, que reexporta `writeJsonAtomic` para o `impact-runner.js`. O temp file continua sendo `<arquivo>.<pid>.tmp`: duas escritas concorrentes no mesmo arquivo dentro do mesmo processo compartilham o temp. Hoje o runner serializa as escritas de estado (`stateWriteQueue`) e o `StateService` serializa pelo `update`, então não há colisão conhecida; mantido.
- **`impact-report` com tipo de entrada estreito (etapa 6).** `buildImpactSummary`/`impactEvaluationsToCsv` recebem `ImpactEvaluation`, que declara só os campos lidos, e não o `CustomerImpact` completo, porque o fixture do spec usa um impacto parcial. Revisar quando `impact-runner`/`impact-evaluator` forem tipados (etapa 9).
- **Specs de `impact/` seguem sem typecheck (etapa 6).** `customer-impact.spec.ts` e `impact-report.spec.ts` ainda falham no `tsc --noEmit` (fixtures parciais passadas para os tipos novos); o erro de `repository-selection.spec.ts` sumiu com a conversão. Continua valendo o achado da etapa 1.
- **Env do Codex já era allowlist em todos os caminhos (etapa 7).** O plano dizia que o `google-chat.service` repassava o `process.env` inteiro; na prática os três consumidores (runner, `impact-evaluator`, Chat) já passavam `codexEnvironment`. O adapter `codex/codex.ts` recebe exatamente as mesmas variáveis em todos os caminhos. O runner trocou handlers `on` por `once` com guarda de `settled`.
- **`gh` e `git` recebem o `process.env` inteiro (etapa 7).** Preservado. Os wrappers do `gh` do runner e do `GithubService` diferiam (timeout, formato do erro), então `github/gh.ts` é parametrizado; o timeout do Nest passou a ser `setTimeout` + `SIGTERM`, como no runner.
- **Erro do ClickUp sanitizado só no runner (etapa 7).** O runner sanitiza o corpo do erro; o `ClickupService` mantém o corpo (truncado em 500) via `serviceClickUpError`. Preservado.
- **Anexos do ClickUp com `x-api-key` (etapa 7).** O download de anexo autentica com `x-api-key`, e as chamadas à API com `Authorization`. Preservado.
- **`normalize` do runner não remove acentos (etapa 7).** A comparação de área/tipo no runner é só `trim`/`toLowerCase`, diferente da do Nest. Preservado.
- **`synchronizeDiagnosedVector` devolve `{ updated, previousVectors }` (etapa 7).** O runner só usava o booleano; o retorno foi estendido para servir aos dois lados. `safeFilename` passou a usar uma checagem equivalente.
- **`sanitize` tinha três cópias (etapa 7).** Unificado em `common/sanitize.ts`. Lacunas preservadas: a regex de `Authorization` redige só um token, corpo `Bearer` não é redigido e tokens `ghp_` não são redigidos.
- **Fingerprint de dependências inclui `process.version` (etapa 7).** Trocar a versão do Node reinstala todas as dependências. Preservado.
- **Instalação de dependências com `stdio: 'inherit'` (etapa 7).** O `bwrap` da sincronização de dependências não captura stderr; o erro só traz o exit code/sinal. Preservado.
- **`runGit` via `runProcess` (etapa 7).** A execução do `git` passou a usar `common/run-process.ts`, que acrescenta guarda de `settled`; args, timeout, `GIT_TERMINAL_PROMPT=0` e o erro sanitizado (últimos 2000 caracteres) são os mesmos. O erro de arquivo de dependência ausente agora carrega `cause`, com a mesma mensagem. `mkdtemp`/`rm` das worktrees de remediação foram para `git/worktrees.ts`.
- **Runner filho sem timeout (etapa 7).** `DiagnosisExecutionService.spawnRunner` e `ImpactExecutionService.spawnRunner` tratam exit code e `error`, mas não têm timeout: um runner travado segura a fila única indefinidamente. Os demais `spawn` (`run-process`, healthcheck, dependências) têm timeout e tratamento de exit code. Não alterado.
- **`processEnv` importado e não usado no runner (etapa 8a).** `runner.js` importa `processEnv` de `config/env.js` sem usar. Remover na conversão para `.ts` (o lint vai acusar).
- **`rejectedTickets` sem uso (etapa 8a, resolvido).** Variável calculada e nunca lida no `main` do runner; saiu junto com a extração de `ticket-selection.ts`.
- **Sanitização do diretório de `results/` duplicada (etapa 8a).** `ticketResultsDir` (`diagnosis/diagnosis-artifacts.ts`) é usado pelo runner, mas o Nest (`google-chat.service.ts`, `diagnosis-execution.service.ts` etc.) repete `id.replace(/[^A-Za-z0-9_-]/g, '_')`. Unificar ao quebrar o `google-chat.service.ts` (etapa 11, resolvido: ver achado da etapa 11).
- **Montagem de prompt com `String.replace` de string (etapa 8a).** Cada placeholder só é substituído na primeira ocorrência e sequências `$&`/`$'`/`` $` `` dentro do JSON do ticket ou da ação são interpretadas como padrões de substituição, podendo corromper o prompt. Preservado em `diagnosis-prompt.ts` e `remediation-prompt.ts`.
- **`run.json` atualizado por read-modify-write sem fila (etapa 8a).** `updateRunArtifact` preserva o comportamento anterior (ler, alterar, `writeJsonAtomic`), fora de qualquer serialização; o Nest só lê `run.json`.
- **`processEnv` importado e não usado no runner (etapa 8b, resolvido).** Removido na conversão para `runner.ts`.
- **Fechamento de PRs substituídos por incidente ignora o `github` injetado (etapa 8b).** `remediateIncident` chama `closeSupersededPullRequests`, que usa `runGitHub` direto; o parâmetro `github` de `processIncident` não cobre esse caminho nos testes. Preservado.
- **`readProcessed` roda antes do ramo `--sync-dependencies-only` (etapa 8b).** Um `state/processed.json` corrompido faz a sincronização de dependências falhar sem necessidade. Preservado.
- **`token`/`listId` opcionais no `RunnerConfig` (etapa 8b).** São obrigatórios para os adapters do ClickUp, mas `runnerConfigFromEnv` só os exige fora do modo incidente; `runner.ts` usa `as TicketProcessingConfig`. Resolver com tipos distintos por modo.
- **Erros relançados ganharam `cause` (etapa 8b).** `runner-lock` e `readProcessed` passaram a anexar `{ cause }` (regra `preserve-caught-error`); a mensagem é a mesma.
- **Fallback morto `options.timeoutMs ||` (etapa 8b).** O timeout sempre vem preenchido da config; o fallback nunca é usado. Preservado.
- **`reorientationId as string` (etapa 8b).** A validação por regex garante string, mas o tipo não estreita; cast mantido.
- **Notificação de ticket x incidente (etapa 8b).** `notifyTicketDiagnosis` é `process.send?.()` sem ack (fora do Nest é no-op), enquanto a de incidente espera ack com timeout de 120 s e falha fora do Nest sem `--no-notify`. Preservado.
- **`processIncident` não remove `raw-output.md`/`codex-stderr.log` antigos (etapa 8b).** Diferente de `processTicket`, uma execução sem stdout/stderr deixa o artefato da anterior. Preservado.
- **Leitura de `state/incidents.json` sem tratar `ENOENT` (etapa 8b).** `--incident-id` sem o arquivo falha com erro cru de `readFile`. Preservado.
- **`ClickUpTask.id` é `string | number` (etapa 8b).** O runner usa `String(task.id)` em cada chamada; normalizar na borda do adapter.
- **`loadImpactTicket` valida o `ticket.json` (etapa 9).** Um `ticket.json` que não seja objeto agora falha com `ticket.json must be an object`; antes o erro aparecia mais adiante, ao ler campos. Só muda a mensagem de um caso já inválido.
- **Índice de `ImpactSnapshot` removido (etapa 9).** `impact-persistence.ts` declarava `[key: string]: unknown` sem uso, o que impedia passar `TicketImpact` (interface). Só tipo; o JSON gravado é o mesmo.
- **`impact-report` com tipo de entrada estreito (etapa 9).** Mantido: o runner passa `TicketImpact`, compatível com `ImpactReportImpact`.
- **`ImpactExecutionService` fora de `config/` (etapa 9).** Usa `process.cwd()` para achar o runner e repassa `processEnv()` inteiro ao filho. Não alterado; revisar na etapa 10 junto com a injeção de config.
- **`bwrap` sem namespace de rede no host local (etapa 9).** Com `kernel.apparmor_restrict_unprivileged_userns=1` (Ubuntu 24.04), `bwrap --unshare-net` falha com `loopback: Failed RTM_NEWADDR: Operation not permitted`, e o Codex não abre sessão. Pré-requisito para rodar impacto/diagnóstico real localmente: perfil AppArmor para o `bwrap` ou rodar no container/staging. O sandbox não foi relaxado.
- **`no-floating-promises` no runner e no impacto (etapa 9).** Com todo o `src/` em `.ts`, o lint type-aware passa sem ocorrências; o achado da etapa 3 está fechado.
- **Sem `CodexModule` (etapa 10).** `codex/codex.ts` é adapter de função pura usado pelo runner, pelo impacto e pelo Chat, sem provider Nest; não ganhou módulo.
- **Contexto do log de autenticação do Chat (etapa 10).** As mensagens de falha de autenticação saem agora com contexto `GoogleChatAuthGuard` em vez de `GoogleChatService`; o texto é o mesmo. A comparação do e-mail do caller passou a usar `safeEqual`.
- **`POST /diagnoses` aceita `ticketId` em branco (etapa 10).** `"   "` passa na validação e é enfileirado (201), como antes; o runner falha adiante. Preservado; `/impacts` já rejeitava.
- **Alias `googleChatUser` com `googleChatSpace: null` (etapa 10).** Com `googleChatSpace` nulo, um `googleChatUser` inválido ainda é validado e o espaço cai no alias, como antes. O alias segue em uso pela API manual; preservado.
- **Mensagem de erro de validação (etapa 10).** Para manter o corpo `{ statusCode, message: string, error }` e o body original (sem `classToPlain`), o `ValidationPipe` foi estendido sobrescrevendo `createExceptionFactory` para devolver só a primeira mensagem. Um `exceptionFactory` passado como opção vai para `validatorOptions` e muda o objeto entregue ao controller.
- **Helpers de `config/app-config.ts` com default `process.env` (etapa 10).** `appReposDir`, `codexBin`, `codexModel`, `googleApplicationCredentials` e `configurationSummary` continuam com `env = process.env` como default, mas no Nest só são chamados com o env injetado (`RuntimeConfig.processEnv`). Fora de `config/` não há leitura de `process.env`.
- **`vi.stubEnv` em `git/dependencies.spec.ts` (etapa 10).** `dependencyEnvironment` (runner) ainda lê o env do processo; o spec usa `vi.stubEnv` e `vi.unstubAllEnvs` no fim do teste, que não roda se uma asserção falhar. Fora do escopo Nest desta etapa; mover para `afterEach` ou injetar o env junto com a config do runner.
- **`ImpactExecutionService` com config injetada (etapa 10).** `cwd` e env do runner de impacto vêm de `RuntimeConfig`; o filho continua recebendo o env inteiro do processo, como antes (o runner precisa do `.env`/tokens do ClickUp). Revisar a allowlist se o impacto deixar de precisar deles.
- **Sanitização de `results/` unificada (etapa 11).** Reorientação do Chat e `DiagnosisExecutionService.get` usam `ticketResultsDir`; troca de `path.resolve` por `path.join`, equivalente porque `runtime.resultsDir` já é absoluto. Não unificados, por semântica diferente: `impact-execution.service.ts` e `impact-runner.ts` (validam e lançam erro em vez de sanitizar), `git/worktrees.ts` (não é `results/`), `google-chat-threading.ts` (chave de thread com `-`) e `incident-issues.ts` (nome de arquivo).
- **Contexto dos logs do Chat (etapa 11).** Os logs saem com contexto `GoogleChatMessengerService`, `GoogleChatActionsService`, `GoogleChatNotificationsService` ou `GoogleChatConversationService` em vez de `GoogleChatService`; o texto é o mesmo. O router não loga. `google-chat-github-users.ts` ainda cria `new Logger('GoogleChatService')` fixo.
- **Non-null assertions preservadas (etapa 11).** `event.chat!`, `pr.url!`, `remediation!`, `dimension!.level`, `issue.url!` e `invokedFunction!` vieram do service original e foram movidas sem mudança; estreitar com guarda explícita em PR separado.
- **Linha comentada `Ver codex log` (etapa 11).** Botão desabilitado comentado em `google-chat-cards.ts`; mantido para não alterar os snapshots. Remover ou implementar.
- **Trava `acting` só em memória (etapa 11).** `GoogleChatActionsService` evita clique duplo em aprovação com um `Set` no processo; restart ou segunda instância não herdam a trava. Preservado.
- **`normalize` do comando não remove acentos (etapa 11).** A comparação de texto do `/processar`/conversa só faz `trim`/`toLowerCase`. Preservado.
- **Passthroughs `sendText`/`bindTicketThread` removidos (etapa 11).** Comando e reorientação deixaram de passar pelo service grande e injetam `GoogleChatMessengerService`/`GoogleChatThreadsService`; mesmas chamadas e argumentos.
- **Specs do Chat seguem sem tipos (etapa 11).** Os specs novos usam `MemoryState` local e parâmetros sem tipo, como os anteriores; entram no achado dos specs sem typecheck (etapa 1).
