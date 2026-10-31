# Driva Debug App

Aplicação NestJS que executa o diagnóstico de tickets do ClickUp em um cron, envia o resultado ao Google Chat e publica o comentário sugerido no ClickUp após aprovação de um desenvolvedor.

Para expandir o Ops Agent para outra área ou integrar novos repositórios e fontes
operacionais, consulte o [guia de onboarding de nova área e novos serviços](docs/onboarding-nova-area-e-servicos.md).

## Fluxo

1. O cron, a API manual ou o webhook do Grafana enfileiram uma execução de `dist/runner.js` (compilado de `src/runner.ts`) como processo filho do Nest, que seleciona o ticket, gera o diagnóstico e decide a ação de engenharia.
2. O campo customizado `Vetores` define os espaços do Google Chat que receberão o card.
3. O primeiro card é enviado assim que o diagnóstico termina e sinaliza brevemente a decisão e a próxima ação técnica.
4. Quando elegível, um segundo Codex revalida a causa, trabalha em worktrees temporárias isoladas e abre um PR por repositório, sem merge ou deploy. As worktrees locais são removidas ao final.
5. Um segundo card é enviado quando a remediação termina, com resultado, verificações e PRs.
6. Os cliques e mensagens chegam em `POST /google-chat/events`; assumir atribui o ticket ao usuário, aprovar publica o comentário no ClickUp e qualquer mensagem na thread do ticket pergunta sobre aquele diagnóstico.

O estado fica em `state/*.json` (por exemplo `processed.json`, `notifications.json`, `approvals.json` e `chat-ticket-threads.json`). Use disco persistente e uma única instância em regime normal. O protocolo de lease torna segura apenas a sobreposição temporária entre o container antigo e o novo durante deploy/restart; não é suporte a réplicas permanentes.

Cada execução salva em `results/<ticket-id>/` o diagnóstico, comentário para CS, `engineering-action.json`, `remediation.json`, as saídas do Codex, `codex-stderr.log` e `remediation-stderr.log`. O `run.json` só passa para `success` quando a remediação chega a um estado final.

## Arquitetura

A aplicação tem dois processos com o mesmo código TypeScript:

- **App Nest** (`dist/main.js`): HTTP, cron, pool FIFO de execuções e notificações. O pool limita processos filhos e impede o mesmo ticket/incidente de rodar em paralelo, mas deixa outro item elegível usar a vaga. `AppModule` só importa os módulos de feature (`DiagnosisModule`, `GoogleChatEventsModule`, `HealthModule`, `ImpactModule`, `IncidentsModule`, `StorageMaintenanceModule`) e o `ConfigModule` global, que expõe a configuração tipada por tokens.
- **Runners**: `dist/runner.js` executa diagnóstico e remediação; `dist/storage-maintenance/storage-maintenance-runner.js` mede e mantém os caches. Ambos rodam como processos filhos e também podem ser chamados pela CLI. Diagnósticos usam claims por item e leases de leitura dos repositórios; a manutenção exige lease exclusivo antes de medir ou alterar caches e worktrees.

`src/` é organizado por feature: `clickup/`, `github/`, `google-chat/`, `diagnosis/`, `incidents/`, `remediation/`, `impact/`, `health/`, `config/` e `state/`, além de `runner/` (etapas do pipeline) e dos adapters sem Nest `codex/`, `git/` e `common/`. No Chat, `GoogleChatModule` concentra notificações, envio de mensagens e threads; `GoogleChatEventsModule` recebe os eventos em `POST /google-chat/events` (controller, comandos e reorientação).

## Configuração

Requisitos: Node.js 20+ (a imagem usa Node.js 24), Codex CLI autenticado, token do ClickUp, Google Chat API habilitada e credenciais de uma service account com o escopo `chat.bot`.

```bash
cp .env.example .env
npm ci
npm run build
npm start
```

Variáveis principais (a lista completa, com comentários, está no `.env.example`):

