# Onboarding de nova área e novos serviços

Este é o caminho curto para colocar outra área no Driva Ops Agent com segurança. A
expansão está pronta quando o agente seleciona os tickets certos, consulta código e
fontes read-only, notifica o time correto e consegue abrir um PR sem merge ou deploy.

## Antes de começar

As áreas usam a mesma instância, lista e campos globais do ClickUp. A instância recebe a
união das áreas, vetores, repositórios, skills e credenciais necessárias. Isso mantém um
único endpoint do Google Chat e um único estado para `/processar`, cards e threads.

`/processar` pode receber qualquer ticket intencionalmente. Tickets fora do domínio podem
terminar inconclusivos ou sem espaço elegível para notificação; isso não precisa ser
bloqueado no onboarding.

`DIAGNOSIS_VECTORS` é a fonte única dos nomes aceitos e das descrições inseridas no prompt.
Use um objeto JSON `{"Nome canônico":"Descrição para o prompt"}`. O runner rejeita a
configuração ausente, vazia, malformada ou com nomes duplicados após normalização.
`GOOGLE_CHAT_VECTOR_SPACES_JSON` continua responsável apenas pelo roteamento dos mesmos
nomes canônicos para espaços.

## Quickstart

### 1. Defina o escopo

Antes de configurar, registre:

- código e owner da área;
- vetores e respectivos espaços do Google Chat;
- repositórios envolvidos;
- banco, logs, traces ou client sessions disponíveis;
- comandos seguros de teste/build de cada serviço.

Um serviço que depende de write em produção, retry, requeue, login real ou reprodução
em conta de cliente ainda não está pronto. Crie primeiro uma fonte read-only ou um
ambiente controlado.

### 2. Configure o ClickUp

As áreas usam a mesma lista e os mesmos campos. Mantenha as configurações atuais e inclua
todos os valores aceitos em `CLICKUP_AREA_VALUES`, um array JSON como `["EN","Nova Área"]`.
O cron seleciona somente tasks que atendem a:

- lista `CLICKUP_LIST_ID`;
- custom task type `CLICKUP_TASK_TYPE_ID`;
- `Tipo do Ticket = Bug`;
- `Área` contida em `CLICKUP_AREA_VALUES`;
- janela `CLICKUP_CREATED_WITHIN_MINUTES`;
- status/tags opcionais;
- task não fechada.

Não é necessário recriar nem redescobrir `CLICKUP_LIST_ID`, field IDs, option IDs, task
type ou status enquanto a lista compartilhada continuar a mesma.

### 3. Adicione os repositórios

Clone cada repositório em `DRIVA_REPOS_DIR`. O runner sincroniza repositórios existentes,
mas não executa o primeiro clone. Não é necessário entrar no container web: depois de
montar o volume, use um one-off da própria app:

```bash
dokku run "$APP_NAME" bash -lc '
  cd "$DRIVA_REPOS_DIR"
  gh repo clone Driva-tecnologia/novo-service novo-service
  cd novo-service
  git switch main
'
```

O mount precisa estar habilitado também para `run`. Como alternativa, clone diretamente
no diretório persistente do host e ajuste o owner para o UID/GID da imagem. O runner exige
checkout limpo, branch local `main`, `origin/main` e fast-forward possível.

Para cada serviço, anote em poucas linhas:

```yaml
service: novo-service
repository: Driva-tecnologia/novo-service
path: novo-service
owner: equipe
runtime_names: [nome-nos-logs]
package_manager: npm|pnpm|go
boundaries: [http, queue, webhook, callback]
correlation_keys: [trace_id, request_id]
sources: [postgres, clickhouse]
checks: ['npm test', 'npm run build']
```

Se o projeto precisa de dependências, inclua-o em `dependencyProjects()` de
`src/runner.js`. Hoje são suportados npm, pnpm e Go. Outro package manager ou linguagem
exige suporte no runner e, possivelmente, no `Dockerfile`.

Submódulos do LinkedIn possuem bootstrap especial. Não suponha que novos submódulos serão
inicializados automaticamente.

### 4. Crie as skills read-only