- `DIAGNOSIS_CRON`: cron do diagnóstico; padrão `*/5 * * * *`, uma vez a cada 5 minutos.
- `DIAGNOSIS_CRON_ENABLED`: `true` ou `false`; padrão `false`. O cron só roda com `true`.
- `DIAGNOSIS_EXECUTION_CONCURRENCY`: número de processos filhos que o Nest pode executar simultaneamente; padrão `2`. Use `1` para rollback operacional ao comportamento serial. `RUNNER_CONCURRENCY` continua limitando os workers de Codex dentro de um lote automático; com os defaults, um lote pode usar até 3 workers e outro item pode usar a segunda vaga do Nest.
- `STALE_PR_CLEANUP_ENABLED`: `true` ou `false`; padrão `false`. Liga o fechamento automático dos PRs do agente (os registrados em `results/**/remediation.json`) sem atividade há `STALE_PR_MAX_AGE_DAYS` dias (padrão 14), com comentário e remoção da branch, e das issues de incidente do agente (as registradas em `results/**/github-issues.json`) sem atividade há `STALE_ISSUE_MAX_AGE_DAYS` dias (padrão 30), fechadas como "not planned". Issues com responsável ou com PR vinculado ainda aberto não são fechadas; se o incidente voltar, o agente abre uma issue nova. Roda em `STALE_PR_CLEANUP_CRON` (padrão `17 9 * * *`).
- `STORAGE_MAINTENANCE_ENABLED`: padrão `false`. Só habilite o cron depois de calibrar `STORAGE_DEPENDENCY_CACHE_HIGH_MB` e `STORAGE_DEPENDENCY_CACHE_TARGET_MB`; o target deve ser menor que o high. `STORAGE_MAINTENANCE_CRON` usa `43 3 * * *` por padrão.
- `DIAGNOSIS_API_KEY`: token Bearer obrigatório nos endpoints manuais e em `GET /health/dependencies`.
- `GRAFANA_WEBHOOK_TOKEN`: token Bearer aceito em `POST /incidents/grafana`.
- `CLICKUP_API_TOKEN` e `CLICKUP_LIST_ID`: acesso à lista de tickets do ClickUp.
- `CODEX_MODEL` e `DRIVA_PROXY_API_KEY`: modelo e credencial do Codex.
- `GITHUB_AUTH_MODE`: `app` é o modo recomendado em produção; `static` usa `GH_TOKEN` somente para desenvolvimento local e rollback.
- `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_ORGANIZATION`, `GITHUB_APP_HEALTH_REPOSITORY` e `GITHUB_APP_PRIVATE_KEY_FILE`: identidade, repositório-canário e chave montada do GitHub App no modo `app`.
- `GITHUB_DDS_TOKEN`: token read-only independente para GitHub Packages; não é substituído pelo GitHub App.
- `DRIVA_REPOS_DIR`: diretório dos repositórios de produto. Defina explicitamente: o padrão do app é `repos/` no diretório atual, mas o do runner é um caminho absoluto fixo.
- `REMEDIATION_TIMEOUT_MINUTES`: limite da etapa de implementação; padrão 90 minutos.
- `CLICKUP_CREATED_WITHIN_MINUTES`: janela de criação dos tickets; o exemplo considera os últimos 60 minutos.
- `CLICKUP_AREA_VALUES`: array JSON das áreas processadas pela mesma instância, por exemplo `["EN","CS"]`.
- `CLICKUP_VECTORS_FIELD_ID`: ID do campo `Vetores`; confirmado no ClickUp como `ecc43bf8-920f-4d68-a99b-d7397c352e19`.
- `DIAGNOSIS_VECTORS`: objeto JSON obrigatório no formato `{"Nome canônico":"Descrição para o prompt"}`; define os únicos vetores aceitos no diagnóstico.
- `CLICKUP_IN_DEVELOPMENT_STATUS`: status aplicado ao assumir ou aprovar; padrão `7. em desenvolvimento`.
- `GOOGLE_CHAT_VECTOR_SPACES_JSON`: JSON que mapeia cada vetor para seus `spaces/...`.
- `GOOGLE_APPLICATION_CREDENTIALS`: caminho das credenciais da service account, quando não forem fornecidas pelo ambiente.
- `GOOGLE_CLOUD_PROJECT_NUMBER`: número **numérico** do projeto Google Cloud usado pelo Chat App em integrações que precisem identificá-lo; não é o audience do modo recomendado por URL.
- `GOOGLE_CHAT_AUDIENCE`: URL HTTPS **exata** configurada como endpoint de interações, por exemplo `https://ops.example.com/google-chat/events`. É obrigatória quando o Authentication Audience do Chat App está em `HTTP endpoint URL`.
- `GOOGLE_CHAT_ACTION_URL`: callback HTTPS usado em `onClick.action.function` nos cards. É opcional e usa `GOOGLE_CHAT_AUDIENCE` por padrão.
- `GOOGLE_CHAT_CALLER_EMAIL`: service account do deployment HTTP exibida em Google Workspace Marketplace SDK → HTTP Deployments → Authorization Resource.
- `GOOGLE_CHAT_NOTIFY_AFTER`: corte ISO opcional. Quando vazio, todos os resultados bem-sucedidos ainda não entregues são considerados; `state/notifications.json` impede reenvios.
- `GOOGLE_CHAT_CONVERSATION_HISTORY_TURNS`: número máximo de pares de mensagens mantidos no contexto compartilhado da thread; padrão `10`.
- `GOOGLE_CHAT_CONVERSATION_MAX_MESSAGE_LENGTH`: tamanho máximo de uma pergunta; padrão `4000` caracteres.
- `GOOGLE_CHAT_CONVERSATION_TIMEOUT_MINUTES`: timeout de uma resposta do Codex; padrão `10` minutos.
- `GOOGLE_CHAT_REORIENTATION_MAX_MESSAGE_LENGTH`: tamanho máximo de uma orientação de nova remediação; padrão `4000` caracteres.
- `GOOGLE_CHAT_REORIENTATION_CONFIRMATION_MINUTES`: validade do card de confirmação da reorientação; padrão `60` minutos.
- `GITHUB_CHAT_USER_MAP`: JSON que mapeia e-mail do Google Chat para login do GitHub; sem mapeamento, a issue do incidente fica sem assignee.

Exemplo de mapeamento:

```env
GOOGLE_CHAT_VECTOR_SPACES_JSON={"Sequências":["spaces/AAAA"],"Conversas/Métricas":["spaces/AAAA"],"Conexões":["spaces/AAAA"]}
```

O MCP do ClickUp confirmou para EN os valores `Sequências`, `Conversas/Métricas` e `Conexões`. O campo global possui outros valores, mas o mapeamento acima cobre os três agrupamentos iniciais solicitados.

## Manutenção de storage

Depois do build, o modo padrão apenas mede e planeja:

```bash
npm run storage-maintenance -- --dry-run
```

A execução manual aplica poda dos caches dedicados, `git gc --auto` e remoção de worktrees temporárias elegíveis. Se a poda não reduzir o cache abaixo do target configurado, ela reseta cache, fingerprints e instalações gerenciadas e sincroniza as dependências novamente:

```bash
npm run storage-maintenance -- --execute
```

Os relatórios são JSON nos logs do processo. A manutenção nunca seleciona `results/`, `secrets/`, outros JSONs de `state/` ou clones inteiros para remoção. O cron permanece desligado até a calibração manual dos limites.

### Autenticação do GitHub

Em produção, use `GITHUB_AUTH_MODE=app` com um GitHub App pertencente à organização e instalado com **Only select repositories**. A seleção deve incluir todos os repositórios configurados para diagnóstico ou remediação e os repositórios privados usados como submódulos.

Permissões de repositório do App:

- Metadata: read-only;
- Contents: read and write;
- Pull requests: read and write;
- Issues: read and write;
- Actions: read-only;
- Checks: read-only.

Não conceda Workflows, Administration, Deployments, Environments nem bypass de branch protection ou rulesets. O agente abre branches e PRs, mas nunca faz merge ou deploy.