Para backend com banco e logs, o conjunto recomendado é:

```text
<repo>/.codex/skills/
  <service>-debug/SKILL.md
  <service>-db-read/SKILL.md
  <service>-logs-read/SKILL.md
```

A skill `debug` explica o fluxo. As skills de DB/logs contêm wrappers aprovados. Para
frontend, crie uma skill de client sessions quando houver RUM/replay.

Todo wrapper de produção deve:

- usar credencial read-only também no servidor;
- rejeitar mutações e múltiplas statements;
- exigir `LIMIT`; logs também exigem janela temporal;
- limitar linhas, bytes e timeout;
- redigir tokens, cookies, headers e dados pessoais;
- nunca imprimir connection strings ou env vars;
- retornar erro claro sem generalizar a indisponibilidade das outras fontes.

Atualize o orquestrador:

- `repos/.codex/skills/driva-debug/SKILL.md` — quando usar o serviço;
- `references/service-map.md` — produtor, consumidor e chaves de correlação;
- `references/playbooks.md` — sintomas frequentes e ordem de investigação.

### 5. Configure env vars e health

Atualize a instância existente. Separe as variáveis assim:

| Atualizar para abranger todas as áreas      | Permanece compartilhado                                         |
| ------------------------------------------- | --------------------------------------------------------------- |
| `CLICKUP_AREA_VALUES`                       | `CLICKUP_API_TOKEN`, `CLICKUP_LIST_ID` e demais IDs `CLICKUP_*` |
| `DIAGNOSIS_VECTORS`                         | `CODEX_HOME`, `CODEX_BIN`, `CODEX_MODEL`, `DRIVA_PROXY_API_KEY` |
| `GOOGLE_CHAT_VECTOR_SPACES_JSON`            | `DIAGNOSIS_API_KEY`, cron, timeouts e concorrência              |
| Credenciais das skills de todos os serviços | Credenciais Google/Chat                                         |
| Tokens de pacotes privados dos novos repos  | Identidade e token GitHub, conforme permissões                  |

`CLICKUP_AREA_VALUE` continua aceito apenas para migração de uma configuração antiga com
uma área. Para o onboarding multiárea, use `CLICKUP_AREA_VALUES`.

#### O mais importante: env vars das skills

Para cada skill nova, identifique primeiro onde o wrapper lê configuração:

1. `.env` do próprio repositório; ou
2. `process.env` do subprocesso Codex.

Use prefixos por serviço no Dokku, por exemplo `NOVO_SERVICE_POSTGRES_*`. O mapping fica
em `src/runner.js`:

- `diagnosisEnvFiles`: converte env vars prefixadas em `.env` local `0600`;
- `codexEnvironment()`: libera somente vars lidas diretamente pela skill;
- `dependencyEnvironment()`: libera tokens necessários apenas durante instalação.

Se a skill espera nomes genéricos como `POSTGRES_HOST`, configure o mapping assim:

```js
{
  name: 'novo-service',
  filename: (reposDir) => path.join(reposDir, 'novo-service', '.env'),
  variables: [
    { source: 'NOVO_SERVICE_POSTGRES_HOST', target: 'POSTGRES_HOST', required: true },
    { source: 'NOVO_SERVICE_POSTGRES_USERNAME', target: 'POSTGRES_USERNAME', required: true },
    { source: 'NOVO_SERVICE_POSTGRES_PASSWORD', target: 'POSTGRES_PASSWORD', required: true },
    { source: 'NOVO_SERVICE_POSTGRES_DATABASE', target: 'POSTGRES_DATABASE', required: true },
  ],
}
```

Configuração parcial deve falhar. Não logue valores nem versione `.env`.

Depois, documente as novas vars em `.env.example`, configure-as no Dokku e adicione a
capability em `src/health/health.controller.ts`. O smoke test precisa funcionar dentro do
Codex, não apenas no shell do container. Diagnóstico não recebe `GH_TOKEN`; remediação
recebe.

O health deve exigir apenas os serviços usados pela instância, nunca credenciais falsas
para ficar verde.

Use os endpoints de health como primeira fonte para conferir o setup:

- `GET /health` confirma apenas que o processo HTTP está respondendo;
- `GET /health/dependencies` valida toolchains, autenticação do GitHub, quantidade de
  repositórios, escrita nos volumes e presença das configurações e credenciais das fontes.

O health detalhado exige o mesmo Bearer de `DIAGNOSIS_API_KEY`:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $DIAGNOSIS_API_KEY" \
  "$APP_URL/health/dependencies"
```

Só avance quando `status` for `ok`. Se retornar `degraded`, use `checks` para identificar
exatamente o comando, diretório ou grupo de configuração ausente; depois confirme a fonte
com seu smoke test, porque o health verifica disponibilidade/configuração, não executa uma
consulta real no serviço.

### 6. Configure Google Chat e deploy

O Chat App, slash command, service account, audience, endpoint e instância continuam os
mesmos. No console do Google Chat, normalmente basta:

1. disponibilizar o app para a nova equipe, se ela ainda não tiver acesso;
2. adicionar o app aos novos espaços que receberão diagnóstico.

O mapping vetor → espaço não fica no console: inclua todos os vetores em
`GOOGLE_CHAT_VECTOR_SPACES_JSON`. O único endpoint recebe `/processar`, callbacks de cards
e mensagens de todas as áreas, preservando idempotência e vínculos de thread no mesmo
`state`.

No Dokku, mantenha uma app com `web=1` e os volumes persistentes atuais:

```text
/var/lib/dokku/data/storage/driva-ops-agent/repos   → /app/repos
/var/lib/dokku/data/storage/driva-ops-agent/state   → /app/state
/var/lib/dokku/data/storage/driva-ops-agent/results → /app/results
<credencial-google-compartilhada>                   → /app/secrets/google-credentials.json:ro
```

Todos os diagnósticos ficam na mesma árvore `results/`, gravada por uma única instância.

Comece sempre com:

```bash
dokku config:set --no-restart "$APP_NAME" \
  CLICKUP_AREA_VALUES='["EN","Nova Área"]' \
  DRIVA_REPOS_DIR=/app/repos \
  CODEX_HOME=/app/codex \
  DIAGNOSIS_CRON_ENABLED=false \
  GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/google-credentials.json \
  GOOGLE_CHAT_SKIP_AUTH=false
```

Complete com a união de vetores, mappings e credenciais da seção anterior. Não é
necessário recriar o Chat App.

Rede NetBird, DNS, mounts, Bubblewrap e capabilities já validados estão detalhados em
[`DEPLOY_HANDOFF.md`](DEPLOY_HANDOFF.md). Não use Docker socket nem `--privileged`.

### 7. Valide e só então ligue o cron

Validação local:

```bash
npm ci
npm test
npm run check
bash -n docker/entrypoint.sh
git diff --check
docker build -t driva-ops-agent:onboarding .
```

Com a app publicada e o cron desligado:

```bash
sh -c 'unshare --user true && echo namespace_ok'
bwrap --ro-bind / / --proc /proc --dev /dev true && echo bwrap_ok
node dist/runner.js --sync-dependencies-only
node dist/runner.js --sync-dependencies-only
```

A segunda sincronização deve informar `Dependencies ready`, sem alterar repositórios.
Depois, exija `GET /health/dependencies` com `status=ok` e execute o smoke test de cada
fonte diretamente e através do Codex — isso detecta diferenças de env, filesystem e rede
do sandbox.

Canário sem notificação:

```bash
node dist/runner.js \
  --ticket-id=<ticket-id> \
  --force \
  --remediation=plan \
  --no-notify