O App autentica pushes, PRs, issues e comentários, que aparecem como ações do bot. A autoria dos commits continua separada e vem de `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` e `GIT_COMMITTER_EMAIL`; configure uma identidade de serviço explícita.

Tokens de instalação expiram e não devem ser persistidos. O adapter controlado obtém uma credencial por chamada; durante remediações longas, o wrapper de `gh` e o credential helper HTTPS do Git renovam a credencial no momento do uso. `GITHUB_AUTH_MODE=static` com `GH_TOKEN` permanece disponível somente para desenvolvimento local e rollback. `GITHUB_DDS_TOKEN` continua sendo a credencial independente de GitHub Packages.

O vetor usado no roteamento não é confiado ao valor inicial do ticket. Ele é inferido
ao final do diagnóstico entre esses três valores, salvo nos artefatos da execução e usado
para escolher os espaços do Google Chat. Se divergir do ClickUp, o runner atualiza o campo
`Vetores` antes de liberar a notificação.

## Rotas

- `GET /health`: verificação básica da aplicação.
- `GET /health/dependencies`: verifica comandos (`codex`, `gh`, `git`, `go`, `pnpm`), diretórios graváveis e configuração; exige `DIAGNOSIS_API_KEY`.
- `POST /incidents/grafana`: webhook de alertas do Grafana; exige `GRAFANA_WEBHOOK_TOKEN`.
- `POST /google-chat/events`: endpoint público configurado no Google Chat App.
- `POST /diagnoses`: inicia uma execução assíncrona manual e retorna `runId`.
- `GET /diagnoses/:runId`: retorna o estado `queued`, `running`, `completed`, `failed` ou `interrupted`.
- `POST /impacts`: recalcula assincronamente apenas o impacto de um ticket já diagnosticado.
- `GET /impacts/:runId`: retorna o estado e, ao concluir, o snapshot e histórico do impacto.

Exemplo manual:

```bash
curl -X POST http://localhost:3000/diagnoses \
  -H "Authorization: Bearer $DIAGNOSIS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"ticketId":"86ajppg5v","force":true,"notify":true,"remediation":"auto","googleChatSpace":"spaces/AAAA"}'

curl http://localhost:3000/diagnoses/SEU_RUN_ID \
  -H "Authorization: Bearer $DIAGNOSIS_API_KEY"
```

`remediation` aceita `none` (somente diagnóstico), `plan` (diagnóstico e plano sem alterações) e `auto` (implementação e PR quando elegível). `googleChatSpace` aceita o recurso `spaces/...` ou somente o ID da DM do app e, quando informado, envia os cards somente para essa conversa, ignorando os espaços configurados pelos vetores. `googleChatUser` continua aceito como alias temporário. O ticket manual ignora a janela de criação; `force: true` também ignora `processed.json`. Cron, API, incidentes e reorientações compartilham o mesmo pool. O cron mantém no máximo um lote em voo.

Antes de processar um item, o runner registra um leitor dos repositórios. Se outro leitor já estiver ativo, a nova execução usa os HEADs atuais sem sincronizar e grava `repository_sync.status = "skipped"` no `run.json`; sem leitores, sincroniza e grava `"synced"`. Locks, leitores e claims usam lease de 2 minutos com heartbeat. Em restart, execuções sem heartbeat viram `interrupted` e são retomadas no máximo duas vezes. Quando o diagnóstico persistido está em `diagnosed` com remediação `pending`, a retomada reutiliza os artefatos e executa somente a remediação. Diretórios `.stale-*` preservam evidência de owners mortos; o antigo `state/diagnosis.lock` é inerte e pode ser removido.

Para recalcular somente o impacto usando os artefatos existentes e as fontes operacionais
disponíveis, sem diagnóstico completo, remediação ou escrita no ClickUp:

```bash
curl -X POST http://localhost:3000/impacts \
  -H "Authorization: Bearer $DIAGNOSIS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"ticketId":"86ajppg5v"}'

curl http://localhost:3000/impacts/SEU_RUN_ID \
  -H "Authorization: Bearer $DIAGNOSIS_API_KEY"
```