```

O canário só passa se usar código/Git e ao menos uma fonte operacional independente,
correlacionar as fronteiras necessárias, não escrever em produção e salvar artefatos
com vetor e etapa corretos. Output bem formatado sem evidência real não conta.

Em seguida:

1. repita com notificação e confira o espaço;
2. teste assumir, aprovar, perguntas na thread e `/processar` com um ticket fora do domínio,
   confirmando que ele termina com segurança como inconclusivo ou sem destinatário elegível;
3. faça uma remediação controlada e confirme teste, branch, commit, push e PR;
4. confirme que não houve merge/deploy e que a worktree temporária foi removida;
5. reinicie a app e confirme que não há notificação duplicada;
6. habilite o cron e observe dois ciclos.

Rollback:

```bash
dokku config:set "$APP_NAME" DIAGNOSIS_CRON_ENABLED=false
```

Não apague volumes durante rollback.

## Pontos de código para revisar ao adicionar serviço/área

| Ponto                      | Motivo                                                 |
| -------------------------- | ------------------------------------------------------ |
| `dependencyProjects()`     | Instalar dependências do serviço                       |
| `diagnosisEnvFiles`        | Materializar credenciais prefixadas                    |
| `dependencyEnvironment()`  | Token de pacote privado                                |
| `codexEnvironment()`       | Env disponível ao subprocesso                          |
| `health.controller.ts`     | Readiness da nova fonte                                |
| `.env.example`             | Documentar variáveis sem valores                       |
| `Dockerfile`               | Novo runtime/CLI                                       |
| `docker/codex/config.toml` | Rede e paths do sandbox                                |
| `driva-debug/**`           | Roteamento e fronteiras                                |
| `DIAGNOSIS_VECTORS`        | Fonte única dos vetores validados e exibidos no prompt |

## Checklist de conclusão

- [ ] Uma única instância usa `web=1` e volumes persistentes para `state`, `repos` e `results`.
- [ ] `CLICKUP_AREA_VALUES` contém todas as áreas atendidas pelo cron.
- [ ] ClickUp seleciona o ticket elegível e rejeita outro tipo/área.
- [ ] `/processar` aceita qualquer ticket e falha com segurança quando não há diagnóstico
      conclusivo ou vetor destinatário elegível.
- [ ] `DIAGNOSIS_VECTORS` alimenta classificador e prompt e coincide com o mapping do Chat.
- [ ] Repositórios estão limpos e sincronizados com `origin/main`.
- [ ] Dependências e toolchains funcionam no container.
- [ ] Skills e credenciais server-side são read-only.
- [ ] Service map registra fronteiras e chaves de correlação.
- [ ] Health e smoke tests funcionam dentro do Codex.
- [ ] Canários de diagnóstico, notificação e PR passaram.
- [ ] Cron foi habilitado por último e observado por dois ciclos.
- [ ] Owner conhece o rollback.

## Problemas comuns

- **Nenhum ticket:** revise lista, janela, task type, `Tipo do Ticket`, área, status e tags.
- **ClickUp 400:** confirme que a configuração compartilhada de fields/options foi copiada
  sem alterações da instância existente.
- **Vetor rejeitado:** confira `DIAGNOSIS_VECTORS` e `GOOGLE_CHAT_VECTOR_SPACES_JSON`.
- **Repo encontrado, dependências ausentes:** falta em `dependencyProjects()` ou manager
  não suportado.
- **Repo dirty após install:** identifique quem alterou o lockfile; não faça restore amplo.
- **Skill existe, mas não roda:** revise path `.codex/skills`, description, cwd,
  orquestrador e permissões do sandbox.
- **Wrapper funciona no shell, não no Codex:** revise allowlist, `.env`, runtime, path e
  rede do subprocesso.
- **Health degraded:** adapte capabilities ao escopo; não configure credencial falsa.
- **Google Chat 401:** audience literal, caller email, subpath e arquivo de credencial.
- **Execução duplicada:** confirme `web=1`, um único cron e um único endpoint ativo do Chat.
- **PR não abre:** `GH_TOKEN`, `gh auth status`, identidade Git, remote e permissão no repo.

## Melhorias que evitam repetir esse trabalho

Prioridade sugerida:

1. criar manifests declarativos de áreas e serviços;
2. gerar dependency sync, env e health a partir desses manifests;
3. trocar token pessoal por GitHub App/bot com escopo por repositório;
4. rejeitar automaticamente diagnóstico “bem-sucedido” sem fonte técnica independente;
5. substituir gradualmente os perfis `unconfined` por perfis mínimos validados.