O ticket precisa possuir `results/<ticketId>/ticket.json` e estar classificado como `bug`
confirmado em `run.json`. Outras classificações são ignoradas e não recebem score. Cada
execução elegível atualiza `customer-impact.json` e acrescenta uma avaliação a
`customer-impact-history.json`.

Para desenvolvimento local, `GOOGLE_CHAT_SKIP_AUTH=true` desativa a validação do evento. Nunca use essa opção em produção.

O botão chama o próprio `POST /google-chat/events`. Para simular localmente uma aprovação já registrada em `state/approvals.json`, use o mesmo formato de evento do Google Chat:

```bash
curl -X POST http://localhost:3000/google-chat/events \
  -H 'Content-Type: application/json' \
  -d '{"commonEventObject":{"invokedFunction":"approve_cs_comment","parameters":{"approvalId":"ID_DA_APROVACAO"}},"space":{"name":"spaces/AAAA"},"user":{"displayName":"Teste local"}}'
```

Essa simulação exige `GOOGLE_CHAT_SKIP_AUTH=true`, e `spaces/AAAA` deve ser um dos espaços gravados na aprovação. Em produção, mantenha `GOOGLE_CHAT_SKIP_AUTH=false`.

O botão `Assumir ticket` usa o e-mail do usuário do Google Chat para localizar o mesmo membro no ClickUp, substitui os assignees por ele, move a task para `7. em desenvolvimento` e marca `Assumido por humano`.
Depois da assunção, o app publica um aviso em cada conversa que recebeu o diagnóstico. Os envios ficam em `state/assumption-notifications.json`, são idempotentes por aprovação e espaço e falhas são tentadas novamente durante as próximas varreduras de notificação.

Cada `(ticket, espaço)` possui uma thread canônica. O diagnóstico abre ou reutiliza essa thread; plano de ação, avisos de assunção, falhas e respostas posteriores usam o mesmo endereço. Qualquer mensagem comum enviada por um participante nessa thread é tratada como pergunta exclusiva sobre o ticket, sem botão, DM ou ativação de sessão. O Codex começa com os artefatos do diagnóstico e, quando eles não bastam, pode usar `$driva-debug`, ler a codebase e o histórico git e consultar as fontes operacionais disponíveis. Esse fluxo de perguntas permanece somente leitura. A única exceção é uma resposta que cite diretamente a mensagem de `Ação técnica`: ela cria uma proposta de reorientação, exige confirmação do mesmo usuário e então executa uma nova remediação. Os PRs anteriores são fechados apenas nos repositórios que receberam substitutos válidos; falhas preservam os PRs existentes. As iterações ficam em `results/<ticket-id>/remediations/` e o controle em `state/remediation-reorientations.json`. `/ajuda` e `/contexto` continuam disponíveis; o vínculo e o histórico curto compartilhado ficam em `state/chat-ticket-threads.json`.

O comando `/processar <link-do-clickup>` inicia o fluxo manual completo, com remediação
automática quando elegível, e envia o resultado para a conversa solicitante. Ele aceita
IDs internos e custom IDs, como `https://app.clickup.com/t/90131820938/TICKET-27829`.
Para exibi-lo no autocomplete, cadastre `/processar` como slash command na configuração
da Google Chat API e use o mesmo ID em `GOOGLE_CHAT_PROCESS_COMMAND_ID` (padrão `1`).

O comando `/comunicacao` usa `GOOGLE_CHAT_COMMUNICATION_COMMAND_ID` (padrão `2`), `GOOGLE_CHAT_NEWS_SPACE`,
`COMMUNICATION_CODEX_MODEL` (padrão `CODEX_MODEL`) e `COMMUNICATION_TIMEOUT_MINUTES` (padrão `20`).
Tickets Form Response de melhoria, na própria task ou nas subtarefas diretas, são citados pelo campo `Dono`.
O rascunho mostra `@Nome` sem notificar. Só na aprovação o app consulta os membros do espaço de novidades
para publicar menções por ID do Google Chat. Sem identidade resolvida, mantém a citação pelo nome e avisa
quem aprovou; o app e as pessoas citadas precisam ter acesso ao espaço para essa resolução.

### Configuração do Chat App dedicado

No projeto Google Cloud do novo app:

1. Habilite a Google Chat API e configure o nome, avatar e descrição do app.
2. Habilite os recursos interativos e selecione conexão por endpoint HTTP.
3. Use `https://<host>/google-chat/events` como endpoint de interações.
4. Disponibilize o app para os usuários/grupos da Driva que poderão usá-lo e adicione-o aos espaços com threads onde os tickets serão publicados.
5. Adicione o novo app aos espaços mantidos em `GOOGLE_CHAT_VECTOR_SPACES_JSON`.
6. Use a service account do projeto em `GOOGLE_APPLICATION_CREDENTIALS` e configure `GOOGLE_CHAT_AUDIENCE` com a URL exata informada no endpoint de interações.
7. Configure `GOOGLE_CHAT_CALLER_EMAIL` com o **Service Account Email** exibido em Google Workspace Marketplace SDK → HTTP Deployments → Authorization Resource (normalmente `service-<project-number>@gcp-sa-gsuiteaddons.iam.gserviceaccount.com`).
8. Em **Authentication Audience**, selecione **HTTP endpoint URL** e mantenha `GOOGLE_CHAT_AUDIENCE` idêntico ao endpoint, incluindo caminho e eventual barra final.
9. Mantenha `GOOGLE_CHAT_SKIP_AUTH=false` em produção.

Os comandos da conversa são interpretados dentro da thread do ticket pelo próprio agente; não é necessário cadastrá-los como comandos separados no Console.

### O que é `GOOGLE_CHAT_AUDIENCE`

O Google Chat envia um ID token ao chamar o endpoint HTTPS quando **Authentication Audience** está configurado como **HTTP endpoint URL**. Nesse modo, recomendado para um servidor HTTP próprio, o `audience` (`aud`) é a URL exata do endpoint:

```env
GOOGLE_CHAT_AUDIENCE=https://<host>/google-chat/events
```

A comparação é literal: protocolo, host, caminho e barra final precisam coincidir com a configuração do Google Chat. O modo alternativo **Project Number** produz um JWT autossinado e requer outro procedimento de verificação; este app usa o modo por URL.

Em deployments HTTP do Workspace Add-ons, `onClick.action.function` também deve
conter uma URL HTTPS completa, não um nome de função local. Por padrão, os cards
usam `GOOGLE_CHAT_AUDIENCE`; configure `GOOGLE_CHAT_ACTION_URL` somente se o
callback das ações precisar ser diferente.

## Comandos

```bash
npm ci                      # instala as dependências (package-lock.json)
npm run start:dev           # Nest em watch
npm run build               # nest build → dist/
npm start                   # node dist/main.js
npm test                    # Vitest
npm run lint                # eslint --max-warnings 0
npm run format              # prettier
npm run diagnose -- --help  # runner em modo CLI; roda dist/, execute npm run build antes
npm run dry-run             # seleciona tickets sem chamar o Codex nem alterar estado
npm run impact -- --ticket-id=86ajppg5v
npm run notify
node dist/runner.js --ticket-id=86ajppg5v --force --remediation=auto
```

`npm run notify` não executa um novo diagnóstico: ele apenas tenta entregar ao Google Chat os resultados bem-sucedidos ainda não marcados como enviados e registra tentativas, erros e respostas em `state/notifications.json`.

## Publicação

O endpoint do Google Chat precisa estar disponível por HTTPS. A aplicação roda em um único container no Dokku (`git push` para o remote `automacoes-driva`); o agendamento pertence ao NestJS. Detalhes de deploy em [`docs/DEPLOY_HANDOFF.md`](docs/DEPLOY_HANDOFF.md) e da integração com o Chat em [`docs/GOOGLE_CHAT_HANDOFF.md`](docs/GOOGLE_CHAT_HANDOFF.md).
